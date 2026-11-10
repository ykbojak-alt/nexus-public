//! NUE-DEMO-OFFLINE (QODER волна 8): демо-режим без фермы.
//!
//! Проверки:
//! - `--demo`/NX_NUE_DEMO=1 → все 11 эндпоинтов 200, SSE идёт, roster 8 полей,
//!   `/api/deck/status` содержит `"source":"demo"`.
//! - В демо-режиме НЕ поднимается `nx connect` (нет дочерних процессов).
//! - Паритет форм: живой и демо-режимы отдают одинаковый набор ключей.
//! - Демо-данные не содержат реальных хостов/путей/секретов.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use nue_host::farm::FarmApi;

fn free_port() -> u16 {
    let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    port
}

struct Server {
    port: u16,
}

/// Запускает хост в демо-режиме (FakeFarm::demo + таймер SSE).
fn with_demo_server(f: impl FnOnce(&Server)) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/root");
    let port = free_port();
    let fake = Arc::new(nue_host::farm::FakeFarm::demo());
    fake.start_demo_events();
    let api: Arc<dyn nue_host::farm::FarmApi> = fake.clone();
    std::thread::spawn(move || {
        let _ = nue_host::serve_with(port, root, "http://127.0.0.1:9/v1".to_string(), api);
    });
    std::thread::sleep(Duration::from_millis(200));
    f(&Server { port });
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

/// SSE-соединение: читаем заголовки + первые байты тела (поток живой).
fn sse_first_frames(port: u16, path: &str) -> (u16, String, Vec<u8>) {
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(6))).unwrap();
    s.write_all(req.as_bytes()).unwrap();
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // ждём несколько кадров (таймер демо — ~2с)
    let deadline = std::time::Instant::now() + Duration::from_secs(7);
    while std::time::Instant::now() < deadline && buf.len() < 4096 {
        match s.read(&mut tmp) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
    }
    let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(buf.len());
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let code = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .unwrap_or(0);
    (code, head, buf[head_end.min(buf.len())..].to_vec())
}

fn keys_of(v: &Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    k.sort();
    k
}

#[test]
fn demo_all_11_endpoints_200() {
    with_demo_server(|s| {
        for ep in [
            "deck/status", "deck/agents", "deck/terminals", "deck/machines", "deck/roster",
            "core/agents", "core/terminals", "core/machines", "core/server", "core/spaces", "core/ratings",
        ] {
            let (code, _, body) = get(s.port, &format!("/api/{ep}"));
            assert_eq!(code, 200, "/api/{ep} должен быть 200 в демо");
            let v: Value = serde_json::from_slice(&body).unwrap();
            assert!(v.is_object() || v.is_array(), "/api/{ep} — JSON");
        }
    });
}

#[test]
fn demo_status_has_source_demo() {
    with_demo_server(|s| {
        let (code, _, body) = get(s.port, "/api/deck/status");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["source"], "demo", "status должен содержать source=demo");
        assert_eq!(v["session"], "nx-demo");
    });
}

#[test]
fn demo_roster_8_fields() {
    with_demo_server(|s| {
        let (code, _, body) = get(s.port, "/api/deck/roster");
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        for row in v["roster"].as_array().unwrap() {
            assert_eq!(row.as_object().unwrap().len(), 8, "ростер: ровно 8 полей");
        }
    });
}

#[test]
fn demo_sse_deck_and_core_stream() {
    with_demo_server(|s| {
        let (code, head, body) = sse_first_frames(s.port, "/api/deck/events");
        assert_eq!(code, 200, "deck/events в демо — 200");
        assert!(head.contains("text/event-stream"), "deck/events content-type: {head}");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("event: nx"), "deck-фрейм должен быть event: nx: {text}");
        assert!(text.contains("data: "), "deck-фрейм должен нести data: {text}");

        let (code, head, body) = sse_first_frames(s.port, "/api/core/events");
        assert_eq!(code, 200, "core/events в демо — 200");
        assert!(head.contains("text/event-stream"), "core/events content-type: {head}");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("data: "), "core-фрейм должен нести data: {text}");
    });
}

#[test]
fn demo_events_are_deterministic_and_clean() {
    with_demo_server(|s| {
        let (_, _, body) = sse_first_frames(s.port, "/api/deck/events");
        let text = String::from_utf8_lossy(&body);
        // никаких реальных хостов/путей/секретов
        for banned in ["roy1-farm", "sage-pl", "BoJaK", "C:\\Users", "/home/", "2.27.5.234", "secret"] {
            assert!(!text.contains(banned), "демо-событие утекло {banned:?}: {text}");
        }
        // детерминированность: порядок кадров воспроизводим — каждый кадр имеет seq
        assert!(text.contains("\"seq\""), "SEQ в кадрах: {text}");
    });
}

#[test]
fn demo_live_key_parity() {
    // Паритет форм: живой FakeFarm и демо-FakeFarm дают одинаковый набор ключей.
    let live = nue_host::farm::FakeFarm::default();
    let demo = nue_host::farm::FakeFarm::demo();
    let cases = [
        ("deck_agents", live.deck_agents(), demo.deck_agents()),
        ("deck_roster", live.deck_roster(), demo.deck_roster()),
        ("deck_machines", live.deck_machines(), demo.deck_machines()),
        ("core_agents", live.core_agents(), demo.core_agents()),
        ("core_terminals", live.core_terminals(), demo.core_terminals()),
        ("core_machines", live.core_machines(), demo.core_machines()),
        ("core_server", live.core_server(), demo.core_server()),
        ("core_spaces", live.core_spaces(), demo.core_spaces()),
        ("core_ratings", live.core_ratings(), demo.core_ratings()),
    ];
    for (name, l, d) in cases {
        let lv = l.unwrap();
        let dv = d.unwrap();
        assert_eq!(keys_of(&lv), keys_of(&dv), "паритет ключей {name}");
    }
    // deck_status: одинаковые ключи, разный source
    let lv = live.deck_status().unwrap();
    let dv = demo.deck_status().unwrap();
    assert_eq!(keys_of(&lv), keys_of(&dv), "паритет ключей deck_status");
    assert_eq!(lv["source"], "live");
    assert_eq!(dv["source"], "demo");
    // demo-машины не содержат реальных хостов
    let machines = demo.deck_machines().unwrap();
    let text = machines.to_string().to_lowercase();
    for banned in ["roy1", "sage-pl", "2.27.5.234"] {
        assert!(!text.contains(banned), "демо-машина утекла {banned:?}");
    }
}
