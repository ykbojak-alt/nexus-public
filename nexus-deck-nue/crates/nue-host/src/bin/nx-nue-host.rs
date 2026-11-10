//! nx-nue-host: автономный локальный хост NUE (без окна nx-app).
//!
//! Использование:
//!   nx-nue-host [--root <папка-out>] [--port <порт>] [--remote <base-url>]
//!
//! По умолчанию:
//!   --root   <путь к статическому экспорту NUE>
//!   --port   8869
//!   --remote https://example.invalid/v1

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut root = std::path::PathBuf::from(r"<NUE_OUT_DIR>");
    let mut port = nue_host::DEFAULT_PORT;
    let mut remote = nue_host::DEFAULT_REMOTE.to_string();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    root = std::path::PathBuf::from(v);
                }
            }
            "--port" => {
                i += 1;
                if let Some(v) = args.get(i).and_then(|s| s.parse().ok()) {
                    port = v;
                }
            }
            "--remote" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    remote = v.trim_end_matches('/').to_string();
                }
            }
            "--help" | "-h" => {
                println!("nx-nue-host [--root <dir>] [--port <n>] [--remote <base>]");
                return;
            }
            other => {
                eprintln!("nx-nue-host: неизвестный аргумент {other:?}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    if let Err(e) = nue_host::serve(port, root, remote) {
        eprintln!("nx-nue-host: {e}");
        std::process::exit(1);
    }
}
