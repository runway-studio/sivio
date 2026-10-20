//! Local HTTP services exercise actual WebDAV and SigV4 transport code, not mocks of it.
use super::{s3_sync, skill::SkillService, sync_protocol::*, webdav_sync};
use crate::{database::Database, settings::*};
use axum::{
    body::{to_bytes, Body},
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Router,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Storage {
    objects: BTreeMap<String, Vec<u8>>,
    conditions: Vec<(Option<String>, Option<String>)>,
    reject_manifest: bool,
    signed_conditions: usize,
}
type Shared = Arc<Mutex<Storage>>;
async fn serve(State(shared): State<Shared>, request: Request) -> Response {
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let headers = request.headers().clone();
    let bytes = to_bytes(request.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    let mut state = shared.lock().unwrap();
    let mut status = StatusCode::OK;
    let mut body = Vec::new();
    let mut response_headers = HeaderMap::new();
    let header = |name| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    if method == "MKCOL" {
        status = StatusCode::CREATED;
    } else if method == "PUT" {
        if path.ends_with("manifest.json") {
            let matches = header("if-match");
            let absent = header("if-none-match");
            state.conditions.push((matches.clone(), absent.clone()));
            if let Some(auth) = header("authorization") {
                if auth.starts_with("AWS4-HMAC-SHA256") {
                    assert!(auth.contains(if matches.is_some() {
                        "if-match"
                    } else {
                        "if-none-match"
                    }));
                    state.signed_conditions += 1;
                }
            }
            let current = state
                .objects
                .get(&path)
                .map(|bytes| format!("\"{}\"", sha256_hex(bytes)));
            if state.reject_manifest
                || (absent.as_deref() == Some("*") && current.is_some())
                || (matches.is_some() && matches != current)
            {
                status = StatusCode::PRECONDITION_FAILED;
            }
        }
        if status.is_success() {
            state.objects.insert(path.clone(), bytes.to_vec());
        }
    } else if let Some(bytes) = state.objects.get(&path) {
        response_headers.insert(
            "etag",
            format!("\"{}\"", sha256_hex(bytes)).parse().unwrap(),
        );
        if method != "HEAD" {
            body = bytes.clone();
        }
    } else {
        status = StatusCode::NOT_FOUND;
    }
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    response
}
struct Environment {
    previous: Option<std::ffi::OsString>,
    settings: AppSettings,
}
impl Drop for Environment {
    fn drop(&mut self) {
        let _ = update_settings(self.settings.clone());
        match &self.previous {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
        let _ = reload_settings();
    }
}
async fn exercise(s3: bool) {
    let previous_proxy = crate::proxy::http_client::get_current_proxy_url();
    crate::proxy::http_client::init(None).unwrap();
    let temporary = tempfile::tempdir().unwrap();
    let _environment = Environment {
        previous: std::env::var_os("CC_SWITCH_TEST_HOME"),
        settings: get_settings(),
    };
    std::env::set_var("CC_SWITCH_TEST_HOME", temporary.path());
    reload_settings().unwrap();
    let mut privacy = AppSettings::default();
    privacy.sync_include_secrets = false;
    update_settings(privacy.clone()).unwrap();
    let shared: Shared = Default::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let router = Router::new().fallback(serve).with_state(shared.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let db = Database::memory().unwrap();
    db.set_setting("sync-fixture", "first").unwrap();
    db.set_setting(
        "common_config_claude",
        r#"{"env":{"ANTHROPIC_API_KEY":"fixture-private-api-key"}}"#,
    )
    .unwrap();
    let skills = SkillService::get_ssot_dir().unwrap();
    std::fs::create_dir_all(skills.join("fixture")).unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "first skill").unwrap();
    let mut dav = WebDavSyncSettings {
        base_url: format!("http://{address}/dav"),
        username: "fixture".into(),
        password: "fixture".into(),
        ..Default::default()
    };
    let mut aws = S3SyncSettings {
        endpoint: format!("http://{address}"),
        bucket: "fixture".into(),
        region: "fixture-region".into(),
        access_key_id: "fixture-id".into(),
        secret_access_key: "fixture-secret".into(),
        ..Default::default()
    };
    macro_rules! upload {
        () => {
            if s3 {
                s3_sync::upload(&db, &mut aws).await
            } else {
                webdav_sync::upload(&db, &mut dav).await
            }
        };
    }
    macro_rules! download {
        () => {
            if s3 {
                s3_sync::download(&db, &mut aws).await
            } else {
                webdav_sync::download(&db, &mut dav).await
            }
        };
    }
    upload!().unwrap();
    let manifest_path = shared
        .lock()
        .unwrap()
        .objects
        .keys()
        .find(|p| p.ends_with("manifest.json"))
        .unwrap()
        .clone();
    let first_manifest = shared.lock().unwrap().objects[&manifest_path].clone();
    for (path, bytes) in &shared.lock().unwrap().objects {
        if path.ends_with(".sql") {
            let sql = String::from_utf8_lossy(bytes);
            assert!(!sql.contains("fixture-private-api-key"));
            assert!(!sql.contains("$siCredential"));
            assert!(sql.contains(crate::portable_credentials::MISSING));
        }
    }
    db.set_setting("sync-fixture", "local edit").unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "local edit").unwrap();
    download!().unwrap();
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("first")
    );
    assert_eq!(
        std::fs::read_to_string(skills.join("fixture/SKILL.md")).unwrap(),
        "first skill"
    );
    // A stale device must stop before it uploads any artifacts.
    let stale_dav = dav.clone();
    let stale_aws = aws.clone();
    db.set_setting("sync-fixture", "second").unwrap();
    upload!().unwrap();
    let good_manifest = shared.lock().unwrap().objects[&manifest_path].clone();
    assert_ne!(good_manifest, first_manifest);
    let current_dav = dav.clone();
    let current_aws = aws.clone();
    dav = stale_dav;
    aws = stale_aws;
    let before_count = shared.lock().unwrap().objects.len();
    assert!(upload!().is_err());
    assert_eq!(shared.lock().unwrap().objects.len(), before_count);
    dav = current_dav;
    aws = current_aws;
    // A race after GET must leave the published snapshot and its objects valid.
    shared.lock().unwrap().reject_manifest = true;
    db.set_setting("sync-fixture", "racing edit").unwrap();
    assert!(upload!().is_err());
    assert_eq!(
        shared.lock().unwrap().objects[&manifest_path],
        good_manifest
    );
    shared.lock().unwrap().reject_manifest = false;
    download!().unwrap();
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("second")
    );
    // Secret-bearing mode encrypts every artifact; wrong-password restore is inert.
    privacy.sync_include_secrets = true;
    privacy.sync_password = "fixture-backup-password".into();
    update_settings(privacy.clone()).unwrap();
    db.set_setting(
        "common_config_claude",
        r#"{"env":{"ANTHROPIC_API_KEY":"fixture-encrypted-api-key"}}"#,
    )
    .unwrap();
    upload!().unwrap();
    let encrypted_manifest: SyncManifest =
        serde_json::from_slice(&shared.lock().unwrap().objects[&manifest_path]).unwrap();
    assert!(encrypted_manifest.encrypted);
    for (name, meta) in &encrypted_manifest.artifacts {
        let object = artifact_object_name(name, meta, true).unwrap();
        let bytes = shared
            .lock()
            .unwrap()
            .objects
            .iter()
            .find(|(key, _)| key.ends_with(&object))
            .unwrap()
            .1
            .clone();
        assert!(bytes.starts_with(b"SIENC002"));
        assert!(!bytes
            .windows(b"fixture-encrypted-api-key".len())
            .any(|w| w == b"fixture-encrypted-api-key"));
    }
    db.set_setting("sync-fixture", "must remain").unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "must remain").unwrap();
    privacy.sync_password = "wrong-fixture-password".into();
    update_settings(privacy.clone()).unwrap();
    assert!(download!().is_err());
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("must remain")
    );
    assert_eq!(
        std::fs::read_to_string(skills.join("fixture/SKILL.md")).unwrap(),
        "must remain"
    );
    privacy.sync_password = "fixture-backup-password".into();
    update_settings(privacy).unwrap();
    download!().unwrap();
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("second")
    );
    assert!(db
        .get_setting("common_config_claude")
        .unwrap()
        .unwrap()
        .contains("fixture-encrypted-api-key"));
    // Portable local files use the same authenticated snapshot and reject stale previews.
    let file = temporary.path().join("fixture.siassist");
    super::backup_bundle::export(&db, &file).unwrap();
    let preview = super::backup_bundle::preview(&file).unwrap();
    db.set_setting("sync-fixture", "local bundle edit").unwrap();
    assert!(super::backup_bundle::restore(&db, &file, "stale-preview").is_err());
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("local bundle edit")
    );
    super::backup_bundle::restore(&db, &file, preview["revision"].as_str().unwrap()).unwrap();
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("second")
    );
    // A crash after either domain changes leaves a durable rollback point.
    let before = db.export_sql_string().unwrap();
    db.set_setting("sync-fixture", "interrupted restore")
        .unwrap();
    let expected_database = db.configuration_revision().unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "interrupted restore").unwrap();
    let expected_skills = super::restore_journal::tree_revision(&skills).unwrap();
    db.import_sql_string(&before).unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "first skill").unwrap();
    let journal =
        super::restore_journal::Journal::begin(&db, &expected_database, &expected_skills).unwrap();
    db.set_setting("sync-fixture", "interrupted restore")
        .unwrap();
    std::fs::write(skills.join("fixture/SKILL.md"), "interrupted restore").unwrap();
    drop(journal);
    super::restore_journal::recover(&db).unwrap();
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("second")
    );
    assert_eq!(
        std::fs::read_to_string(skills.join("fixture/SKILL.md")).unwrap(),
        "first skill"
    );
    assert!(!crate::config::get_app_config_dir()
        .join("pending-restore")
        .exists());
    let old = db.configuration_revision().unwrap();
    let tree = super::restore_journal::tree_revision(&skills).unwrap();
    let journal = super::restore_journal::Journal::begin(&db, &old, &tree).unwrap();
    db.set_setting("sync-fixture", "external edit").unwrap();
    assert!(super::restore_journal::recover(&db).is_err());
    assert_eq!(
        db.get_setting("sync-fixture").unwrap().as_deref(),
        Some("external edit")
    );
    db.set_setting("sync-fixture", "second").unwrap();
    journal.rollback(&db).unwrap();
    let state = shared.lock().unwrap();
    assert_eq!(state.conditions.first().unwrap(), &(None, Some("*".into())));
    assert!(state
        .conditions
        .iter()
        .skip(1)
        .all(|(matched, _)| matched.is_some()));
    if s3 {
        assert_eq!(state.signed_conditions, state.conditions.len());
    }
    server.abort();
    crate::proxy::http_client::apply_proxy(previous_proxy.as_deref()).unwrap();
}
#[tokio::test]
#[serial_test::serial]
async fn webdav_roundtrip_conflict_immutable_artifacts_and_encrypted_restore() {
    exercise(false).await;
}
#[tokio::test]
#[serial_test::serial]
async fn s3_roundtrip_conflict_signed_conditions_and_encrypted_restore() {
    exercise(true).await;
}
