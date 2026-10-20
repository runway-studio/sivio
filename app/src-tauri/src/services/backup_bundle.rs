//! Portable configuration bundles use the same verified AI/network/Skills snapshot as cloud sync.
use super::sync_protocol::*;
use crate::{database::Database, error::AppError};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
const MAX_BUNDLE: u64 = 1024 * 1024 * 1024 + 4 * 1024 * 1024;
fn error(message: &str) -> AppError {
    AppError::Config(message.into())
}

pub fn export(db: &Database, destination: &Path) -> Result<(), AppError> {
    let snapshot = build_local_snapshot(db)?;
    // The temporary file lives beside its destination, so publication is one rename.
    let parent = destination
        .parent()
        .ok_or_else(|| error("Invalid backup destination"))?;
    let mut staged =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| AppError::io(parent, e))?;
    {
        let mut writer = zip::ZipWriter::new(staged.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in [
            (REMOTE_MANIFEST, snapshot.manifest_bytes),
            (REMOTE_DB_SQL, snapshot.db_sql),
            (REMOTE_SKILLS_ZIP, snapshot.skills_zip),
        ] {
            writer
                .start_file(name, options)
                .map_err(|_| error("Cannot create backup entry"))?;
            writer
                .write_all(&bytes)
                .map_err(|e| AppError::io(destination, e))?;
        }
        writer
            .finish()
            .map_err(|_| error("Cannot finish backup archive"))?;
    }
    staged
        .as_file()
        .sync_all()
        .map_err(|e| AppError::io(destination, e))?;
    staged
        .persist(destination)
        .map_err(|e| AppError::io(destination, e.error))?;
    fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| AppError::io(parent, e))?;
    Ok(())
}
pub struct VerifiedBundle {
    pub manifest: SyncManifest,
    pub hash: String,
    pub db: Vec<u8>,
    pub skills: Vec<u8>,
}
pub fn read(path: &Path) -> Result<VerifiedBundle, AppError> {
    let file = fs::File::open(path).map_err(|e| AppError::io(path, e))?;
    if file.metadata().map_err(|e| AppError::io(path, e))?.len() > MAX_BUNDLE {
        return Err(error("Backup bundle exceeds size limit"));
    }
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| error("Invalid Sivio backup archive"))?;
    if archive.len() != 3 {
        return Err(error(
            "A configuration bundle must contain exactly manifest.json, db.sql and skills.zip",
        ));
    }
    let mut read_entry = |name: &str, limit: u64| -> Result<Vec<u8>, AppError> {
        let entry = archive
            .by_name(name)
            .map_err(|_| error("Backup bundle is incomplete"))?;
        if entry.size() > limit {
            return Err(error("Backup entry exceeds size limit"));
        }
        let mut bytes = Vec::new();
        entry
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| AppError::io(path, e))?;
        if bytes.len() as u64 > limit {
            return Err(error("Backup entry exceeds size limit"));
        }
        Ok(bytes)
    };
    let manifest_bytes = read_entry(REMOTE_MANIFEST, MAX_MANIFEST_BYTES as u64)?;
    let manifest: SyncManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| error("Invalid backup manifest"))?;
    validate_manifest_compat(&manifest, RemoteLayout::Current)?;
    let db = read_entry(REMOTE_DB_SQL, MAX_SYNC_ARTIFACT_BYTES)?;
    let skills = read_entry(REMOTE_SKILLS_ZIP, MAX_SYNC_ARTIFACT_BYTES)?;
    for (name, bytes) in [(REMOTE_DB_SQL, &db), (REMOTE_SKILLS_ZIP, &skills)] {
        let meta = manifest
            .artifacts
            .get(name)
            .ok_or_else(|| error("Backup manifest is incomplete"))?;
        verify_artifact(bytes, name, meta)?;
    }
    let hash = compute_snapshot_id(&manifest.artifacts);
    if hash != manifest.snapshot_id {
        return Err(error("Backup snapshot identity mismatch"));
    }
    // Includes metadata in the preview token; edited archives must be previewed again.
    Ok(VerifiedBundle {
        manifest,
        hash: sha256_hex(&manifest_bytes),
        db,
        skills,
    })
}
pub fn preview(path: &Path) -> Result<Value, AppError> {
    let bundle = read(path)?;
    Ok(
        json!({"filePath":path,"revision":bundle.hash,"device":bundle.manifest.device_name,"createdAt":bundle.manifest.created_at,"encrypted":bundle.manifest.encrypted,"artifacts":bundle.manifest.artifacts}),
    )
}
pub fn restore(db: &Database, path: &Path, expected: &str) -> Result<(), AppError> {
    let bundle = read(path)?;
    if bundle.hash != expected {
        return Err(error(
            "Backup changed after preview; select and review it again",
        ));
    }
    let (sql, skills) = decode_snapshot(&bundle.manifest, bundle.db, bundle.skills)?;
    apply_snapshot(db, &sql, &skills)
}
