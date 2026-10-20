//! Permissions for application-owned data. Never follow links or chmod ancestors.
use crate::error::AppError;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::{fs, path::Path};

pub(crate) fn reject_link(path: &Path) -> Result<(), AppError> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata)
                if metadata.file_type().is_symlink()
                    && !((ancestor == Path::new("/var")
                        && fs::read_link(ancestor).ok().as_deref()
                            == Some(Path::new("private/var")))
                        || (ancestor == Path::new("/tmp")
                            && fs::read_link(ancestor).ok().as_deref()
                                == Some(Path::new("private/tmp")))) =>
            {
                return Err(AppError::Config(
                    "Private storage path contains a symbolic link".into(),
                ))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(AppError::io(ancestor, e)),
        }
    }
    Ok(())
}
pub(crate) fn directory(path: &Path) -> Result<(), AppError> {
    reject_link(path)?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(|e| AppError::io(path, e))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| AppError::io(path, e))
}
pub(crate) fn existing_file(path: &Path) -> Result<(), AppError> {
    reject_link(path)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|e| AppError::io(path, e))
        }
        Ok(_) => Err(AppError::Config(
            "Private file path is not a regular file".into(),
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::io(path, e)),
    }
}
pub(crate) fn database(path: &Path) -> Result<(), AppError> {
    directory(
        path.parent()
            .ok_or_else(|| AppError::Config("Invalid database path".into()))?,
    )?;
    existing_file(path)?;
    fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|e| AppError::io(path, e))?;
    for suffix in ["-wal", "-shm", "-journal"] {
        existing_file(&path.with_file_name(format!(
            "{}{}",
            path.file_name().unwrap().to_string_lossy(),
            suffix
        )))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn database_and_sidecars_are_private_and_symlinks_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("owned/db");
        database(&path).unwrap();
        fs::write(path.with_file_name("db-wal"), b"fixture").unwrap();
        database(&path).unwrap();
        for file in [&path, &path.with_file_name("db-wal")] {
            assert_eq!(
                fs::metadata(file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let link = temp.path().join("linked");
        std::os::unix::fs::symlink(path.parent().unwrap(), &link).unwrap();
        assert!(database(&link.join("db")).is_err());
    }
    #[test]
    fn file_migration_conflicts_and_write_failures_keep_original_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        fs::write(&path, "external change").unwrap();
        assert!(crate::config::compare_and_write_private(&path, "old", b"migrated").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external change");
        crate::config::compare_and_write_private(&path, "external change", b"migrated").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let blocked = temp.path().join("not-a-directory");
        fs::write(&blocked, b"original").unwrap();
        assert!(
            crate::config::atomic_write_private(&blocked.join("settings.json"), b"fixture")
                .is_err()
        );
        assert_eq!(fs::read(&blocked).unwrap(), b"original");
    }
}
