//! macOS filesystem/process boundary shared by privileged and ordinary Mihomo.
//! A missing or rejected sandbox is a startup failure; there is no unsandboxed fallback.
use std::path::Path;
fn quoted(path: &Path) -> std::io::Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| std::io::Error::other("non-UTF8 sandbox path"))?;
    if !path.is_absolute() || text.contains(['\n', '\r', '\0']) {
        return Err(std::io::Error::other("invalid sandbox path"));
    }
    Ok(format!(
        "\"{}\"",
        text.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
pub fn profile(core: &Path, runtime: &Path, control_directory: &Path) -> std::io::Result<String> {
    let runtime = quoted(&runtime.canonicalize()?)?;
    let core = quoted(&core.canonicalize()?)?;
    let control = quoted(&control_directory.canonicalize()?)?;
    let read = [
        format!("(subpath {runtime})"),
        format!("(subpath {control})"),
        format!("(literal {core})"),
        "(subpath \"/System/Library\")".into(),
        "(literal \"/\")".into(),
        "(subpath \"/usr/lib\")".into(),
        "(subpath \"/usr/share/zoneinfo\")".into(),
        "(subpath \"/private/etc/ssl\")".into(),
        "(literal \"/private/etc/resolv.conf\")".into(),
        "(literal \"/private/var/run/resolv.conf\")".into(),
        "(literal \"/private/etc/hosts\")".into(),
        "(literal \"/private/etc/localtime\")".into(),
        "(literal \"/dev/urandom\")".into(),
        "(literal \"/dev/random\")".into(),
        "(literal \"/dev/null\")".into(),
    ];
    let read_deny = read
        .iter()
        .map(|r| format!("(require-not {r})"))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!("(version 1) (allow default) (deny file-read-data (require-all {read_deny})) (deny file-write* (require-all (require-not (subpath {runtime})) (require-not (subpath {control})) (require-not (literal \"/dev/null\")))) (deny process-exec (require-not (literal {core})))"))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn private_runtime_read_works_but_outside_and_symlink_reads_fail() {
        use std::{fs, process::Command};
        let root = std::env::temp_dir().join(format!(
            "si-sandbox-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = root.join("runtime");
        fs::create_dir_all(&runtime).unwrap();
        let inside = runtime.join("inside");
        let outside = root.join("outside");
        fs::write(&inside, b"inside-fixture").unwrap();
        fs::write(&outside, b"outside-fixture").unwrap();
        let link = runtime.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let core = Path::new("/bin/cat");
        let policy = profile(core, &runtime, &runtime).unwrap();
        let run = |path: &Path| {
            Command::new("/usr/bin/sandbox-exec")
                .args(["-p", &policy])
                .arg(core)
                .arg(path)
                .output()
                .unwrap()
        };
        let allowed = run(&inside);
        assert!(
            allowed.status.success(),
            "{}",
            String::from_utf8_lossy(&allowed.stderr)
        );
        assert_eq!(allowed.stdout, b"inside-fixture");
        for path in [&outside, &link] {
            let denied = run(path);
            assert!(!denied.status.success());
            assert!(!denied
                .stdout
                .windows(b"outside-fixture".len())
                .any(|w| w == b"outside-fixture"));
        }
        fs::remove_dir_all(root).unwrap();
    }
}
