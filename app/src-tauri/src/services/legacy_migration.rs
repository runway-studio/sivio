//! Previewed, repeatable migration. Sources are read as files, never opened by
//! the original app or SQLite in place; publication reuses the restore journal.
use super::{restore_journal, skill::SkillService, sync_protocol, webdav_sync::archive};
use crate::{database::Database, error::AppError};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
const LIMIT: u64 = 512 * 1024 * 1024;
fn err(message: impl Into<String>) -> AppError {
    AppError::Config(message.into())
}
type Files = BTreeMap<String, Vec<u8>>;
fn read_file(path: &Path, budget: &mut u64) -> Result<Vec<u8>, AppError> {
    use std::os::unix::fs::OpenOptionsExt;
    let metadata = fs::symlink_metadata(path).map_err(|e| AppError::io(path, e))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(err(
            "Migration source must contain ordinary files; symbolic links are not followed",
        ));
    }
    if metadata.len() > LIMIT.saturating_sub(*budget) {
        return Err(err("Migration source exceeds 512 MiB"));
    }
    let mut bytes = Vec::new();
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .and_then(|file| {
            file.take(LIMIT.saturating_sub(*budget) + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(|e| AppError::io(path, e))?;
    *budget += bytes.len() as u64;
    if *budget > LIMIT {
        return Err(err("Migration source exceeds 512 MiB"));
    }
    Ok(bytes)
}
fn visit(root: &Path, path: &Path, files: &mut Files, budget: &mut u64) -> Result<(), AppError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| err("Source path is outside its root"))?;
    if files.len() > 30_000 || relative.components().count() > 128 {
        return Err(err("Migration tree exceeds entry/depth limit"));
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| AppError::io(path, e))?;
    if metadata.file_type().is_symlink() {
        return Err(err(
            "Source contains a symbolic link; export a self-contained backup first",
        ));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| AppError::io(path, e))? {
            visit(
                root,
                &entry.map_err(|e| AppError::io(path, e))?.path(),
                files,
                budget,
            )?;
        }
    } else {
        files.insert(
            relative
                .to_str()
                .ok_or_else(|| err("Non-UTF-8 source path"))?
                .into(),
            read_file(path, budget)?,
        );
    }
    Ok(())
}
fn gather(path: &Path, kind: &str) -> Result<Files, AppError> {
    if !["cc-switch", "clash-verge"].contains(&kind) {
        return Err(err("Unknown migration source"));
    }
    let mut files = Files::new();
    let mut budget = 0;
    if path.is_dir() {
        for name in if kind == "cc-switch" {
            vec!["cc-switch.db", "cc-switch.db-wal", "skills"]
        } else {
            vec![
                "profiles.yaml",
                "config.yaml",
                "verge.yaml",
                "dns_config.yaml",
                "profiles",
            ]
        } {
            let entry = path.join(name);
            if entry.symlink_metadata().is_ok() {
                visit(path, &entry, &mut files, &mut budget)?;
            }
        }
    } else if kind == "clash-verge" {
        let bytes = read_file(path, &mut budget)?;
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| err("Invalid Clash Verge Rev ZIP"))?;
        if zip.len() > 30_000 {
            return Err(err("Too many archive entries"));
        }
        budget = 0;
        let mut seen = std::collections::BTreeSet::new();
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|_| err("Invalid archive entry"))?;
            let name = entry
                .enclosed_name()
                .ok_or_else(|| err("Archive path escapes its root"))?;
            if name
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
                || name.components().count() > 128
                || !seen.insert(name.clone())
            {
                return Err(err("Invalid or duplicate archive path"));
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(err("Archive symlinks are not supported"));
            }
            if entry.is_dir() {
                continue;
            }
            if entry.size() > LIMIT.saturating_sub(budget) {
                return Err(err("Expanded archive exceeds 512 MiB"));
            }
            let mut bytes = Vec::new();
            (&mut entry)
                .take(LIMIT.saturating_sub(budget) + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| err("Cannot read archive entry"))?;
            budget += bytes.len() as u64;
            if budget > LIMIT {
                return Err(err("Expanded archive exceeds 512 MiB"));
            }
            let name = name.to_str().ok_or_else(|| err("Non-UTF-8 archive path"))?;
            if [
                "profiles.yaml",
                "config.yaml",
                "verge.yaml",
                "dns_config.yaml",
            ]
            .contains(&name)
                || name.starts_with("profiles/")
            {
                files.insert(name.into(), bytes);
            }
        }
    } else {
        let name = if path.extension().is_some_and(|v| v == "db") {
            "cc-switch.db"
        } else {
            "export.sql"
        };
        files.insert(name.into(), read_file(path, &mut budget)?);
        if name == "cc-switch.db" {
            let wal = PathBuf::from(format!("{}-wal", path.display()));
            if wal.exists() {
                files.insert("cc-switch.db-wal".into(), read_file(&wal, &mut budget)?);
            }
        }
    }
    if files.is_empty() {
        return Err(err("No supported source data was found"));
    }
    Ok(files)
}
fn revision(files: &Files) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    for (name, bytes) in files {
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name);
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    format!("{:x}", hash.finalize())
}
fn source_modes(path: &Path, files: &Files) -> Result<BTreeMap<String, u32>, AppError> {
    use std::os::unix::fs::PermissionsExt;
    let mut modes = BTreeMap::new();
    if path.is_dir() {
        for name in files.keys() {
            let file = path.join(name);
            let metadata = fs::symlink_metadata(&file).map_err(|e| AppError::io(&file, e))?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(err("Source file changed during scan"));
            }
            modes.insert(name.clone(), metadata.permissions().mode() & 0o700);
        }
    }
    Ok(modes)
}
fn skills_revision(path: &Path) -> Result<String, AppError> {
    if path.symlink_metadata().is_err() {
        Ok("absent".into())
    } else {
        restore_journal::tree_revision(path)
    }
}
struct Plan {
    _stage: tempfile::TempDir,
    skills: PathBuf,
    sql: String,
    revision: String,
    before_db: String,
    before_skills: String,
    report: Value,
}
fn plan(db: &Database, path: &Path, kind: &str, replace: bool) -> Result<Plan, AppError> {
    let before_db = db.configuration_revision()?;
    let own_skills = SkillService::get_ssot_dir().map_err(|e| err(e.to_string()))?;
    let before_skills = skills_revision(&own_skills)?;
    let files = gather(path, kind)?;
    let modes = source_modes(path, &files)?;
    let source_hash = sync_protocol::sha256_hex(
        format!(
            "{}:{}",
            revision(&files),
            serde_json::to_string(&modes).map_err(|e| err(e.to_string()))?
        )
        .as_bytes(),
    );
    // SQLite and its WAL must describe one stable source revision.
    if revision(&files) != revision(&gather(path, kind)?) || modes != source_modes(path, &files)? {
        return Err(err(
            "Source changed during scan; close the original app and retry",
        ));
    }
    let stage = tempfile::tempdir().map_err(|e| err(e.to_string()))?;
    let skills = stage.path().join("skills");
    archive::copy_dir_recursive(&own_skills, &skills)?;
    let (sql, mut counts) = if kind == "cc-switch" {
        let sql = if let Some(bytes) = files.get("cc-switch.db") {
            let copy = stage.path().join("source.db");
            crate::config::atomic_write_private(&copy, bytes)?;
            if let Some(wal) = files.get("cc-switch.db-wal") {
                crate::config::atomic_write_private(&stage.path().join("source.db-wal"), wal)?;
            }
            Database::legacy_cc_sql(&[], Some(&copy))?
        } else {
            Database::legacy_cc_sql(
                files
                    .get("export.sql")
                    .ok_or_else(|| err("CC Switch database/export is missing"))?,
                None,
            )?
        };
        db.merge_legacy_cc(&sql, replace)?
    } else {
        let (value, counts) = crate::network::legacy_import::merge(
            &files,
            db.get_setting("si_assist_network")?.as_deref(),
            replace,
        )
        .map_err(|e| err(e.to_string()))?;
        (db.legacy_network_snapshot(&value)?, counts)
    };
    let (mut added, mut conflicts, mut kept) = (0, 0, 0);
    for (name, bytes) in files
        .iter()
        .filter(|(name, _)| kind == "cc-switch" && name.starts_with("skills/"))
    {
        let relative = Path::new(name)
            .strip_prefix("skills")
            .map_err(|_| err("Invalid Skills path"))?;
        let destination = skills.join(relative);
        // An existing link or file/directory collision is a conflict, never an
        // invitation to follow a path into another project.
        let mut cursor = skills.clone();
        for part in relative.components() {
            cursor.push(part);
            if cursor
                .symlink_metadata()
                .is_ok_and(|m| m.file_type().is_symlink())
            {
                return Err(err(
                    "A destination Skill path is a symbolic link; resolve it before migration",
                ));
            }
        }
        if destination.exists() {
            conflicts += 1;
            if !replace {
                kept += 1;
                continue;
            }
        } else {
            added += 1;
        }
        crate::config::atomic_write_private(&destination, bytes)?;
        if let Some(mode) = modes.get(name) {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&destination, fs::Permissions::from_mode(*mode))
                .map_err(|e| AppError::io(&destination, e))?;
        }
    }
    counts["skillFiles"] = json!({"added":added,"conflicts":conflicts,"kept":kept});
    if db.configuration_revision()? != before_db || skills_revision(&own_skills)? != before_skills {
        return Err(err("Sivio data changed during preview; retry"));
    }
    let token = sync_protocol::sha256_hex(
        format!(
            "{kind}\0{}\0{replace}\0{source_hash}\0{before_db}\0{before_skills}",
            path.display()
        )
        .as_bytes(),
    );
    let report = json!({"filePath":path,"kind":kind,"replace":replace,"revision":token,"counts":counts,"warnings":if kind=="cc-switch" {vec!["Imported providers, MCP, prompts and Skills remain inactive. Original CLI files, OAuth sessions, app preferences and proxy ownership are not copied. Directory import includes Skills files; SQL/DB file import contains database rows only."]}else{vec!["If existing network configuration cannot be read, the replace option replaces that whole configuration from this source after backing it up. Imported profiles remain unselected and scheduled updates are disabled. Source options and global config/DNS/preferences are preserved for review; Sivio ports, TUN, system proxy and update settings remain unchanged. Scripts are retained without execution."]}});
    Ok(Plan {
        _stage: stage,
        skills,
        sql,
        revision: token,
        before_db,
        before_skills,
        report,
    })
}
pub(crate) fn scan() -> Value {
    let home = dirs::home_dir().unwrap_or_default();
    json!([{"kind":"cc-switch","filePath":home.join(".cc-switch"),"available":home.join(".cc-switch/cc-switch.db").is_file()},{"kind":"clash-verge","filePath":home.join("Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"),"available":home.join("Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles.yaml").is_file()}])
}
pub(crate) fn preview(
    db: &Database,
    path: &Path,
    kind: &str,
    replace: bool,
) -> Result<Value, AppError> {
    let _guard = super::skill::skill_state_read_guard();
    Ok(plan(db, path, kind, replace)?.report)
}
pub(crate) fn apply(
    db: &Database,
    path: &Path,
    kind: &str,
    replace: bool,
    expected: &str,
) -> Result<(), AppError> {
    let _guard = super::skill::skill_state_write_guard();
    let plan = plan(db, path, kind, replace)?;
    if plan.revision != expected {
        return Err(err(
            "Source or Sivio data changed after preview; review again",
        ));
    }
    let own_skills = SkillService::get_ssot_dir().map_err(|e| err(e.to_string()))?;
    if skills_revision(&own_skills)? != plan.before_skills {
        return Err(err("Skills changed after preview"));
    }
    sync_protocol::apply_staged_configuration(db, &plan.sql, &plan.skills, Some(&plan.before_db))
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    struct Environment {
        previous: Option<std::ffi::OsString>,
        settings: crate::settings::AppSettings,
    }
    impl Drop for Environment {
        fn drop(&mut self) {
            let _ = crate::settings::update_settings(self.settings.clone());
            match &self.previous {
                Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            };
            let _ = crate::settings::reload_settings();
        }
    }
    fn environment(path: &Path) -> Environment {
        let guard = Environment {
            previous: std::env::var_os("CC_SWITCH_TEST_HOME"),
            settings: crate::settings::get_settings(),
        };
        std::env::set_var("CC_SWITCH_TEST_HOME", path);
        crate::settings::reload_settings().unwrap();
        crate::settings::update_settings(Default::default()).unwrap();
        guard
    }
    fn original_cc() -> String {
        let source = Database::memory().unwrap();
        source.apply_schema_migrations().unwrap();
        source.conn.lock().unwrap().execute("INSERT INTO providers(id,app_type,name,settings_config,is_current) VALUES('migrate-fixture','claude','Imported fixture',?1,1)",[r#"{"env":{"ANTHROPIC_API_KEY":"fixture-migration-secret"},"future":7}"#]).unwrap();
        source.export_sql_string().unwrap().replacen(
            "-- Sivio SQLite 导出",
            "-- CC Switch SQLite 导出",
            1,
        )
    }
    #[test]
    fn legacy_sql_merge_is_inactive_repeatable_conflict_checked_and_journaled() {
        let temp = tempfile::tempdir().unwrap();
        let _environment = environment(temp.path());
        let db = Database::memory().unwrap();
        let source = temp.path().join("source.sql");
        fs::write(&source, original_cc()).unwrap();
        let old = fs::read(&source).unwrap();
        let review = preview(&db, &source, "cc-switch", false).unwrap();
        assert_eq!(review["counts"]["providers"]["added"], 1);
        assert!(!review.to_string().contains("fixture-migration-secret"));
        assert!(!db.export_sql_string().unwrap().contains("migrate-fixture"));
        apply(
            &db,
            &source,
            "cc-switch",
            false,
            review["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(old, fs::read(&source).unwrap());
        let (count, active): (i64, i64) = db
            .conn
            .lock()
            .unwrap()
            .query_row(
                "SELECT count(*),is_current FROM providers WHERE id='migrate-fixture'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, active), (1, 0));
        assert!(db
            .export_sql_string()
            .unwrap()
            .contains("fixture-migration-secret"));
        let repeated = preview(&db, &source, "cc-switch", false).unwrap();
        assert_eq!(repeated["counts"]["providers"]["added"], 0);
        assert_eq!(repeated["counts"]["providers"]["kept"], 1);
        db.set_setting("external-fixture", "changed").unwrap();
        assert!(apply(
            &db,
            &source,
            "cc-switch",
            false,
            repeated["revision"].as_str().unwrap()
        )
        .is_err());
        let replaced = preview(&db, &source, "cc-switch", true).unwrap();
        apply(
            &db,
            &source,
            "cc-switch",
            true,
            replaced["revision"].as_str().unwrap(),
        )
        .unwrap();
        let stale = preview(&db, &source, "cc-switch", false).unwrap();
        fs::write(&source, original_cc() + "\n-- changed").unwrap();
        assert!(apply(
            &db,
            &source,
            "cc-switch",
            false,
            stale["revision"].as_str().unwrap()
        )
        .is_err());
        assert_eq!(
            db.get_setting("external-fixture").unwrap().as_deref(),
            Some("changed")
        );
    }
    #[test]
    fn clash_archive_preserves_profile_enhancement_and_never_runs_source_script() {
        let temp = tempfile::tempdir().unwrap();
        let _environment = environment(temp.path());
        let db = Database::memory().unwrap();
        let source = temp.path().join("clash.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&source).unwrap());
        for(name,text)in [("profiles.yaml","current: L1\nitems:\n - {uid: L1, type: remote, name: Fixture, file: L1.yaml, url: 'https://fixture.invalid/private-subscription', option: {merge: M1, script: S1, update_interval: 60}}\n - {uid: M1, type: merge, file: M1.yaml}\n - {uid: S1, type: script, file: S1.js}"),("profiles/L1.yaml","proxies: []\nrules: [MATCH,DIRECT]"),("profiles/M1.yaml","profile: {future: true}"),("profiles/S1.js","throw new Error('must not run during migration');"),("config.yaml","mixed-port: 9999"),("verge.yaml","enable_tun_mode: true")]{zip.start_file(name,zip::write::SimpleFileOptions::default()).unwrap();zip.write_all(text.as_bytes()).unwrap();}
        zip.finish().unwrap();
        let old = fs::read(&source).unwrap();
        let review = preview(&db, &source, "clash-verge", false).unwrap();
        assert_eq!(review["counts"]["networkProfiles"]["added"], 1);
        apply(
            &db,
            &source,
            "clash-verge",
            false,
            review["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(old, fs::read(&source).unwrap());
        let raw = db.get_setting("si_assist_network").unwrap().unwrap();
        assert!(raw.contains("private-subscription"));
        assert!(!db.export_portable_sql(false, true).unwrap().contains("private-subscription"));
        let value: Value = crate::credential_vault::from_str(&raw).unwrap();
        assert!(value["config"]["catalog"]["active"].is_null());
        assert_eq!(value["config"]["catalog"]["settings"]["mixedPort"], 7890);
        assert_eq!(value["config"]["catalog"]["profiles"][0]["interval"], 0);
        assert!(value.to_string().contains("must not run during migration"));
        let repeated = preview(&db, &source, "clash-verge", false).unwrap();
        assert_eq!(repeated["counts"]["networkProfiles"]["kept"], 1);
        fs::write(&source, b"damaged").unwrap();
        assert!(preview(&db, &source, "clash-verge", false).is_err());
    }
    #[test]
    fn copied_sqlite_with_live_wal_is_read_without_modifying_the_original_and_skills_conflict_is_explicit(
    ) {
        let temp = tempfile::tempdir().unwrap();
        let _environment = environment(&temp.path().join("own"));
        let db = Database::memory().unwrap();
        let source = temp.path().join("cc");
        fs::create_dir_all(source.join("skills/fixture")).unwrap();
        fs::write(source.join("skills/fixture/SKILL.md"), "incoming").unwrap();
        let conn = rusqlite::Connection::open(source.join("cc-switch.db")).unwrap();
        conn.execute_batch(&original_cc()).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; INSERT INTO settings(key,value) VALUES('ignored-runtime','private')").unwrap();
        let own = SkillService::get_ssot_dir().unwrap();
        fs::create_dir_all(own.join("fixture")).unwrap();
        fs::write(own.join("fixture/SKILL.md"), "existing").unwrap();
        let before = revision(&gather(&source, "cc-switch").unwrap());
        let review = preview(&db, &source, "cc-switch", false).unwrap();
        assert_eq!(review["counts"]["skillFiles"]["kept"], 1);
        apply(
            &db,
            &source,
            "cc-switch",
            false,
            review["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(own.join("fixture/SKILL.md")).unwrap(),
            "existing"
        );
        assert_eq!(before, revision(&gather(&source, "cc-switch").unwrap()));
        let replace = preview(&db, &source, "cc-switch", true).unwrap();
        apply(
            &db,
            &source,
            "cc-switch",
            true,
            replace["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(own.join("fixture/SKILL.md")).unwrap(),
            "incoming"
        );
        assert_eq!(before, revision(&gather(&source, "cc-switch").unwrap()));
    }
    #[test]
    fn corrupt_future_and_escaping_sources_do_not_touch_the_current_database() {
        let temp = tempfile::tempdir().unwrap();
        let _environment = environment(temp.path());
        let db = Database::memory().unwrap();
        let before = db.configuration_revision().unwrap();
        let source = temp.path().join("bad.sql");
        for sql in [
            "-- CC Switch SQLite 导出\nCREATE TABLE providers(id);".into(),
            original_cc()
                .replace("-- user_version: 20", "-- user_version: 999")
                .replace("PRAGMA user_version=20;", "PRAGMA user_version=999;"),
            format!(
                "{}\nATTACH DATABASE '/tmp/migration-must-not-create.db' AS outside;",
                original_cc()
            ),
        ] {
            fs::write(&source, sql).unwrap();
            assert!(preview(&db, &source, "cc-switch", false).is_err());
        }
        let path = temp.path().join("escape.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        zip.start_file("../profiles.yaml", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"items: []").unwrap();
        zip.finish().unwrap();
        assert!(preview(&db, &path, "clash-verge", false).is_err());
        assert_eq!(before, db.configuration_revision().unwrap());
    }
}
