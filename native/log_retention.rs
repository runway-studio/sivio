//! Bounded logs in an explicitly owned directory. Never follows links or cleans unrelated files.
use std::{
    fs::{File, OpenOptions},
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
pub fn cleanup(
    directory: &Path,
    basename: &str,
    current: &str,
    days: u16,
    include_current: bool,
) -> io::Result<usize> {
    cleanup_at(
        directory,
        basename,
        current,
        days,
        include_current,
        SystemTime::now(),
    )
}
fn cleanup_at(
    directory: &Path,
    basename: &str,
    current: &str,
    days: u16,
    include_current: bool,
    now: SystemTime,
) -> io::Result<usize> {
    if days == 0 || !directory.exists() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !(name.starts_with(&format!("{basename}.")) || name.starts_with(&format!("{basename}_")))
            || !name.contains(".log")
            || (!include_current && name == current)
            || !entry.file_type()?.is_file()
        {
            continue;
        }
        if now
            .duration_since(entry.metadata()?.modified()?)
            .unwrap_or_default()
            > Duration::from_secs(u64::from(days) * 86400)
        {
            std::fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}
/// A single archive plus current file. Each persisted record is <= 16 KiB.
pub struct RotatingLog {
    path: PathBuf,
    file: Option<File>,
    limit: u64,
    length: u64,
}
impl RotatingLog {
    pub fn open(path: PathBuf, limit: u64) -> io::Result<Self> {
        let file = Self::open_file(&path)?;
        let length = file.metadata()?.len();
        Ok(Self {
            path,
            file: Some(file),
            limit,
            length,
        })
    }
    fn open_file(path: &Path) -> io::Result<File> {
        if std::fs::symlink_metadata(path).is_ok_and(|m| !m.file_type().is_file()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Log is not a regular file",
            ));
        }
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(super::libc::O_NOFOLLOW | super::libc::O_CLOEXEC);
        }
        options.open(path)
    }
    pub fn write_line(&mut self, line: &str) -> io::Result<()> {
        let mut end = line.len().min(16 * 1024);
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        let line = &line[..end];
        if self.length + line.len() as u64 + 1 > self.limit {
            self.file.take();
            let archive = self.path.with_extension("log.1");
            if archive.exists() {
                std::fs::remove_file(&archive)?;
            }
            std::fs::rename(&self.path, archive)?;
            self.file = Some(Self::open_file(&self.path)?);
            self.length = 0;
        }
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| io::Error::other("Log writer unavailable"))?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        self.length += line.len() as u64 + 1;
        Ok(())
    }
}
/// Drain overlong records in fixed chunks and omit them entirely, avoiding partial-secret leakage.
pub fn bounded_line(reader: &mut impl BufRead, limit: usize) -> io::Result<Option<String>> {
    let mut output = Vec::new();
    let mut seen = false;
    let mut overlong = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            break;
        }
        seen = true;
        let newline = chunk.iter().position(|b| *b == b'\n');
        let count = newline.map_or(chunk.len(), |n| n + 1);
        let keep = count.min(limit.saturating_sub(output.len()));
        overlong |= keep < count;
        output.extend_from_slice(&chunk[..keep]);
        reader.consume(count);
        if newline.is_some() {
            break;
        }
    }
    Ok(seen.then(|| {
        if overlong {
            "[overlong log record omitted]".into()
        } else {
            String::from_utf8_lossy(&output)
                .trim_end_matches(['\r', '\n'])
                .to_owned()
        }
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "si-assist-log-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn bounded_input_drains_huge_line_and_keeps_next_record() {
        let mut source = std::io::BufReader::new(std::io::Cursor::new(format!(
            "{}\nnext\n",
            "x".repeat(200_000)
        )));
        assert_eq!(
            bounded_line(&mut source, 1024).unwrap().as_deref(),
            Some("[overlong log record omitted]")
        );
        assert_eq!(
            bounded_line(&mut source, 1024).unwrap().as_deref(),
            Some("next")
        );
        assert!(bounded_line(&mut source, 1024).unwrap().is_none());
    }
    #[test]
    fn rotation_and_age_cleanup_preserve_current_foreign_files_and_links() {
        let directory = dir();
        let path = directory.join("core.log");
        let mut writer = RotatingLog::open(path.clone(), 64).unwrap();
        for _ in 0..100 {
            writer.write_line("1234567890").unwrap();
        }
        assert!(path.metadata().unwrap().len() <= 64);
        assert!(directory.join("core.log.1").metadata().unwrap().len() <= 64);
        std::fs::write(directory.join("other.log"), "foreign").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(directory.join("other.log"), directory.join("core_link.log"))
            .unwrap();
        let future = SystemTime::now() + Duration::from_secs(8 * 86400);
        assert_eq!(
            cleanup_at(&directory, "core", "core.log", 7, false, future).unwrap(),
            1
        );
        assert!(path.exists());
        assert!(directory.join("other.log").exists());
        drop(writer);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
