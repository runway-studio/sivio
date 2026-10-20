use super::*;
use std::sync::Mutex as StdMutex;

struct Fake {
    write: Mutex<()>,
    catalog: StdMutex<Catalog>,
    events: StdMutex<Vec<String>>,
    running: StdMutex<bool>,
    faults: Vec<&'static str>,
    suspended: bool,
}
impl Fake {
    fn new(running: bool, faults: Vec<&'static str>) -> Self {
        Self {
            write: Mutex::new(()),
            catalog: StdMutex::new(Catalog::default()),
            events: Default::default(),
            running: StdMutex::new(running),
            faults,
            suspended: false,
        }
    }
    fn event(&self, event: &str) -> Result<()> {
        self.events.lock().unwrap().push(event.into());
        ensure!(!self.faults.contains(&event), "injected {event} failure");
        Ok(())
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
    fn revision(&self) -> String {
        digest(&serde_json::to_vec(&self.catalog.lock().unwrap().settings).unwrap())
    }
    fn next(&self) -> Settings {
        Settings {
            mixed_port: 27891,
            ..Settings::default()
        }
    }
}
impl Backend for Fake {
    fn write(&self) -> &Mutex<()> {
        &self.write
    }
    fn read(&self) -> Result<Catalog> {
        Ok(self.catalog.lock().unwrap().clone())
    }
    fn save(&self, catalog: &Catalog) -> Result<()> {
        self.event("save")?;
        *self.catalog.lock().unwrap() = catalog.clone();
        if self
            .events()
            .iter()
            .filter(|event| *event == "save")
            .count()
            == 1
        {
            if self.faults.contains(&"external-save") {
                self.catalog.lock().unwrap().settings.mixed_port = 28888;
                bail!("concurrent external write");
            }
            ensure!(
                !self.faults.contains(&"save-after-write"),
                "durability failed after replacement"
            );
        }
        Ok(())
    }
    async fn status(&self, _: &Catalog) -> Result<Status> {
        Ok(Status {
            running: *self.running.lock().unwrap(),
            starting: false,
            proxy_suspended: self.suspended,
            managed: false,
        })
    }
    async fn validate(&self, _: &Catalog, _: &Catalog, _: Status) -> Result<()> {
        self.event("validate")?;
        if self.faults.contains(&"change-during-validation") {
            self.catalog.lock().unwrap().settings.mixed_port = 28888;
        }
        Ok(())
    }
    async fn stop(&self) -> Result<()> {
        let cleanup = self.events().iter().any(|event| event == "stop");
        self.event("stop")?;
        if cleanup {
            self.event("cleanup")?;
        }
        *self.running.lock().unwrap() = false;
        Ok(())
    }
    async fn start(&self, catalog: &Catalog, suspend: bool) -> Result<()> {
        let event = if catalog.settings.mixed_port == 7890 {
            "start-old"
        } else {
            "start-new"
        };
        // Simulate a partially started candidate even when readiness fails.
        *self.running.lock().unwrap() = true;
        self.event(event)?;
        tokio::task::yield_now().await;
        self.events
            .lock()
            .unwrap()
            .push(format!("proxy-suspended:{suspend}"));
        Ok(())
    }
    async fn failed(&self, _: &str) {
        *self.running.lock().unwrap() = false;
        self.events.lock().unwrap().push("failed".into());
    }
}

#[tokio::test]
async fn running_save_activates_before_committing() {
    let backend = Fake::new(true, vec![]);
    let result = apply(&backend, backend.next(), &backend.revision())
        .await
        .unwrap();
    assert_eq!(result["restarted"], true);
    assert_eq!(backend.read().unwrap().settings.mixed_port, 27891);
    assert!(*backend.running.lock().unwrap());
    assert_eq!(
        backend.events(),
        [
            "validate",
            "stop",
            "start-new",
            "proxy-suspended:false",
            "save"
        ]
    );
}
#[tokio::test]
async fn stopped_save_and_noop_never_start_a_network() {
    let backend = Fake::new(false, vec![]);
    let result = apply(&backend, backend.next(), &backend.revision())
        .await
        .unwrap();
    assert_eq!(result["restarted"], false);
    assert_eq!(backend.events(), ["validate", "save"]);
    let live = Fake::new(true, vec![]);
    apply(&live, Settings::default(), &live.revision())
        .await
        .unwrap();
    assert!(live.events().is_empty());
    let stopped_failure = Fake::new(false, vec!["save-after-write"]);
    let error = apply(
        &stopped_failure,
        stopped_failure.next(),
        &stopped_failure.revision(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("网络保持停止"));
    assert_eq!(stopped_failure.read().unwrap().settings.mixed_port, 7890);
    assert!(!*stopped_failure.running.lock().unwrap());
}
#[tokio::test]
async fn stale_edits_and_invalid_candidates_do_not_stop_the_old_core() {
    let backend = Fake::new(true, vec!["validate"]);
    assert!(apply(&backend, backend.next(), "stale").await.is_err());
    assert!(backend.events().is_empty());
    assert!(apply(&backend, backend.next(), &backend.revision())
        .await
        .is_err());
    assert_eq!(backend.events(), ["validate"]);
    assert!(*backend.running.lock().unwrap());
    assert_eq!(backend.read().unwrap().settings.mixed_port, 7890);
}
#[tokio::test]
async fn failed_activation_or_commit_cleans_candidate_and_restores_old_runtime() {
    for fault in ["start-new", "save"] {
        let backend = Fake::new(true, vec![fault]);
        let message = apply(&backend, backend.next(), &backend.revision())
            .await
            .unwrap_err()
            .to_string();
        assert!(message.contains("旧网络已恢复"), "{message}");
        assert_eq!(backend.read().unwrap().settings.mixed_port, 7890);
        assert!(*backend.running.lock().unwrap());
        let events = backend.events();
        let last_stop = events.iter().rposition(|e| e == "stop").unwrap();
        assert!(last_stop < events.iter().position(|e| e == "start-old").unwrap());
    }
}
#[tokio::test]
async fn cleanup_or_recovery_failure_never_claims_success_or_starts_a_second_core() {
    for faults in [
        vec!["stop"],
        vec!["start-new", "cleanup"],
        vec!["start-new", "start-old"],
    ] {
        let backend = Fake::new(true, faults.clone());
        let message = apply(&backend, backend.next(), &backend.revision())
            .await
            .unwrap_err()
            .to_string();
        assert!(message.contains("恢复失败"), "{message}");
        assert!(backend.events().contains(&"failed".into()));
        assert_eq!(backend.read().unwrap().settings.mixed_port, 7890);
        if faults.contains(&"stop") || faults.contains(&"cleanup") {
            assert!(!backend.events().contains(&"start-old".into()));
        }
    }
}
#[tokio::test]
async fn unrelated_changes_and_rollback_keep_external_proxy_takeover_suspended() {
    let mut backend = Fake::new(true, vec![]);
    backend.suspended = true;
    let mut next = Settings::default();
    next.log_level = "debug".into();
    apply(&backend, next, &backend.revision()).await.unwrap();
    assert!(backend.events().contains(&"proxy-suspended:true".into()));
}

#[tokio::test]
async fn an_error_after_persistence_restores_our_candidate_but_never_an_external_write() {
    let backend = Fake::new(true, vec!["save-after-write"]);
    let error = apply(&backend, backend.next(), &backend.revision())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("旧网络已恢复"));
    assert_eq!(backend.read().unwrap().settings.mixed_port, 7890);
    assert!(*backend.running.lock().unwrap());
    let external = Fake::new(true, vec!["external-save"]);
    let error = apply(&external, external.next(), &external.revision())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("配置被其他操作修改"));
    assert_eq!(external.read().unwrap().settings.mixed_port, 28888);
    assert!(!external.events().contains(&"start-old".into()));
}

#[tokio::test]
async fn simultaneous_saves_are_serialized_and_a_stale_second_save_never_restarts() {
    let backend = Fake::new(true, vec![]);
    let revision = backend.revision();
    let first = backend.next();
    let second = Settings {
        mixed_port: 27892,
        ..first.clone()
    };
    let (first, second) = tokio::join!(
        apply(&backend, first, &revision),
        apply(&backend, second, &revision)
    );
    first.unwrap();
    assert!(second
        .unwrap_err()
        .to_string()
        .contains("reload before saving"));
    assert_eq!(
        backend
            .events()
            .iter()
            .filter(|event| *event == "stop")
            .count(),
        1
    );
    assert_eq!(backend.read().unwrap().settings.mixed_port, 27891);
}

#[tokio::test]
async fn external_changes_during_preflight_are_rejected_before_stopping() {
    let backend = Fake::new(true, vec!["change-during-validation"]);
    let error = apply(&backend, backend.next(), &backend.revision())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("during validation"));
    assert_eq!(backend.events(), ["validate"]);
    assert!(*backend.running.lock().unwrap());
    assert_eq!(backend.read().unwrap().settings.mixed_port, 28888);
}

#[tokio::test]
async fn stopping_waits_for_the_owned_pac_listener_to_release_its_port() {
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let mut runtime = Runtime::default();
    runtime.pac = Some(pac::start(port, 27891, pac::DEFAULT_SCRIPT).await.unwrap());
    stop_inner(&mut runtime).await.unwrap();
    let replacement = pac::start(port, 27892, pac::DEFAULT_SCRIPT).await.unwrap();
    replacement.abort();
    let _ = replacement.await;
}

#[tokio::test]
async fn explicit_proxy_changes_can_apply_but_failed_changes_restore_the_previous_suspension() {
    let mut backend = Fake::new(true, vec!["save"]);
    backend.suspended = true;
    backend.catalog.lock().unwrap().settings.system_proxy = true;
    let mut next = backend.next();
    next.system_proxy = true;
    let error = apply(&backend, next, &backend.revision())
        .await
        .unwrap_err();
    assert!(error.to_string().contains("旧网络已恢复"));
    let events = backend.events();
    assert!(events.contains(&"proxy-suspended:false".into()));
    assert_eq!(events.last().unwrap(), "proxy-suspended:true");
}

// Opt-in integration driver: real bundled Mihomo + the ordinary supervisor,
// using only a private temporary directory and ephemeral loopback ports.
// It exercises the production transaction, composition, port checks,
// control channel and stop_inner; it never contacts the installed helper.
struct ProcessBackend {
    write: Mutex<()>,
    dir: tempfile::TempDir,
    core: PathBuf,
    supervisor: PathBuf,
    runtime: Mutex<Runtime>,
    fail_save: std::sync::atomic::AtomicBool,
    fail_start: std::sync::atomic::AtomicBool,
}
impl ProcessBackend {
    fn socket(&self) -> PathBuf {
        self.dir.path().join("control.sock")
    }
    fn yaml(&self, settings: &Settings) -> Result<String> {
        compose(
            "proxies: []\nproxy-groups: []\nrules: ['MATCH,DIRECT']\n",
            settings,
            &self.socket(),
        )
    }
    async fn probe(&self, upstream: u16) {
        let port = self.runtime.lock().await.port.unwrap();
        let response = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::http(format!("http://127.0.0.1:{port}")).unwrap())
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
            .get(format!("http://127.0.0.1:{upstream}/proof"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "sivio-live-proof");
    }
}
impl Backend for ProcessBackend {
    fn write(&self) -> &Mutex<()> {
        &self.write
    }
    fn read(&self) -> Result<Catalog> {
        Ok(serde_json::from_slice(&std::fs::read(
            self.dir.path().join("catalog.json"),
        )?)?)
    }
    fn save(&self, catalog: &Catalog) -> Result<()> {
        ensure!(
            !self
                .fail_save
                .swap(false, std::sync::atomic::Ordering::SeqCst),
            "injected commit failure"
        );
        atomic(
            &self.dir.path().join("catalog.json"),
            &serde_json::to_vec(catalog)?,
        )
    }
    async fn status(&self, _: &Catalog) -> Result<Status> {
        Ok(Status {
            running: self.runtime.lock().await.phase == "running",
            ..Status::default()
        })
    }
    async fn validate(&self, old: &Catalog, next: &Catalog, status: Status) -> Result<()> {
        let yaml = self.yaml(&next.settings)?;
        let stage = tempfile::tempdir_in(self.dir.path())?;
        atomic(&stage.path().join("config.yaml"), yaml.as_bytes())?;
        let output = Command::new("/usr/bin/sandbox-exec")
            .args([
                "-p",
                &runtime_sandbox::profile(&self.core, stage.path(), self.dir.path())?,
            ])
            .arg(&self.core)
            .args(["-t", "-d"])
            .arg(stage.path())
            .arg("-f")
            .arg(stage.path().join("config.yaml"))
            .output()
            .await?;
        ensure!(output.status.success(), "real core rejected candidate");
        if status.running {
            port::check_settings(&next.settings, Some(&old.settings), false)?;
            port::check_dns(&yaml, Some(&self.yaml(&old.settings)?), false)?;
        }
        Ok(())
    }
    async fn stop(&self) -> Result<()> {
        stop_inner(&mut *self.runtime.lock().await).await?;
        if self.socket().exists() {
            std::fs::remove_file(self.socket())?;
        }
        Ok(())
    }
    async fn start(&self, catalog: &Catalog, _: bool) -> Result<()> {
        port::check_settings(&catalog.settings, None, false)?;
        port::check_dns(&self.yaml(&catalog.settings)?, None, false)?;
        atomic(
            &self.dir.path().join("config.yaml"),
            self.yaml(&catalog.settings)?.as_bytes(),
        )?;
        let child = Command::new(&self.supervisor)
            .arg(&self.core)
            .arg(self.dir.path())
            .arg("stable")
            .env("SI_ASSIST_CONTROL_DIRECTORY", self.dir.path())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        let mut runtime = self.runtime.lock().await;
        runtime.child = Some(child);
        runtime.phase = "running".into();
        runtime.generation += 1;
        runtime.socket = self.socket();
        runtime.port = Some(catalog.settings.mixed_port);
        for _ in 0..60 {
            if control(&runtime, "GET", "/version", None).await.is_ok()
                && port::listeners_ready(&catalog.settings).await
                && port::dns_ready(&self.yaml(&catalog.settings)?).await
            {
                ensure!(
                    !self
                        .fail_start
                        .swap(false, std::sync::atomic::Ordering::SeqCst),
                    "injected readiness failure after launch"
                );
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        bail!("real core did not become ready")
    }
    async fn failed(&self, message: &str) {
        let mut runtime = self.runtime.lock().await;
        runtime.phase = "failed".into();
        runtime.error = Some(message.into());
    }
}

#[tokio::test]
#[ignore = "requires bundled core/supervisor and permission to run local listeners/sandbox-exec"]
async fn real_core_live_apply_and_rollback_preserve_proxy_traffic() {
    use std::io::Read as _;
    use std::net::{Ipv4Addr, TcpListener};
    use std::os::unix::fs::PermissionsExt as _;
    use std::sync::atomic::Ordering;
    let free_port = || {
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let dir = tempfile::Builder::new()
        .prefix("sivio-live-")
        .tempdir_in("/private/tmp")
        .unwrap();
    let core = dir.path().join("mihomo");
    let mut bytes = Vec::new();
    flate2::read::GzDecoder::new(
        std::fs::File::open(root.join("app/src-tauri/resources/network/mihomo.gz")).unwrap(),
    )
    .read_to_end(&mut bytes)
    .unwrap();
    assert_eq!(digest(&bytes), core_hash("stable").unwrap());
    std::fs::write(&core, bytes).unwrap();
    std::fs::set_permissions(&core, std::fs::Permissions::from_mode(0o700)).unwrap();
    let backend = ProcessBackend {
        write: Mutex::new(()),
        core,
        supervisor: root.join("build/cache/target/debug/si-network-supervisor"),
        dir,
        runtime: Default::default(),
        fail_save: false.into(),
        fail_start: false.into(),
    };
    let upstream = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        axum::serve(
            upstream,
            axum::Router::new().route(
                "/proof",
                axum::routing::get(|| async { "sivio-live-proof" }),
            ),
        )
        .await
        .unwrap();
    });
    let mut catalog = Catalog::default();
    catalog.settings.mixed_port = free_port();
    backend.save(&catalog).unwrap();
    backend.start(&catalog, false).await.unwrap();
    backend.probe(upstream_port).await;
    let revision = |catalog: &Catalog| digest(&serde_json::to_vec(&catalog.settings).unwrap());

    let old_port = catalog.settings.mixed_port;
    let mut next = catalog.settings.clone();
    next.mixed_port = free_port();
    assert_eq!(
        apply(&backend, next.clone(), &revision(&catalog))
            .await
            .unwrap()["restarted"],
        true
    );
    assert!(std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, old_port)).is_err());
    backend.probe(upstream_port).await;
    catalog = backend.read().unwrap();

    next.log_level = "debug".into();
    let dns_port = free_port();
    next.dns = format!("enable: true\nlisten: 127.0.0.1:{dns_port}\nnameserver: [1.1.1.1]");
    apply(&backend, next, &revision(&catalog)).await.unwrap();
    catalog = backend.read().unwrap();
    backend.probe(upstream_port).await;
    assert!(port::dns_ready(&backend.yaml(&catalog.settings).unwrap()).await);

    for start_failure in [false, true] {
        let mut candidate = catalog.settings.clone();
        candidate.mixed_port = free_port();
        let abandoned = candidate.mixed_port;
        if start_failure {
            backend.fail_start.store(true, Ordering::SeqCst);
        } else {
            backend.fail_save.store(true, Ordering::SeqCst);
        }
        let error = apply(&backend, candidate, &revision(&catalog))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("旧网络已恢复"), "{error:#}");
        assert_eq!(
            backend.read().unwrap().settings.mixed_port,
            catalog.settings.mixed_port
        );
        assert!(std::net::TcpStream::connect((Ipv4Addr::LOCALHOST, abandoned)).is_err());
        backend.probe(upstream_port).await;
    }
    let foreign = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let generation = backend.runtime.lock().await.generation;
    let mut candidate = catalog.settings.clone();
    candidate.mixed_port = foreign.local_addr().unwrap().port();
    assert!(apply(&backend, candidate, &revision(&catalog))
        .await
        .is_err());
    assert_eq!(backend.runtime.lock().await.generation, generation);
    backend.probe(upstream_port).await;
    let foreign_dns = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let mut dns_conflict = catalog.settings.clone();
    dns_conflict.dns = format!(
        "enable: true\nlisten: 127.0.0.1:{}\nnameserver: [1.1.1.1]",
        foreign_dns.local_addr().unwrap().port()
    );
    assert!(apply(&backend, dns_conflict, &revision(&catalog))
        .await
        .is_err());
    assert_eq!(backend.runtime.lock().await.generation, generation);
    assert!(port::dns_ready(&backend.yaml(&catalog.settings).unwrap()).await);
    let mut invalid = catalog.settings.clone();
    invalid.dns = "nameserver: [".into();
    assert!(apply(&backend, invalid, &revision(&catalog)).await.is_err());
    assert_eq!(backend.runtime.lock().await.generation, generation);
    backend.stop().await.unwrap();
    let result = apply(
        &backend,
        Settings {
            mixed_port: free_port(),
            ..catalog.settings.clone()
        },
        &revision(&catalog),
    )
    .await
    .unwrap();
    assert_eq!(result["restarted"], false);
    assert_eq!(backend.runtime.lock().await.phase, "stopped");
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn subscription_restart_and_rollback_preserve_proxy_suspension() {
    for faults in [vec![], vec!["start-new"], vec!["save-after-write"]] {
        let backend = Fake::new(true, faults.clone());
        let old = backend.read().unwrap();
        let mut next = old.clone();
        next.settings = backend.next();
        let result = apply_profile(&backend, &old, &next, true, true).await;
        assert_eq!(result.is_ok(), faults.is_empty());
        assert!(!backend.events().contains(&"proxy-suspended:false".into()));
        assert!(backend.events().contains(&"proxy-suspended:true".into()));
        assert!(*backend.running.lock().unwrap());
        assert_eq!(
            backend.read().unwrap().settings.mixed_port,
            if faults.is_empty() { 27891 } else { 7890 }
        );
    }
}

#[tokio::test]
async fn subscription_cleanup_failure_never_starts_a_second_runtime() {
    let backend = Fake::new(true, vec!["start-new", "cleanup"]);
    let old = backend.read().unwrap();
    let mut next = old.clone();
    next.settings = backend.next();
    assert!(apply_profile(&backend, &old, &next, true, false)
        .await
        .is_err());
    assert!(!backend.events().contains(&"start-old".into()));
    assert!(backend.events().contains(&"failed".into()));
}

#[tokio::test]
async fn subscription_commit_conflict_preserves_external_write_and_reports_recovery_failure() {
    let backend = Fake::new(true, vec!["external-save"]);
    let old = backend.read().unwrap();
    let mut next = old.clone();
    next.settings = backend.next();
    assert!(apply_profile(&backend, &old, &next, true, false)
        .await
        .is_err());
    assert_eq!(backend.read().unwrap().settings.mixed_port, 28888);
    assert!(!backend.events().contains(&"start-old".into()));
    assert!(backend.events().contains(&"failed".into()));
}

#[tokio::test]
async fn inactive_subscription_failure_does_not_interrupt_another_running_profile() {
    let backend = Fake::new(true, vec!["external-save"]);
    let old = backend.read().unwrap();
    let mut next = old.clone();
    next.settings = backend.next();
    assert!(apply_profile(&backend, &old, &next, false, false)
        .await
        .is_err());
    assert!(*backend.running.lock().unwrap());
    assert_eq!(backend.events(), ["save"]);
    assert_eq!(backend.read().unwrap().settings.mixed_port, 28888);
}

#[tokio::test]
async fn quick_enable_starts_even_when_saved_settings_are_unchanged() {
    let backend = Fake::new(false, vec![]);
    let result = apply_with_start(&backend, Settings::default(), &backend.revision(), true)
        .await
        .unwrap();
    assert_eq!(result["started"], true);
    assert!(*backend.running.lock().unwrap());
    assert_eq!(
        backend.events(),
        ["validate", "start-old", "proxy-suspended:false", "save"]
    );
}

#[tokio::test]
async fn quick_enable_failure_restores_stopped_state_and_never_restarts_old_core() {
    for fault in ["start-new", "save", "save-after-write"] {
        let backend = Fake::new(false, vec![fault]);
        let error = apply_with_start(&backend, backend.next(), &backend.revision(), true)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("网络保持停止"), "{error}");
        assert!(!*backend.running.lock().unwrap());
        assert_eq!(backend.read().unwrap().settings.mixed_port, 7890);
        assert!(!backend.events().contains(&"start-old".into()));
    }
    let backend = Fake::new(false, vec!["validate"]);
    assert!(
        apply_with_start(&backend, backend.next(), &backend.revision(), true)
            .await
            .is_err()
    );
    assert_eq!(backend.events(), ["validate"]);
}

#[tokio::test]
async fn explicit_enable_of_prepared_core_claims_proxy_and_rollback_keeps_previous_suspension() {
    let mut backend = Fake::new(true, vec![]);
    backend.suspended = true;
    apply_action(&backend, Settings::default(), &backend.revision(), true, true).await.unwrap();
    assert!(backend.events().contains(&"proxy-suspended:false".into()));
    let mut failed = Fake::new(true, vec!["start-new"]);
    failed.suspended = true;
    assert!(apply_action(&failed, failed.next(), &failed.revision(), true, true).await.is_err());
    assert!(failed.events().contains(&"proxy-suspended:true".into()));
}
