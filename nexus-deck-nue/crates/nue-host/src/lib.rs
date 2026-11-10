//! NUE-IN-NXAPP: локальный хост для NUE-клиента.
//!
//! Работает в копии nexus-deck (`nexus-deck-nue`), живой nx-app не трогает.
//! 1) Раздаёт статический NUE-бандл (`apps/nexus/out/`) на 127.0.0.1:<port>.
//! 2) Проксирует `/v1/*` на удалённый ai2 host (по умолчанию
//!    https://example.invalid/v1/* — настраивается флагом `--remote`) — заголовки и метод проходят
//!    без изменений, авторизацию (Bearer / X-API-Key) несёт сам клиент.
//! 3) Next.js static export: `{path}` → `{path}.html` → `{path}/index.html` → 404.
//!
//! Безопасность (QODER NUE-HOST-SECURITY):
//!   N-1  нет обхода root: относительный и абсолютный traversal (`..`,
//!        `C:/…`, NTFS-ADS `file:stream`) → 404;
//!   N-2  MIME считается по фактически отданному файлу (SPA-роут → text/html);
//!   N-3  не-GET/HEAD на статике → 405;
//!   N-4  неизвестные пути → 404 (не 200 + index.html);
//!   N-5  Host-валидация (только localhost/127.0.0.1/[::1]) → 421;
//!   N-6  нераспознанный метод прокси → 405;
//!   N-7  префикс `/v1/` вырезается ровно один раз, `..` в прокси → 404;
//!   N-9  Transfer-Encoding: chunked → 411.
//!
//! Мини-сервер на std::net::TcpListener (HTTP/1.1, Connection: close) —
//! без новых сетевых зависимостей в приложении; сеть только у прокси
//! (ureq в крейте nue-host).

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};

pub const DEFAULT_PORT: u16 = 8869;
/// Default remote backend. Override with `--remote` when running
/// `nx-nue-host` (see bin/nx-nue-host.rs); the placeholder below is
/// deliberately not a live host.
pub const DEFAULT_REMOTE: &str = "https://example.invalid/v1";
const MAX_BODY: usize = 16 * 1024 * 1024; // тело запроса к прокси (16 MiB)

/// Поток-обработчик соединения. `root` — папка статики, `remote` — base URL прокси.
pub fn serve(port: u16, root: PathBuf, remote: String) -> io::Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    eprintln!(
        "nue-host: NUE на http://127.0.0.1:{port} (root: {}) · /v1/* → {remote}",
        root.display()
    );
    if !root.join("index.html").exists() {
        eprintln!("nue-host: предупреждение: index.html не найден в {}", root.display());
    }
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let root = root.clone();
                let remote = remote.clone();
                std::thread::spawn(move || {
                    if let Err(e) = handle(stream, &root, &remote) {
                        eprintln!("nue-host: {e}");
                    }
                });
            }
            Err(e) => eprintln!("nue-host: accept: {e}"),
        }
    }
    Ok(())
}

struct Request {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    chunked: bool,
}

fn handle(mut stream: TcpStream, root: &Path, remote: &str) -> io::Result<()> {
    stream.set_read_timeout(Some(std::time::Duration::from_secs(30)))?;
    let req = read_request(&mut stream)?;
    eprintln!("nue-host: {} {}", req.method, req.path);

    // N-5: Host-валидация (закрывает DNS-rebinding).
    if !host_allowed(&req.headers) {
        return response_plain(&mut stream, 421, "Misdirected Request");
    }

    // CORS: предзапросы от браузера (NUE-бандл открывается с другого origin).
    if req.method == "OPTIONS" {
        let r = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(r.as_bytes())?;
        return Ok(());
    }

    // N-9: chunked-тела не поддерживаются → 411 (не отправляем битое тело в апстрим).
    if req.chunked {
        return response_plain(&mut stream, 411, "Length Required");
    }

    if req.path.starts_with("/v1/") {
        return proxy(&mut stream, &req, remote);
    }

    serve_static(&mut stream, &req, root)
}

/// N-5: разрешены только локальные hostname (порт игнорируется).
fn host_allowed(headers: &[(String, String)]) -> bool {
    let Some((_, v)) = headers.iter().find(|(k, _)| k == "host") else {
        return true; // HTTP/1.0 / локальный клиент без Host
    };
    let host = v.rsplit_once(':').map(|(h, _)| h).unwrap_or(v.as_str()).trim();
    host.is_empty()
        || host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "[::1]"
}

fn read_request(stream: &mut TcpStream) -> io::Result<Request> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        let n = stream.read(&mut tmp)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "EOF in request"));
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
        if buf.len() > 64 * 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "headers too large"));
        }
    };

    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut lines = head.split("\r\n");

    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts.next().unwrap_or("/").to_string();

    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }

    let chunked = headers.iter().any(|(k, v)| {
        k == "transfer-encoding" && !v.eq_ignore_ascii_case("identity")
    });

    let content_length: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    if content_length > MAX_BODY {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "body too large"));
    }
    let mut body = buf[header_end..].to_vec();
    if body.len() < content_length {
        let mut rest = vec![0u8; content_length - body.len()];
        stream.read_exact(&mut rest)?;
        body.extend_from_slice(&rest);
    }

    Ok(Request { method, path, headers, body, chunked })
}

const MIME: &[(&str, &str)] = &[
    ("html", "text/html; charset=utf-8"),
    ("htm", "text/html; charset=utf-8"),
    ("js", "text/javascript; charset=utf-8"),
    ("mjs", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("json", "application/json; charset=utf-8"),
    ("map", "application/json; charset=utf-8"),
    ("svg", "image/svg+xml"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("ico", "image/x-icon"),
    ("txt", "text/plain; charset=utf-8"),
    ("xml", "application/xml"),
    ("pdf", "application/pdf"),
    ("wasm", "application/wasm"),
    ("woff", "font/woff"),
    ("woff2", "font/woff2"),
    ("ttf", "font/ttf"),
    ("otf", "font/otf"),
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("ogg", "audio/ogg"),
];

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    MIME
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, m)| *m)
        .unwrap_or("application/octet-stream")
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Безопасное разрешение пути.
/// N-1: никаких `..`, абсолютных путей (`C:/…`, `\\server\share`, `/…`),
/// букв диска, NTFS-ADS (`file:stream`) — всё это → None → 404.
fn resolve_path(root: &Path, raw: &str) -> Option<PathBuf> {
    let decoded = percent_decode(raw.split('?').next().unwrap_or("/"));
    let clean = if decoded.is_empty() { "/" } else { decoded.as_str() };
    let mut parts: Vec<String> = Vec::new();
    for seg in clean.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => return None,
            s if s.contains(':') => return None, // буква диска и NTFS-ADS
            s => parts.push(s.to_string()),
        }
    }
    if parts.is_empty() {
        parts.push("index.html".to_string());
    }
    let joined = parts.join("/");
    let rel = Path::new(&joined);
    if rel.is_absolute()
        || rel.components().any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
    {
        return None;
    }
    let candidate = root.join(rel);
    if !candidate.starts_with(root) {
        return None; // страховка: результат остаётся в root
    }
    Some(candidate)
}

fn response_plain(stream: &mut TcpStream, status: u16, reason: &str) -> io::Result<()> {
    let body = format!("{status} {reason}\n");
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    Ok(())
}

fn response_404(stream: &mut TcpStream) -> io::Result<()> {
    response_plain(stream, 404, "Not Found")
}

/// Статика. Порядок поиска (Next.js static export):
///   1. `root/<path>` (точный файл);
///   2. `root/<path>.html` (роут: `/workflow` → `workflow.html`);
///   3. `root/<path>/index.html` (вложенный каталог);
///   иначе → 404 (N-4). Не-GET/HEAD → 405 (N-3).
/// MIME считается по фактически отданному файлу (N-2).
fn serve_static(stream: &mut TcpStream, req: &Request, root: &Path) -> io::Result<()> {
    if req.method != "GET" && req.method != "HEAD" {
        return response_plain(stream, 405, "Method Not Allowed");
    }

    let requested = match resolve_path(root, &req.path) {
        Some(p) => p,
        None => return response_404(stream),
    };

    let mut target = requested.clone();
    let mut opened = std::fs::File::open(&target);
    if opened.is_err() {
        if requested.extension().is_none() {
            let mut with_html = requested.clone();
            with_html.set_extension("html");
            target = with_html;
            opened = std::fs::File::open(&target);
        }
        if opened.is_err() {
            target = requested.join("index.html");
            opened = std::fs::File::open(&target);
        }
    }
    let mut file = match opened {
        Ok(f) => f,
        Err(_) => return response_404(stream),
    };

    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        mime_for(target.to_str().unwrap_or("")),
        len
    );
    stream.write_all(head.as_bytes())?;
    if req.method != "HEAD" {
        io::copy(&mut file, stream)?;
    }
    Ok(())
}

use ureq::{Agent, RequestBuilder};

fn skip_header(k: &str) -> bool {
    matches!(k, "host" | "connection" | "content-length" | "accept-encoding")
}

fn apply_headers<T>(b: RequestBuilder<T>, headers: &[(String, String)]) -> RequestBuilder<T> {
    let mut b = b;
    for (k, v) in headers {
        if skip_header(k) {
            continue;
        }
        b = b.header(k.as_str(), v.as_str());
    }
    b
}

fn proxy(stream: &mut TcpStream, req: &Request, remote: &str) -> io::Result<()> {
    // N-7: вырезаем ровно один префикс `/v1/`; сегменты `..` → 404.
    let rest = match req.path.strip_prefix("/v1/") {
        Some(r) => r,
        None => return response_404(stream),
    };
    if rest.split(['/', '\\']).any(|s| s == "..") {
        return response_404(stream);
    }
    let url = format!("{remote}/{rest}");
    let agent = Agent::new_with_defaults();
    let result = match req.method.as_str() {
        "GET" => apply_headers(agent.get(&url), &req.headers).call(),
        "POST" => apply_headers(agent.post(&url), &req.headers).send(req.body.as_slice()),
        "PUT" => apply_headers(agent.put(&url), &req.headers).send(req.body.as_slice()),
        "PATCH" => apply_headers(agent.patch(&url), &req.headers).send(req.body.as_slice()),
        "DELETE" => apply_headers(agent.delete(&url), &req.headers).call(),
        "HEAD" => apply_headers(agent.head(&url), &req.headers).call(),
        _ => return response_plain(stream, 405, "Method Not Allowed"), // N-6
    };
    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let reason = reason_phrase(status).to_string();
            let ct = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            let mut body = Vec::new();
            resp.into_body()
                .into_reader()
                .take(MAX_BODY as u64)
                .read_to_end(&mut body)?;
            let head = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes())?;
            if req.method != "HEAD" {
                stream.write_all(&body)?;
            }
            Ok(())
        }
        Err(ureq::Error::StatusCode(status)) => {
            let reason = reason_phrase(status).to_string();
            let body = format!("{{\"error\":\"http_{status}\"}}\n");
            let head = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes())?;
            stream.write_all(body.as_bytes())?;
            Ok(())
        }
        Err(e) => {
            let msg = format!("nue-host: proxy error: {e}");
            eprintln!("{msg}");
            let body = format!("{{\"error\":\"proxy_unreachable\",\"detail\":{msg:?}}}\n");
            let head = format!(
                "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes())?;
            stream.write_all(body.as_bytes())?;
            Ok(())
        }
    }
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        204 => "No Content",
        301 => "Moved Permanently",
        302 => "Found",
        304 => "Not Modified",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        411 => "Length Required",
        418 => "I'm a teapot",
        421 => "Misdirected Request",
        422 => "Unprocessable Entity",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "",
    }
}
