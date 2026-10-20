//! A durable rollback point spans the database and Skills directory. A pending
//! restore is rolled back before startup publishes any derived client files.
use super::{skill::SkillService, sync_protocol::sha256_hex};
use crate::{
    config::{atomic_write_private, get_app_config_dir},
    database::Database,
    error::AppError,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
const LIMIT: u64 = 512 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Metadata {
    version: u32,
    skills: PathBuf,
    sql_sha256: String,
    before_database: String,
    after_database: String,
    before_skills: String,
    after_skills: String,
}
pub struct Journal {
    root: PathBuf,
}
fn error(message: impl Into<String>) -> AppError {
    AppError::Config(message.into())
}
fn sync_dir(path: &Path) -> Result<(), AppError> {
    fs::File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| AppError::io(path, e))
}

pub(crate) fn tree_revision(root: &Path) -> Result<String, AppError> {
    use sha2::{Digest, Sha256};
    use std::os::unix::{ffi::OsStrExt, fs::OpenOptionsExt};
    fn visit(
        root: &Path,
        path: &Path,
        hash: &mut Sha256,
        budget: &mut (u64, usize),
    ) -> Result<(), AppError> {
        budget.1 += 1;
        if budget.1 > 30_000 || path.strip_prefix(root).unwrap().components().count() > 128 {
            return Err(error("Recovery tree exceeds entry or depth limit"));
        }
        let relative = path.strip_prefix(root).unwrap().as_os_str().as_bytes();
        hash.update((relative.len() as u64).to_le_bytes());
        hash.update(relative);
        let metadata = fs::symlink_metadata(path).map_err(|e| AppError::io(path, e))?;
        if metadata.file_type().is_symlink() {
            hash.update(b"link");
            hash.update(
                fs::read_link(path)
                    .map_err(|e| AppError::io(path, e))?
                    .as_os_str()
                    .as_bytes(),
            );
        } else if metadata.is_dir() {
            hash.update(b"dir");
            let mut entries = fs::read_dir(path)
                .map_err(|e| AppError::io(path, e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::io(path, e))?;
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                visit(root, &entry.path(), hash, budget)?;
            }
        } else if metadata.is_file() {
            hash.update(b"file");
            let mut content = Sha256::new();
            let mut file = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(path)
                .map_err(|e| AppError::io(path, e))?;
            let mut buffer = [0u8; 8192];
            loop {
                let count = file.read(&mut buffer).map_err(|e| AppError::io(path, e))?;
                if count == 0 {
                    break;
                }
                budget.0 += count as u64;
                if budget.0 > LIMIT {
                    return Err(error("Recovery tree exceeds 512 MiB"));
                }
                content.update(&buffer[..count]);
            }
            hash.update(content.finalize());
        } else {
            return Err(error("Recovery tree contains a special file"));
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    visit(root, root, &mut hash, &mut (0, 0))?;
    Ok(format!("{:x}", hash.finalize()))
}

/// Copy links as links, never following them outside the snapshot tree. Bounded
/// copy protects recovery from accidental unbounded or special-file traversal.
pub(crate) fn copy_tree(source: &Path, destination: &Path) -> Result<(), AppError> {
    fn copy(
        source: &Path,
        destination: &Path,
        bytes: &mut u64,
        entries: &mut usize,
    ) -> Result<(), AppError> {
        *entries += 1;
        if *entries > 30_000 {
            return Err(error("Recovery snapshot has too many entries"));
        }
        let metadata = fs::symlink_metadata(source).map_err(|e| AppError::io(source, e))?;
        if metadata.file_type().is_symlink() {
            let target = fs::read_link(source).map_err(|e| AppError::io(source, e))?;
            std::os::unix::fs::symlink(target, destination)
                .map_err(|e| AppError::io(destination, e))?;
        } else if metadata.is_dir() {
            fs::create_dir(destination).map_err(|e| AppError::io(destination, e))?;
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(destination, fs::Permissions::from_mode(0o700))
                .map_err(|e| AppError::io(destination, e))?;
            for entry in fs::read_dir(source).map_err(|e| AppError::io(source, e))? {
                let entry = entry.map_err(|e| AppError::io(source, e))?;
                copy(
                    &entry.path(),
                    &destination.join(entry.file_name()),
                    bytes,
                    entries,
                )?;
            }
            sync_dir(destination)?;
        } else if metadata.is_file() {
            let remaining = LIMIT
                .checked_sub(*bytes)
                .ok_or_else(|| error("Recovery snapshot exceeds 512 MiB"))?;
            if metadata.len() > remaining {
                return Err(error("Recovery snapshot exceeds 512 MiB"));
            }
            let mut input = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(source)
                .map_err(|e| AppError::io(source, e))?
                .take(remaining + 1);
            use std::os::unix::fs::OpenOptionsExt;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(destination)
                .map_err(|e| AppError::io(destination, e))?;
            let copied =
                std::io::copy(&mut input, &mut output).map_err(|e| AppError::io(destination, e))?;
            *bytes += copied;
            if *bytes > LIMIT {
                return Err(error("Recovery snapshot exceeds 512 MiB"));
            }
            use std::os::unix::fs::PermissionsExt;
            output
                .set_permissions(fs::Permissions::from_mode(
                    metadata.permissions().mode() & 0o700,
                ))
                .map_err(|e| AppError::io(destination, e))?;
            output
                .flush()
                .and_then(|_| output.sync_all())
                .map_err(|e| AppError::io(destination, e))?;
        } else {
            return Err(error(
                "Recovery snapshots cannot contain device files, pipes or sockets",
            ));
        }
        Ok(())
    }
    copy(source, destination, &mut 0, &mut 0)
}
impl Journal {
    pub fn begin(
        db: &Database,
        after_database: &str,
        after_skills: &str,
    ) -> Result<Self, AppError> {
        let parent = get_app_config_dir();
        fs::create_dir_all(&parent).map_err(|e| AppError::io(&parent, e))?;
        let root = parent.join("pending-restore");
        if root.try_exists().map_err(|e| AppError::io(&root, e))? {
            return Err(error(
                "A previous restore needs recovery; restart Sivio before restoring again",
            ));
        }
        let staged = tempfile::Builder::new()
            .prefix(".si-restore-staging-")
            .tempdir_in(&parent)
            .map_err(|e| AppError::io(&parent, e))?;
        db.protect_legacy_credentials()?;
        let (sql, before_database) = db.recovery_snapshot()?;
        if sql.len() as u64 > LIMIT {
            return Err(error("Recovery SQL exceeds 512 MiB"));
        }
        atomic_write_private(&staged.path().join("current.sql"), sql.as_bytes())?;
        let skills = SkillService::get_ssot_dir().map_err(|e| error(e.to_string()))?;
        if !fs::symlink_metadata(&skills)
            .map_err(|e| AppError::io(&skills, e))?
            .is_dir()
        {
            return Err(error(
                "Skills storage root must be a real directory before restoring",
            ));
        }
        copy_tree(&skills, &staged.path().join("skills"))?;
        let before_skills = tree_revision(&staged.path().join("skills"))?;
        if tree_revision(&skills)? != before_skills
            || db.configuration_revision()? != before_database
        {
            return Err(error(
                "Application configuration changed while preparing recovery; no data was restored",
            ));
        }
        let metadata = Metadata {
            version: 2,
            skills,
            sql_sha256: sha256_hex(sql.as_bytes()),
            before_database,
            after_database: after_database.into(),
            before_skills,
            after_skills: after_skills.into(),
        };
        atomic_write_private(
            &staged.path().join("state.json"),
            &serde_json::to_vec(&metadata).map_err(|e| error(e.to_string()))?,
        )?;
        sync_dir(staged.path())?;
        fs::rename(staged.path(), &root).map_err(|e| AppError::io(&root, e))?;
        sync_dir(&parent)?;
        Ok(Self { root })
    }
    pub fn database_before(&self) -> Result<String, AppError> {
        let metadata: Metadata = serde_json::from_slice(
            &fs::read(self.root.join("state.json")).map_err(|e| AppError::io(&self.root, e))?,
        )
        .map_err(|_| error("Invalid recovery metadata"))?;
        Ok(metadata.before_database)
    }
    pub fn rollback(&self, db: &Database) -> Result<(), AppError> {
        let metadata: Metadata = serde_json::from_slice(
            &fs::read(self.root.join("state.json")).map_err(|e| AppError::io(&self.root, e))?,
        )
        .map_err(|_| error("Invalid pending restore metadata; recovery files were preserved"))?;
        if metadata.version != 2 || metadata.skills != SkillService::ssot_dir_path() {
            return Err(error("Pending restore belongs to a different Skills location; restore the original storage setting before retrying"));
        }
        let sql_path = self.root.join("current.sql");
        if fs::metadata(&sql_path)
            .map_err(|e| AppError::io(&sql_path, e))?
            .len()
            > LIMIT
        {
            return Err(error("Recovery SQL exceeds size limit"));
        }
        let sql = fs::read(&sql_path).map_err(|e| AppError::io(&sql_path, e))?;
        if sha256_hex(&sql) != metadata.sql_sha256 {
            return Err(error(
                "Recovery SQL failed integrity verification; recovery files were preserved",
            ));
        }
        let sql = std::str::from_utf8(&sql).map_err(|_| error("Recovery SQL is not UTF-8"))?;
        if tree_revision(&self.root.join("skills"))? != metadata.before_skills {
            return Err(error(
                "Recovery Skills failed integrity verification; recovery files were preserved",
            ));
        }
        let current_database = db.configuration_revision()?;
        let current_skills = match fs::symlink_metadata(&metadata.skills) {
            Ok(entry) if entry.is_dir() => Some(tree_revision(&metadata.skills)?),
            Ok(_) => {
                return Err(error(
                    "Skills recovery destination must be a real directory",
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(AppError::io(&metadata.skills, e)),
        };
        if ![metadata.before_database, metadata.after_database].contains(&current_database)
            || current_skills.is_some_and(|current| {
                ![metadata.before_skills, metadata.after_skills].contains(&current)
            })
        {
            return Err(error("Configuration changed outside the pending restore. Recovery stopped without overwriting it; preserve pending-restore and resolve the conflict before retrying."));
        }
        db.import_sql_string(sql)?;
        super::webdav_sync::archive::restore_skills_directory(&self.root.join("skills"))?;
        self.finish()
    }
    pub fn finish(&self) -> Result<(), AppError> {
        let parent = self.root.parent().unwrap();
        // Moving away the pending name is the commit point. Cleanup can fail
        // without making a successfully restored snapshot look uncommitted.
        let complete = parent.join(format!(".si-restore-complete-{}", uuid::Uuid::new_v4()));
        fs::rename(&self.root, &complete).map_err(|e| AppError::io(&self.root, e))?;
        if let Err(e) = sync_dir(parent) {
            log::warn!("Restore commit directory sync failed: {e}");
        }
        if let Err(e) = fs::remove_dir_all(&complete) {
            log::warn!("Completed restore recovery copy retained: {e}");
        }
        Ok(())
    }
}
pub fn recover(db: &Database) -> Result<(), AppError> {
    let root = get_app_config_dir().join("pending-restore");
    if fs::symlink_metadata(&root).is_ok() {
        crate::settings::validate_settings_storage()?;
        if fs::symlink_metadata(&root)
            .map_err(|e| AppError::io(&root, e))?
            .file_type()
            .is_symlink()
        {
            return Err(error("Pending restore directory cannot be a symbolic link"));
        }
        Journal { root }.rollback(db)?;
        log::info!("Interrupted configuration restore was rolled back before startup");
    }
    Ok(())
}

#[cfg(test)]
mod crash_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    // Run in separate OS processes: no Drop/unwind cleanup may rescue the
    // writer, and the verifier exercises Database::init's real startup hook.
    #[test]
    fn restore_crash_worker() {
        let Ok(phase) = std::env::var("SI_RESTORE_TEST_PHASE") else {
            return;
        };
        let home = PathBuf::from(std::env::var_os("CC_SWITCH_TEST_HOME").unwrap());
        assert!(home.join("isolated-test-marker").is_file());
        crate::settings::reload_settings().unwrap();
        if std::env::var_os("SI_RESTORE_TEST_VERIFY").is_some() {
            let root = crate::config::get_app_config_dir();
            let skills = SkillService::ssot_dir_path();
            if phase == "tampered-missing" || phase == "external-edit" || phase == "symlink" {
                assert!(Database::init().is_err(), "must fail closed at {phase}");
                assert!(root.join("pending-restore").is_dir());
                if phase == "tampered-missing" {
                    assert!(
                        !skills.exists(),
                        "integrity failure must not create an empty live tree"
                    );
                } else if phase == "external-edit" {
                    assert_eq!(
                        fs::read_to_string(skills.join("SKILL.md")).unwrap(),
                        "external"
                    );
                } else {
                    assert!(fs::symlink_metadata(skills)
                        .unwrap()
                        .file_type()
                        .is_symlink());
                    assert_eq!(
                        fs::read_to_string(home.join("outside/keep")).unwrap(),
                        "untouched"
                    );
                }
                return;
            }
            let db = Database::init().unwrap();
            let expected = if phase == "committed" {
                "after"
            } else {
                "before"
            };
            assert_eq!(
                db.get_setting("recovery-fixture").unwrap().as_deref(),
                Some(expected)
            );
            assert_eq!(
                fs::read_to_string(skills.join("SKILL.md")).unwrap(),
                expected
            );
            assert!(!root.join("pending-restore").exists());
            drop(db);
            // Recovery is idempotent across a second fresh database open.
            assert_eq!(
                Database::init()
                    .unwrap()
                    .get_setting("recovery-fixture")
                    .unwrap()
                    .as_deref(),
                Some(expected)
            );
            return;
        }
        let db = Database::init().unwrap();
        let skills = SkillService::get_ssot_dir().unwrap();
        db.set_setting("recovery-fixture", "after").unwrap();
        fs::write(skills.join("SKILL.md"), "after").unwrap();
        let after_db = db.configuration_revision().unwrap();
        let after_skills = tree_revision(&skills).unwrap();
        db.set_setting("recovery-fixture", "before").unwrap();
        fs::write(skills.join("SKILL.md"), "before").unwrap();
        if phase == "disk-full" {
            // Explicit opt-in on a separately mounted, small fixture volume.
            // Never fill the user's filesystem, even with a mistaken test HOME.
            use std::os::unix::fs::{MetadataExt, PermissionsExt};
            assert_ne!(fs::metadata(&home).unwrap().dev(), fs::metadata("/").unwrap().dev());
            assert!(home.starts_with("/private/tmp/si-assist-fault-run15-volume"));
            let before_db = db.configuration_revision().unwrap();
            let before_tree = tree_revision(&skills).unwrap();
            let filler_path = home.join("fixture-filler");
            let mut filler = fs::File::create(&filler_path).unwrap();
            let chunk = vec![0u8; 1024 * 1024];
            let mut full = false;
            for _ in 0..128 {
                match filler.write_all(&chunk) {
                    Ok(()) => (),
                    Err(e) => { assert_eq!(e.raw_os_error(), Some(libc::ENOSPC)); full = true; break; }
                }
            }
            assert!(full, "fixture volume must run out before 128 MiB");
            // A failed 1 MiB append can leave small free extents. Exhaust
            // those too, otherwise a small SQL snapshot may still fit.
            for size in [4096usize, 1] {
                let bytes = vec![0; size];
                let mut exhausted = false;
                for _ in 0..(2 * 1024 * 1024 / size) {
                    if let Err(e) = filler.write_all(&bytes) {
                        assert_eq!(e.raw_os_error(), Some(libc::ENOSPC));
                        exhausted = true;
                        break;
                    }
                }
                assert!(exhausted, "small free extents exceeded fixture budget");
            }
            assert!(Journal::begin(&db, &after_db, &after_skills).is_err());
            assert_eq!(db.configuration_revision().unwrap(), before_db);
            assert_eq!(tree_revision(&skills).unwrap(), before_tree);
            assert!(!get_app_config_dir().join("pending-restore").exists());
            drop(filler);
            fs::remove_file(filler_path).unwrap();
            let protected = home.join("read-only");
            fs::create_dir(&protected).unwrap();
            fs::write(protected.join("active.json"), "original").unwrap();
            fs::set_permissions(&protected, fs::Permissions::from_mode(0o500)).unwrap();
            let denied = atomic_write_private(&protected.join("active.json"), b"replacement");
            fs::set_permissions(&protected, fs::Permissions::from_mode(0o700)).unwrap();
            assert!(denied.is_err());
            assert_eq!(fs::read_to_string(protected.join("active.json")).unwrap(), "original");
            println!("actual isolated ENOSPC and read-only directory: original DB/Skills/file preserved");
            return;
        }
        if phase != "before-journal" {
            let journal = Journal::begin(&db, &after_db, &after_skills).unwrap();
            if [
                "moved",
                "installed",
                "database",
                "committed",
                "tampered-missing",
                "symlink",
            ]
            .contains(&phase.as_str())
            {
                fs::rename(&skills, home.join("moved-original")).unwrap();
            }
            if ["installed", "database", "committed"].contains(&phase.as_str()) {
                fs::create_dir(&skills).unwrap();
                fs::write(skills.join("SKILL.md"), "after").unwrap();
            }
            if ["database", "committed"].contains(&phase.as_str()) {
                db.set_setting("recovery-fixture", "after").unwrap();
            }
            if phase == "external-edit" {
                fs::write(skills.join("SKILL.md"), "external").unwrap();
            }
            if phase == "tampered-missing" {
                fs::write(journal.root.join("current.sql"), "corrupt").unwrap();
            }
            if phase == "symlink" {
                fs::create_dir(home.join("outside")).unwrap();
                fs::write(home.join("outside/keep"), "untouched").unwrap();
                std::os::unix::fs::symlink(home.join("outside"), &skills).unwrap();
            }
            if phase == "committed" {
                journal.finish().unwrap();
            }
        }
        fs::write(home.join("ready"), b"ready").unwrap();
        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    #[test]
    fn process_kill_restore_matrix() {
        for phase in [
            "before-journal",
            "prepared",
            "moved",
            "installed",
            "database",
            "committed",
            "tampered-missing",
            "external-edit",
            "symlink",
        ] {
            let temp = tempfile::tempdir().unwrap();
            fs::write(temp.path().join("isolated-test-marker"), b"fixture").unwrap();
            let command = || {
                let mut command = Command::new(std::env::current_exe().unwrap());
                command
                    .args([
                        "--exact",
                        "services::restore_journal::crash_tests::restore_crash_worker",
                        "--nocapture",
                    ])
                    .env("CC_SWITCH_TEST_HOME", temp.path())
                    .env("SI_RESTORE_TEST_PHASE", phase)
                    .stdout(Stdio::null())
                    .stderr(Stdio::piped());
                command
            };
            let mut child = command().spawn().unwrap();
            let started = Instant::now();
            while !temp.path().join("ready").exists() {
                if let Some(status) = child.try_wait().unwrap() {
                    panic!("writer exited at {phase}: {status}");
                }
                if started.elapsed() > Duration::from_secs(30) {
                    child.kill().unwrap();
                    child.wait().unwrap();
                    panic!("writer timed out at {phase}");
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            child.kill().unwrap();
            assert!(!child.wait().unwrap().success());
            let result = command()
                .env("SI_RESTORE_TEST_VERIFY", "1")
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "restart failed at {phase}: {}",
                String::from_utf8_lossy(&result.stderr)
            );
            println!("process SIGKILL + fresh restart passed: {phase}");
        }
    }
}
