//! NUE-HOST-SECURITY (QODER волна 1): регрессионные тесты.
//!
//! Покрывают N-1 (escape абсолютным путём), N-2 (MIME SPA-fallback),
//! N-3 (405 на не-GET), N-4 (404 на неизвестные пути), N-5 (Host).
//!
//! Запускаются против реального listen-сокета на 127.0.0.1:0 —
//! полный HTTP-путь (read_request → handle → serve_static/proxy).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::Duration;

fn free_port() -> u16 {
    let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = l.local_addr().unwrap().port();
    drop(l);
    port
}

struct Server {
    port: u16,
    _thread: std::thread::JoinHandle<()>,
}

/// Запускает реальный сервер на случайном локальном порту с тестовым root.
/// Поток не join'им: при завершении теста процесс сам убьёт его.
fn with_server<T>(f: T)
where
    T: FnOnce(&Server),
{
    let root = temp_root();
    let port = free_port();
    let root2 = root.clone();
    let handle = std::thread::spawn(move || {
        // remote не используется тестами (только статика/OPTIONS/методы);
        // прокси-ветки в тестах не трогаем.
        let _ = nue_host::serve(port, root2, "http://127.0.0.1:9/v1".to_string());
    });
    std::thread::sleep(Duration::from_millis(200));
    let srv = Server {
        port,
        _thread: handle,
    };
    f(&srv);
}

/// Тестовая копия NUE out/: index.html + роуты + один реальный ассет.
fn temp_root() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "nue-host-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("index.html"), "<!DOCTYPE html><title>NUE</title>").unwrap();
    std::fs::write(dir.join("style.css"), "body{}").unwrap();
    // Next.js static export: каждый роут — отдельный `{route}.html`.
    for r in ["workflow", "deck", "newf", "mission-control"] {
        std::fs::write(dir.join(format!("{r}.html")), format!("<!DOCTYPE html><title>{r}</title>"))
            .unwrap();
    }
    dir
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

fn get(port: u16, path: &str, host: &str) -> (u16, String) {
    let req = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    let (code, head, _) = raw_http(port, &req);
    (code, head)
}

// ---------------------------------------------------------------------------
// N-1: абсолютный путь Windows не должен читать файлы вне root
// ---------------------------------------------------------------------------

#[test]
fn escape_absolute_path_windows_is_404() {
    with_server(|s| {
        for p in [
            "/C:/Windows/win.ini",
            "/C:/Users/someuser/.config/settings.json",
            "/D:/repo/placeholder/Cargo.toml",
            "/C:/Windows/System32/drivers/etc/hosts",
        ] {
            let (code, _) = get(s.port, p, "127.0.0.1");
            assert_eq!(code, 404, "N-1: {p} должен давать 404");
        }
    });
}

#[test]
fn escape_absolute_path_percent_encoded_is_404() {
    with_server(|s| {
        for p in [
            "/C:%5CWindows%5Cwin.ini",
            "/C:%3A/Windows/win.ini",
            "/%43%3A/Windows/win.ini",
            "/C:/Windows%5Cwin.ini",
        ] {
            let (code, _) = get(s.port, p, "127.0.0.1");
            assert_eq!(code, 404, "N-1: {p} должен давать 404");
        }
    });
}

#[test]
fn escape_relative_traversal_is_404() {
    with_server(|s| {
        for p in [
            "/../Cargo.toml",
            "/..%2f..%2fCargo.toml",
            "/%2e%2e/%2e%2e/Cargo.toml",
            "/..\\..\\Cargo.toml",
            "/%252e%252e%252fCargo.toml",
        ] {
            let (code, _) = get(s.port, p, "127.0.0.1");
            assert_eq!(code, 404, "N-1: {p} должен давать 404");
        }
    });
}

#[test]
fn escape_ntfs_ads_is_404() {
    with_server(|s| {
        let (code, _) = get(s.port, "/index.html:hidden", "127.0.0.1");
        assert_eq!(code, 404, "N-1: NTFS ADS должен давать 404");
    });
}

// ---------------------------------------------------------------------------
// Обычные пути внутри root работают
// ---------------------------------------------------------------------------

#[test]
fn root_files_and_spa_for_200() {
    with_server(|s| {
        let (code, head) = get(s.port, "/index.html", "127.0.0.1");
        assert_eq!(code, 200);
        assert!(head.contains("text/html"), "head={head}");

        let (code, head) = get(s.port, "/", "127.0.0.1");
        assert_eq!(code, 200);
        assert!(head.contains("text/html"), "head={head}");

        let (code, head) = get(s.port, "/style.css", "127.0.0.1");
        assert_eq!(code, 200);
        assert!(head.contains("text/css"), "head={head}");
    });
}

// ---------------------------------------------------------------------------
// N-2: MIME SPA-fallback = text/html (а не application/octet-stream)
// ---------------------------------------------------------------------------

#[test]
fn spa_fallback_serves_text_html() {
    with_server(|s| {
        // роуты существуют как {route}.html — отдаются как text/html
        for p in ["/workflow", "/deck", "/newf", "/mission-control"] {
            let (code, head) = get(s.port, p, "127.0.0.1");
            assert_eq!(code, 200, "{p}");
            assert!(
                head.contains("text/html"),
                "N-2: {p} должен отдаваться text/html, head={head}"
            );
        }
    });
}

// ---------------------------------------------------------------------------
// N-4: неизвестные пути → 404 (а не 200 + index.html)
// ---------------------------------------------------------------------------

#[test]
fn unknown_paths_are_404() {
    with_server(|s| {
        for p in [
            "/.git/config",
            "/.env",
            "/not-a-real-file.css",
            "/assets/missing.png",
            "/.well-known/security.txt",
            "/no-such-route",
        ] {
            let (code, _) = get(s.port, p, "127.0.0.1");
            assert_eq!(code, 404, "N-4: {p} должен давать 404");
        }
    });
}

// ---------------------------------------------------------------------------
// N-3: не-GET/HEAD на статике → 405
// ---------------------------------------------------------------------------

#[test]
fn non_get_methods_on_static_are_405() {
    with_server(|s| {
        for m in ["POST", "PUT", "DELETE", "PATCH", "PROPFIND"] {
            let req = format!(
                "{m} / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let (code, head, _) = raw_http(s.port, &req);
            assert_eq!(code, 405, "N-3: {m} / должен давать 405");
            assert!(head.contains("405"), "head={head}");
        }
        let (code, _) = get(s.port, "/", "127.0.0.1");
        assert_eq!(code, 200, "GET всё ещё должен работать");
    });
}

// ---------------------------------------------------------------------------
// N-5: чужой Host отклоняется
// ---------------------------------------------------------------------------

#[test]
fn foreign_host_is_rejected() {
    with_server(|s| {
        for host in ["evil.example", "attacker.com", "127.0.0.1.evil.com"] {
            let (code, _) = get(s.port, "/", host);
            assert!(
                code == 421 || code == 403,
                "N-5: Host {host} должен отклоняться (421/403), получено {code}"
            );
        }
        for host in ["127.0.0.1", "localhost", "127.0.0.1:8869", "localhost:8869"] {
            let (code, _) = get(s.port, "/", host);
            assert_eq!(code, 200, "Host {host} должен быть разрешён");
        }
    });
}
