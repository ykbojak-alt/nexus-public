//! NUE-HOST-HARDEN-2 (QODER волна 7): паритет форм с зеркалом, 405 на
//! не-GET для /api/*, 404 на скрытые пути, отсутствие cwd/argv/env,
//! маска home-сегментов, регресс query (G-6-1).
//!
//! В отличие от security.rs (реальный FarmPool), здесь тесты идут против
//! FakeFarm через `serve_with` — предсказуемые данные и никакого живого
//! ядра.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

fn free_port() -> u16 {
    let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    port
}

struct Server {
    port: u16,
}

/// Запускает реальный хост (nue_host::serve_with) с FakeFarm на случайном
/// порту. Поток не join'им — процесс сам убьёт его в конце теста.
fn with_fake_server(f: impl FnOnce(&Server, &nue_host::farm::FakeFarm)) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/root");
    let port = free_port();
    let fake = Arc::new(nue_host::farm::FakeFarm::default());
    let api: Arc<dyn nue_host::farm::FarmApi> = fake.clone();
    std::thread::spawn(move || {
        let _ = nue_host::serve_with(port, root, "http://127.0.0.1:9/v1".to_string(), api);
    });
    std::thread::sleep(Duration::from_millis(200));
    f(&Server { port }, &fake);
}

fn raw_http(port: u16, req: &str) -> (u16, String, Vec<u8>) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    s.write_all(req.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf);
    let head_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .unwrap_or(buf.len());
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let code = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .unwrap_or(0);
    (code, head, buf[head_end.min(buf.len())..].to_vec())
}

fn get(port: u16, path: &str) -> (u16, String, Vec<u8>) {
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    raw_http(port, &req)
}

fn assert_no_forbidden_keys(v: &Value) {
    match v {
        Value::Object(o) => {
            for (k, val) in o {
                assert!(
                    !matches!(k.as_str(), "cwd" | "argv" | "env" | "pid"),
                    "запрещённый ключ в ответе: {k}"
                );
                assert_no_forbidden_keys(val);
            }
        }
        Value::Array(a) => {
            for x in a {
                assert_no_forbidden_keys(x);
            }
        }
        _ => {}
    }
}

/// Whitelist-набор ключей строки deck/agents (форма 1:1 с зеркалом).
const DECK_AGENT_KEYS: &[&str] = &[
    "address", "agent", "agent_msg", "agent_state", "app", "cols", "machine",
    "name", "rows", "state", "title", "turn",
];

// ---------------------------------------------------------------------------
// (a) паритет форм с эталоном (зеркало nx_mirror.py)
// ---------------------------------------------------------------------------

#[test]
fn deck_agents_projection_shape_matches_mirror() {
    with_fake_server(|s, _| {
        let (code, _, body) = get(s.port, "/api/deck/agents");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        let agents = v["agents"].as_array().unwrap();
        assert_eq!(agents.len(), 6);
        for row in agents {
            let keys: Vec<&str> = row.as_object().unwrap().keys().map(|s| s.as_str()).collect();
            for k in &keys {
                assert!(
                    DECK_AGENT_KEYS.contains(k),
                    "неожиданный ключ в deck/agents: {k}"
                );
            }
            assert_no_forbidden_keys(row);
        }
        // Проверка значений терминала local-farm/term-1 (FakeFarm).
        let first = agents.iter().find(|a| a["address"] == "local-farm/term-1").expect("term-1");
        assert_eq!(first["address"], "local-farm/term-1");
        assert_eq!(first["agent_state"], "working");
        assert_eq!(first["turn"], 110);
        assert_eq!(first["machine"], "local-farm");
    });
}

#[test]
fn roster_rows_have_exactly_8_fields() {
    with_fake_server(|s, _| {
        let (code, _, body) = get(s.port, "/api/deck/roster");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        for row in v["roster"].as_array().unwrap() {
            assert_eq!(row.as_object().unwrap().len(), 8, "ростер: ровно 8 полей");
            assert_eq!(row["model"], "");
            assert!(row.get("cwd").is_none());
            assert!(row.get("argv").is_none());
            assert!(row.get("env").is_none());
        }
        let row = v["roster"].as_array().unwrap().iter()
            .find(|r| r["agent_id"] == "local-farm/term-1")
            .expect("term-1 в ростере");
        assert_eq!(row["agent_id"], "local-farm/term-1");
        assert_eq!(row["status"], "working");
        assert_eq!(row["current_wave"], 110);
    });
}

#[test]
fn core_shapes_match_mirror() {
    with_fake_server(|s, _| {
        let (code, _, body) = get(s.port, "/api/core/agents");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        let first = v["agents"].as_array().unwrap().iter()
            .find(|a| a["address"] == "local-farm/term-1")
            .expect("term-1");
        assert_eq!(first["address"], "local-farm/term-1");
        assert_eq!(first["name"], "term-1");
        assert_eq!(first["state"], "working");
        assert_eq!(first["attention"], false);
        assert_eq!(first["parent"], Value::Null);
        let keys: Vec<&str> = first.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        assert_eq!(keys.len(), 6, "core/agents: ровно 6 полей: {keys:?}");

        let (code, _, body) = get(s.port, "/api/core/terminals");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["live"], 6);
        let first = v["terminals"].as_array().unwrap().iter()
            .find(|a| a["address"] == "local-farm/term-1")
            .expect("term-1");
        assert_eq!(first["keep"], true);
        assert_eq!(first["parent"], Value::Null);
        assert_eq!(first["exit_code"], Value::Null);
        assert_eq!(first["created_at"], Value::Null);
        assert_eq!(first["exited_at"], Value::Null);
        assert_eq!(first["respawn_count"], 0);
        let keys: Vec<&str> = first.as_object().unwrap().keys().map(|s| s.as_str()).collect();
        assert_eq!(keys.len(), 15, "core/terminals: 15 полей: {keys:?}");
    });
}

// ---------------------------------------------------------------------------
// (b) 405 на не-GET для /api/*
// ---------------------------------------------------------------------------

#[test]
fn non_get_methods_on_api_are_405() {
    with_fake_server(|s, _| {
        for m in ["POST", "PUT", "DELETE", "PATCH", "PROPFIND"] {
            for base in ["/api/deck/agents", "/api/core/server"] {
                let req = format!(
                    "{m} {base} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                let (code, head, _) = raw_http(s.port, &req);
                assert_eq!(code, 405, "{m} {base} должен давать 405");
                assert!(head.contains("405"), "head={head}");
            }
        }
        let (code, _, _) = get(s.port, "/api/deck/agents");
        assert_eq!(code, 200, "GET должен остаться рабочим");
    });
}

// ---------------------------------------------------------------------------
// (c) 404 на скрытые пути (статика)
// ---------------------------------------------------------------------------

#[test]
fn hidden_paths_are_404() {
    with_fake_server(|s, _| {
        for p in [
            "/.git/config",
            "/.env",
            "/.well-known/security.txt",
            "/node_modules/lodash/index.js",
            "/deck/../node_modules/x",
            "/foo/.hidden/file",
            "/%2e%2e/secret",
        ] {
            let (code, _, _) = get(s.port, p);
            assert_eq!(code, 404, "{p} должен давать 404");
        }
        // обычные пути не задеты
        let (code, _, _) = get(s.port, "/index.html");
        assert_eq!(code, 200);
    });
}

// ---------------------------------------------------------------------------
// (d) нет cwd/argv/env ни в одном ответе
// ---------------------------------------------------------------------------

#[test]
fn no_cwd_argv_env_in_any_response() {
    with_fake_server(|s, _| {
        let eps = [
            "deck/status", "deck/agents", "deck/terminals", "deck/machines",
            "deck/roster", "core/agents", "core/terminals", "core/machines",
            "core/server", "core/spaces", "core/ratings",
        ];
        for ep in eps {
            let (code, _, body) = get(s.port, &format!("/api/{ep}"));
            assert_eq!(code, 200, "/api/{ep}");
            let v: Value = serde_json::from_slice(&body).unwrap();
            assert_no_forbidden_keys(&v);
        }
    });
}

// ---------------------------------------------------------------------------
// (e) маска home-сегментов
// ---------------------------------------------------------------------------

#[test]
fn home_segments_are_masked_in_responses() {
    with_fake_server(|s, fake| {
        fake.terminals.lock().unwrap().push(serde_json::json!({
            "address": "local-farm/tHome",
            "state": "live",
            "name": "HOME",
            "title": r"C:\Users\<user>\Tools\pwsh\pwsh.exe",
            "status": {},
            "labels": {},
        }));
        let (code, _, body) = get(s.port, "/api/deck/agents");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        let row = v["agents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["address"] == "local-farm/tHome")
            .expect("home-терминал должен быть в списке");
        assert_eq!(row["title"], r"C:\Users\***\Tools\pwsh\pwsh.exe");
        let (code, _, body) = get(s.port, "/api/core/terminals");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        let row = v["terminals"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["address"] == "local-farm/tHome")
            .expect("home-терминал в core/terminals");
        assert_eq!(row["title"], r"C:\Users\***\Tools\pwsh\pwsh.exe");
    });
}

// ---------------------------------------------------------------------------
// Регресс query (G-6-1) — интеграционно
// ---------------------------------------------------------------------------

#[test]
fn api_query_string_ignored() {
    with_fake_server(|s, _| {
        let (code, _, body) = get(s.port, "/api/deck/roster?x=1&y=2");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["count"], 6);
        // SSE остаётся SSE с query (тело не читаем — поток бесконечный).
        let req = "GET /api/core/events?types=status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
        let (code, head, _) = raw_http(s.port, req);
        assert_eq!(code, 200, "SSE с query должен быть 200");
        assert!(head.contains("text/event-stream"), "head={head}");
        let (code, _, _) = get(s.port, "/index.html?v=3");
        assert_eq!(code, 200);
    });
}
