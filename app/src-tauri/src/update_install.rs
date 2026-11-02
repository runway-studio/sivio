//! Same-volume replacement with a retained recovery copy. No sudo or user data writes.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

static INSTALLING: AtomicBool = AtomicBool::new(false);
pub fn installing() -> bool {
    INSTALLING.load(Ordering::SeqCst)
}
pub struct InstallGuard;
impl InstallGuard {
    pub fn acquire() -> Result<Self, String> {
        INSTALLING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "UPDATE_BUSY: 安装正在进行".to_string())?;
        Ok(Self)
    }
}
impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALLING.store(false, Ordering::SeqCst);
    }
}

pub fn current_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or("Cannot locate installed application")?;
    if bundle.extension().is_none_or(|ext| ext != "app")
        || !bundle.join("Contents/Info.plist").is_file()
    {
        return Err("请先将 Sivio 安装到可写的 Applications 目录，再更新".into());
    }
    Ok(bundle.to_path_buf())
}

/// Prepare on the destination volume before stopping the network.
pub fn prepare(bundle: &Path, bytes: &[u8]) -> Result<tempfile::TempDir, String> {
    let parent = bundle.parent().ok_or("Invalid application path")?;
    let stage = tempfile::Builder::new()
        .prefix(".sivio-update-")
        .tempdir_in(parent)
        .map_err(|_| "应用目录不可写；请移动到可写的 Applications 目录后重试".to_string())?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    // Caller verified path safety, signature, product and architecture immediately before this call.
    archive
        .unpack(stage.path())
        .map_err(|e| format!("Cannot stage update: {e}"))?;
    Ok(stage)
}

pub fn replace(bundle: &Path, stage: tempfile::TempDir) -> Result<PathBuf, String> {
    let source = std::fs::read_dir(stage.path())
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .collect::<Vec<_>>();
    if source.len() != 1 || source[0].extension().is_none_or(|ext| ext != "app") {
        return Err("Invalid staged application".into());
    }
    let backup = stage.path().join("previous.app");
    if let Err(error) = swap(bundle, &source[0], &backup, |from, to| {
        std::fs::rename(from, to)
    }) {
        // Preserve the backup even if automatic restoration itself failed.
        if backup.exists() {
            let _ = stage.keep();
        }
        return Err(error);
    }
    // The old process still maps these files until restart. Never delete them here.
    let retained = stage.keep();
    Ok(retained.join("previous.app"))
}

fn swap<F>(bundle: &Path, staged: &Path, backup: &Path, mut rename: F) -> Result<(), String>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    rename(bundle, backup).map_err(|e| format!("旧应用未变更：{e}"))?;
    if let Err(error) = rename(staged, bundle) {
        return match rename(backup, bundle) {
            Ok(()) => Err(format!("安装失败，旧应用已恢复：{error}")),
            Err(restore) => Err(format!(
                "安装失败：{error}；请从 {} 恢复旧应用：{restore}",
                backup.display()
            )),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_retains_old_bytes_and_rolls_back_failed_move() {
        for fail in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let old = temp.path().join("Sivio.app");
            let new = temp.path().join("new.app");
            let backup = temp.path().join("backup.app");
            std::fs::create_dir(&old).unwrap();
            std::fs::create_dir(&new).unwrap();
            std::fs::write(old.join("version"), "old").unwrap();
            std::fs::write(new.join("version"), "new").unwrap();
            let result = swap(&old, &new, &backup, |a, b| {
                if fail && a == new {
                    Err(std::io::Error::other("injected move failure"))
                } else {
                    std::fs::rename(a, b)
                }
            });
            assert_eq!(result.is_err(), fail);
            assert_eq!(
                std::fs::read_to_string(old.join("version")).unwrap(),
                if fail { "old" } else { "new" }
            );
            if !fail {
                assert_eq!(
                    std::fs::read_to_string(backup.join("version")).unwrap(),
                    "old"
                );
            }
        }
    }
}
