//! NUE host (owner directive NUE-IN-NXAPP): the app becomes the local host for the
//! NUE client. Architecture (Windows):
//!
//! - the NUE bundle (`apps/nexus/out`, the Next static export) is served from a
//!   local 127.0.0.1 HTTP server in this process;
//! - `/v1/*` requests are same-origin to the bundle and are proxied to the
//!   remote ai2 backend (default `https://example.invalid/v1/*`, overridable);
//! - a WebView2 window (its own Win32 top-level window owned by the app process)
//!   opens the local URL, so the NUE client runs inside the app without a
//!   separate host machine.
//!
//! The server keeps running even if the webview cannot start: the URL stays
//! usable from a system browser, and every proxied call is logged to the
//! console (`[nue] PROXY ...`) as backend evidence.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use webview2_com::{
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    CoreWebView2EnvironmentOptions, Microsoft::Web::WebView2::Win32::{
        CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2Controller,
        ICoreWebView2EnvironmentOptions,
    },
};
use windows_core::PCWSTR;

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// The webview controller, for resizing it with the window (WM_SIZE).
static CTRL: Mutex<Option<ICoreWebView2Controller>> = Mutex::new(None);

const DEFAULT_UPSTREAM: &str = "https://example.invalid";
const DEFAULT_OUT: &str = "<NUE_OUT_DIR>";
const DEFAULT_PORT: u16 = 8787;
const MAX_BODY: u64 = 10_000_000;

pub fn run(args: &[String]) {
    let mut out: Option<PathBuf> = None;
    let mut upstream = DEFAULT_UPSTREAM.to_string();
    let mut port = DEFAULT_PORT;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                if let Some(p) = args.get(i) {
                    out = Some(PathBuf::from(p));
                }
            }
            "--upstream" => {
                i += 1;
                if let Some(u) = args.get(i) {
                    upstream = u.clone();
                }
            }
            "--port" => {
                i += 1;
                if let Some(p) = args.get(i).and_then(|s| s.parse().ok()) {
                    port = p;
                }
            }
            other => eprintln!("nue: unknown flag {other:?}"),
        }
        i += 1;
    }
    let out_dir = out.unwrap_or_else(|| PathBuf::from(DEFAULT_OUT));
    if !out_dir.join("index.html").exists() {
        eprintln!("nue: {out_dir:?} has no index.html — build the bundle first (pnpm nx run nexus:build)");
        std::process::exit(2);
    }

    // The local server: static bundle + /v1/* proxy.
    let serve_port = listen_and_serve(out_dir.clone(), upstream.clone(), port);
    let url = format!("http://127.0.0.1:{serve_port}/");
    println!(
        "nue: serving {} at {url}; /v1/* -> {}",
        out_dir.display(),
        upstream.trim_end_matches('/')
    );

    if let Err(e) = open_webview(&url) {
        println!(
            "nue: webview unavailable ({e:#}) — the server keeps running; open {url} in a browser, Ctrl-C stops it"
        );
    }
}

/// Bind 127.0.0.1:port (port..port+50), run the request loop in a thread.
fn listen_and_serve(out_dir: PathBuf, upstream: String, first: u16) -> u16 {
    let listener = (first..(first + 50))
        .find_map(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .expect("nue: no free port in range for the local server");
    let port = listener.local_addr().expect("nue: no local address").port();
    let upstream = upstream.trim_end_matches('/').to_string();
    thread::spawn(move || {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(60)))
            .build();
        let agent = ureq::Agent::new_with_config(agent);
        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                serve_one(&mut stream, &out_dir, &upstream, &agent);
            }
        }
    });
    port
}

fn serve_one(stream: &mut TcpStream, out_dir: &Path, upstream: &str, agent: &ureq::Agent) {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    // Request head: read until the blank line (cap the head at 16 KB).
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16_384 {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    let mut lines = text.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let (path, query) = match target.find('?') {
        Some(q) => (&target[..q], Some(&target[q..])),
        None => (target.as_str(), None),
    };

    let mut content_length = 0u64;
    let mut forward: Vec<(String, String)> = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let (name, value) = (name.trim(), value.trim());
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.parse().unwrap_or(0).min(MAX_BODY);
            } else if name.eq_ignore_ascii_case("content-type")
                || name.eq_ignore_ascii_case("authorization")
                || name.starts_with("x-")
                || name.eq_ignore_ascii_case("accept")
            {
                forward.push((name.to_string(), value.to_string()));
            }
        }
    }
    // The body, when declared and small enough.
    let mut body: Vec<u8> = Vec::new();
    if content_length > 0 {
        while (body.len() as u64) < content_length {
            if let Ok(n) = stream.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                body.extend_from_slice(&chunk[..n]);
            } else {
                break;
            }
        }
    }

    if path == "/v1" || path.starts_with("/v1/") {
        proxy(stream, &method, target, &forward, &body, upstream, agent);
    } else {
        static_file(stream, out_dir, path, &method);
    }
}

/// Forward /v1/* to the remote ai2 backend over TLS and write the response back
/// to the client; the log line is the backend-touching evidence.
fn proxy(
    stream: &mut TcpStream,
    method: &str,
    target: &str,
    forward: &[(String, String)],
    body: &[u8],
    upstream: &str,
    agent: &ureq::Agent,
) {
    let url = format!("{upstream}{target}");
    let t0 = Instant::now();
    let result: Result<(u16, Option<String>, Vec<u8>), String> = match method {
        "GET" => send_no_body(agent.get(&url), forward),
        "HEAD" => send_no_body(agent.head(&url), forward),
        "DELETE" => send_no_body(agent.delete(&url), forward),
        "POST" => send_with_body(agent.post(&url), forward, body),
        "PUT" => send_with_body(agent.put(&url), forward, body),
        "PATCH" => send_with_body(agent.patch(&url), forward, body),
        other => {
            println!("[nue] PROXY {other} {target} -> 405 (not a proxied method)");
            write_http_response(stream, 405, "text/plain", b"method not proxied");
            return;
        }
    };

    match result {
        Ok((status, ct, bytes)) => {
            let text = ct.as_deref().unwrap_or("application/octet-stream");
            println!(
                "[nue] PROXY {method} {target} -> {status} in {:.2} s ({} bytes)",
                t0.elapsed().as_secs_f64(),
                bytes.len()
            );
            write_http_response(stream, status, text, &bytes);
        }
        Err(e) => {
            println!(
                "[nue] PROXY {method} {target} -> 502 upstream error ({e}) after {:.1} s",
                t0.elapsed().as_secs_f64()
            );
            let msg = format!("{{\"error\":\"upstream unavailable: {e}\"}}");
            write_http_response(stream, 502, "application/json", msg.as_bytes());
        }
    }
}

/// Forwarded headers: identity-signalling ones only, re-validated by the client.
fn forward_headers(
    forward: &[(String, String)],
) -> Vec<(String, String)> {
    forward
        .iter()
        .filter(|(n, _)| {
            let n = n.to_ascii_lowercase();
            n.starts_with("x-") || n == "content-type" || n == "authorization" || n == "accept"
        })
        .cloned()
        .collect()
}

/// GET/HEAD/DELETE: no request body.
fn send_no_body(
    builder: ureq::RequestBuilder<ureq::typestate::WithoutBody>,
    forward: &[(String, String)],
) -> Result<(u16, Option<String>, Vec<u8>), String> {
    let mut b = builder;
    for (name, value) in forward_headers(forward) {
        b = b.header(name.as_str(), value.as_str());
    }
    let resp = b.call().map_err(|e| e.to_string())?;
    read_response(resp)
}

/// POST/PUT/PATCH: forward the request body.
fn send_with_body(
    builder: ureq::RequestBuilder<ureq::typestate::WithBody>,
    forward: &[(String, String)],
    body: &[u8],
) -> Result<(u16, Option<String>, Vec<u8>), String> {
    let mut b = builder;
    for (name, value) in forward_headers(forward) {
        b = b.header(name.as_str(), value.as_str());
    }
    let resp = b.send(body).map_err(|e| e.to_string())?;
    read_response(resp)
}

fn read_response(mut resp: ureq::http::Response<ureq::Body>) -> Result<(u16, Option<String>, Vec<u8>), String> {
    let status = resp.status().as_u16();
    let content_type = resp.header("content-type").map(|h| h.to_string());
    let bytes = resp.body().read_to_vec().map_err(|e| e.to_string())?;
    Ok((status, content_type, bytes))
}

/// Write a plain HTTP/1.1 response (head + body) to the client.
fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    ct: Option<&str>,
    body: &[u8],
) {
    let reason = reason_phrase(status);
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {ct2}\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\n\r\n",
        body.len(),
        ct2 = ct.unwrap_or("application/octet-stream")
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

/// Serve the static bundle out of the Next export tree.
fn static_file(stream: &mut TcpStream, out_dir: &Path, path: &str, method: &str) {
    if method != "GET" && method != "HEAD" {
        respond(stream, 405, Some(b"method not allowed (GET only)"), "text/plain");
        return;
    }
    let rel = path.trim_start_matches('/');
    // Reject traversal.
    if rel.contains("..") {
        respond(stream, 400, Some(b"bad path"), "text/plain");
        return;
    }
    let p = out_dir.join(rel);
    let file = if p.is_file() {
        p
    } else if !rel.contains('.') && p.with_extension("html").is_file() {
        // Extensionless route (/agents -> agents.html) in the static export.
        p.with_extension("html")
    } else if rel.is_empty() {
        out_dir.join("index.html")
    } else {
        // Unknown path: SPA-style fall to the export's 404 page when it exists.
        let fallback = out_dir.join("404.html");
        if fallback.is_file() {
            println!("[nue] STATIC {path} -> 404 (served 404.html)");
            respond_or_file(stream, &fallback, 404, "text/html");
            return;
        }
        println!("[nue] STATIC {path} -> 404");
        respond(stream, 404, Some(b"not found"), "text/plain");
        return;
    };
    if let Ok(bytes) = std::fs::read(&file) {
        let ct = content_type(&file);
        let cache = if rel.contains("_next/") {
            "public, max-age=31536000, immutable"
        } else if ct.starts_with("text/html") {
            "no-cache"
        } else {
            "public, max-age=60"
        };
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: {ct}\r\ncache-control: {cache}\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\n\r\n",
            bytes.len()
        );
        if method == "HEAD" {
            let _ = stream.write_all(head.as_bytes());
        } else {
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&bytes);
        }
        println!("[nue] STATIC {path} -> 200 ({} bytes)", bytes.len());
    } else {
        respond(stream, 500, Some(b"read failed"), "text/plain");
    }
}

fn respond_or_file(stream: &mut TcpStream, path: &Path, status: u16, ct: &str) {
    let bytes = std::fs::read(path).unwrap_or_default();
    let head = format!(
        "HTTP/1.1 {status} \r\ncontent-type: {ct}\r\ncontent-length: {}\r\n\r\n",
        bytes.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&bytes);
}

fn respond(stream: &mut TcpStream, status: u16, body: Option<&[u8]>, ct: &str) {
    let body = body.unwrap_or(b"");
    let head = format!(
        "HTTP/1.1 {status}\r\ncontent-type: {ct}\r\ncontent-length: {}\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    if !body.is_empty() {
        let _ = stream.write_all(body);
    }
}

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("map") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("txt") => "text/plain; charset=utf-8",
        Some("wasm") => "application/wasm",
        _ => "application/octet-stream",
    }
}

// ---- WebView2 window -----------------------------------------------------

fn user_data_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("D:\\nx-app-nue"));
    let dir = base.join("nx-app-nue").join("webview2");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn open_webview(url: &str) -> Result<(), String> {
    let user_data = user_data_dir();

    // Top-level Win32 window owned by this process.
    unsafe {
        let class_name = wide("NueHostWindow");
        let title = wide("NUE — NEXUS");
        let hinstance = GetModuleHandleW(None);
        let mut cls: WNDCLASSEXW = std::mem::zeroed();
        cls.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
        cls.style = CS_HREDRAW | CS_VREDRAW;
        cls.lpfnWndProc = Some(wnd_proc);
        cls.hInstance = hinstance;
        cls.lpszClassName = class_name.as_ptr();
        RegisterClassExW(&cls as *const _);

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            title.as_ptr(),
            WS_OVERLAPPEDWINDOW,
            (current_width() as i32 - 1360) / 2,
            (current_height() as i32 - 900) / 2,
            1360,
            900,
            None,
            None,
            hinstance,
            None,
        );
        if hwnd == 0 {
            return Err("CreateWindowExW failed".into());
        }
        ShowWindow(hwnd, SW_SHOW);
        SetForegroundWindow(hwnd);

        // WebView2 environment (stable channel).
        let opts = CoreWebView2EnvironmentOptions::default();
        let env_opts: &ICoreWebView2EnvironmentOptions =
            &ICoreWebView2EnvironmentOptions::from(opts);
        let (tx, rx) = mpsc::channel();
        let user_data_s = user_data.to_string_lossy().into_owned();
        CreateCoreWebView2EnvironmentWithOptions(
            PCWSTR::null(),
            &user_data_s,
            env_opts,
            &CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
                move |error_code, environment| {
                    error_code?;
                    environment
                        .ok_or(windows_core::Error::from(windows_core::HRESULT(0x80004003)))
                        .and_then(|env| {
                            let _ = tx.send(env);
                            Ok(())
                        })
                        .map_err(|_| windows_core::Error::from(windows_core::HRESULT(0x80000081)))
                },
            )),
        )
        .map_err(|e| format!("CreateCoreWebView2EnvironmentWithOptions: {e}"))?;
        let env = webview2_com::wait_with_pump(rx).map_err(|e| format!("webview2 env: {e:?}"))?;

        // Controller bound to our window.
        let (tx2, rx2) = mpsc::channel();
        env.CreateCoreWebView2Controller(
            hwnd,
            &CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |error_code, controller| {
                    error_code?;
                    controller
                        .ok_or(windows_core::Error::from(windows_core::HRESULT(0x80004003)))
                        .and_then(|c| {
                            let _ = tx2.send(c);
                            Ok(())
                        })
                        .map_err(|_| windows_core::Error::from(windows_core::HRESULT(0x80000081)))
                },
            )),
        )
        .map_err(|e| format!("CreateCoreWebView2Controller: {e}"))?;
        let ctrl = webview2_com::wait_with_pump(rx2).map_err(|e| format!("webview2 ctrl: {e:?}"))?;

        let webview = ctrl
            .GetWebView()
            .map_err(|e| format!("GetWebView: {e}"))?;
        let mut url16: Vec<u16> = url.encode_utf16().collect();
        url16.push(0);
        webview
            .Navigate(PCWSTR::from_utf16(&url16).map_err(|e| format!("url: {e}"))?)
            .map_err(|e| format!("Navigate: {e}"))?;

        *CTRL.lock().unwrap() = Some(ctrl.clone());
    }

    // Message loop until the window closes.
    let mut msg: MSG = std::mem::zeroed();
    while unsafe { GetMessageW(&mut msg, 0, 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: u32,
    lparam: i32,
) -> windows_sys::Win32::Foundation::LRESULT {
    match msg {
        WM_SIZE => {
            if let Some(ctrl) = CTRL.lock().ok().and_then(|g| g.clone()) {
                let mut r: windows_sys::Win32::Graphics::Gdi::RECT = std::mem::zeroed();
                GetClientRect(hwnd, &mut r);
                let _ = ctrl.SetBounds(&windows::Win32::Foundation::RECT {
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom,
                });
            }
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn current_width() -> u32 {
    unsafe { GetSystemMetrics(SM_CXSCREEN) as u32 }
}
fn current_height() -> u32 {
    unsafe { GetSystemMetrics(SM_CYSCREEN) as u32 }
}
