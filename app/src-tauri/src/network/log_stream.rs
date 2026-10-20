//! Read redacted ordinary-core logs by inode/offset, without following links.
use super::*;
#[derive(Default)]
pub(super) struct Cursor {
    inode: u64,
    offset: u64,
}
pub(super) fn read(cursor: &mut Cursor, path: &Path) -> Result<(Vec<String>, bool)> {
    use std::{
        io::{Read, Seek, SeekFrom},
        os::unix::fs::{MetadataExt, OpenOptionsExt},
    };
    let mut file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false))
        }
        Err(error) => return Err(error.into()),
    };
    let meta = file.metadata()?;
    ensure!(
        meta.is_file() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0,
        "Log ownership or permissions are unsafe"
    );
    let rotated = cursor.inode != 0 && (cursor.inode != meta.ino() || cursor.offset > meta.len());
    let initial = cursor.inode == 0 || rotated;
    let start = if initial {
        meta.len().saturating_sub(256 * 1024)
    } else {
        cursor.offset
    };
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.take(256 * 1024).read_to_end(&mut bytes)?;
    let Some(last) = bytes.iter().rposition(|b| *b == b'\n') else {
        return Ok((Vec::new(), rotated));
    };
    cursor.inode = meta.ino();
    cursor.offset = start + last as u64 + 1;
    let skip = if initial && start > 0 {
        bytes.iter().position(|b| *b == b'\n').map_or(0, |n| n + 1)
    } else {
        0
    };
    let lines = String::from_utf8_lossy(&bytes[skip..last + 1])
        .lines()
        .map(str::to_owned)
        .collect();
    Ok((lines, rotated))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tail_of_one_oversized_record_does_not_panic_or_emit_a_partial_record() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("core.log");
        std::fs::write(&path, format!("{}\n", "x".repeat(300 * 1024))).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(read(&mut Cursor::default(), &path).unwrap().0.is_empty());
    }
    #[test]
    fn identical_lines_are_incremental_and_foreign_links_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("core.log");
        std::fs::write(&path, "same\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let mut cursor = Cursor::default();
        assert_eq!(read(&mut cursor, &path).unwrap().0, vec!["same"]);
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"same\n")
            .unwrap();
        assert_eq!(read(&mut cursor, &path).unwrap().0, vec!["same"]);
        assert!(read(&mut cursor, &path).unwrap().0.is_empty());
        let foreign = dir.path().join("foreign");
        std::fs::write(&foreign, "private\n").unwrap();
        std::fs::remove_file(&path).unwrap();
        symlink(foreign, &path).unwrap();
        assert!(read(&mut cursor, &path).is_err());
    }
}
