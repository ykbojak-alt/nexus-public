//! Локальный ферм-контур (QODER NUE-DECK-LOCAL, волна 6).
//!
//! Вариант A: локальная сессия `nx connect` (stdio, framed JSON-RPC) внутри
//! `crates/nue-host` + whitelist-проекции 1:1 с `farm-mirror` на remote-host.
//! Никаких секретов и реальных путей наружу: все проекции — whitelist,
//! свободный текст чистится (`_clean_text`), home-сегменты маскируются.
//!
//! Формы ответов повторяют живое зеркало :5685 (сняты замером с :4433):
//!   /api/deck/{status,agents,terminals,machines,roster}
//!   /api/core/{agents,terminals,machines,server,spaces,ratings,events}
//! SSE: /api/deck/events (envelope `event: nx`) и /api/core/events (flat).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Длина заголовка кадра: channel u32 LE + kind u8 + len u32 LE.
const FRAME_HEADER: usize = 9;
const KIND_DATA: u8 = 0;
const KIND_CREDIT: u8 = 1;
const DATA_MAX: usize = 1 << 20; // защита от огромного кадра
const TEXT_LIMIT: usize = 160;

// ---------------------------------------------------------------------------
// Ошибки

#[derive(Debug)]
pub enum FarmError {
    /// `nx connect` не запустился / нет бинаря.
    Spawn(String),
    /// hello не пришёл или ядро отказало.
    Hello(String),
    /// потеряно соединение с ядром.
    Lost(String),
    /// RPC-ошибка от ядра (сообщение).
    Rpc(String),
    /// таймаут ответа.
    Timeout(String),
}

impl std::fmt::Display for FarmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(m) | Self::Hello(m) | Self::Lost(m) | Self::Rpc(m) | Self::Timeout(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for FarmError {}

fn map_io(ctx: &str, e: std::io::Error) -> FarmError {
    FarmError::Lost(format!("{ctx}: {e}"))
}

// ---------------------------------------------------------------------------
// Санитайзеры (порт из farm-mirror)

/// `_HOME_RE` без regex-крейта: `([A-Za-z]:\Users\|/home/|/Users/)[^\\/\s]+`
fn mask_home(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let prefix_len = if i + 7 < b.len()
            && b[i].is_ascii_alphabetic()
            && b[i + 1] == b':'
            && b[i + 2] == b'\\'
            && &b[i + 3..i + 9] == b"Users\\"
        {
            Some(9)
        } else if b[i..].starts_with(b"/home/") {
            Some(6)
        } else if b[i..].starts_with(b"/Users/") {
            Some(7)
        } else {
            None
        };
        match prefix_len {
            Some(plen) => {
                out.extend_from_slice(&b[i..i + plen]);
                out.extend_from_slice(b"***");
                i += plen;
                while i < b.len() && !matches!(b[i], b'/' | b'\\' | b' ' | b'\t') {
                    i += 1;
                }
            }
            None => {
                out.push(b[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `_clean_text`: контрольные символы (кроме \n \t) убираются, текст режется
/// до 160 симв., home-сегменты маскируются.
pub fn clean_text(v: &Value) -> Value {
    let Some(s) = v.as_str() else { return v.clone() };
    let cleaned: String = s
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || u32::from(*c) >= 32)
        .take(TEXT_LIMIT)
        .collect();
    Value::String(mask_home(&cleaned))
}

/// `_safe_value`: whitelist ключей для экранирования текста в событиях.
fn safe_value(key: &str, val: &Value) -> Value {
    match val {
        Value::Null | Value::Bool(_) | Value::Number(_) => val.clone(),
        Value::String(_) => {
            let known = matches!(
                key,
                "title" | "name" | "msg" | "message" | "text" | "label" | "where"
                    | "state" | "app" | "turn" | "terminal" | "address" | "type"
                    | "method" | "id" | "kind" | "reason" | "session" | "event" | "seq"
            );
            if known { clean_text(val) } else { Value::Null }
        }
        Value::Array(a) => {
            let out: Vec<Value> = a.iter().map(|v| safe_value(key, v)).filter(|v| !v.is_null()).collect();
            if out.is_empty() { Value::Null } else { Value::Array(out) }
        }
        Value::Object(o) => {
            let out: serde_json::Map<String, Value> = o
                .iter()
                .filter_map(|(k, v)| {
                    let sv = safe_value(k, v);
                    if sv.is_null() { None } else { Some((k.clone(), sv)) }
                })
                .collect();
            if out.is_empty() { Value::Null } else { Value::Object(out) }
        }
    }
}

/// Типы событий, которые проходят по whitelist (как `_EVENT_TYPES`).
const EVENT_TYPES: &[&str] = &[
    "status", "title", "turn", "created", "finished", "lost", "removed", "keep",
    "labels", "size", "foreground", "doc",
];

/// `_clean_frame`: из raw-сообщения события оставляем только безопасный envelope.
fn clean_frame(raw: &Value) -> Value {
    let Value::Object(o) = raw else { return json!({}) };
    let mut frame = serde_json::Map::new();
    for k in ["jsonrpc", "method"] {
        if let Some(Value::String(s)) = o.get(k) {
            frame.insert(k.to_string(), Value::String(s.clone()));
        }
    }
    if let Some(Value::Object(params)) = o.get("params") {
        let mut p = serde_json::Map::new();
        for k in ["type", "terminal", "seq"] {
            if let Some(v) = params.get(k) {
                match v {
                    Value::Null | Value::Bool(_) | Value::Number(_) => { p.insert(k.to_string(), v.clone()); }
                    Value::String(_) => { p.insert(k.to_string(), clean_text(v)); }
                    _ => {}
                }
            }
        }
        let etype = p.get("type").and_then(Value::as_str).unwrap_or("");
        if EVENT_TYPES.contains(&etype) {
            if let Some(Value::Object(_)) = params.get("data") {
                let kept = safe_value("data", &params["data"]);
                if let Value::Object(kept) = kept {
                    p.insert("data".to_string(), Value::Object(kept));
                } else {
                    p.insert("data".to_string(), json!({}));
                }
            } else {
                p.insert("data".to_string(), json!({}));
            }
        } else {
            p.insert("data".to_string(), json!({}));
        }
        frame.insert("params".to_string(), Value::Object(p));
    }
    Value::Object(frame)
}

// ---------------------------------------------------------------------------
// Проекции (1:1 с зеркалом)

fn terminal_state(t: &Value) -> String {
    String::from(t.get("state").and_then(Value::as_str).unwrap_or(""))
}

fn terminal_status(t: &Value) -> Value {
    match t.get("status") {
        Some(v) if v.is_object() => v.clone(),
        _ => json!({}),
    }
}

fn terminal_labels(t: &Value) -> Value {
    match t.get("labels") {
        Some(v) if v.is_object() => v.clone(),
        _ => json!({}),
    }
}

fn machine_of(addr: &str) -> String {
    match addr.split_once('/') {
        Some((m, _)) => m.to_string(),
        None => "local".to_string(),
    }
}

fn term_id(addr: &str) -> String {
    match addr.split_once('/') {
        Some((_, t)) => t.to_string(),
        None => addr.to_string(),
    }
}

/// Сортировка терминалов по `address` — как в зеркале
/// (`sorted(_terminals.values(), key=lambda t: str(t.get("address", "")))`).
fn sort_by_address(mut rows: Vec<Value>) -> Vec<Value> {
    rows.sort_by_key(|t| String::from(t.get("address").and_then(Value::as_str).unwrap_or("")));
    rows
}

/// `_core_state` (OSC-7501 lifecycle): dead/exited/finished -> exited;
/// agent_state working|blocked|idle|done -> verbatim; иначе idle.
fn core_state(t: &Value) -> String {
    match terminal_state(t).as_str() {
        "dead" | "exited" | "finished" => return "exited".to_string(),
        _ => {}
    }
    let status = terminal_status(t);
    let agent_state = status.get("state").and_then(Value::as_str).unwrap_or("");
    match agent_state {
        "working" | "blocked" | "idle" | "done" => agent_state.to_string(),
        _ => "idle".to_string(),
    }
}

/// `_public_terminal`: whitelist-проекция терминала для Deck UI.
fn public_terminal(t: &Value) -> Value {
    let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
    let status = terminal_status(t);
    let labels = terminal_labels(t);
    let name_src = t
        .get("name")
        .filter(|v| v.as_str().map_or(false, |s| !s.is_empty()))
        .cloned()
        .or_else(|| labels.get("where").filter(|v| v.as_str().map_or(false, |s| !s.is_empty())).cloned())
        .or_else(|| t.get("title").filter(|v| v.as_str().map_or(false, |s| !s.is_empty())).cloned());
    let mut out = serde_json::Map::new();
    out.insert("address".into(), json!(addr));
    // `_public_terminal`: name = name ?? labels.where ?? title; пустая строка
    // не эмитится (зеркало: {k: v for ... if v is not None}).
    if let Some(name) = name_src {
        let cleaned = clean_text(&name);
        if !cleaned.as_str().map_or(true, |s| s.is_empty()) {
            out.insert("name".into(), cleaned);
        }
    }
    out.insert("state".into(), terminal_state(t).into());
    if let Some(agent) = t.get("agent").and_then(Value::as_str) {
        out.insert("agent".into(), json!(agent));
    }
    if let Some(app) = status.get("app").and_then(Value::as_str) {
        out.insert("app".into(), clean_text(&json!(app)));
    }
    if let Some(st) = status.get("state").and_then(Value::as_str) {
        out.insert("agent_state".into(), clean_text(&json!(st)));
    }
    if let Some(msg) = status.get("msg").and_then(Value::as_str) {
        out.insert("agent_msg".into(), clean_text(&json!(msg)));
    }
    if let Some(turn) = t.get("turn").and_then(Value::as_u64) {
        out.insert("turn".into(), json!(turn));
    }
    if let Some(title) = t.get("title").and_then(Value::as_str) {
        out.insert("title".into(), clean_text(&json!(title)));
    }
    for k in ["cols", "rows"] {
        if let Some(v) = t.get(k).and_then(Value::as_u64) {
            out.insert(k.to_string(), json!(v));
        }
    }
    out.insert("machine".into(), json!(machine_of(&addr)));
    Value::Object(out)
}

/// `_public_roster_row`: ровно 8 полей по QODER-roster-spec.
fn public_roster_row(t: &Value) -> Value {
    let p = public_terminal(t);
    let addr = String::from(p.get("address").and_then(Value::as_str).unwrap_or(""));
    let labels = terminal_labels(t);
    // name — persona (name/labels.where); пустая строка -> address (как зеркало).
    let name_src = t
        .get("name")
        .filter(|v| v.as_str().map_or(false, |s| !s.is_empty()))
        .cloned()
        .or_else(|| labels.get("where").filter(|v| v.as_str().map_or(false, |s| !s.is_empty())).cloned());
    let name = match name_src {
        Some(v) => {
            let cleaned = clean_text(&v);
            if cleaned.as_str().map_or(true, |s| s.is_empty()) {
                json!(addr)
            } else {
                cleaned
            }
        }
        None => json!(addr),
    };
    // group: "group" -> "nx.group" -> "TEAM" (пустые строки пропускаются).
    let group = labels
        .get("group")
        .filter(|v| v.as_str().map_or(false, |s| !s.is_empty()))
        .or_else(|| labels.get("nx.group").filter(|v| v.as_str().map_or(false, |s| !s.is_empty())))
        .map(|v| clean_text(v))
        .unwrap_or_else(|| json!("TEAM"));
    let status = core_state(t);
    let wave = p.get("turn").and_then(Value::as_u64).unwrap_or(0);
    json!({
        "agent_id": addr,
        "name": name,
        "role": p.get("app").cloned().unwrap_or(json!("")),
        "group": group,
        "term": addr,
        "model": json!(""),
        "status": status,
        "current_wave": wave,
    })
}

/// `_core_labels`: agent из status.app/agent, persona из name/where/title.
fn core_labels(t: &Value) -> Value {
    let mut labels = serde_json::Map::new();
    let status = terminal_status(t);
    let app = status
        .get("app")
        .and_then(Value::as_str)
        .or_else(|| t.get("agent").and_then(Value::as_str));
    if let Some(app) = app {
        labels.insert("agent".into(), clean_text(&json!(app)));
    }
    let raw_labels = terminal_labels(t);
    let name_src = t
        .get("name")
        .filter(|v| v.as_str().map_or(false, |s| !s.is_empty()))
        .cloned()
        .or_else(|| raw_labels.get("where").cloned())
        .or_else(|| t.get("title").cloned());
    if let Some(name) = name_src {
        if let Some(s) = name.as_str() {
            labels.insert("persona".into(), clean_text(&json!(s)));
        }
    }
    Value::Object(labels)
}

/// `_core_agent_row`.
fn core_agent_row(t: &Value) -> Value {
    let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
    let state = core_state(t);
    json!({
        "address": addr,
        "name": term_id(&addr),
        "state": state,
        "attention": state == "blocked",
        "labels": core_labels(t),
        "parent": Value::Null,
    })
}

/// `_core_terminal_row`.
fn core_terminal_row(t: &Value) -> Value {
    let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
    let state = core_state(t);
    let mut out = serde_json::Map::new();
    out.insert("name".into(), json!(term_id(&addr)));
    out.insert("machine".into(), json!(machine_of(&addr)));
    out.insert("address".into(), json!(addr));
    out.insert("state".into(), json!(state));
    out.insert("attention".into(), json!(state == "blocked"));
    out.insert("labels".into(), core_labels(t));
    out.insert("keep".into(), json!(true));
    out.insert("parent".into(), Value::Null);
    out.insert("exit_code".into(), t.get("exit_code").cloned().unwrap_or(Value::Null));
    out.insert("created_at".into(), Value::Null);
    out.insert("exited_at".into(), Value::Null);
    out.insert("respawn_count".into(), json!(0));
    for k in ["cols", "rows"] {
        if let Some(v) = t.get(k).and_then(Value::as_u64) {
            out.insert(k.to_string(), json!(v));
        }
    }
    if let Some(title) = t.get("title").and_then(Value::as_str) {
        out.insert("title".into(), clean_text(&json!(title)));
    }
    Value::Object(out)
}

// ---------------------------------------------------------------------------
// Живой источник: framed JSON-RPC к `nx connect`

struct FarmInner {
    child: Mutex<Child>,
    stdin: Mutex<std::process::ChildStdin>,
    routes: Arc<Mutex<HashMap<u64, Sender<Result<Value, Value>>>>>,
    next_id: AtomicU64,
    events_channel: AtomicU32, // 0 = ещё нет подписки
    last_seq: AtomicU64,
    deck_senders: Mutex<Vec<Sender<Value>>>,
    core_senders: Mutex<Vec<Sender<Value>>>,
    version: Mutex<String>,
    session: String,
}

pub struct Farm {
    inner: Arc<FarmInner>,
}

/// Сырое событие из кадра (JSON-строка).
fn parse_event_line(line: &[u8]) -> Option<Value> {
    serde_json::from_slice::<Value>(line).ok()
}

/// Трансформация в формат /api/deck/events (`data:`-часть кадра SSE).
fn deck_event_payload(raw: &Value, seq: u64, ts: f64) -> Value {
    json!({ "seq": seq, "ts": ts, "event": clean_frame(raw) })
}

/// Трансформация в формат /api/core/events (flat).
fn core_event_payload(raw: &Value, seq: u64, ts: f64) -> Option<Value> {
    let params = raw.get("params").and_then(Value::as_object)?;
    let etype = params.get("type").and_then(Value::as_str).unwrap_or("");
    let addr = params.get("terminal").and_then(Value::as_str);
    // core-bridge: status/без-типа без адреса отбрасываются.
    if etype.is_empty() || etype == "status" {
        if addr.map_or(true, |a| a.is_empty()) {
            return None;
        }
    }
    let data = params.get("data").and_then(Value::as_object).cloned().unwrap_or_default();
    let mut flat = serde_json::Map::new();
    flat.insert("type".into(), json!(if etype.is_empty() { "status" } else { etype }));
    flat.insert("seq".into(), json!(seq));
    flat.insert("ts".into(), json!(ts));
    if let Some(addr) = addr {
        flat.insert("address".into(), json!(addr));
        flat.insert("machine".into(), json!(machine_of(addr)));
        flat.insert("term".into(), json!(term_id(addr)));
    }
    for k in ["state", "prev", "keep", "exit_code", "cols", "rows"] {
        match data.get(k) {
            Some(v) if v.is_null() || v.is_boolean() || v.is_number() => { flat.insert(k.to_string(), v.clone()); }
            Some(Value::String(s)) => { flat.insert(k.to_string(), clean_text(&json!(s))); }
            _ => {}
        }
    }
    if flat.get("state").is_none() {
        if let Some(inner) = data.get("status").and_then(Value::as_object) {
            if let Some(s) = inner.get("state").and_then(Value::as_str) {
                flat.insert("state".into(), clean_text(&json!(s)));
            }
        }
    }
    Some(Value::Object(flat))
}

impl Farm {
    /// Запускает `nx connect`, делает hello (framed), поднимает читалку.
    pub fn connect(exe: &Path, session: Option<&str>) -> Result<Arc<Farm>, FarmError> {
        let mut cmd = Command::new(exe);
        cmd.arg("connect").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        if let Some(s) = session {
            cmd.env("NX_SESSION", s);
        }
        let mut child = cmd.spawn().map_err(|e| FarmError::Spawn(format!("cannot run {exe:?}: {e}")))?;
        let mut stdin = child.stdin.take().ok_or_else(|| FarmError::Spawn("no stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| FarmError::Spawn("no stdout".into()))?;
        let mut stderr = child.stderr.take().ok_or_else(|| FarmError::Spawn("no stderr".into()))?;

        // stderr -> eprintln (в нити, чтобы не блокировать).
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(s) = std::str::from_utf8(&buf[..n]) {
                            eprintln!("nue-host: nx(stderr): {}", s.trim_end());
                        }
                    }
                }
            }
        });

        // Hello — обычной строкой (до framed).
        stdin
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"hello\",\"params\":{\"framed\":true}}\n")
            .map_err(|e| map_io("hello write", e))?;
        let mut reader = BufReader::new(stdout);
        let mut hello_line = String::new();
        reader
            .read_line(&mut hello_line)
            .map_err(|e| map_io("hello read", e))?;
        let hello: Value = serde_json::from_str(&hello_line)
            .map_err(|e| FarmError::Hello(format!("bad hello reply: {e}: {hello_line}")))?;
        if let Some(err) = hello.get("error") {
            return Err(FarmError::Hello(format!("core refused hello: {err}")));
        }
        let result = hello.get("result").cloned().unwrap_or(Value::Null);
        let version = String::from(result.get("version").and_then(Value::as_str).unwrap_or("0.0.0"));
        let hello_session = session.unwrap_or("").to_string();

        let inner = Arc::new(FarmInner {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            routes: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            events_channel: AtomicU32::new(0),
            last_seq: AtomicU64::new(0),
            deck_senders: Mutex::new(Vec::new()),
            core_senders: Mutex::new(Vec::new()),
            version: Mutex::new(version),
            session: hello_session,
        });
        let farm = Arc::new(Farm { inner: inner.clone() });

        // Читалка кадров (работает через Arc<FarmInner> — поля клонировать нельзя).
        let thread_inner = inner.clone();
        std::thread::Builder::new()
            .name("nx-farm-reader".into())
            .spawn(move || {
                let mut pending: Vec<u8> = Vec::new();
                loop {
                    let mut h = [0u8; FRAME_HEADER];
                    if reader.read_exact(&mut h).is_err() {
                        break;
                    }
                    let channel = u32::from_le_bytes(h[0..4].try_into().unwrap());
                    let kind = h[4];
                    let len = u32::from_le_bytes(h[5..9].try_into().unwrap()) as usize;
                    if len > DATA_MAX {
                        break;
                    }
                    let mut payload = vec![0u8; len];
                    if reader.read_exact(&mut payload).is_err() {
                        break;
                    }
                    if channel == 0 {
                        if let Ok(msg) = serde_json::from_slice::<Value>(&payload) {
                            if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                                let res = match msg.get("error") {
                                    Some(e) => Err(e.clone()),
                                    None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                                };
                                if let Some(tx) = thread_inner.routes.lock().unwrap().remove(&id) {
                                    let _ = tx.send(res);
                                }
                            }
                        }
                        continue;
                    }
                    if channel != thread_inner.events_channel.load(Ordering::Relaxed) {
                        continue;
                    }
                    // Событийный канал: накапливаем до \n.
                    match kind {
                        KIND_DATA => {
                            pending.extend_from_slice(&payload);
                            let mut consumed = 0;
                            for (i, byte) in pending.iter().enumerate() {
                                if *byte == b'\n' {
                                    if let Some(raw) = parse_event_line(&pending[consumed..i]) {
                                        if let Some(seq) = raw.pointer("/params/seq").and_then(Value::as_u64) {
                                            thread_inner.last_seq.store(seq, Ordering::Relaxed);
                                        }
                                        push_events(&raw, &thread_inner.deck_senders, &thread_inner.core_senders);
                                    }
                                    consumed = i + 1;
                                }
                            }
                            pending.drain(..consumed);
                            // Кредит обратно (по размеру полученного).
                            let credit = (payload.len() as u32).to_le_bytes();
                            let mut hdr = Vec::with_capacity(FRAME_HEADER + 4);
                            hdr.extend_from_slice(&channel.to_le_bytes());
                            hdr.push(KIND_CREDIT);
                            hdr.extend_from_slice(&4u32.to_le_bytes());
                            hdr.extend_from_slice(&credit);
                            if let Ok(mut w) = thread_inner.stdin.lock() {
                                let _ = w.write_all(&hdr);
                                let _ = w.flush();
                            }
                        }
                        _ => {}
                    }
                }
                // Ядро ушло: шлём панику подписчикам.
                for tx in thread_inner.deck_senders.lock().unwrap().drain(..) {
                    let _ = tx.send(json!({"error": "farm_lost"}));
                }
                for tx in thread_inner.core_senders.lock().unwrap().drain(..) {
                    let _ = tx.send(json!({"error": "farm_lost"}));
                }
            })
            .map_err(|e| FarmError::Spawn(format!("reader thread: {e}")))?;

        // Ленивая подписка на события (чтобы events_connected/events_seq были
        // живыми с первого запроса; если не выйдет — не смертельно).
        if let Err(e) = farm.ensure_subscription() {
            eprintln!("nue-host: farm: предупреждение: events.subscribe: {e}");
        }

        Ok(farm)
    }

    /// Отправка framed-запроса на канал 0.
    fn send_frame(&self, channel: u32, kind: u8, payload: &[u8]) -> Result<(), FarmError> {
        let mut hdr = Vec::with_capacity(FRAME_HEADER + payload.len());
        hdr.extend_from_slice(&channel.to_le_bytes());
        hdr.push(kind);
        hdr.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        hdr.extend_from_slice(payload);
        let mut w = self.inner.stdin.lock().map_err(|_| FarmError::Lost("stdin lock".into()))?;
        w.write_all(&hdr).map_err(|e| map_io("frame write", e))?;
        w.flush().map_err(|e| map_io("frame flush", e))
    }

    /// RPC-вызов с таймаутом.
    fn call(&self, method: &str, params: Value) -> Result<Value, FarmError> {
        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = channel();
        {
            let mut routes = self.inner.routes.lock().unwrap();
            routes.insert(id, tx);
        }
        let req = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        self.send_frame(0, KIND_DATA, req.to_string().as_bytes())?;
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(FarmError::Rpc(format!("{method}: {e}"))),
            Err(_) => {
                self.inner.routes.lock().unwrap().remove(&id);
                Err(FarmError::Timeout(format!("{method}: no reply from core")))
            }
        }
    }

    fn terminal_list(&self) -> Result<Vec<Value>, FarmError> {
        let res = self.call("terminal.list", json!({}))?;
        let list = match res.get("terminals") {
            Some(Value::Array(a)) => a.clone(),
            _ => match res {
                Value::Array(a) => a.clone(),
                _ => Vec::new(),
            },
        };
        Ok(sort_by_address(list.into_iter().filter(|t| terminal_state(t) == "live").collect()))
    }

    fn machine_list(&self) -> Result<Vec<Value>, FarmError> {
        let res = self.call("machine.list", json!({}))?;
        let list = match res.get("machines") {
            Some(Value::Array(a)) => a.clone(),
            _ => match res {
                Value::Array(a) => a.clone(),
                _ => Vec::new(),
            },
        };
        Ok(list)
    }

    fn server_status(&self) -> Result<Value, FarmError> {
        self.call("server.status", json!({}))
    }

    fn version(&self) -> String {
        self.inner.version.lock().unwrap().clone()
    }

    /// Подписка на события (один раз).
    fn ensure_subscription(&self) -> Result<(), FarmError> {
        if self.inner.events_channel.load(Ordering::Relaxed) != 0 {
            return Ok(());
        }
        let res = self.call("events.subscribe", json!({}))?;
        let channel = res.get("channel").and_then(Value::as_u64).ok_or_else(|| {
            FarmError::Rpc("events.subscribe returned no channel".into())
        })? as u32;
        self.inner.events_channel.store(channel, Ordering::Relaxed);
        let credit = (1024 * 1024u32).to_le_bytes();
        let mut hdr = Vec::new();
        hdr.extend_from_slice(&channel.to_le_bytes());
        hdr.push(KIND_CREDIT);
        hdr.extend_from_slice(&4u32.to_le_bytes());
        hdr.extend_from_slice(&credit);
        let mut w = self.inner.stdin.lock().map_err(|_| FarmError::Lost("stdin lock".into()))?;
        w.write_all(&hdr).map_err(|e| map_io("credit write", e))?;
        w.flush().map_err(|e| map_io("credit flush", e))
    }

    fn subscribe_deck(&self) -> Result<Receiver<Value>, FarmError> {
        self.ensure_subscription()?;
        let (tx, rx) = channel();
        self.inner.deck_senders.lock().unwrap().push(tx);
        Ok(rx)
    }

    fn subscribe_core(&self) -> Result<Receiver<Value>, FarmError> {
        self.ensure_subscription()?;
        let (tx, rx) = channel();
        self.inner.core_senders.lock().unwrap().push(tx);
        Ok(rx)
    }
}

impl Drop for Farm {
    fn drop(&mut self) {
        if let Ok(mut child) = self.inner.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Рассылка события всем подписчикам (deck- и core-канал).
fn broadcast_events(raw: &Value, deck: &[Sender<Value>], core: &[Sender<Value>]) {
    let seq = raw.pointer("/params/seq").and_then(Value::as_u64).unwrap_or(0);
    let ts = raw.pointer("/params/seq").is_some().then(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0)
    }).unwrap_or(0.0);
    let deck_ev = deck_event_payload(raw, seq, ts);
    for tx in deck {
        let _ = tx.send(deck_ev.clone());
    }
    if let Some(core_ev) = core_event_payload(raw, seq, ts) {
        for tx in core {
            let _ = tx.send(core_ev.clone());
        }
    }
}

fn push_events(raw: &Value, deck: &Mutex<Vec<Sender<Value>>>, core: &Mutex<Vec<Sender<Value>>>) {
    let d = deck.lock().unwrap();
    let c = core.lock().unwrap();
    broadcast_events(raw, &d, &c);
}

// ---------------------------------------------------------------------------
// Общий интерфейс (для тестов подставляется FakeFarm)

pub trait FarmApi: Send + Sync {
    fn deck_status(&self) -> Result<Value, FarmError>;
    fn deck_agents(&self) -> Result<Value, FarmError>;
    fn deck_terminals(&self) -> Result<Value, FarmError>;
    fn deck_machines(&self) -> Result<Value, FarmError>;
    fn deck_roster(&self) -> Result<Value, FarmError>;
    fn core_agents(&self) -> Result<Value, FarmError>;
    fn core_terminals(&self) -> Result<Value, FarmError>;
    fn core_machines(&self) -> Result<Value, FarmError>;
    fn core_server(&self) -> Result<Value, FarmError>;
    fn core_spaces(&self) -> Result<Value, FarmError>;
    fn core_ratings(&self) -> Result<Value, FarmError>;
    fn deck_events(&self) -> Result<Receiver<Value>, FarmError>;
    fn core_events(&self) -> Result<Receiver<Value>, FarmError>;
}

impl FarmApi for Farm {
    fn deck_status(&self) -> Result<Value, FarmError> {
        let st = self.server_status()?;
        let terminals = self.terminal_list()?.len();
        let machines = self.machine_list()?.len();
        let uptime = st.get("uptime_ms").and_then(Value::as_u64).unwrap_or(0) as f64 / 1000.0;
        Ok(json!({
            "connected": true,
            "events_connected": self.inner.events_channel.load(Ordering::Relaxed) != 0,
            "version": self.version(),
            "uptime_s": uptime,
            "terminals": terminals,
            "machines": machines,
            "events_seq": self.inner.last_seq.load(Ordering::Relaxed),
            "session": self.inner.session,
            "source": "live",
        }))
    }

    fn deck_agents(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.terminal_list()?.iter().map(public_terminal).collect();
        Ok(json!({"agents": rows, "count": rows.len()}))
    }

    fn deck_terminals(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.terminal_list()?.iter().map(public_terminal).collect();
        Ok(json!({"terminals": rows, "count": rows.len()}))
    }

    fn deck_machines(&self) -> Result<Value, FarmError> {
        let machines: Vec<Value> = self
            .machine_list()?
            .iter()
            .filter_map(|m| {
                let mut out = serde_json::Map::new();
                for k in ["name", "target", "state", "version"] {
                    if let Some(v) = m.get(k) {
                        out.insert(k.to_string(), v.clone());
                    }
                }
                if out.is_empty() { None } else { Some(Value::Object(out)) }
            })
            .collect();
        Ok(json!({"machines": machines}))
    }

    fn deck_roster(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.terminal_list()?.iter().map(public_roster_row).collect();
        Ok(json!({"roster": rows, "count": rows.len()}))
    }

    fn core_agents(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.terminal_list()?.iter().map(core_agent_row).collect();
        Ok(json!({"agents": rows, "count": rows.len()}))
    }

    fn core_terminals(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.terminal_list()?.iter().map(core_terminal_row).collect();
        let live = rows.iter().filter(|r| r.get("state").and_then(Value::as_str) != Some("exited")).count();
        Ok(json!({"terminals": rows, "count": rows.len(), "live": live}))
    }

    fn core_machines(&self) -> Result<Value, FarmError> {
        let mut machines = serde_json::Map::new();
        for m in self.machine_list()? {
            let name = m.get("name").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() { continue; }
            let host = m.get("target").and_then(Value::as_str).unwrap_or(name);
            machines.insert(name.to_string(), json!({
                "host": host,
                "transport": "ssh",
                "state": m.get("state").and_then(Value::as_str).unwrap_or("connected"),
                "since_ms": Value::Null,
                "why": Value::Null,
                "labels": json!({}),
            }));
        }
        if !machines.contains_key("local") {
            machines.insert("local".into(), json!({
                "host": "localhost", "transport": "local", "state": "connected",
                "since_ms": Value::Null, "why": Value::Null, "labels": json!({}),
            }));
        }
        Ok(json!({"machines": machines, "count": machines.len()}))
    }

    fn core_server(&self) -> Result<Value, FarmError> {
        let st = self.server_status()?;
        let terminals = self.terminal_list()?.len();
        let machines = self.machine_list()?.len();
        let uptime = st.get("uptime_ms").and_then(Value::as_u64).unwrap_or(0) as f64 / 1000.0;
        Ok(json!({
            "version": self.version(),
            "state": "running",
            "uptime_s": uptime,
            "terminals": terminals,
            "machines": machines,
            "events": self.inner.last_seq.load(Ordering::Relaxed),
            "session": self.inner.session,
        }))
    }

    fn core_spaces(&self) -> Result<Value, FarmError> {
        let mut per_machine: HashMap<String, usize> = HashMap::new();
        for t in self.terminal_list()? {
            let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
            *per_machine.entry(machine_of(&addr)).or_default() += 1;
        }
        let mut keys: Vec<String> = per_machine.keys().cloned().collect();
        keys.sort();
        let spaces: Vec<Value> = keys
            .into_iter()
            .map(|m| json!({"id": m, "name": m, "machine": m, "state": "connected", "terminals": per_machine[&m]}))
            .collect();
        Ok(json!({"spaces": spaces}))
    }

    fn core_ratings(&self) -> Result<Value, FarmError> {
        Ok(json!({"ratings": {}}))
    }

    fn deck_events(&self) -> Result<Receiver<Value>, FarmError> {
        self.subscribe_deck()
    }

    fn core_events(&self) -> Result<Receiver<Value>, FarmError> {
        self.subscribe_core()
    }
}

/// Пул: ленивое создание RealFarm + сброс при потере соединения.
#[derive(Default)]
pub struct FarmPool {
    inner: Mutex<Option<Arc<Farm>>>,
}

impl FarmPool {
    pub fn get(&self) -> Result<Arc<Farm>, FarmError> {
        if let Some(f) = self.inner.lock().unwrap().as_ref() {
            return Ok(f.clone());
        }
        let exe = std::env::var("NX_BIN")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| Path::new("nx").to_path_buf());
        let session = std::env::var("NX_SESSION").ok();
        let farm = Farm::connect(&exe, session.as_deref())?;
        *self.inner.lock().unwrap() = Some(farm.clone());
        Ok(farm)
    }

    pub fn reset(&self) {
        *self.inner.lock().unwrap() = None;
    }
}

/// Обёртка: FarmPool как FarmApi (с авто-сбросом при потере).
pub struct PoolApi {
    pool: Arc<FarmPool>,
}

impl PoolApi {
    pub fn new(pool: Arc<FarmPool>) -> Self {
        Self { pool }
    }

    fn with_retry<T>(&self, f: impl Fn(&Farm) -> Result<T, FarmError>) -> Result<T, FarmError> {
        let farm = self.pool.get()?;
        match f(&farm) {
            Ok(v) => Ok(v),
            Err(e @ (FarmError::Lost(_) | FarmError::Timeout(_) | FarmError::Rpc(_))) => {
                self.pool.reset();
                let farm = self.pool.get()?;
                f(&farm).map_err(|_| e)
            }
            Err(e) => Err(e),
        }
    }
}

impl FarmApi for PoolApi {
    fn deck_status(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::deck_status(f))
    }
    fn deck_agents(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::deck_agents(f))
    }
    fn deck_terminals(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::deck_terminals(f))
    }
    fn deck_machines(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::deck_machines(f))
    }
    fn deck_roster(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::deck_roster(f))
    }
    fn core_agents(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_agents(f))
    }
    fn core_terminals(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_terminals(f))
    }
    fn core_machines(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_machines(f))
    }
    fn core_server(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_server(f))
    }
    fn core_spaces(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_spaces(f))
    }
    fn core_ratings(&self) -> Result<Value, FarmError> {
        self.with_retry(|f| FarmApi::core_ratings(f))
    }
    fn deck_events(&self) -> Result<Receiver<Value>, FarmError> {
        let farm = self.pool.get()?;
        FarmApi::deck_events(farm.as_ref())
    }
    fn core_events(&self) -> Result<Receiver<Value>, FarmError> {
        let farm = self.pool.get()?;
        FarmApi::core_events(farm.as_ref())
    }
}

// ---------------------------------------------------------------------------
// FakeFarm — предсказуемый источник для тестов (без живого ядра)

pub struct FakeFarm {
    pub terminals: Mutex<Vec<Value>>,
    pub machines: Vec<Value>,
    pub server: Value,
    senders: Mutex<(Vec<Sender<Value>>, Vec<Sender<Value>>)>,
    /// Индикатор источника: "live" (тестовый макет живого) или "demo".
    source: Mutex<String>,
    /// Имя сессии, видимое в status/server.
    session: Mutex<String>,
    /// Версия, видимая в status/server.
    version: Mutex<String>,
    /// Таймер демо-событий запущен (один раз на инстанс).
    demo_timer: AtomicBool,
}

impl Default for FakeFarm {
    fn default() -> Self {
        let mut terminals = Vec::new();
        let rows = [
            ("local-farm/term-1", "working", Some("ROLE-1 / 1"), 110u64, "▆ ROLE-1 | nexus"),
            ("local-farm/term-2", "working", Some("ROLE-2 / 1"), 75, "▆ ROLE-2 | nexus"),
            ("local-farm/term-3", "blocked", Some("ROLE-3 / 1"), 42, "▆ ROLE-3 | nexus"),
            ("local-farm/term-4", "idle", Some("ROLE-4 / 1"), 199, "▏ ROLE-4 | nexus"),
            ("local-farm/t4", "done", Some("ROLE-5 / 1"), 33, "▏ ROLE-5 | nexus"),
            ("local-farm/t3", "idle", Some("ROLE-6 / 1"), 126, "▏ ROLE-6 | nexus"),
        ];
        for (addr, astate, name, turn, title) in rows {
            let status = json!({"app": "codex", "state": astate, "msg": ""});
            terminals.push(json!({
                "address": addr,
                "name": name,
                "state": "live",
                "turn": turn,
                "cols": 94,
                "rows": 26,
                "title": title,
                "status": status,
                "labels": json!({"agent": "codex", "persona": name}),
            }));
        }
        Self {
            terminals: Mutex::new(terminals),
            machines: vec![json!({"name": "local-farm", "target": "local-farm", "state": "connected", "version": "0.1.18"})],
            server: json!({"version": "0.1.18", "uptime_ms": 6_174_500}),
            senders: Mutex::new((Vec::new(), Vec::new())),
            source: Mutex::new("live".into()),
            session: Mutex::new("nx-deck".into()),
            version: Mutex::new("0.1.18".into()),
            demo_timer: AtomicBool::new(false),
        }
    }
}

impl FakeFarm {
    /// Синтетический демо-источник (волна 8): те же 6 агентов, но без
    /// реальных хостов/путей/секретов. `source: "demo"` в status.
    pub fn demo() -> Self {
        let mut terminals = Vec::new();
        let rows = [
            ("local-farm/term-1", "working", Some("ROLE-1 / 1"), 110u64, "▆ ROLE-1 | nexus"),
            ("local-farm/term-2", "working", Some("ROLE-2 / 1"), 75, "▆ ROLE-2 | nexus"),
            ("local-farm/term-3", "blocked", Some("ROLE-3 / 1"), 42, "▆ ROLE-3 | nexus"),
            ("local-farm/term-4", "idle", Some("ROLE-4 / 1"), 199, "▏ ROLE-4 | nexus"),
            ("local-farm/t4", "done", Some("ROLE-5 / 1"), 33, "▏ ROLE-5 | nexus"),
            ("local-farm/t3", "idle", Some("ROLE-6 / 1"), 126, "▏ ROLE-6 | nexus"),
        ];
        for (addr, astate, name, turn, title) in rows {
            let status = json!({"app": "codex", "state": astate, "msg": ""});
            terminals.push(json!({
                "address": addr,
                "name": name,
                "state": "live",
                "turn": turn,
                "cols": 94,
                "rows": 26,
                "title": title,
                "status": status,
                "labels": json!({"agent": "codex", "persona": name}),
            }));
        }
        Self {
            terminals: Mutex::new(terminals),
            machines: vec![
                json!({"name": "farm-a", "target": "192.0.2.10", "state": "connected", "version": "0.1.18"}),
                json!({"name": "farm-b", "target": "192.0.2.11", "state": "connected", "version": "0.1.18"}),
            ],
            server: json!({"version": env!("CARGO_PKG_VERSION"), "uptime_ms": 6_174_500}),
            senders: Mutex::new((Vec::new(), Vec::new())),
            source: Mutex::new("demo".into()),
            session: Mutex::new("nx-demo".into()),
            version: Mutex::new(env!("CARGO_PKG_VERSION").into()),
            demo_timer: AtomicBool::new(false),
        }
    }

    /// Запускает поток демо-событий (SSE): детерминированная
    /// последовательность кадров (status/turn/title по кругу по терминалам)
    /// с интервалом ~2 с. Первый кадр — сразу.
    pub fn start_demo_events(self: &Arc<Self>) {
        if self.demo_timer.swap(true, Ordering::Relaxed) {
            return;
        }
        let fake = self.clone();
        std::thread::Builder::new()
            .name("nx-demo-events".into())
            .spawn(move || {
                let mut seq: u64 = 1;
                loop {
                    let terms = fake.live_terminals();
                    for t in &terms {
                        let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
                        let astate = String::from(
                            t.pointer("/status/state").and_then(Value::as_str).unwrap_or("idle"),
                        );
                        let turn = t.get("turn").and_then(Value::as_u64).unwrap_or(0);
                        let title = String::from(t.get("title").and_then(Value::as_str).unwrap_or(""));
                        let etype = match seq % 3 {
                            0 => "status",
                            1 => "turn",
                            _ => "title",
                        };
                        let raw = match etype {
                            "status" => json!({"method":"event","params":{"type":"status","terminal":addr,"seq":seq,"data":{"status":{"state":astate}}}}),
                            "turn" => json!({"method":"event","params":{"type":"turn","terminal":addr,"seq":seq,"data":{"turn":turn}}}),
                            _ => json!({"method":"event","params":{"type":"title","terminal":addr,"seq":seq,"data":{"title":title}}}),
                        };
                        {
                            let s = fake.senders.lock().unwrap();
                            broadcast_events(&raw, &s.0, &s.1);
                        }
                        seq += 1;
                    }
                    std::thread::sleep(Duration::from_secs(2));
                }
            })
            .expect("spawn demo events");
    }

    fn live_terminals(&self) -> Vec<Value> {
        sort_by_address(self.terminals.lock().unwrap().clone())
    }

    fn make_events(&self, deck: bool) -> Receiver<Value> {
        let (tx, rx) = channel();
        if deck {
            self.senders.lock().unwrap().0.push(tx);
        } else {
            self.senders.lock().unwrap().1.push(tx);
        }
        rx
    }
}

impl FarmApi for FakeFarm {
    fn deck_status(&self) -> Result<Value, FarmError> {
        let terminals = self.live_terminals().len();
        Ok(json!({
            "connected": true,
            "events_connected": true,
            "version": *self.version.lock().unwrap(),
            "uptime_s": 6174.5,
            "terminals": terminals,
            "machines": self.machines.len(),
            "events_seq": 26785,
            "session": *self.session.lock().unwrap(),
            "source": *self.source.lock().unwrap(),
        }))
    }

    fn deck_agents(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.live_terminals().iter().map(public_terminal).collect();
        Ok(json!({"agents": rows, "count": rows.len()}))
    }

    fn deck_terminals(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.live_terminals().iter().map(public_terminal).collect();
        Ok(json!({"terminals": rows, "count": rows.len()}))
    }

    fn deck_machines(&self) -> Result<Value, FarmError> {
        let machines: Vec<Value> = self
            .machines
            .iter()
            .filter_map(|m| {
                let mut out = serde_json::Map::new();
                for k in ["name", "target", "state", "version"] {
                    if let Some(v) = m.get(k) {
                        out.insert(k.to_string(), v.clone());
                    }
                }
                if out.is_empty() { None } else { Some(Value::Object(out)) }
            })
            .collect();
        Ok(json!({"machines": machines}))
    }

    fn deck_roster(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.live_terminals().iter().map(public_roster_row).collect();
        Ok(json!({"roster": rows, "count": rows.len()}))
    }

    fn core_agents(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.live_terminals().iter().map(core_agent_row).collect();
        Ok(json!({"agents": rows, "count": rows.len()}))
    }

    fn core_terminals(&self) -> Result<Value, FarmError> {
        let rows: Vec<Value> = self.live_terminals().iter().map(core_terminal_row).collect();
        let live = rows.iter().filter(|r| r.get("state").and_then(Value::as_str) != Some("exited")).count();
        Ok(json!({"terminals": rows, "count": rows.len(), "live": live}))
    }

    fn core_machines(&self) -> Result<Value, FarmError> {
        let mut machines = serde_json::Map::new();
        for m in &self.machines {
            let name = m.get("name").and_then(Value::as_str).unwrap_or("");
            let host = m.get("target").and_then(Value::as_str).unwrap_or(name);
            machines.insert(name.to_string(), json!({
                "host": host,
                "transport": "ssh",
                "state": m.get("state").and_then(Value::as_str).unwrap_or("connected"),
                "since_ms": Value::Null,
                "why": Value::Null,
                "labels": json!({}),
            }));
        }
        machines.insert("local".into(), json!({
            "host": "localhost", "transport": "local", "state": "connected",
            "since_ms": Value::Null, "why": Value::Null, "labels": json!({}),
        }));
        Ok(json!({"machines": machines, "count": machines.len()}))
    }

    fn core_server(&self) -> Result<Value, FarmError> {
        Ok(json!({
            "version": *self.version.lock().unwrap(),
            "state": "running",
            "uptime_s": 6174.5,
            "terminals": self.live_terminals().len(),
            "machines": self.machines.len(),
            "events": 26785,
            "session": *self.session.lock().unwrap(),
        }))
    }

    fn core_spaces(&self) -> Result<Value, FarmError> {
        let mut per_machine: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for t in self.live_terminals() {
            let addr = String::from(t.get("address").and_then(Value::as_str).unwrap_or(""));
            *per_machine.entry(machine_of(&addr)).or_default() += 1;
        }
        let mut keys: Vec<String> = per_machine.keys().cloned().collect();
        keys.sort();
        let spaces: Vec<Value> = keys
            .into_iter()
            .map(|m| json!({"id": m, "name": m, "machine": m, "state": "connected", "terminals": per_machine[&m]}))
            .collect();
        Ok(json!({"spaces": spaces}))
    }

    fn core_ratings(&self) -> Result<Value, FarmError> {
        Ok(json!({"ratings": {}}))
    }

    fn deck_events(&self) -> Result<Receiver<Value>, FarmError> {
        Ok(self.make_events(true))
    }

    fn core_events(&self) -> Result<Receiver<Value>, FarmError> {
        Ok(self.make_events(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(addr: &str, state: &str, agent_state: Option<&str>, name: Option<&str>, turn: u64) -> Value {
        let mut status = serde_json::Map::new();
        if let Some(st) = agent_state {
            status.insert("state".into(), json!(st));
        }
        json!({
            "address": addr,
            "state": state,
            "name": name,
            "turn": turn,
            "cols": 94,
            "rows": 26,
            "title": "",
            "status": status,
            "labels": json!({}),
        })
    }

    #[test]
    fn clean_text_masks_home_and_limits() {
        assert_eq!(clean_text(&json!("C:\\Users\\<user>\\Tools\\pwsh.exe")), json!("C:\\Users\\***\\Tools\\pwsh.exe"));
        assert_eq!(clean_text(&json!("/home/ubuntu/project")), json!("/home/***/project"));
        let long = "x".repeat(300);
        assert_eq!(clean_text(&json!(long)).as_str().unwrap().len(), 160);
        // контрольные символы убираются
        assert_eq!(clean_text(&json!("a\u{1b}b\u{00}")), json!("ab"));
    }

    #[test]
    fn roster_row_has_exactly_8_fields() {
        let t = terminal("local-farm/term-2", "live", Some("working"), Some("ROLE-2 / 1"), 75);
        let row = public_roster_row(&t);
        let obj = row.as_object().unwrap();
        assert_eq!(obj.len(), 8);
        assert_eq!(obj["agent_id"], json!("local-farm/term-2"));
        assert_eq!(obj["name"], json!("ROLE-2 / 1"));
        assert_eq!(obj["role"], json!(""));
        assert_eq!(obj["group"], json!("TEAM"));
        assert_eq!(obj["term"], json!("local-farm/term-2"));
        assert_eq!(obj["model"], json!(""));
        assert_eq!(obj["status"], json!("working"));
        assert_eq!(obj["current_wave"], json!(75));
    }

    #[test]
    fn core_state_verbatim_and_idle_fallback() {
        assert_eq!(core_state(&terminal("t1", "live", Some("working"), None, 0)), "working");
        assert_eq!(core_state(&terminal("t2", "live", Some("blocked"), None, 0)), "blocked");
        assert_eq!(core_state(&terminal("t3", "live", Some("done"), None, 0)), "done");
        assert_eq!(core_state(&terminal("t4", "live", None, None, 0)), "idle");
        assert_eq!(core_state(&terminal("t5", "dead", None, None, 0)), "exited");
        assert_eq!(core_state(&terminal("t6", "finished", None, None, 0)), "exited");
        // не-OSC значение -> idle
        assert_eq!(core_state(&terminal("t7", "live", Some("error"), None, 0)), "idle");
    }

    #[test]
    fn core_agent_row_shape() {
        let t = terminal("local-farm/term-1", "live", Some("working"), Some("ROLE-1 / 1"), 110);
        let row = core_agent_row(&t);
        assert_eq!(row["address"], json!("local-farm/term-1"));
        assert_eq!(row["name"], json!("term-1"));
        assert_eq!(row["state"], json!("working"));
        assert_eq!(row["attention"], json!(false));
        assert_eq!(row["labels"]["persona"], json!("ROLE-1 / 1"));
        assert_eq!(row["parent"], Value::Null);
    }

    #[test]
    fn public_terminal_machine_local_without_prefix() {
        let t = terminal("t3", "live", Some("error"), Some("ROLE-6 / 1"), 126);
        let p = public_terminal(&t);
        assert_eq!(p["machine"], json!("local"));
        assert_eq!(p["agent_state"], json!("error"));
        assert_eq!(p["name"], json!("ROLE-6 / 1"));
    }

    #[test]
    fn clean_frame_whitelist() {
        let raw = json!({
            "jsonrpc": "2.0",
            "method": "event",
            "params": {
                "type": "title",
                "terminal": "term-1",
                "seq": 123,
                "data": {"title": "C:\\Users\\<user>\\x", "cwd": "/root/secret"}
            }
        });
        let frame = clean_frame(&raw);
        assert_eq!(frame["params"]["type"], json!("title"));
        assert_eq!(frame["params"]["terminal"], json!("term-1"));
        // title маскирован, cwd вырезан (не в whitelist)
        assert_eq!(frame["params"]["data"]["title"], json!("C:\\Users\\***\\x"));
        assert!(frame["params"]["data"].get("cwd").is_none());
        // неизвестный тип -> data={}
        let raw2 = json!({"method": "event", "params": {"type": "bogus", "data": {"x": 1}}});
        assert_eq!(clean_frame(&raw2)["params"]["data"], json!({}));
    }

    #[test]
    fn core_event_flat_drops_status_without_address() {
        let raw = json!({"jsonrpc":"2.0","method":"event","params":{"type":"status","data":{"status":{"state":"working"}}}});
        assert!(core_event_payload(&raw, 1, 1.0).is_none());
        let raw2 = json!({"method":"event","params":{"type":"title","terminal":"term-1","data":{"title":"hi"}}});
        let flat = core_event_payload(&raw2, 2, 1.0).unwrap();
        assert_eq!(flat["type"], json!("title"));
        assert_eq!(flat["address"], json!("term-1"));
        assert_eq!(flat["machine"], json!("local"));
        assert_eq!(flat["term"], json!("term-1"));
    }

    // -----------------------------------------------------------------------
    // Паритет проекций с эталоном farm-mirror (волна 7).
    // Ожидания сгенерированы из чистых функций зеркала (gen_parity.py).
    // -----------------------------------------------------------------------

    fn parity_terminal(addr: &str, state: &str, agent_state: Option<&str>, name: Option<&str>, turn: u64, title: &str, labels: Value, status: Option<&str>, msg: Option<&str>) -> Value {
        let mut st = serde_json::Map::new();
        if let Some(s) = agent_state {
            st.insert("state".into(), json!(s));
        }
        if let Some(s) = status {
            st.insert("app".into(), json!(s));
        }
        if let Some(s) = msg {
            st.insert("msg".into(), json!(s));
        }
        let mut t = serde_json::Map::new();
        t.insert("address".into(), json!(addr));
        t.insert("state".into(), json!(state));
        if let Some(n) = name {
            t.insert("name".into(), json!(n));
        }
        if turn != 0 {
            t.insert("turn".into(), json!(turn));
        }
        if !title.is_empty() {
            t.insert("title".into(), json!(title));
        }
        t.insert("cols".into(), json!(94));
        t.insert("rows".into(), json!(26));
        if !st.is_empty() {
            t.insert("status".into(), Value::Object(st));
        }
        t.insert("labels".into(), labels);
        Value::Object(t)
    }

    fn parity_case(name: &str) -> Value {
        match name {
            "title_path" => parity_terminal(
                "local-farm/term-1", "live", Some("working"), Some("ROLE-1 / 1"), 110,
                r"C:\Users\<user>\Tools\pwsh\pwsh.exe",
                json!({"agent": "codex", "persona": "ROLE-1 / 1", "group": "dev"}),
                Some("codex"), Some("hi")),
            "bad_agent_state" => parity_terminal(
                "local-farm/term-2", "live", Some("error"), Some("ROLE-2 / 1"), 0,
                "▆ ROLE-2 | nexus", json!({"group": ""}), Some("forge"), None),
            "name_only_where" => parity_terminal(
                "local-farm/term-4", "live", Some("idle"), None, 0,
                "▏ ROLE-4 | nexus", json!({"where": "QODER"}), None, None),
            "dead" => parity_terminal(
                "local-farm/t9", "dead", None, Some("DEAD"), 0,
                "dead window", json!({}), None, None),
            "exited" => parity_terminal(
                "local-farm/t10", "exited", None, Some("EXITED"), 0,
                "", json!({}), None, None),
            "finished" => parity_terminal(
                "local/t11", "finished", None, Some("FINISHED"), 0,
                "", json!({}), None, None),
            "no_status" => parity_terminal(
                "remote-host/t3", "live", None, Some("ALICE"), 0,
                "", json!({"where": "ROLE-6"}), None, None),
            "local" => parity_terminal(
                "t3", "live", None, Some("LOCAL"), 0,
                "local window", json!({}), None, None),
            "no_name" => parity_terminal(
                "local-farm/t12", "live", Some("done"), None, 0,
                "", json!({}), None, None),
            _ => panic!("unknown case {name}"),
        }
    }

    /// Ожидания из эталона: (public_terminal, roster, core_agent, core_terminal, core_state, core_labels).
    fn expected_parity(name: &str) -> (Value, Value, Value, Value, Value, Value) {
        let (pt, rs, ca, ct, cs, cl) = match name {
            "title_path" => (
                json!({"address":"local-farm/term-1","name":"ROLE-1 / 1","state":"live","app":"codex","agent_state":"working","agent_msg":"hi","turn":110,"title":r"C:\Users\***\Tools\pwsh\pwsh.exe","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/term-1","name":"ROLE-1 / 1","role":"codex","group":"dev","term":"local-farm/term-1","model":"","status":"working","current_wave":110}),
                json!({"address":"local-farm/term-1","name":"term-1","state":"working","attention":false,"labels":{"agent":"codex","persona":"ROLE-1 / 1"},"parent":null}),
                json!({"name":"term-1","machine":"local-farm","address":"local-farm/term-1","state":"working","attention":false,"labels":{"agent":"codex","persona":"ROLE-1 / 1"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26,"title":r"C:\Users\***\Tools\pwsh\pwsh.exe"}),
                "working", json!({"agent":"codex","persona":"ROLE-1 / 1"})),
            "bad_agent_state" => (
                json!({"address":"local-farm/term-2","name":"ROLE-2 / 1","state":"live","app":"forge","agent_state":"error","title":"▆ ROLE-2 | nexus","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/term-2","name":"ROLE-2 / 1","role":"forge","group":"TEAM","term":"local-farm/term-2","model":"","status":"idle","current_wave":0}),
                json!({"address":"local-farm/term-2","name":"term-2","state":"idle","attention":false,"labels":{"agent":"forge","persona":"ROLE-2 / 1"},"parent":null}),
                json!({"name":"term-2","machine":"local-farm","address":"local-farm/term-2","state":"idle","attention":false,"labels":{"agent":"forge","persona":"ROLE-2 / 1"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26,"title":"▆ ROLE-2 | nexus"}),
                "idle", json!({"agent":"forge","persona":"ROLE-2 / 1"})),
            "name_only_where" => (
                json!({"address":"local-farm/term-4","name":"QODER","state":"live","agent_state":"idle","title":"▏ ROLE-4 | nexus","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/term-4","name":"QODER","role":"","group":"TEAM","term":"local-farm/term-4","model":"","status":"idle","current_wave":0}),
                json!({"address":"local-farm/term-4","name":"term-4","state":"idle","attention":false,"labels":{"persona":"QODER"},"parent":null}),
                json!({"name":"term-4","machine":"local-farm","address":"local-farm/term-4","state":"idle","attention":false,"labels":{"persona":"QODER"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26,"title":"▏ ROLE-4 | nexus"}),
                "idle", json!({"persona":"QODER"})),
            "dead" => (
                json!({"address":"local-farm/t9","name":"DEAD","state":"dead","title":"dead window","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/t9","name":"DEAD","role":"","group":"TEAM","term":"local-farm/t9","model":"","status":"exited","current_wave":0}),
                json!({"address":"local-farm/t9","name":"t9","state":"exited","attention":false,"labels":{"persona":"DEAD"},"parent":null}),
                json!({"name":"t9","machine":"local-farm","address":"local-farm/t9","state":"exited","attention":false,"labels":{"persona":"DEAD"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26,"title":"dead window"}),
                "exited", json!({"persona":"DEAD"})),
            "exited" => (
                json!({"address":"local-farm/t10","name":"EXITED","state":"exited","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/t10","name":"EXITED","role":"","group":"TEAM","term":"local-farm/t10","model":"","status":"exited","current_wave":0}),
                json!({"address":"local-farm/t10","name":"t10","state":"exited","attention":false,"labels":{"persona":"EXITED"},"parent":null}),
                json!({"name":"t10","machine":"local-farm","address":"local-farm/t10","state":"exited","attention":false,"labels":{"persona":"EXITED"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26}),
                "exited", json!({"persona":"EXITED"})),
            "finished" => (
                json!({"address":"local/t11","name":"FINISHED","state":"finished","cols":94,"rows":26,"machine":"local"}),
                json!({"agent_id":"local/t11","name":"FINISHED","role":"","group":"TEAM","term":"local/t11","model":"","status":"exited","current_wave":0}),
                json!({"address":"local/t11","name":"t11","state":"exited","attention":false,"labels":{"persona":"FINISHED"},"parent":null}),
                json!({"name":"t11","machine":"local","address":"local/t11","state":"exited","attention":false,"labels":{"persona":"FINISHED"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26}),
                "exited", json!({"persona":"FINISHED"})),
            "no_status" => (
                json!({"address":"remote-host/t3","name":"ALICE","state":"live","cols":94,"rows":26,"machine":"remote-host"}),
                json!({"agent_id":"remote-host/t3","name":"ALICE","role":"","group":"TEAM","term":"remote-host/t3","model":"","status":"idle","current_wave":0}),
                json!({"address":"remote-host/t3","name":"t3","state":"idle","attention":false,"labels":{"persona":"ALICE"},"parent":null}),
                json!({"name":"t3","machine":"remote-host","address":"remote-host/t3","state":"idle","attention":false,"labels":{"persona":"ALICE"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26}),
                "idle", json!({"persona":"ALICE"})),
            "local" => (
                json!({"address":"t3","name":"LOCAL","state":"live","title":"local window","cols":94,"rows":26,"machine":"local"}),
                json!({"agent_id":"t3","name":"LOCAL","role":"","group":"TEAM","term":"t3","model":"","status":"idle","current_wave":0}),
                json!({"address":"t3","name":"t3","state":"idle","attention":false,"labels":{"persona":"LOCAL"},"parent":null}),
                json!({"name":"t3","machine":"local","address":"t3","state":"idle","attention":false,"labels":{"persona":"LOCAL"},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26,"title":"local window"}),
                "idle", json!({"persona":"LOCAL"})),
            "no_name" => (
                json!({"address":"local-farm/t12","state":"live","agent_state":"done","cols":94,"rows":26,"machine":"local-farm"}),
                json!({"agent_id":"local-farm/t12","name":"local-farm/t12","role":"","group":"TEAM","term":"local-farm/t12","model":"","status":"done","current_wave":0}),
                json!({"address":"local-farm/t12","name":"t12","state":"done","attention":false,"labels":{},"parent":null}),
                json!({"name":"t12","machine":"local-farm","address":"local-farm/t12","state":"done","attention":false,"labels":{},"keep":true,"parent":null,"exit_code":null,"created_at":null,"exited_at":null,"respawn_count":0,"cols":94,"rows":26}),
                "done", json!({})),
            _ => panic!("unknown expected {name}"),
        };
        (pt, rs, ca, ct, json!(cs), cl)
    }

    #[test]
    fn parity_projections_match_mirror() {
        for name in ["title_path", "bad_agent_state", "name_only_where", "dead", "exited", "finished", "no_status", "local", "no_name"] {
            let t = parity_case(name);
            let (ept, ers, eca, ect, ecs, ecl) = expected_parity(name);
            let pt = public_terminal(&t);
            assert_eq!(pt, ept, "public_terminal[{name}]");
            let rs = public_roster_row(&t);
            assert_eq!(rs, ers, "roster[{name}]");
            let ca = core_agent_row(&t);
            assert_eq!(ca, eca, "core_agent[{name}]");
            let ct = core_terminal_row(&t);
            assert_eq!(ct, ect, "core_terminal[{name}]");
            assert_eq!(json!(core_state(&t)), ecs, "core_state[{name}]");
            assert_eq!(core_labels(&t), ecl, "core_labels[{name}]");
        }
    }

    #[test]
    fn terminal_list_is_sorted_by_address() {
        let mut rows = vec![
            json!({"address": "local-farm/t4", "state": "live"}),
            json!({"address": "local-farm/t3", "state": "live"}),
            json!({"address": "local-farm/term-1", "state": "live"}),
            json!({"address": "remote-host/t9", "state": "live"}),
        ];
        let sorted = sort_by_address(std::mem::take(&mut rows));
        let addrs: Vec<&str> = sorted.iter().map(|t| t["address"].as_str().unwrap()).collect();
        assert_eq!(addrs, vec!["local-farm/t3", "local-farm/t4", "local-farm/term-1", "remote-host/t9"]);
    }
}
