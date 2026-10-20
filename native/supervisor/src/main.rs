//! Unprivileged ordinary-core lifetime guard. GUI death closes stdin; this guard
//! retains the Child handle and reaps that exact process, without a PID-file kill.
#[cfg(unix)]
use libc;
#[path = "../../log_redaction.rs"]
mod log_redaction;
#[path = "../../log_retention.rs"]
mod log_retention;
#[path = "../../runtime_sandbox.rs"]
mod runtime_sandbox;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};
fn main() {
    if let Err(error) = run() {
        eprintln!("SI network supervisor: {error}");
        std::process::exit(1)
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("expected fixed core, private runtime, and channel".into());
    }
    let core = PathBuf::from(&args[0]).canonicalize()?;
    let root = PathBuf::from(&args[1]).canonicalize()?;
    let channel = args[2].to_str().ok_or("invalid core channel")?;
    let expected = match (std::env::consts::ARCH, channel) {
        ("aarch64", "stable") => "4b72628bd46113be90b63a18c483bbb55a7f9395e396926a2b0a99905d4f2386",
        ("aarch64", "alpha") => "f0d0d1eeb92137e0a28fc23612494c648ea919fb9bed2891ffd81d10453a8961",
        ("x86_64", "stable") => "55bca124906a40a7140ee7537a305b34c2c31806f3d724629089dc2960ea0993",
        ("x86_64", "alpha") => "baa7f8ae796a4491cc2378d2e5081e8f68aa368ce5455d8320413be3318c21a4",
        _ => return Err("unsupported core".into()),
    };
    let bytes = std::fs::read(&core)?;
    if format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err("core digest mismatch".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = std::fs::metadata(&root)?;
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        let uid = unsafe { geteuid() };
        if uid == 0 || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
            return Err("ordinary supervisor requires a private user-owned runtime".into());
        }
    }
    let control = std::env::var_os("SI_ASSIST_CONTROL_DIRECTORY")
        .map(PathBuf::from)
        .ok_or("control directory missing")?;
    let profile = runtime_sandbox::profile(&core, &root, &control)?;
    let redactor = std::sync::Arc::new(
        log_redaction::Redactor::from_yaml(&std::fs::read_to_string(root.join("config.yaml"))?)
            .map_err(std::io::Error::other)?,
    );
    let mut child = Command::new("/usr/bin/sandbox-exec")
        .args(["-p", &profile])
        .arg(&core)
        .arg("-d")
        .arg(&root)
        .arg("-f")
        .arg(root.join("config.yaml"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    log_retention::cleanup(&root, "core", "core.log", 7, true)?;
    let log = std::sync::Arc::new(std::sync::Mutex::new(log_retention::RotatingLog::open(
        root.join("core.log"),
        2 * 1024 * 1024,
    )?));
    for pipe in [
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn std::io::Read + Send>),
    ] {
        let redactor = redactor.clone();
        let log = log.clone();
        if let Some(pipe) = pipe {
            std::thread::spawn(move || {
                let mut reader = std::io::BufReader::new(pipe);
                while let Ok(Some(line)) = log_retention::bounded_line(&mut reader, 16 * 1024) {
                    let redacted = redactor.redact(&line);
                    if let Ok(mut log) = log.lock() {
                        let _ = log.write_line(&redacted);
                    }
                }
            });
        }
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut input = std::io::stdin().lock();
        let mut buffer = [0u8; 64];
        while let Ok(size) = input.read(&mut buffer) {
            if size == 0 {
                break;
            }
        }
        let _ = tx.send(());
    });
    loop {
        if !matches!(
            rx.recv_timeout(Duration::from_millis(200)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("Mihomo exited with {status}").into())
            };
        }
    }
}
