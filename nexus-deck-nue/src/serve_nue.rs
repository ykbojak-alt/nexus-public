//! `nx-app serve-nue` — локальный хост NUE (NUE-IN-NXAPP).
//!
//! Запускает HTTP-сервер на 127.0.0.1:<port>, который раздаёт статический
//! NUE-бандл (apps/nexus/out/) и проксирует `/v1/*` на удалённый ai2 host.
//! Наиболее инвазивный путь: отдельная субкоманда, окно/модель/моды не
//! трогаются; блокирует процесс до остановки (Ctrl+C).
//!
//! Использование:
//!   nx-app serve-nue [--root <dir>] [--port <n>] [--remote <base>]

use std::path::PathBuf;

pub fn main(args: &[String]) -> i32 {
    let mut root = PathBuf::from(r"D:\nexus\apps\nexus\out");
    let mut port = nue_host::DEFAULT_PORT;
    let mut remote = nue_host::DEFAULT_REMOTE.to_string();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                i += 1;
                match args.get(i) {
                    Some(v) => root = PathBuf::from(v),
                    None => return usage(),
                }
            }
            "--port" => {
                i += 1;
                match args.get(i).and_then(|s| s.parse().ok()) {
                    Some(v) => port = v,
                    None => return usage(),
                }
            }
            "--remote" => {
                i += 1;
                match args.get(i) {
                    Some(v) => remote = v.trim_end_matches('/').to_string(),
                    None => return usage(),
                }
            }
            "--help" | "-h" => {
                println!(
                    "nx-app serve-nue [--root <dir>] [--port <n>] [--remote <base>]\n\
                     NUE-бандл по умолчанию: {}",
                    root.display()
                );
                return 0;
            }
            other => {
                eprintln!("nx-app serve-nue: неизвестный аргумент {other:?}");
                return usage();
            }
        }
        i += 1;
    }

    match nue_host::serve(port, root, remote) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("nx-app serve-nue: {e}");
            1
        }
    }
}

fn usage() -> i32 {
    eprintln!("nx-app serve-nue [--root <dir>] [--port <n>] [--remote <base>]");
    2
}
