// SPDX-License-Identifier: AGPL-3.0-or-later
//! `solde-server healthcheck`: the probe used by the container healthcheck.

use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::Duration;

const BIN: &str = env!("CARGO_BIN_EXE_solde-server");

/// A free local port (bound, then released).
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind")
        .local_addr()
        .expect("addr")
        .port()
}

/// The binary with a clean `SOLDE_*` environment.
fn command(env: &[(&str, &str)]) -> Command {
    let mut command = Command::new(BIN);
    for (name, _) in std::env::vars() {
        if name.starts_with("SOLDE_") || name == "RUST_LOG" {
            command.env_remove(name);
        }
    }
    command.envs(env.iter().copied());
    command
}

fn healthcheck(listen: &str) -> Output {
    command(&[("SOLDE_LISTEN_ADDR", listen)])
        .arg("healthcheck")
        .output()
        .expect("run solde-server healthcheck")
}

#[test]
fn unspecified_addresses_probe_loopback() {
    let addr = |s: &str| s.parse::<SocketAddr>().expect("addr");
    assert_eq!(
        solde_server::healthcheck_addr(addr("0.0.0.0:8080")),
        addr("127.0.0.1:8080")
    );
    assert_eq!(
        solde_server::healthcheck_addr(addr("[::]:8080")),
        addr("[::1]:8080")
    );
    assert_eq!(
        solde_server::healthcheck_addr(addr("192.0.2.10:9000")),
        addr("192.0.2.10:9000")
    );
    // A specified IPv6 address keeps its scope id.
    let scoped = addr("[fe80::1%3]:8080");
    assert_eq!(solde_server::healthcheck_addr(scoped), scoped);
    let SocketAddr::V6(kept) = solde_server::healthcheck_addr(scoped) else {
        panic!("still IPv6");
    };
    assert_eq!(kept.scope_id(), 3);
}

#[test]
fn fails_when_nothing_listens() {
    let output = healthcheck(&format!("127.0.0.1:{}", free_port()));
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot connect"));
}

#[test]
fn fails_on_a_bad_listen_addr() {
    let output = healthcheck("not-an-address");
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stderr).contains("SOLDE_LISTEN_ADDR"));
}

#[test]
fn fails_on_a_non_200_answer() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 512];
        let _ = stream.read(&mut buf);
        stream
            .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
            .expect("write");
    });
    let err = solde_server::healthcheck(addr, Duration::from_secs(3)).expect_err("503 fails");
    assert!(err.to_string().contains("503"), "{err:#}");
    server.join().expect("server thread");
}

#[test]
fn times_out_on_a_silent_server() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    // The kernel accepts the connection (backlog), but nothing ever answers.
    let err =
        solde_server::healthcheck(addr, Duration::from_millis(200)).expect_err("silence fails");
    assert!(err.to_string().contains("no answer"), "{err:#}");
    drop(listener);
}

#[test]
fn times_out_on_a_trickling_server() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    // Sends one byte every 50 ms and never ends the status line: each read
    // succeeds, so only a deadline on the whole read stops the probe.
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut buf = [0_u8; 512];
        let _ = stream.read(&mut buf);
        for _ in 0..200 {
            if stream.write_all(b"H").is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    });
    let started = std::time::Instant::now();
    let err =
        solde_server::healthcheck(addr, Duration::from_millis(300)).expect_err("a trickle fails");
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    assert!(err.to_string().contains("no answer"), "{err:#}");
}

/// A real server answers, and the probe needs neither the master key nor
/// the database: it gets only `SOLDE_LISTEN_ADDR`.
#[test]
fn succeeds_against_a_running_server_without_secrets() {
    let dir: PathBuf =
        std::env::temp_dir().join(format!("solde-server-healthcheck-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let key = dir.join("master.key");
    // 32 fake bytes (0x01 repeated) in base64.
    std::fs::write(&key, "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n").expect("write key");
    let port = free_port();
    let listen = format!("0.0.0.0:{port}");
    let db = format!("sqlite://{}", dir.join("solde.db").display());
    let mut child = command(&[
        ("SOLDE_MASTER_KEY_FILE", &key.display().to_string()),
        ("SOLDE_DATABASE_URL", &db),
        ("SOLDE_LISTEN_ADDR", &listen),
        ("SOLDE_INSECURE_COOKIES", "1"),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
    .expect("spawn solde-server");
    // Wait for the "listening" log line on another thread, with a deadline,
    // so a changed log line fails the test instead of hanging it.
    let stdout = child.stdout.take().expect("stdout");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.contains("listening") {
                let _ = tx.send(());
                break;
            }
        }
    });
    let listening = rx.recv_timeout(Duration::from_secs(30)).is_ok();

    let output = healthcheck(&listen);
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&dir);

    assert!(listening, "the server did not start");
    assert!(output.status.success(), "{output:?}");
    assert_eq!(String::from_utf8_lossy(&output.stdout), "ok\n");
}
