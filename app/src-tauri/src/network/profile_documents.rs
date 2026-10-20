//! External editors work on a private copy; importing and applying is explicit.
use super::*;
use std::os::unix::fs::PermissionsExt;
pub(super) async fn execute(_app: &tauri::AppHandle, action: &str, args: &Value) -> Result<Value> {
    let id = text(args, "id")?;
    let catalog = read_catalog()?;
    let record = catalog
        .profiles
        .iter()
        .find(|p| p.id == id)
        .context("profile not found")?;
    ensure!(
        args.get("baseRevision").and_then(Value::as_str) == Some(record.revision.as_str()),
        "profile changed externally; reload before saving"
    );
    let dir = root()?.join("editor-copies");
    if dir.exists() {
        ensure!(
            !std::fs::symlink_metadata(&dir)?.file_type().is_symlink(),
            "editor directory must not be a symlink"
        );
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    let digest = format!(
        "{:x}",
        Sha256::digest(format!("{id}:{}", record.revision).as_bytes())
    );
    let path = dir.join(format!("{digest}.yaml"));
    if action == "profile.file.open" {
        // Preserve unsaved edits when opening the same revision again.
        if !path.exists() {
            let payload = secret_get(id)?;
            crate::config::atomic_write_private(&path, text(&payload, "yaml")?.as_bytes())?;
        }
        ensure!(
            std::fs::symlink_metadata(&path)?.is_file(),
            "editor file must be a regular file"
        );
        let status = Command::new("/usr/bin/open")
            .arg("-t")
            .arg(&path)
            .status()
            .await?;
        ensure!(status.success(), "could not open the external editor");
        Ok(json!({"opened":true}))
    } else {
        use std::io::Read;
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)?;
        ensure!(
            file.metadata()?.is_file(),
            "editor copy must be a regular file"
        );
        let mut yaml = String::new();
        file.take((LIMIT + 1) as u64).read_to_string(&mut yaml)?;
        ensure!(yaml.len() <= LIMIT, "profile exceeds 16 MiB");
        let _: Mapping = serde_yaml_ng::from_str(&yaml).context("profile must be valid YAML")?;
        Ok(json!({"yaml":yaml}))
    }
}
