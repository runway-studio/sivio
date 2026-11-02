//! Disposable macOS CI driver. Excluded from normal/release builds.
//! Calls the real application lifecycle; no download/install/network mocks.
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use tauri::{Listener, Manager};

fn record(path: &std::path::Path, value: Value) -> Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{}", value)?;
    file.sync_all()?;
    Ok(())
}

async fn network(app: &tauri::AppHandle, action: &str, args: Value) -> Result<Value> {
    crate::network::network_command(app.clone(), app.state(), action.into(), Some(args))
        .await.map_err(|value| anyhow::anyhow!("{value}"))
}

async fn run(app: tauri::AppHandle, report: PathBuf, feed: String) -> Result<()> {
    // Startup includes the normal database, network repository and window setup.
    tokio::time::sleep(Duration::from_secs(10)).await;
    let state = app.state::<crate::store::AppState>();
    state.db.set_setting("native_upgrade_validation", "synthetic-retained-record")?;
    let mut settings = crate::settings::get_settings();
    settings.language = Some("en".into());
    crate::settings::update_settings(settings)?;
    let public: Value = serde_json::from_str(include_str!("../release-config.json"))?;
    let key = public["publicKey"].as_str().context("public key")?.to_string();

    // A real HTTP failure must leave the installed binary untouched.
    let executable = std::env::current_exe()?;
    let original = std::fs::read(&executable)?;
    crate::app_updates::save_channel(&app, format!("{feed}.missing"), key.clone(), Some("custom".into())).await.map_err(anyhow::Error::msg)?;
    ensure!(crate::app_updates::information(&app).await.is_err(), "missing feed unexpectedly succeeded");
    ensure!(std::fs::read(&executable)? == original, "failed check changed executable");
    record(&report, json!({"stage":"failed-check-preserved-app"}))?;
    crate::app_updates::save_channel(&app, feed, key, Some("custom".into())).await.map_err(anyhow::Error::msg)?;

    let before = network(&app, "snapshot", json!({})).await?;
    ensure!(before["helperAuthorized"] == true, "native App is not accepted by the installed helper");
    let profile = network(&app, "profile.save", json!({
        "name":"Upgrade validation fixture", "kind":"local",
        "yaml":"proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n"
    })).await?;
    network(&app, "profile.select", json!({"id":profile["id"]})).await?;
    let snapshot = network(&app, "snapshot", json!({})).await?;
    let mut preferences = snapshot["catalog"]["settings"].clone();
    preferences["system_proxy"] = json!(true);
    preferences["tun"] = json!(false);
    preferences["mixed_port"] = json!(17890);
    network(&app, "settings.save", json!({"settings":preferences,"baseRevision":snapshot["settingsRevision"],"startIfStopped":true})).await?;
    let running = network(&app, "snapshot", json!({})).await?;
    ensure!(running["runtime"]["phase"] == "running", "network did not start");
    record(&report, json!({"stage":"before-upgrade","pid":std::process::id(),"version":app.package_info().version.to_string(),
        "helperAuthorized":running["helperAuthorized"],"runtime":running["runtime"],"profileId":profile["id"]}))?;

    let info = crate::app_updates::information(&app).await.map_err(anyhow::Error::msg)?;
    let id = info["candidateId"].as_str().context("higher update was not offered")?.to_owned();
    ensure!(info["availableVersion"].as_str().is_some_and(|v| v.contains("-rc.")), "validation requires a prerelease");
    record(&report, json!({"stage":"candidate","currentVersion":info["currentVersion"],"availableVersion":info["availableVersion"]}))?;
    crate::app_updates::download_candidate(&app, &id).await.map_err(anyhow::Error::msg)?;
    record(&report, json!({"stage":"verified-download"}))?;
    crate::app_updates::validation_flip_candidate(&id).map_err(anyhow::Error::msg)?;
    ensure!(crate::app_updates::install(&app, &id).await.is_err(), "tampered candidate was accepted");
    ensure!(std::fs::read(&executable)? == original, "failed signature changed executable");
    ensure!(network(&app, "snapshot", json!({})).await?["runtime"]["phase"] == "running", "signature failure disrupted network");
    record(&report, json!({"stage":"tampered-signature-rejected","networkStillRunning":true}))?;
    crate::app_updates::validation_flip_candidate(&id).map_err(anyhow::Error::msg)?;
    // The same install function used by the UI cleans live network state, swaps
    // on the same volume, retains the old bundle and relaunches the native app.
    crate::app_updates::install(&app, &id).await.map_err(anyhow::Error::msg)?;
    anyhow::bail!("install unexpectedly returned without restarting")
}

pub fn start(app: &tauri::AppHandle) {
    let Ok(report) = std::env::var("SIVIO_NATIVE_UPGRADE_PROBE") else { return };
    // The driver may mutate disposable runner state only. Production excludes
    // this module entirely; setting an environment variable cannot enable it.
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    let temp = PathBuf::from(std::env::var("RUNNER_TEMP").expect("runner temp"));
    let report = PathBuf::from(report);
    assert!(report.is_absolute() && report.starts_with(&temp));
    assert!(std::env::current_exe().unwrap().starts_with(&temp));
    let feed = std::env::var("SIVIO_NATIVE_UPGRADE_FEED").expect("test feed");
    assert!(feed.starts_with("https://github.com/runway-studio/sivio/releases/download/v"));
    assert!(feed.contains("-rc.") && feed.ends_with("/latest.json"));
    let progress_report = report.clone();
    let previous = std::sync::Mutex::new(String::new());
    app.listen("update-download-progress", move |event| {
        if let Ok(payload) = serde_json::from_str::<Value>(event.payload()) {
            let stage = payload["stage"].as_str().unwrap_or("").to_owned();
            let mut last = previous.lock().unwrap();
            if *last == stage { return; }
            *last = stage;
            let _ = record(&progress_report, json!({"stage":"progress","progress":payload["stage"]}));
        }
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(app.clone(), report.clone(), feed).await {
            let _ = record(&report, json!({"stage":"error","message":error.to_string()}));
            app.exit(1);
        }
    });
}
