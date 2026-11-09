//! Sivio network domain. Mihomo and the isolated service own packet handling;
//! this module owns profiles, composition, lifecycle and the local control boundary.
use anyhow::{bail, ensure, Context, Result};
use clash_verge_service_ipc as ipc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use serde_yaml_ng::{Mapping, Value as Yaml};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};
mod dashboard;
mod delay;
pub(crate) mod legacy_import;
#[path = "../../../../native/listener_boundary.rs"]
mod listener_boundary;
mod log_stream;
mod lease;
mod media;
mod media_job;
mod metrics;
mod home;
pub(crate) mod outbound;
mod pac;
mod port;
mod profile_enhance;
mod builtin_rules;
mod core_bundle;
mod profile_documents;
mod proxy_guard;
pub(crate) mod repository;
mod settings_update;
mod service_setup;
#[path = "../../../../native/runtime_sandbox.rs"]
mod runtime_sandbox;
mod subscription;
pub(crate) mod tray_bridge;
mod enhance {
    pub mod field;
    pub mod merge;
    pub mod seq;
}
const LIMIT: usize = 16 * 1024 * 1024;
pub(crate) const KEYCHAIN_SERVICE: &str = "local.siassist.desktop.network";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomTest {
    id: String,
    name: String,
    url: String,
    #[serde(default)]
    icon: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    name: String,
    kind: String,
    revision: String,
    updated: i64,
    #[serde(default)]
    interval: u64,
    #[serde(default)]
    usage: Option<String>,
    #[serde(default)]
    last_attempt: i64,
    #[serde(default)]
    last_error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Settings {
    mixed_port: u16,
    #[serde(default)]
    port_defaults_version: u8,
    ipv6: bool,
    unified_delay: bool,
    log_level: String,
    dns_override: bool,
    tun_stack: String,
    tun_mtu: u16,
    http_port: u16,
    socks_port: u16,
    redir_port: u16,
    latency_url: String,
    latency_timeout: u64,
    auto_delay_minutes: u64,
    close_connections_on_switch: bool,
    allow_lan: bool,
    lan_username: String,
    lan_password: String,
    proxy_mode: String,
    pac_port: u16,
    pac_script: String,
    mode: String,
    core: String,
    tun: bool,
    system_proxy: bool,
    bypass: String,
    merge: String,
    script: String,
    rules: String,
    proxies: String,
    groups: String,
    dns: String,
    controller_enabled: bool,
    controller_port: u16,
    controller_secret: String,
    web_ui_list: Vec<String>,
    custom_tests: Vec<CustomTest>,
    builtin_enhanced: bool,
    bypass_check: bool,
    use_default_bypass: bool,
    proxy_guard: bool,
    proxy_guard_seconds: u64,
    proxy_host: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            mixed_port: 7890,
            port_defaults_version: 1,
            ipv6: false,
            unified_delay: true,
            log_level: "info".into(),
            dns_override: true,
            tun_stack: "system".into(),
            tun_mtu: 1500,
            http_port: 0,
            socks_port: 0,
            redir_port: 0,
            latency_url: "https://www.gstatic.com/generate_204".into(),
            latency_timeout: 5000,
            auto_delay_minutes: 0,
            close_connections_on_switch: false,
            allow_lan: false,
            lan_username: "si-assist".into(),
            lan_password: String::new(),
            proxy_mode: "global".into(),
            pac_port: 15723,
            pac_script: pac::DEFAULT_SCRIPT.into(),
            mode: "rule".into(),
            core: "stable".into(),
            tun: false,
            system_proxy: false,
            bypass: "localhost,127.*,::1".into(),
            merge: "{}".into(),
            script: "function main(config) { return config; }".into(),
            rules: "prepend: []\nappend: []\ndelete: []".into(),
            proxies: "prepend: []\nappend: []\ndelete: []".into(),
            groups: "prepend: []\nappend: []\ndelete: []".into(),
            dns: "{}".into(),
            controller_enabled: false,
            controller_port: 15724,
            controller_secret: String::new(),
            web_ui_list: Vec::new(),
            custom_tests: Vec::new(),
            builtin_enhanced: true,
            bypass_check: true,
            use_default_bypass: false,
            proxy_guard: true,
            proxy_guard_seconds: 30,
            proxy_host: "127.0.0.1".into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    #[serde(skip)]
    storage_revision: Option<String>,
    #[serde(default = "default_outbound")]
    outbound: String,
    #[serde(default)]
    custom_proxy_ref: Option<String>,
    #[serde(default)]
    schema: u32,
    #[serde(default)]
    profiles: Vec<Profile>,
    active: Option<String>,
    #[serde(default)]
    settings: Settings,
    #[serde(default)]
    selections: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            schema: 1,
            storage_revision: None,
            outbound: "direct".into(),
            custom_proxy_ref: None,
            profiles: vec![],
            active: None,
            settings: Settings::default(),
            selections: Default::default(),
        }
    }
}

struct Runtime {
    child: Option<Child>,
    session: Option<ipc::OwnerSessionProof>,
    lease: Option<lease::Heartbeat>,
    generation: u64,
    phase: String,
    error: Option<String>,
    socket: PathBuf,
    port: Option<u16>,
    managed: bool,
    tun: bool,
    active: Option<String>,
    pac: Option<tokio::task::JoinHandle<()>>,
    dashboard: Option<tokio::task::JoinHandle<()>>,
    media: Option<media_job::MediaJob>,
    last_delay: i64,
    configured_port: u16,
    recovery_required: bool,
    proxy_guard: proxy_guard::Guard,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            child: None,
            session: None,
            lease: None,
            generation: 0,
            phase: "stopped".into(),
            error: None,
            socket: PathBuf::new(),
            port: None,
            managed: false,
            tun: false,
            active: None,
            pac: None,
            dashboard: None,
            media: None,
            last_delay: 0,
            configured_port: 0,
            recovery_required: false,
            proxy_guard: Default::default(),
        }
    }
}
#[derive(Clone, Default)]
pub struct NetworkState {
    runtime: Arc<Mutex<Runtime>>,
    write: Arc<Mutex<()>>,
    ready: Arc<std::sync::atomic::AtomicBool>,
    workers_started: Arc<std::sync::atomic::AtomicBool>,
    approved_proxy_target: Arc<Mutex<Option<ipc::MacosProxyConfig>>>,
}
impl NetworkState {
    fn mark_ready(&self) -> bool {
        use std::sync::atomic::Ordering;
        self.ready.store(true, Ordering::Release);
        !self.workers_started.swap(true, Ordering::AcqRel)
    }
}
fn default_outbound() -> String {
    "direct".into()
}
fn root() -> Result<PathBuf> {
    let path = Some(crate::config::get_home_dir())
        .context("home directory unavailable")?
        .join("Library/Application Support/SI Assist/network");
    private_dir(&path)?;
    Ok(path)
}
fn private_dir(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(path)?;
    ensure!(
        !std::fs::symlink_metadata(path)?.file_type().is_symlink(),
        "private directory is a symlink"
    );
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    Ok(())
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    ensure!(bytes.len() <= LIMIT, "file exceeds 16 MiB");
    let parent = path.parent().context("missing parent")?;
    private_dir(parent)?;
    if path.exists() {
        ensure!(
            !std::fs::symlink_metadata(path)?.file_type().is_symlink(),
            "refusing symlink write"
        );
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    std::fs::set_permissions(temp.path(), {
        use std::os::unix::fs::PermissionsExt;
        std::fs::Permissions::from_mode(0o600)
    })?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)?;
    std::fs::File::open(parent)?.sync_all()?;
    Ok(())
}
fn read_catalog() -> Result<Catalog> {
    let mut catalog = match repository::catalog()? {
        Some(catalog) => catalog,
        None => read_legacy_catalog()?,
    };
    migrate_port_defaults(&mut catalog.settings);
    Ok(catalog)
}
fn migrate_port_defaults(settings: &mut Settings) {
    if settings.port_defaults_version == 0 {
        if settings.mixed_port == 15722 { settings.mixed_port = 7890; }
        settings.port_defaults_version = 1;
    }
}
fn read_legacy_catalog() -> Result<Catalog> {
    let path = root()?.join("catalog.json");
    if !path.exists() {
        return Ok(Catalog {
            schema: 1,
            ..Default::default()
        });
    }
    let bytes = std::fs::read(&path)?;
    ensure!(bytes.len() <= LIMIT, "catalog too large");
    let mut document: Value = crate::credential_vault::from_str(std::str::from_utf8(&bytes)?)?;
    if let Some(settings) = document.get_mut("settings") {
        if settings
            .as_object()
            .is_some_and(|map| map.len() == 1 && map.contains_key("config"))
        {
            *settings = settings["config"].take();
        }
    }
    let value: Catalog = serde_json::from_value(document)?;
    ensure!(value.schema <= 1, "catalog schema is newer than supported");
    Ok(value)
}
fn save_catalog(value: &Catalog) -> Result<()> {
    if repository::connected() {
        return repository::save(value);
    }
    let mut document = serde_json::to_value(value)?;
    document["settings"] = json!({"config": document["settings"].take()});
    let sealed = crate::credential_vault::to_string(&document)?;
    atomic(&root()?.join("catalog.json"), sealed.as_bytes())
}
fn secret_get(id: &str) -> Result<Value> {
    let key = if id.starts_with("profile:") {
        id.to_owned()
    } else {
        let catalog = read_catalog()?;
        let p = catalog
            .profiles
            .iter()
            .find(|p| p.id == id)
            .context("profile not found")?;
        format!("profile:{}:{}", p.id, p.revision)
    };
    if let Some(payload) = repository::payload(&key)? {
        return Ok(payload);
    }
    legacy_secret_get(&key)
}
fn legacy_secret_get(key: &str) -> Result<Value> {
    repository::staged(key)?.context(crate::credential_vault::MIGRATION_REQUIRED)
}
fn secret_set(id: &str, value: &Value) -> Result<()> {
    repository::stage(id, value.clone())
}
fn terminal_env(shell: &str, host: &str, port: u16) -> Result<String> {
    ipc::proxy_destination::validate_host(host)?;
    let host = ipc::proxy_destination::authority(host);
    let http = format!("http://{host}:{port}");
    let socks = format!("socks5://{host}:{port}");
    Ok(match shell {
        "bash" => format!("export http_proxy='{http}' https_proxy='{http}' all_proxy='{socks}'"),
        "fish" => format!("set -gx http_proxy '{http}'; set -gx https_proxy '{http}'; set -gx all_proxy '{socks}'"),
        "cmd" => format!("set http_proxy={http}\r\nset https_proxy={http}\r\nset all_proxy={socks}"),
        "powershell" => format!("$env:HTTP_PROXY='{http}'; $env:HTTPS_PROXY='{http}'; $env:ALL_PROXY='{socks}'"),
        "nushell" => format!("load-env {{ http_proxy: '{http}', https_proxy: '{http}', all_proxy: '{socks}' }}"),
        _ => bail!("Unsupported proxy command shell"),
    })
}
fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("missing {key}"))
}
fn credentials() -> Result<ipc::OwnerCredentials> {
    Ok(ipc::OwnerCredentials {
        identity: ipc::OwnerIdentity::Unix {
            uid: unsafe { libc::geteuid() },
            gid: unsafe { libc::getegid() },
        },
        app_data_dir: root()?.to_string_lossy().into_owned(),
        token: None,
    })
}
fn resource(app: &tauri::AppHandle, name: &str) -> Result<PathBuf> {
    let path = app.path().resource_dir()?.join("network").join(name);
    ensure!(
        path.is_file(),
        "bundled network resource is missing: {name}"
    );
    Ok(path)
}
fn core_hash(core: &str) -> Result<&'static str> {
    match (std::env::consts::ARCH, core) {
        ("aarch64", "stable") => {
            Ok("4b72628bd46113be90b63a18c483bbb55a7f9395e396926a2b0a99905d4f2386")
        }
        ("aarch64", "alpha") => {
            Ok("f0d0d1eeb92137e0a28fc23612494c648ea919fb9bed2891ffd81d10453a8961")
        }
        ("x86_64", "stable") => {
            Ok("55bca124906a40a7140ee7537a305b34c2c31806f3d724629089dc2960ea0993")
        }
        ("x86_64", "alpha") => {
            Ok("baa7f8ae796a4491cc2378d2e5081e8f68aa368ce5455d8320413be3318c21a4")
        }
        _ => bail!("unsupported core/architecture"),
    }
}
fn checked_core(app: &tauri::AppHandle, channel: &str) -> Result<PathBuf> {
    core_bundle::checked(
        &app.path().resource_dir()?.join("network/mihomo-cores.xz"),
        &root()?.join("cores"),
        channel,
    )
}

fn compose(yaml: &str, settings: &Settings, socket: &Path) -> Result<String> {
    compose_with_profile(yaml, settings, socket, None, "Sivio")
}
fn compose_with_profile(
    yaml: &str,
    settings: &Settings,
    socket: &Path,
    enhancement: Option<&Value>,
    name: &str,
) -> Result<String> {
    ensure!(yaml.len() <= LIMIT, "profile exceeds 16 MiB");
    ensure!(
        !yaml.contains(crate::portable_credentials::MISSING),
        "This profile needs its credentials or subscription URL re-entered after portable restore"
    );
    let config: Mapping =
        serde_yaml_ng::from_str(yaml).context("profile must be a YAML mapping")?;
    let mut config = profile_enhance::apply(config, settings, enhancement, name)?;
    if settings.builtin_enhanced {
        // CV baseline builtin meta_hy_alpn / meta_guard, GPL-3.0.
        if let Some(Yaml::Sequence(proxies)) = config.get_mut("proxies") {
            for proxy in proxies {
                let Some(proxy) = proxy.as_mapping_mut() else {
                    continue;
                };
                if proxy["type"].as_str() == Some("hysteria") {
                    if let Some(alpn) = proxy["alpn"].as_str().map(str::to_owned) {
                        proxy["alpn"] = Yaml::Sequence(vec![Yaml::String(alpn)]);
                    }
                }
            }
        }
        if config.get("mode").and_then(Yaml::as_str) == Some("script") {
            config.insert("mode".into(), "rule".into());
        }
    }
    // GUI control fields are authoritative after all untrusted transformations.
    for key in [
        "external-controller",
        "external-controller-pipe",
        "external-controller-tls",
        "external-ui",
        "external-ui-url",
        "external-ui-name",
        "secret",
        "port",
        "socks-port",
        "redir-port",
        "tproxy-port",
    ] {
        config.remove(key);
    }
    ensure!(
        settings.mixed_port > 1024
            && ![16721, crate::proxy::http_client::get_proxy_port()].contains(&settings.mixed_port),
        "choose an unprivileged port distinct from the AI router"
    );
    ensure!(
        ["rule", "global", "direct"].contains(&settings.mode.as_str()),
        "invalid mode"
    );
    config.insert("mixed-port".into(), settings.mixed_port.into());
    let mut ports = std::collections::BTreeSet::from([
        settings.mixed_port,
        16721,
        crate::proxy::http_client::get_proxy_port(),
    ]);
    for (key, port) in [
        ("port", settings.http_port),
        ("socks-port", settings.socks_port),
        ("redir-port", settings.redir_port),
    ] {
        if port != 0 {
            ensure!(
                port > 1024 && ports.insert(port),
                "listener ports must be distinct and unprivileged"
            );
            config.insert(key.into(), port.into());
        }
    }
    ensure!(
        ["global", "pac"].contains(&settings.proxy_mode.as_str()),
        "invalid system proxy mode"
    );
    if settings.proxy_mode == "pac" {
        ensure!(
            settings.pac_port > 1024 && ports.insert(settings.pac_port),
            "PAC port must be distinct and unprivileged"
        );
        pac::validate(&settings.pac_script)?;
    }
    ipc::proxy_destination::validate_host(&settings.proxy_host)?;
    proxy_guard::validate(settings)?;
    dashboard::validate(settings)?;
    if settings.controller_enabled {
        ensure!(
            ports.insert(settings.controller_port),
            "Controller port must be distinct from proxy, PAC and AI ports"
        );
    }
    ensure!(
        settings.custom_tests.len() <= 30,
        "At most 30 custom connectivity tests"
    );
    let mut test_ids = std::collections::BTreeSet::new();
    for test in &settings.custom_tests {
        ensure!(
            !test.id.is_empty()
                && test.id.len() <= 100
                && test_ids.insert(&test.id)
                && !test.name.trim().is_empty()
                && test.name.len() <= 200
                && test.url.len() <= 2048
                && test.icon.len() <= 2048,
            "Invalid or duplicate custom connectivity test"
        );
        let url = url::Url::parse(&test.url)?;
        ensure!(
            ["http", "https"].contains(&url.scheme())
                && url.host_str().is_some()
                && url.username().is_empty()
                && url.password().is_none(),
            "Connectivity tests need HTTP(S) URLs without credentials"
        );
    }
    config.insert("allow-lan".into(), settings.allow_lan.into());
    let latency = url::Url::parse(&settings.latency_url).context("invalid latency test URL")?;
    ensure!(
        ["https", "http"].contains(&latency.scheme()) && latency.host_str().is_some(),
        "latency test URL must be HTTP(S)"
    );
    ensure!(
        (100..=5000).contains(&settings.latency_timeout),
        "latency timeout must be 100–5000 ms"
    );
    ensure!(
        settings.auto_delay_minutes <= 1440,
        "automatic latency interval must be 0–1440 minutes"
    );
    config.insert(
        "bind-address".into(),
        if settings.allow_lan { "*" } else { "127.0.0.1" }.into(),
    );
    config.remove("authentication");
    if settings.allow_lan {
        ensure!(
            !settings.lan_username.is_empty()
                && !settings.lan_username.contains(':')
                && settings.lan_password.len() >= 16,
            "LAN access needs a username and a password of at least 16 bytes"
        );
        config.insert(
            "authentication".into(),
            vec![Yaml::from(format!(
                "{}:{}",
                settings.lan_username, settings.lan_password
            ))]
            .into(),
        );
    }
    config.insert(
        "skip-auth-prefixes".into(),
        vec![Yaml::from("127.0.0.0/8"), Yaml::from("::1/128")].into(),
    );
    ensure!(["silent", "error", "warning", "info", "debug"].contains(&settings.log_level.as_str()), "invalid log level");
    ensure!(["system", "gvisor", "mixed"].contains(&settings.tun_stack.as_str()), "invalid TUN stack");
    ensure!((1280..=9000).contains(&settings.tun_mtu), "TUN MTU must be 1280–9000");
    config.insert("ipv6".into(), settings.ipv6.into());
    config.insert("unified-delay".into(), settings.unified_delay.into());
    config.insert("log-level".into(), settings.log_level.clone().into());
    config.insert("mode".into(), settings.mode.clone().into());
    config.insert(
        "external-controller-unix".into(),
        socket.to_string_lossy().to_string().into(),
    );
    config.insert("secret".into(), "".into());
    config.insert(
        "profile".into(),
        serde_yaml_ng::from_str::<Yaml>("store-selected: true\nstore-fake-ip: true")?,
    );
    let mut tun = config
        .remove("tun")
        .and_then(|v| v.as_mapping().cloned())
        .unwrap_or_default();
    tun.insert("stack".into(), settings.tun_stack.clone().into());
    tun.insert("mtu".into(), settings.tun_mtu.into());
    tun.insert("enable".into(), settings.tun.into());
    tun.insert("auto-route".into(), settings.tun.into());
    tun.insert("auto-detect-interface".into(), true.into());
    let mut excluded = tun
        .get("route-exclude-address")
        .and_then(Yaml::as_sequence)
        .cloned()
        .unwrap_or_default();
    for value in ["127.0.0.0/8", "::1/128"] {
        if !excluded.iter().any(|v| v.as_str() == Some(value)) {
            excluded.push(value.into());
        }
    }
    tun.insert("route-exclude-address".into(), excluded.into());
    config.insert("tun".into(), tun.into());
    listener_boundary::apply(&mut config)?;
    port::validate_dns_ports(&config, settings)?;
    validate_paths(&config)?;
    validate_proxy_graph(&config)?;
    let composed = serde_yaml_ng::to_string(&config)?;
    ensure!(!composed.contains(crate::portable_credentials::MISSING),"Configuration needs credentials re-entered after portable restore; missing values cannot be used as real credentials");
    Ok(composed)
}
fn validate_paths(config: &Mapping) -> Result<()> {
    for field in ["proxy-providers", "rule-providers"] {
        if let Some(providers) = config.get(field).and_then(Yaml::as_mapping) {
            for (_, provider) in providers {
                if let Some(path) = provider.get("path").and_then(Yaml::as_str) {
                    let path = Path::new(path);
                    ensure!(
                        !path.is_absolute()
                            && path
                                .components()
                                .all(|c| matches!(c, std::path::Component::Normal(_))),
                        "provider path must stay inside the managed runtime"
                    );
                }
                if let Some(url) = provider.get("url").and_then(Yaml::as_str) {
                    let parsed = url::Url::parse(url)?;
                    ensure!(
                        ["https", "http"].contains(&parsed.scheme()),
                        "unsupported provider URL scheme"
                    );
                }
            }
        }
    }
    Ok(())
}
/// Reject selector/dialer cycles before asking Mihomo to publish any listener.
fn validate_proxy_graph(config: &Mapping) -> Result<()> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for (field, list_key) in [("proxies", "dialer-proxy"), ("proxy-groups", "proxies")] {
        if let Some(items) = config.get(field).and_then(Yaml::as_sequence) {
            for item in items {
                let name = item
                    .get("name")
                    .and_then(Yaml::as_str)
                    .context("proxy/group needs a name")?;
                let next = if list_key == "proxies" {
                    item.get(list_key)
                        .and_then(Yaml::as_sequence)
                        .map(|v| {
                            v.iter()
                                .filter_map(Yaml::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                } else {
                    item.get(list_key)
                        .and_then(Yaml::as_str)
                        .map(|s| vec![s.to_owned()])
                        .unwrap_or_default()
                };
                ensure!(
                    edges.insert(name.into(), next).is_none(),
                    "proxy/group names must be unique"
                );
            }
        }
    }
    fn visit(
        name: &str,
        edges: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
    ) -> Result<()> {
        if done.contains(name) || !edges.contains_key(name) {
            return Ok(());
        }
        ensure!(
            visiting.insert(name.into()),
            "proxy dialer/selector cycle detected"
        );
        // A long chain is invalid rather than risking a recursive stack overflow.
        ensure!(
            visiting.len() <= 128,
            "proxy dependency chain exceeds 128 levels"
        );
        for child in &edges[name] {
            visit(child, edges, visiting, done)?;
        }
        visiting.remove(name);
        done.insert(name.into());
        Ok(())
    }
    let mut done = BTreeSet::new();
    for name in edges.keys() {
        visit(name, &edges, &mut BTreeSet::new(), &mut done)?;
    }
    Ok(())
}
async fn validate_core(core: &Path, yaml: &str) -> Result<()> {
    let dir = tempfile::tempdir_in(root()?)?;
    atomic(&dir.path().join("config.yaml"), yaml.as_bytes())?;
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new("/usr/bin/sandbox-exec")
            .args([
                "-p",
                &runtime_sandbox::profile(core, dir.path(), dir.path())?,
            ])
            .arg(core)
            .kill_on_drop(true)
            .args(["-t", "-d"])
            .arg(dir.path())
            .arg("-f")
            .arg(dir.path().join("config.yaml"))
            .output(),
    )
    .await
    .context("Mihomo validation timed out")??;
    ensure!(
        output.status.success(),
        "Mihomo rejected configuration ({}); check YAML fields and proxy references. Raw output is withheld because it can contain credentials.", output.status
    );
    Ok(())
}
async fn fetch(
    url: &str,
    port: Option<u16>,
    options: &subscription::Options,
) -> Result<(String, Option<String>)> {
    let url = url::Url::parse(url)?;
    ensure!(
        ["https", "http"].contains(&url.scheme()),
        "subscription URL must be HTTP(S)"
    );
    let response = options
        .client(port)?
        .get(url)
        .header("User-Agent", &options.user_agent)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("subscription request failed (URL hidden)"))?
        .error_for_status()
        .map_err(|e| anyhow::anyhow!("subscription HTTP status {:?}", e.status()))?;
    ensure!(
        response.content_length().unwrap_or(0) <= LIMIT as u64,
        "subscription exceeds 16 MiB"
    );
    let usage = response
        .headers()
        .get("subscription-userinfo")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut stream = response.bytes_stream();
    use futures::StreamExt;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| anyhow::anyhow!("subscription stream failed"))?;
        ensure!(
            bytes.len() + chunk.len() <= LIMIT,
            "subscription exceeds 16 MiB"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok((String::from_utf8(bytes)?, usage))
}
fn redacted_logs(lines: Vec<String>, active: Option<&str>) -> Result<Vec<String>> {
    let mut secrets = Vec::new();
    fn collect(value: &Yaml, key: &str, output: &mut Vec<String>) {
        match value {
            Yaml::Mapping(map) => {
                for (key, value) in map {
                    collect(value, key.as_str().unwrap_or(""), output);
                }
            }
            Yaml::Sequence(items) => {
                for item in items {
                    collect(item, key, output);
                }
            }
            Yaml::String(text) => {
                let key = key.to_ascii_lowercase().replace(['-', '_'], "");
                if !text.is_empty()
                    && ([
                        "password",
                        "token",
                        "secret",
                        "uuid",
                        "privatekey",
                        "apikey",
                    ]
                    .iter()
                    .any(|part| key.contains(part))
                        || key == "url")
                {
                    output.push(text.clone());
                }
            }
            _ => {}
        }
    }
    let catalog = read_catalog()?;
    if !catalog.settings.lan_password.is_empty() {
        secrets.push(catalog.settings.lan_password);
    }
    if let Some(id) = active {
        let profile = secret_get(id)?;
        if let Some(url) = profile
            .get("url")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            secrets.push(url.into());
        }
        let value: Yaml = serde_yaml_ng::from_str(text(&profile, "yaml")?)
            .context("cannot safely redact logs from an invalid profile")?;
        collect(&value, "", &mut secrets);
    }
    Ok(lines
        .into_iter()
        .map(|line| crate::redact_known_secrets_strict(&line, &secrets))
        .collect())
}
#[derive(Clone)]
struct ControlTarget {
    socket: PathBuf,
    managed: bool,
    session: Option<ipc::OwnerSessionProof>,
}
impl From<&Runtime> for ControlTarget {
    fn from(runtime: &Runtime) -> Self {
        Self { socket: runtime.socket.clone(), managed: runtime.managed, session: runtime.session.clone() }
    }
}
async fn control(runtime: &Runtime, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    ensure!(runtime.phase == "running", "network core is not running");
    control_at(&ControlTarget::from(runtime), method, path, body).await
}
async fn control_at(runtime: &ControlTarget, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    let request = ipc::MihomoControlRequest {
        method: method.into(),
        path: path.into(),
        body: body.clone(),
    };
    ipc::validate_mihomo_control(&request)?;
    if runtime.managed {
        let response = ipc::control_mihomo(
            &credentials()?,
            runtime
                .session
                .as_ref()
                .context("owner proof unavailable")?,
            &request,
        )
        .await?;
        ensure!(
            response.code == 0,
            "managed control rejected: {}",
            response.message
        );
        return response.data.context("managed control omitted result");
    }
    if ["/traffic", "/memory"].contains(&path) {
        return ipc::read_mihomo_metric(&runtime.socket, path).await;
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .unix_socket(runtime.socket.clone())
        .timeout(Duration::from_secs(15))
        .build()?;
    let mut request = client.request(method.parse()?, format!("http://localhost{path}"));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("network core control connection failed"))?;
    ensure!(
        response.status().is_success(),
        "Mihomo API returned {}",
        response.status()
    );
    if response.status() == 204 {
        return Ok(json!({"ok":true}));
    }
    let text = response.text().await?;
    if text.is_empty() {
        Ok(json!({"ok":true}))
    } else {
        Ok(serde_json::from_str(&text)?)
    }
}
async fn stop_inner(runtime: &mut Runtime) -> Result<()> {
    if let Err(error) = stop_resources(runtime).await {
        runtime.phase = "failed".into();
        runtime.recovery_required = true;
        runtime.error = Some(format!("Network cleanup incomplete; retry stop before starting: {error}"));
        return Err(error);
    }
    Ok(())
}
async fn stop_resources(runtime: &mut Runtime) -> Result<()> {
    if let Some(job) = &mut runtime.media {
        job.cancel();
    }
    outbound::core(None, runtime.generation, false);
    if let Some(session) = &runtime.session {
        let response = ipc::stop_clash(&credentials()?, session).await?;
        if response.code != 0 {
            service_setup::require_current_app().await?;
            let status = ipc::get_status(&credentials()?).await?;
            let previous_gone = status.code == 0
                && status.data.as_ref().is_some_and(|s| {
                    !s.is_active || s.active_generation != Some(session.generation)
                });
            ensure!(previous_gone, "helper stop failed: {}", response.message);
        }
    }
    if let Some(child) = &mut runtime.child {
        if child.try_wait()?.is_none() {
            drop(child.stdin.take());
            tokio::time::timeout(Duration::from_secs(4), child.wait())
                .await
                .context("ordinary core guard did not confirm cleanup")??;
        }
    }
    if !runtime.managed {
        if let Some(parent) = runtime.socket.parent() {
            if parent.to_string_lossy().starts_with("/tmp/si-assist-") {
                let _ = std::fs::remove_file(&runtime.socket);
                let _ = std::fs::remove_dir(parent);
            }
        }
    }
    if let Some(server) = runtime.dashboard.take() {
        server.abort();
        let _ = server.await;
    }
    if let Some(server) = runtime.pac.take() {
        server.abort();
        let _ = server.await;
    }
    runtime.child = None;
    runtime.lease = None;
    runtime.session = None;
    runtime.port = None;
    runtime.active = None;
    runtime.managed = false;
    runtime.tun = false;
    runtime.phase = "stopped".into();
    runtime.recovery_required = false;
    runtime.error = None;
    runtime.proxy_guard = Default::default();
    Ok(())
}
pub async fn begin_restore<'a>(
    state: &'a NetworkState,
    app_state: &crate::store::AppState,
) -> Result<tokio::sync::MutexGuard<'a, ()>> {
    ensure!(
        !app_state.proxy_service.is_running().await,
        "Stop Sivio AI routing before restoring application data"
    );
    // A stopped workspace with unreadable legacy configuration must still be
    // recoverable by import. Never bypass the running-network/AI checks.
    let guard = state.write.lock().await;
    ensure!(
        state.runtime.lock().await.phase == "stopped",
        "Stop Sivio network before restoring application data"
    );
    Ok(guard)
}
pub fn reload_preferences() -> Result<()> {
    let catalog = read_catalog()?;
    let custom = repository::custom(&catalog)?;
    let valid = outbound::validate(&catalog.outbound, custom.as_deref());
    outbound::configure(&catalog.outbound, if valid.is_ok() { custom } else { None });
    Ok(())
}
pub(crate) async fn prepare_update(state: &NetworkState) -> Result<tokio::sync::MutexGuard<'_, ()>> {
    let guard = state.write.lock().await;
    stop_inner(&mut *state.runtime.lock().await).await?;
    Ok(guard)
}
pub(crate) async fn resume_after_update_failure(app: &tauri::AppHandle, state: &NetworkState) {
    service_setup::prepare_on_launch(app, state).await;
}
pub async fn shutdown(state: &NetworkState) -> Result<()> {
    stop_inner(&mut *state.runtime.lock().await).await
}
pub async fn shutdown_for_exit(state: &NetworkState) -> Result<()> {
    let _write = state.write.lock().await;
    shutdown(state).await
}
fn require_compatible_helper(info: &ipc::ProtocolInfo) -> Result<()> {
    ensure!(info.supports_client(ipc::ProtocolVersion::current(), ipc::MIN_REQUIRED_SERVICE_REVISION),
        "Sivio 服务需要升级到 revision 13。请在网络设置中安装 / 修复服务，完成系统授权后重试。");
    Ok(())
}
async fn managed_mode(settings: &Settings) -> Result<bool> {
    let helper = ipc::get_status(&credentials()?)
        .await
        .ok()
        .filter(|r| r.code == 0);
    let version = ipc::get_version().await.ok().and_then(|response| response.data);
    let managed = helper.is_some() && version.as_ref().is_some_and(|info| require_compatible_helper(info).is_ok());
    if (settings.system_proxy
        && ipc::proxy_destination::needs_revision9(&settings.proxy_host))
        || (managed && settings.controller_enabled)
    {
        let version = ipc::get_version().await?;
        ensure!(version.data.is_some_and(|info|info.protocol.epoch==ipc::PROTOCOL_EPOCH && info.protocol.revision>=9), "Custom system proxy hosts require Sivio helper revision 9; install or repair the bundled service first");
    }
    if (settings.tun || settings.system_proxy) && !managed {
        let version = ipc::get_version().await.ok().and_then(|response| response.data);
        if let Some(version) = version {
            require_compatible_helper(&version)?;
            bail!("Sivio 服务已安装，但尚未登记当前 App。请在网络设置中安装 / 修复服务，完成系统授权后重试。");
        }
        bail!("系统代理与 TUN 需要 Sivio 自有服务。请在网络设置中安装 / 修复服务，完成系统授权后重试。");
    }
    Ok(managed)
}

async fn approve_proxy_destination(app: &tauri::AppHandle, state: &NetworkState, settings: &Settings) -> Result<()> {
    if settings.system_proxy
        && ipc::proxy_destination::needs_revision9(&settings.proxy_host)
        && settings.proxy_host != "localhost"
    {
        let target = proxy_guard::config(&settings);
        let mut approved = state.approved_proxy_target.lock().await;
        if approved.as_ref() != Some(&target) {
            let handle = app.clone();
            let destination = settings.proxy_host.clone();
            let accepted=tauri::async_runtime::spawn_blocking(move || {
                use tauri_plugin_dialog::{DialogExt,MessageDialogButtons};
                handle.dialog().message(format!("将本机系统代理指向 {destination}。该目标可能位于其他设备，将接收系统代理流量。请确认它由你管理并且可信。\n\nRoute system proxy traffic to {destination}. This destination may be another device and will receive system proxy traffic. Approve only a destination you trust.")).title("确认系统代理目标 / Confirm proxy destination").buttons(MessageDialogButtons::OkCancel).blocking_show()
            }).await?;
            ensure!(accepted, "Custom system proxy destination was not approved");
            *approved = Some(target);
        }
    }
    Ok(())
}

async fn start(app: &tauri::AppHandle, state: &NetworkState, catalog: &Catalog) -> Result<Value> {
    service_setup::ensure_ready(app, &catalog.settings).await?;
    start_with_proxy_policy(app, state, catalog, StartPolicy::default()).await
}

#[derive(Default)]
struct StartPolicy {
    expired_generation: Option<u64>,
    suspend_proxy: bool,
    destination_approved: bool,
}

async fn start_with_proxy_policy(app: &tauri::AppHandle, state: &NetworkState, catalog: &Catalog, policy: StartPolicy) -> Result<Value> {
    let id = catalog.active.as_ref().context("select a profile first")?;
    let data = secret_get(id)?;
    let yaml = text(&data, "yaml")?;
    let core = checked_core(app, &catalog.settings.core)?;
    let mut runtime = state.runtime.lock().await;
    ensure!(!runtime.recovery_required, "网络恢复尚未完成，请先清理并停止");
    ensure!(runtime.child.is_none() && runtime.session.is_none() && runtime.pac.is_none() && runtime.dashboard.is_none(),
        "Previous network resources still require cleanup; stop before starting");
    ensure!(
        runtime.phase == "stopped" || runtime.phase == "failed",
        "stop network before applying a new runtime"
    );
    let mut requirements = catalog.settings.clone();
    if policy.suspend_proxy { requirements.system_proxy = false; }
    let managed = managed_mode(&requirements).await?;
    ensure!(policy.expired_generation.is_none() || managed, "网络服务尚未恢复");
    port::check_settings(&catalog.settings, None, managed)?;
    let socket = if managed {
        PathBuf::from(ipc::mihomo_ipc_path(&credentials()?.identity))
    } else {
        let directory = PathBuf::from(format!(
            "/tmp/si-assist-{}-{}",
            unsafe { libc::geteuid() },
            uuid::Uuid::new_v4().simple()
        ));
        directory.join("control.sock")
    };
    let name = catalog
        .profiles
        .iter()
        .find(|profile| profile.id == *id)
        .map(|p| p.name.as_str())
        .unwrap_or("Sivio");
    let yaml = compose_with_profile(
        yaml,
        &catalog.settings,
        &socket,
        data.get("enhancement"),
        name,
    )?;
    validate_core(&core, &yaml).await?;
    port::check_dns(&yaml, None, managed)?;
    if !policy.suspend_proxy && !policy.destination_approved {
        approve_proxy_destination(app, state, &catalog.settings).await?;
    }
    runtime.generation += 1;
    runtime.phase = "starting".into();
    runtime.recovery_required = false;
    runtime.error = None;
    // Record ownership before allocating listeners/processes, so any partial
    // launch is cleaned against this run's paths rather than the previous run.
    runtime.socket = socket.clone();
    runtime.managed = managed;
    let result = async {
        if !managed {
            private_dir(socket.parent().context("control directory unavailable")?)?;
        }
        if catalog.settings.system_proxy && catalog.settings.proxy_mode == "pac" {
            runtime.pac = Some(
                pac::start(
                    catalog.settings.pac_port,
                    catalog.settings.mixed_port,
                    &catalog.settings.pac_script,
                )
                .await?,
            );
        }
        if managed {
            let channel = &catalog.settings.core;
            let rootcore = ipc::service_paths()?
                .core_dir()
                .join(if channel == "alpha" {
                    "verge-mihomo-alpha"
                } else {
                    "verge-mihomo"
                });
            let mut random = [0u8; 32];
            use std::io::Read;
            std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
            let token = random
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            let providers = remote_providers(&yaml)?;
            let proxy = catalog
                .settings
                .system_proxy
                .then_some(())
                .filter(|_| !policy.suspend_proxy)
                .map(|_| proxy_guard::config(&catalog.settings));
            let owner = credentials()?;
            let request = ipc::StartClashRequest {
                runtime: ipc::RuntimeBundle {
                    yaml: yaml.clone(),
                    assets: vec![],
                    remote_providers: providers,
                    core_path: rootcore.to_string_lossy().into_owned(),
                },
                proposed_session_token: token.clone(),
                macos_proxy: proxy,
            };
            let response = match policy.expired_generation {
                Some(expired) => ipc::reconnect_clash(&owner, expired, &request).await?,
                None => ipc::start_clash(&owner, &request).await?,
            };
            ensure!(
                response.code == 0,
                "helper start failed: {}",
                response.message
            );
            let proof = ipc::OwnerSessionProof {
                generation: response
                    .data
                    .context("helper omitted owner proof")?
                    .session
                    .generation,
                token,
            };
            runtime.lease = Some(lease::Heartbeat::start(owner, proof.clone()));
            runtime.session = Some(proof);
        } else {
            let work = root()?.join("runtime");
            private_dir(&work)?;
            atomic(&work.join("config.yaml"), yaml.as_bytes())?;
            let mut command = Command::new(resource(app, "si-network-supervisor")?);
            command
                .arg(&core)
                .arg(&work)
                .arg(&catalog.settings.core)
                .env(
                    "SI_ASSIST_CONTROL_DIRECTORY",
                    socket.parent().context("control directory unavailable")?,
                )
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(false);
            runtime.child = Some(command.spawn()?);
        }
        runtime.socket = socket;
        runtime.port = Some(catalog.settings.mixed_port);
        runtime.configured_port = catalog.settings.mixed_port;
        runtime.managed = managed;
        runtime.active = Some(id.clone());
        runtime.tun = catalog.settings.tun;
        runtime.phase = "running".into();
        runtime.last_delay = 0;
        runtime.proxy_guard = proxy_guard::Guard::configured(&catalog.settings);
        runtime.proxy_guard.tripped = policy.suspend_proxy && catalog.settings.system_proxy;
        tokio::time::timeout(Duration::from_secs(10), async {
            for _ in 0..40 {
                if control(&runtime, "GET", "/version", None).await.is_ok()
                    && port::listeners_ready(&catalog.settings).await
                    && port::dns_ready(&yaml).await {
                    outbound::ready(
                        runtime.port,
                        runtime.generation,
                        runtime.socket.clone(),
                        runtime.session.clone(),
                    );
                    if catalog.settings.controller_enabled {
                        runtime.dashboard = Some(
                            dashboard::start(app, state, &catalog.settings, runtime.generation)
                                .await?,
                        );
                    }
                    schedule_selection_restore(state.clone(), id.clone(), runtime.generation);
                    return Ok(json!({"generation":runtime.generation,"managed":managed}));
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            bail!("core started but its control socket did not become ready")
        })
        .await
        .context("core control did not become ready within 10 seconds")?
    }
    .await;
    if let Err(error) = &result {
        let message = error.to_string();
        let cleanup = stop_inner(&mut runtime).await;
        runtime.phase = "failed".into();
        runtime.error = Some(match cleanup {
            Ok(()) => message,
            Err(error) => format!("{message}; cleanup incomplete: {error}"),
        });
    }
    result
}
fn schedule_selection_restore(state: NetworkState, id: String, generation: u64) {
    tauri::async_runtime::spawn(async move {
        for attempt in 0..15 {
            let Ok(catalog) = read_catalog() else { return };
            let groups = catalog
                .selections
                .get(&id)
                .map(|values| values.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let mut pending = 0;
            for group in groups {
                // Serialize each choice with manual selection, but yield the
                // runtime lock between groups so lease renewal is not delayed.
                let _write = state.write.lock().await;
                if crate::update_install::installing() { return; }
                let Ok(latest) = read_catalog() else { return };
                let Some(node) = latest.selections.get(&id).and_then(|map| map.get(&group)) else {
                    continue;
                };
                let runtime = state.runtime.lock().await;
                if runtime.phase != "running"
                    || runtime.generation != generation
                    || runtime.active.as_deref() != Some(&id)
                {
                    return;
                }
                let path = format!(
                    "/proxies/{}",
                    group
                        .as_bytes()
                        .iter()
                        .map(|byte| format!("%{byte:02X}"))
                        .collect::<String>()
                );
                let result = async {
                    let current = control(&runtime, "GET", &path, None).await?;
                    if current["now"].as_str() == Some(node) {
                        return Ok::<(), anyhow::Error>(());
                    }
                    ensure!(
                        current["all"].as_array().is_some_and(|nodes| nodes
                            .iter()
                            .any(|value| value.as_str() == Some(node))),
                        "saved node is not available yet"
                    );
                    control(&runtime, "PUT", &path, Some(json!({"name":node}))).await?;
                    Ok(())
                }
                .await;
                if result.is_err() {
                    pending += 1;
                }
            }
            if pending == 0 {
                return;
            }
            if attempt == 14 {
                let mut runtime = state.runtime.lock().await;
                if runtime.generation == generation && runtime.phase == "running" {
                    runtime.error=Some("Some saved node selections are unavailable. Review the proxy groups; saved choices were retained.".into());
                }
            } else {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    });
}
fn remote_providers(yaml: &str) -> Result<Vec<ipc::RemoteProvider>> {
    let config: Mapping = serde_yaml_ng::from_str(yaml)?;
    let mut providers = Vec::new();
    for field in ["proxy-providers", "rule-providers"] {
        if let Some(map) = config.get(field).and_then(Yaml::as_mapping) {
            for (_, item) in map {
                if let (Some(path), Some(url)) = (
                    item.get("path").and_then(Yaml::as_str),
                    item.get("url").and_then(Yaml::as_str),
                ) {
                    providers.push(ipc::RemoteProvider {
                        destination: path.into(),
                        url: url.into(),
                    });
                }
            }
        }
    }
    Ok(providers)
}
/// Fetch and validate before committing a new revision. If activating it fails, restore the previous revision/runtime.
async fn refresh_profile(
    app: &tauri::AppHandle,
    state: &NetworkState,
    id: &str,
    managed: bool,
) -> Result<Value> {
    refresh_profile_route(app, state, id, managed, None).await
}
async fn refresh_profile_route(app: &tauri::AppHandle, state: &NetworkState, id: &str, managed: bool, via: Option<&str>) -> Result<Value> {
    let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
    let old = read_catalog()?;
    let record = old
        .profiles
        .iter()
        .find(|p| p.id == id)
        .context("profile not found")?;
    ensure!(
        record.kind == "remote",
        "only remote subscriptions can update"
    );
    let mut payload = secret_get(id)?;
    let mut request_options: subscription::Options = payload
        .get("requestOptions")
        .map(|v| serde_json::from_value(v.clone()))
        .transpose()?
        .unwrap_or_default();
    if let Some(via) = via {
        ensure!(["direct", "system-proxy", "managed-network"].contains(&via), "Invalid subscription download route");
        request_options.via = via.into();
    }
    let port = if (via.is_none() && managed) || request_options.via == "managed-network" {
        let runtime = state.runtime.lock().await;
        control(&runtime, "GET", "/version", None).await?;
        runtime.port
    } else {
        None
    };
    let (yaml, usage) = fetch(text(&payload, "url")?, port, &request_options).await?;
    let composed = compose_with_profile(
        &yaml,
        &old.settings,
        Path::new("/tmp/si-validation.sock"),
        payload.get("enhancement"),
        &record.name,
    )?;
    validate_core(&checked_core(app, &old.settings.core)?, &composed).await?;
    let revision = uuid::Uuid::new_v4().to_string();
    let key = format!("profile:{id}:{revision}");
    payload["yaml"] = json!(yaml);
    let (restart, managed_running, tripped) = {
        let runtime = state.runtime.lock().await;
        ensure!(["running", "stopped"].contains(&runtime.phase.as_str()), "Clean up the failed network before updating a subscription");
        let restart = runtime.active.as_deref() == Some(id) && runtime.phase == "running";
        (restart, restart && runtime.managed, runtime.proxy_guard.tripped)
    };
    let suspend_proxy = proxy_guard::suspended(&old.settings, managed_running, tripped).await?;
    secret_set(&key, &payload)?;
    let mut next = old.clone();
    let profile = next.profiles.iter_mut().find(|p| p.id == id).unwrap();
    profile.revision = revision.clone();
    profile.updated = chrono::Utc::now().timestamp();
    profile.last_attempt = profile.updated;
    profile.last_error = None;
    profile.usage = usage;
    let activation = settings_update::activate_profile(app, state, &old, &next, restart, suspend_proxy).await;
    let _ = repository::discard(&key);
    activation?;
    let _ = repository::discard(&format!("profile:{id}:{}", record.revision));
    Ok(json!({"updated":true,"revision":revision,"restarted":restart}))
}
async fn install(app: &tauri::AppHandle) -> Result<Value> {
    // Reinstalling a service cannot repair the signature of an overwritten process.
    service_setup::require_current_app().await?;
    let core = checked_core(app, "stable")?;
    let alpha = checked_core(app, "alpha")?;
    let output = Command::new("/usr/bin/codesign")
        .args(["-d", "--verbose=4"])
        .arg(std::env::current_exe()?)
        .output()
        .await?;
    ensure!(
        output.status.success(),
        "application must be signed before service installation"
    );
    let signature = String::from_utf8(output.stderr)?;
    let hash = signature
        .lines()
        .find_map(|line| line.strip_prefix("CDHash="))
        .context("application signature omitted CDHash")?;
    let requirement = Command::new("/usr/bin/codesign").args(["-d", "-r-"]).arg(std::env::current_exe()?).output().await?;
    let requirement = String::from_utf8(requirement.stdout)?;
    // The preparation switch must be first; signer arguments follow it.
    let mut signer_args = Vec::new();
    if let Some(pin) = service_setup::signer_pin(&requirement) { signer_args.extend(["--client-signer", pin]); }
    let status = Command::new(resource(app, "sivio-helper-install")?)
        .arg("--prepare-install").args(signer_args)
        .args([
            "--prompt",
            "Sivio 安装独立网络服务，供 TUN、系统代理恢复使用",
            "--client-cdhash",
            hash,
            "--core",
            "verge-mihomo",
        ])
        .arg(core)
        .args(["--core", "verge-mihomo-alpha"])
        .arg(alpha)
        .status()
        .await?;
    ensure!(status.success(), "service installation refused or failed");
    Ok(json!({"installed":true}))
}
fn snapshot(runtime: &Runtime) -> Value {
    json!({"phase":runtime.phase,"generation":runtime.generation,"error":runtime.error,"managed":runtime.managed,"tun":runtime.tun,"proxyGuardTripped":runtime.proxy_guard.tripped,"port":runtime.port,"active":runtime.active,"tunVerification":"pending","intelAcceptance":"not-passed","media":runtime.media.as_ref().map(|job|job.snapshot())})
}
pub fn setup(app: &tauri::App) -> Result<()> {
    outbound::configure("unavailable", None);
    let state = NetworkState::default();
    app.manage(state.clone());
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = initialize_preferences(&handle, &state).await {
            log::warn!("Network preferences unavailable: {error}");
        }
    });
    Ok(())
}
async fn initialize_preferences(app: &tauri::AppHandle, state: &NetworkState) -> Result<()> {
    let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
    if state.ready.load(std::sync::atomic::Ordering::Acquire) {
        return Ok(());
    }
    let db = app.state::<crate::store::AppState>().db.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        repository::connect(db).and_then(|_| reload_preferences())
    }).await.map_err(anyhow::Error::from).and_then(|result| result);
    match result {
        Ok(()) => {
            state.runtime.lock().await.error = None;
            if state.mark_ready() {
                start_workers(app.clone(), state.clone());
                service_setup::prepare_on_launch(app, state).await;
            }
            // The first renderer query can race initialization. Wake a failed
            // snapshot exactly once when loading completes, without polling errors.
            let _ = app.emit("network-runtime-changed", ());
            Ok(())
        }
        Err(error) => {
            outbound::configure("unavailable", None);
            state.runtime.lock().await.error = Some("Network configuration unavailable. Migrate legacy credentials or restore a configuration backup; other workspaces remain available.".into());
            Err(error)
        }
    }
}
fn start_workers(app: tauri::AppHandle, state: NetworkState) {
    tray_bridge::start(app.clone(), state.clone());
    let scheduler_state = state.clone();
    let latency_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(30));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Ok(catalog) = read_catalog() else {
                continue;
            };
            if catalog.settings.auto_delay_minutes == 0 {
                continue;
            }
            if let Err(error) = delay::automatic(&latency_state, &catalog.settings).await {
                log::debug!("Automatic latency check skipped: {error}");
            }
        }
    });
    let scheduler_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(30));
        loop {
            timer.tick().await;
            let now = chrono::Utc::now().timestamp();
            let due = read_catalog()
                .map(|c| {
                    c.profiles
                        .into_iter()
                        .filter(|p| {
                            p.kind == "remote"
                                && p.interval >= 5
                                && now.saturating_sub(p.updated.max(p.last_attempt))
                                    >= (p.interval.min(43200) * 60) as i64
                        })
                        .map(|p| p.id)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for id in due {
                if refresh_profile(&scheduler_app, &scheduler_state, &id, false)
                    .await
                    .is_err()
                {
                    let _write = scheduler_state.write.lock().await;
                    if let Ok(mut catalog) = read_catalog() {
                        if let Some(profile) = catalog.profiles.iter_mut().find(|p| p.id == id) {
                            profile.last_attempt = chrono::Utc::now().timestamp();
                            profile.last_error=Some("Subscription update failed; the last valid revision was retained. Retry manually or wait for the next interval.".into());
                            let _ = save_catalog(&catalog);
                        }
                    }
                }
            }
        }
    });
    let guard_state = state.clone();
    let guard_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(1));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let Ok(_write) = guard_state.write.try_lock() else {
                continue;
            };
            let Ok(mut runtime) = guard_state.runtime.try_lock() else {
                continue;
            };
            let was_tripped = runtime.proxy_guard.tripped;
            proxy_guard::reconcile(&mut runtime).await;
            let changed = was_tripped != runtime.proxy_guard.tripped;
            drop(runtime);
            if changed {
                let _ = guard_app.emit("network-runtime-changed", ());
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(5));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            let mut runtime = state.runtime.lock().await;
            let before = (runtime.phase.clone(), runtime.error.clone(), runtime.port);
            let mut stale = false;
            if let Some(heartbeat) = &runtime.lease {
                match heartbeat.latest() {
                    Ok(()) => {
                        if runtime.phase == "failed" && runtime.managed && !runtime.recovery_required {
                            runtime.phase = "running".into();
                            if control(&runtime, "GET", "/version", None).await.is_ok() {
                                runtime.port = Some(runtime.configured_port);
                                runtime.error = None;
                                outbound::ready(
                                    runtime.port,
                                    runtime.generation,
                                    runtime.socket.clone(),
                                    runtime.session.clone(),
                                );
                            } else {
                                runtime.phase = "failed".into();
                            }
                        }
                    }
                    Err(detail) => {
                        stale = detail == lease::RenewalError::Stale && !runtime.recovery_required;
                        if let Some(job) = &mut runtime.media {
                            job.cancel();
                        }
                        runtime.phase = "failed".into();
                        runtime.error = Some(if service_setup::running_code_changed().await {
                            service_setup::APP_RESTART_MESSAGE.into()
                        } else {
                            match detail {
                                lease::RenewalError::Stale if stale => "网络服务会话已失效，正在尝试重新连接…".into(),
                                lease::RenewalError::Stale => "网络服务会话已失效，请先清理并停止，再重新启动网络".into(),
                                lease::RenewalError::Other(detail) => format!("网络服务连接暂时中断，正在重试：{detail}"),
                            }
                        });
                        runtime.port = None;
                        outbound::core(None, runtime.generation, false);
                    }
                }
            }
            if let Some(child) = &mut runtime.child {
                if let Ok(Some(_)) = child.try_wait() {
                    if let Some(job) = &mut runtime.media {
                        job.cancel();
                    }
                    runtime.phase = "failed".into();
                    runtime.error = Some("Mihomo exited unexpectedly".into());
                    runtime.port = None;
                    runtime.child = None;
                    outbound::core(None, runtime.generation, false);
                }
            }
            let changed = before != (runtime.phase.clone(), runtime.error.clone(), runtime.port);
            let generation = runtime.generation;
            drop(runtime);
            if changed {
                let _ = app.emit("network-runtime-changed", ());
            }
            if stale {
                lease::reconnect(&app, &state, generation).await;
            }
        }
    });
}
/// Global hotkeys use the same ownership, validation and rollback as the UI.
pub(crate) async fn shortcut(app: &tauri::AppHandle, action: &str) -> Result<Value> {
    shortcut_generation(app, action, None).await
}
async fn shortcut_generation(
    app: &tauri::AppHandle,
    action: &str,
    expected: Option<u64>,
) -> Result<Value> {
    let state = app
        .try_state::<NetworkState>()
        .context("Network workspace is not ready")?;
    ensure!(
        state.ready.load(std::sync::atomic::Ordering::Acquire),
        "Network preferences are still loading or unavailable"
    );
    let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
    if let Some(generation) = expected {
        ensure!(
            state.runtime.lock().await.generation == generation,
            "Network generation changed; retry required"
        );
    }
    let before = read_catalog()?;
    let mut next = before.clone();
    match action {
        "clash_mode_rule" => next.settings.mode = "rule".into(),
        "clash_mode_global" => next.settings.mode = "global".into(),
        "clash_mode_direct" => next.settings.mode = "direct".into(),
        "toggle_system_proxy" => next.settings.system_proxy = !next.settings.system_proxy,
        "toggle_tun_mode" => next.settings.tun = !next.settings.tun,
        "reactivate_profiles" => {}
        _ => bail!("Unknown network shortcut"),
    }
    let active = next
        .active
        .as_deref()
        .context("Select a profile before using network shortcuts")?;
    let payload = secret_get(active)?;
    let yaml = compose_with_profile(
        text(&payload, "yaml")?,
        &next.settings,
        Path::new("/tmp/si-check.sock"),
        payload.get("enhancement"),
        "Sivio",
    )?;
    validate_core(&checked_core(app, &next.settings.core)?, &yaml).await?;
    let running = state.runtime.lock().await.phase == "running";
    if running {
        shutdown(&state).await?;
    }
    if let Err(error) = save_catalog(&next) {
        if running {
            let _ = start(app, &state, &before).await;
        }
        return Err(error);
    }
    let committed = read_catalog()?;
    if running || action == "reactivate_profiles" {
        if let Err(error) = start(app, &state, &committed).await {
            let mut rollback = committed;
            rollback.settings = before.settings;
            if save_catalog(&rollback).is_ok() && running {
                let _ = start(app, &state, &rollback).await;
            }
            return Err(error);
        }
    }
    Ok(json!({"applied":true}))
}

#[tauri::command]
pub async fn network_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, NetworkState>,
    action: String,
    args: Option<Value>,
) -> Result<Value, Value> {
    let operation = uuid::Uuid::new_v4().to_string();
    execute(&app,&state,&action,args.unwrap_or(json!({}))).await.map_err(|error|json!({"code":"NETWORK_OPERATION_FAILED","message":error.to_string(),"retryable":false,"operationId":operation}))
}
async fn controller_request(state: &NetworkState, args: Value) -> Result<Value> {
    let method = text(&args, "method")?;
    let path = text(&args, "path")?;
    let selection = method == "PUT" && path.starts_with("/proxies/") && !path.contains('?');
    let _write = if selection {
        Some(state.write.lock().await)
    } else {
        None
    };
    let mut catalog = if selection {
        Some(read_catalog()?)
    } else {
        None
    };
    let runtime = state.runtime.lock().await;
    ensure!(
        args.get("expectedGeneration")
            .and_then(Value::as_u64)
            .map_or(true, |generation| generation == runtime.generation),
        "Network core changed; reload before selecting a node"
    );
    let previous = if selection {
        control(&runtime, "GET", path, None)
            .await?
            .get("now")
            .and_then(Value::as_str)
            .map(str::to_owned)
    } else {
        None
    };
    let response = control(&runtime, method, path, args.get("body").cloned()).await?;
    if selection {
        outbound::invalidate_selection();
    }
    let active = runtime.active.clone();
    let generation = runtime.generation;
    drop(runtime);
    if let Some(catalog) = &mut catalog {
        let group = percent_encoding::percent_decode_str(path.trim_start_matches("/proxies/"))
            .decode_utf8()?
            .into_owned();
        let node = args["body"]["name"]
            .as_str()
            .context("selected node is required")?;
        let id = active.as_ref().context("active profile is missing")?;
        catalog
            .selections
            .entry(id.clone())
            .or_default()
            .insert(group, node.into());
        if let Err(error) = save_catalog(catalog) {
            let mut runtime = state.runtime.lock().await;
            if runtime.generation != generation || runtime.phase != "running" {
                return Err(error);
            }
            let restored = if let Some(previous) = previous {
                control(&runtime, "PUT", path, Some(json!({"name":previous})))
                    .await
                    .is_ok()
            } else {
                false
            };
            if !restored {
                stop_inner(&mut runtime).await?;
            }
            bail!("Node selection could not be persisted; previous selection was restored or the core stopped: {error}");
        }
        if catalog.settings.close_connections_on_switch {
            let runtime = state.runtime.lock().await;
            ensure!(
                runtime.generation == generation,
                "network generation changed after selection"
            );
            control(&runtime, "DELETE", "/connections", None).await?;
        }
    }
    Ok(response)
}
async fn execute(
    app: &tauri::AppHandle,
    state: &NetworkState,
    action: &str,
    args: Value,
) -> Result<Value> {
    if !action.starts_with("desktop.")
        && !action.starts_with("appearance.")
        && !action.starts_with("app.update.")
        && !action.starts_with("migration.")
        && !action.starts_with("backup.")
        && action != "preferences.reload"
    {
        ensure!(state.ready.load(std::sync::atomic::Ordering::Acquire), "Network preferences are still loading or unavailable; other workspaces remain available");
    }
    match action {
        "preferences.reload" => {
            initialize_preferences(app, state).await?;
            Ok(json!({"ready":true}))
        }
        "home.probe" => home::probe(state, &args).await,
        "probe.custom" => {
            let catalog = read_catalog()?;
            let test = catalog
                .settings
                .custom_tests
                .iter()
                .find(|test| Some(test.id.as_str()) == args["id"].as_str())
                .context("Connectivity test not found")?;
            let (port, generation) = {
                let runtime = state.runtime.lock().await;
                ensure!(
                    runtime.phase == "running",
                    "Start Sivio network before testing"
                );
                (
                    runtime.port.context("Missing network port")?,
                    runtime.generation,
                )
            };
            let client = reqwest::Client::builder()
                .no_proxy()
                .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?)
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?;
            let started = std::time::Instant::now();
            let response = client.get(&test.url).send().await.map_err(|_| {
                anyhow::anyhow!("Connectivity test failed or timed out through Sivio network")
            })?;
            {
                let runtime = state.runtime.lock().await;
                ensure!(
                    runtime.generation == generation && runtime.phase == "running",
                    "Network changed during test; retry required"
                );
            }
            Ok(
                json!({"name":test.name,"httpStatus":response.status().as_u16(),"elapsedMs":started.elapsed().as_millis(),"successfulHttpResponse":response.status().is_success(),"accountAuthorizationVerified":false}),
            )
        }
        "terminal.env" => {
            let runtime = state.runtime.lock().await;
            ensure!(
                runtime.phase == "running",
                "Start the network core before copying proxy commands"
            );
            let port = runtime.port.context("Network core has no live listener")?;
            let shell = crate::desktop_preferences::current(app).env_type;
            Ok(json!({"text": terminal_env(&shell, &read_catalog()?.settings.proxy_host, port)?}))
        }
        "desktop.startupScript.choose" => crate::desktop_startup_script::choose(app).await,
        "desktop.startupScript.clear" => crate::desktop_startup_script::clear(),
        "desktop.get" => Ok(crate::desktop_preferences::read(
            app,
            &app.state::<crate::store::AppState>().db,
        )?),
        "desktop.reset" => {
            let raw = app
                .state::<crate::store::AppState>()
                .db
                .get_setting("si_assist_desktop")?;
            Ok(crate::desktop_preferences::save(
                app,
                serde_json::to_value(crate::desktop_preferences::Preferences::default())?,
                raw.as_deref()
                    .map(|s| crate::services::sync_protocol::sha256_hex(s.as_bytes())),
            )
            .await?)
        }
        "desktop.save" => Ok(crate::desktop_preferences::save(
            app,
            args.get("preferences")
                .context("desktop preferences required")?
                .clone(),
            args.get("revision")
                .and_then(Value::as_str)
                .map(str::to_owned),
        )
        .await?),
        "appearance.get" => Ok(crate::appearance::read(
            &app.state::<crate::store::AppState>().db,
        )?),
        "appearance.reset" => Ok(crate::appearance::restore_defaults(
            &app.state::<crate::store::AppState>().db,
        )?),
        "appearance.save" => Ok(crate::appearance::save(
            &app.state::<crate::store::AppState>().db,
            args.get("preferences")
                .context("appearance preferences required")?
                .clone(),
            args.get("revision").and_then(Value::as_str),
        )?),
        "metrics" => metrics::sample(state, &args).await,
        "delay" => delay::measure(state, &args).await,
        "migration.scan" => Ok(crate::services::legacy_migration::scan()),
        "migration.choose" => {
            use tauri_plugin_dialog::DialogExt;
            let app = app.clone();
            let directory = args
                .get("directory")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let kind = text(&args, "kind")?.to_owned();
            ensure!(
                ["cc-switch", "clash-verge"].contains(&kind.as_str()),
                "Unknown migration source"
            );
            tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                let picker=app.dialog().file().set_title("选择原应用目录或导出的备份");
                let selected=if directory {picker.blocking_pick_folder()} else if kind=="cc-switch" {picker.add_filter("CC Switch database or SQL", &["db","sql"]).blocking_pick_file()} else {picker.add_filter("Clash Verge Rev backup", &["zip"]).blocking_pick_file()};
                Ok(match selected {Some(path)=>json!({"filePath":path.into_path().map_err(|_|anyhow::anyhow!("A local source is required"))?,"kind":kind}),None=>json!({"cancelled":true})})
            }).await?
        }
        "migration.preview" | "migration.apply" => {
            let app_state = app.state::<crate::store::AppState>().inner().clone();
            let path = PathBuf::from(text(&args, "filePath")?);
            let kind = text(&args, "kind")?.to_owned();
            let replace = args
                .get("replace")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if action == "migration.preview" {
                tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                    Ok(crate::services::legacy_migration::preview(
                        &app_state.db,
                        &path,
                        &kind,
                        replace,
                    )?)
                })
                .await?
            } else {
                let _network = begin_restore(state, &app_state).await?;
                let _sync = crate::services::sync_protocol::sync_mutex().lock().await;
                let expected = text(&args, "revision")?.to_owned();
                tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                    crate::services::legacy_migration::apply(
                        &app_state.db,
                        &path,
                        &kind,
                        replace,
                        &expected,
                    )?;
                    // Imported objects are inactive; do not project original app
                    // state onto external clients as a side effect of migration.
                    reload_preferences()?;
                    Ok(json!({"imported":true}))
                })
                .await?
            }
        }
        "app.update.get" => {
            crate::settings::validate_settings_storage()?;
            let settings = crate::settings::get_settings();
            Ok(serde_json::to_value(crate::update_channel::resolve(&settings).map_err(anyhow::Error::msg)?)?)
        }
        "app.update.save" => {
            crate::app_updates::save_channel(
                app,
                text(&args, "endpoint")?.into(),
                text(&args, "publicKey")?.into(),
                args.get("mode").and_then(Value::as_str).map(String::from),
            ).await.map_err(anyhow::Error::msg)?;
            Ok(json!({"saved":true}))
        }
        "about.sources" => {
            use tauri_plugin_opener::OpenerExt;
            let path = app
                .path()
                .resolve("legal", tauri::path::BaseDirectory::Resource)?;
            ensure!(
                path.is_dir(),
                "Source and license materials are available in the packaged app"
            );
            app.opener()
                .open_path(path.to_string_lossy().to_string(), None::<String>)?;
            Ok(json!({"opened":true}))
        }
        "backup.export" => {
            use tauri::{Emitter, Manager};
            use tauri_plugin_dialog::DialogExt;
            let app = app.clone();
            let _sync = crate::services::sync_protocol::sync_mutex().lock().await;
            tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                let Some(path) = app
                    .dialog()
                    .file()
                    .add_filter("Sivio configuration ZIP", &["zip"])
                    .set_file_name("Sivio-configuration.sivio.zip")
                    .blocking_save_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| anyhow::anyhow!("A local file destination is required"))?;
                crate::services::backup_bundle::export(
                    &app.state::<crate::store::AppState>().db,
                    &path,
                )?;
                Ok(json!({"saved":true,"filePath":path}))
            })
            .await?
        }
        "backup.preview" => {
            use tauri_plugin_dialog::DialogExt;
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                let Some(path) = app
                    .dialog()
                    .file()
                    .add_filter("Sivio configuration ZIP", &["zip", "sivio", "siassist"])
                    .blocking_pick_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| anyhow::anyhow!("A local backup file is required"))?;
                Ok(crate::services::backup_bundle::preview(&path)?)
            })
            .await?
        }
        "backup.restore" => {
            use tauri::{Emitter, Manager};
            let app_state = app.state::<crate::store::AppState>().inner().clone();
            let _network = begin_restore(state, &app_state).await?;
            let _sync = crate::services::sync_protocol::sync_mutex().lock().await;
            let path = PathBuf::from(text(&args, "filePath")?);
            let revision = text(&args, "revision")?.to_owned();
            tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                crate::services::backup_bundle::restore(&app_state.db, &path, &revision)?;
                let warning = crate::commands::sync_support::run_post_import_sync(&app_state)
                    .err()
                    .map(|e| e.to_string());
                Ok(json!({"restored":true,"warning":warning}))
            })
            .await?
        }
        "sync.privacy.get" => {
            crate::settings::validate_settings_storage()?;
            let settings = crate::settings::get_settings();
            Ok(
                json!({"includeSecrets":settings.sync_include_secrets,"passwordConfigured":!settings.sync_password.is_empty(),"rememberPassword":settings.sync_remember_password}),
            )
        }
        "sync.privacy.save" => {
            let include = args
                .get("includeSecrets")
                .and_then(Value::as_bool)
                .context("includeSecrets is required")?;
            let password = args
                .get("password")
                .and_then(Value::as_str)
                .map(str::to_owned);
            crate::settings::set_sync_privacy(
                include,
                password,
                args.get("rememberPassword")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )?;
            Ok(json!({"saved":true}))
        }
        "outbound.set" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let mode = text(&args, "mode")?;
            let custom = args
                .get("url")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            outbound::validate(mode, custom)?;
            let mut catalog = read_catalog()?;
            let key = if let Some(url) = custom {
                let key = format!("outbound:{}", uuid::Uuid::new_v4());
                repository::stage(&key, json!(url))?;
                Some(key)
            } else {
                None
            };
            let previous = catalog.custom_proxy_ref.clone();
            catalog.outbound = mode.into();
            catalog.custom_proxy_ref = key.clone();
            if let Err(error) = save_catalog(&catalog) {
                if let Some(key) = &key { let _ = repository::discard(key); }
                return Err(error);
            }
            outbound::configure(mode, custom.map(str::to_owned));
            if let Some(previous) = previous {
                let _ = repository::discard(&previous);
            }
            Ok(json!({"mode":mode}))
        }
        "snapshot" => {
            let catalog = read_catalog()?;
            let settings_revision = digest(&serde_json::to_vec(&catalog.settings)?);
            let runtime = snapshot(&*state.runtime.lock().await);
            let helper = ipc::get_version()
                .await
                .ok()
                .filter(|r| r.code == 0)
                .and_then(|r| r.data);
            let helper_authorized = if helper.is_some() {
                ipc::get_status(&credentials()?)
                    .await
                    .is_ok_and(|r| r.code == 0)
            } else {
                false
            };
            let helper_compatible = helper.as_ref().is_some_and(|info| {
                info.supports_client(
                    ipc::ProtocolVersion::current(),
                    ipc::MIN_REQUIRED_SERVICE_REVISION,
                )
            });
            let app_restart_required = !helper_authorized && service_setup::running_code_changed().await;
            Ok(
                json!({"catalog":catalog,"settingsRevision":settings_revision,"runtime":runtime,"helper":helper,"helperCompatible":helper_compatible,"helperAuthorized":helper_authorized,"appRestartRequired":app_restart_required}),
            )
        }
        "profile.file.open" | "profile.file.read" => profile_documents::execute(app, &action, &args).await,
        "profile.export" => {
            use tauri_plugin_dialog::DialogExt;
            let yaml = text(&args, "yaml")?.to_owned();
            ensure!(yaml.len() <= LIMIT, "profile exceeds 16 MiB");
            let _: Mapping =
                serde_yaml_ng::from_str(&yaml).context("profile must be valid YAML")?;
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
                let Some(path) = app
                    .dialog()
                    .file()
                    .set_title("导出 YAML（包含节点密钥，请妥善保管）")
                    .set_file_name("Sivio-profile.yaml")
                    .blocking_save_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| anyhow::anyhow!("A local destination is required"))?;
                crate::config::atomic_write_private(&path, yaml.as_bytes())?;
                Ok(json!({"exported":true}))
            })
            .await?
        }
        "profile.read" => {
            let id = text(&args, "id")?;
            ensure!(
                read_catalog()?.profiles.iter().any(|p| p.id == id),
                "profile not found"
            );
            secret_get(id)
        }
        "profile.save" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let mut catalog = read_catalog()?;
            let old_catalog = catalog.clone();
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let name = text(&args, "name")?.trim();
            ensure!(
                !name.is_empty() && name.len() <= 256,
                "profile name must be 1–256 bytes"
            );
            let kind = args.get("kind").and_then(Value::as_str).unwrap_or("local");
            ensure!(["local", "remote"].contains(&kind), "invalid profile kind");
            let yaml = text(&args, "yaml")?;
            let _: Mapping = serde_yaml_ng::from_str(yaml).map_err(|error| {
                anyhow::anyhow!(
                    "profile must be a YAML mapping (line {})",
                    error.location().map(|l| l.line()).unwrap_or(0)
                )
            })?;
            ensure!(yaml.len() <= LIMIT, "profile too large");
            if let Some(current) = catalog.profiles.iter().find(|p| p.id == id) {
                ensure!(
                    args.get("baseRevision").and_then(Value::as_str)
                        == Some(current.revision.as_str()),
                    "profile changed externally; reload before saving"
                );

            }
            let interval = args.get("interval").and_then(Value::as_u64).unwrap_or(0);
            ensure!(
                interval == 0 || (5..=43200).contains(&interval),
                "update interval must be 0 or 5–43200 minutes"
            );
            let revision = uuid::Uuid::new_v4().to_string();
            let key = format!("profile:{id}:{revision}");
            let previous_payload = if catalog.profiles.iter().any(|p| p.id == id) {
                secret_get(&id)?
            } else {
                json!({})
            };
            let enhancement = args
                .get("enhancement")
                .cloned()
                .or_else(|| previous_payload.get("enhancement").cloned())
                .unwrap_or(serde_json::to_value(
                    profile_enhance::ProfileEnhancement::default(),
                )?);
            let composed = compose_with_profile(
                yaml,
                &catalog.settings,
                Path::new("/tmp/si-check.sock"),
                Some(&enhancement),
                name,
            )?;
            validate_core(&checked_core(app, &catalog.settings.core)?, &composed).await?;
            let mut payload = previous_payload;
            let request_options: subscription::Options = args
                .get("requestOptions")
                .or_else(|| payload.get("requestOptions"))
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()?
                .unwrap_or_default();
            request_options.validate()?;
            payload["requestOptions"] = serde_json::to_value(request_options)?;
            payload["yaml"] = json!(yaml);
            payload["url"] = json!(args.get("url").and_then(Value::as_str).unwrap_or(""));
            payload["enhancement"] = enhancement;
            let (restart, managed_running, tripped) = {
                let runtime = state.runtime.lock().await;
                ensure!(["running", "stopped"].contains(&runtime.phase.as_str()), "网络正在切换或需要清理，请稍后重试");
                let restart = runtime.active.as_deref() == Some(id.as_str()) && runtime.phase == "running";
                (restart, restart && runtime.managed, runtime.proxy_guard.tripped)
            };
            let suspend_proxy = proxy_guard::suspended(&old_catalog.settings, managed_running, tripped).await?;
            secret_set(&key, &payload)?;
            let previous = catalog
                .profiles
                .iter()
                .find(|p| p.id == id)
                .map(|p| format!("profile:{}:{}", p.id, p.revision));
            let record = Profile {
                id: id.clone(),
                name: name.into(),
                kind: kind.into(),
                revision: revision.clone(),
                updated: chrono::Utc::now().timestamp(),
                interval,
                usage: args
                    .get("usage")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        catalog
                            .profiles
                            .iter()
                            .find(|profile| profile.id == id)
                            .and_then(|profile| profile.usage.clone())
                    }),
                last_attempt: chrono::Utc::now().timestamp(),
                last_error: None,
            };
            if let Some(position) = catalog.profiles.iter().position(|profile| profile.id == id) {
                catalog.profiles[position] = record;
            } else {
                catalog.profiles.push(record);
            }
            if catalog.active.is_none() {
                catalog.active = Some(id.clone());
            }
            let activation = settings_update::activate_profile(app, state, &old_catalog, &catalog, restart, suspend_proxy).await;
            let _ = repository::discard(&key);
            activation?;
            if let Some(previous) = previous {
                let _ = repository::discard(&previous);
            }
            Ok(json!({"id":id,"revision":revision}))
        }
        "profile.update" => {
            refresh_profile_route(
                app,
                state,
                text(&args, "id")?,
                args.get("managed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                args.get("via").and_then(Value::as_str),
            )
            .await
        }
        "profile.reorder" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let mut catalog = read_catalog()?;
            let ids: Vec<String> =
                serde_json::from_value(args.get("ids").context("profile order required")?.clone())?;
            ensure!(
                ids.len() == catalog.profiles.len()
                    && ids.iter().collect::<std::collections::BTreeSet<_>>().len() == ids.len(),
                "order must contain each profile exactly once"
            );
            let mut ordered = Vec::new();
            for id in ids {
                ordered.push(
                    catalog
                        .profiles
                        .iter()
                        .find(|p| p.id == id)
                        .context("unknown profile in order")?
                        .clone(),
                );
            }
            catalog.profiles = ordered;
            save_catalog(&catalog)?;
            Ok(json!({"saved":true}))
        }
        "profile.delete" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let mut catalog = read_catalog()?;
            let id = text(&args, "id")?;
            ensure!(
                state.runtime.lock().await.active.as_deref() != Some(id),
                "stop active profile before deleting"
            );
            let profile = catalog
                .profiles
                .iter()
                .find(|p| p.id == id)
                .context("profile not found")?
                .clone();
            ensure!(
                args.get("baseRevision").and_then(Value::as_str) == Some(profile.revision.as_str()),
                "profile revision conflict"
            );
            catalog.profiles.retain(|p| p.id != id);
            if catalog.active.as_deref() == Some(id) {
                catalog.active = None;
            }
            catalog.selections.remove(id);
            save_catalog(&catalog)?;
            let _ = repository::discard(&format!("profile:{}:{}", profile.id, profile.revision));
            Ok(json!({"deleted":true}))
        }
        "profile.select" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let old = read_catalog()?;
            let mut catalog = old.clone();
            let id = text(&args, "id")?;
            let record = catalog.profiles.iter().find(|p| p.id == id).context("profile not found")?;
            let payload = secret_get(id)?;
            let composed = compose_with_profile(text(&payload, "yaml")?, &catalog.settings, Path::new("/tmp/si-check.sock"), payload.get("enhancement"), &record.name)?;
            validate_core(&checked_core(app, &catalog.settings.core)?, &composed).await?;
            let (running, managed, tripped) = {
                let runtime = state.runtime.lock().await;
                ensure!(["running", "stopped"].contains(&runtime.phase.as_str()), "网络正在切换或需要清理，请稍后重试");
                (runtime.phase == "running", runtime.managed, runtime.proxy_guard.tripped)
            };
            let suspended = proxy_guard::suspended(&old.settings, running && managed, tripped).await?;
            catalog.active = Some(id.into());
            settings_update::activate_profile(app, state, &old, &catalog, running, suspended).await?;
            Ok(json!({"selected":id}))
        }
        "subscription.fetch" => {
            let request_options: subscription::Options = args
                .get("requestOptions")
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()?
                .unwrap_or_default();
            let via = args
                .get("managed")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || request_options.via == "managed-network";
            let port = if via {
                let runtime = state.runtime.lock().await;
                ensure!(
                    runtime.phase == "running",
                    "managed network unavailable; direct fallback is disabled"
                );
                runtime.port
            } else {
                None
            };
            let (yaml, usage) = fetch(text(&args, "url")?, port, &request_options).await?;
            let _: Mapping =
                serde_yaml_ng::from_str(&yaml).context("subscription returned invalid YAML")?;
            Ok(json!({"yaml":yaml,"usage":usage}))
        }
        "settings.save" => settings_update::save(app, state, &args).await,
        "settings.revision" => {
            Ok(json!({"revision":digest(&serde_json::to_vec(&read_catalog()?.settings)?)}))
        }
        "validate" | "preview" => {
            let settings: Settings = args
                .get("settings")
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()?
                .unwrap_or(read_catalog()?.settings);
            let yaml = compose_with_profile(
                text(&args, "yaml")?,
                &settings,
                Path::new("/tmp/si-check.sock"),
                args.get("enhancement"),
                args.get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Sivio"),
            )?;
            validate_core(&checked_core(app, &settings.core)?, &yaml).await?;
            Ok(json!({"yaml":yaml,"valid":true}))
        }
        "start" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let result = start(app, state, &read_catalog()?).await?;
            if let Err(error) = service_setup::remember_running(true) {
                shutdown(state).await?;
                return Err(error.context("无法保存网络启动状态"));
            }
            Ok(result)
        }
        "stop" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let remembered = service_setup::remember_running(false);
            shutdown(state).await?;
            remembered.context("网络已停止，但无法保存下次启动偏好")?;
            Ok(json!({"stopped":true}))
        }
        "proxy.reapply" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            let mut runtime = state.runtime.lock().await;
            ensure!(args.get("expectedGeneration").and_then(Value::as_u64) == Some(runtime.generation), "Network core changed; reload before applying system proxy");
            let settings = read_catalog()?.settings;
            proxy_guard::reapply(&mut runtime, &settings).await?;
            Ok(json!({"applied":true}))
        }
        "controller" => controller_request(state, args).await,
        "logs" => {
            let runtime = state.runtime.lock().await;
            ensure!(
                runtime.phase == "running",
                "start the network to read the current run logs"
            );
            if runtime.managed {
                let response = ipc::get_clash_logs(&credentials()?).await?;
                ensure!(response.code == 0, "helper logs unavailable");
                let active = runtime.active.clone();
                drop(runtime);
                Ok(
                    json!({"lines":redacted_logs(response.data.unwrap_or_default(),active.as_deref())?}),
                )
            } else {
                let path = root()?.join("runtime/core.log");
                use std::os::unix::fs::OpenOptionsExt;
                let file = std::fs::OpenOptions::new()
                    .read(true)
                    .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                    .open(path);
                let lines = match file {
                    Ok(mut file) => {
                        use std::io::{Read, Seek, SeekFrom};
                        let len = file.metadata()?.len();
                        file.seek(SeekFrom::Start(len.saturating_sub(256 * 1024)))?;
                        let mut bytes = Vec::new();
                        file.take(256 * 1024).read_to_end(&mut bytes)?;
                        String::from_utf8_lossy(&bytes)
                            .lines()
                            .rev()
                            .take(500)
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect::<Vec<_>>()
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
                    Err(e) => return Err(e.into()),
                };
                let active = runtime.active.clone();
                drop(runtime);
                Ok(json!({"lines":redacted_logs(lines,active.as_deref())?}))
            }
        }
        "helper.install" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            service_setup::require_current_app().await?;
            // Preparing a service is an explicit user operation. An ordinary
            // warm core can be stopped and restored without touching OS proxy.
            let ordinary = !state.runtime.lock().await.managed;
            if ordinary { shutdown(state).await?; }
            let result = install(app).await;
            if result.is_ok() { shutdown(state).await?; }
            if result.is_ok() || ordinary { service_setup::prepare_on_launch(app, state).await; }
            result
        }
        "helper.uninstall" => {
            let _write = state.write.lock().await;
    ensure!(!crate::update_install::installing(), "UPDATE_BUSY: 正在安装更新");
            shutdown(state).await?;
            let status = Command::new(resource(app, "sivio-helper-uninstall")?)
                .arg("--prepare-uninstall")
                .status()
                .await?;
            ensure!(
                status.success(),
                "service removal refused or recovery failed"
            );
            Ok(json!({"removed":true}))
        }
        "media.start" => {
            let mut runtime = state.runtime.lock().await;
            control(&runtime, "GET", "/version", None).await?;
            let port = runtime.port.context("managed network port unavailable")?;
            if let Some(job) = &mut runtime.media {
                job.cancel();
            }
            runtime.media = Some(media_job::MediaJob::start(
                port,
                args.get("name").and_then(Value::as_str).map(str::to_owned),
            )?);
            Ok(runtime.media.as_ref().unwrap().snapshot())
        }
        "media.cancel" => {
            let mut runtime = state.runtime.lock().await;
            if let Some(job) = &mut runtime.media {
                job.cancel();
            }
            Ok(json!({"cancelled":true}))
        }
        "diagnostics" => {
            let runtime = state.runtime.lock().await;
            let sys = std::process::Command::new("/usr/bin/sw_vers").output()?;
            Ok(
                json!({"appVersion":env!("CARGO_PKG_VERSION"),"arch":std::env::consts::ARCH,"os":String::from_utf8_lossy(&sys.stdout),"runtime":{"phase":runtime.phase,"managed":runtime.managed,"generation":runtime.generation,"port":runtime.port},"profileCount":read_catalog()?.profiles.len(),"intelAcceptance":"not-passed"}),
            )
        }
        _ => bail!("unknown network operation"),
    }
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn failed_cleanup_retains_resources_and_requires_explicit_retry() {
        let child = Command::new("/bin/sleep").arg("30")
            .stdin(std::process::Stdio::piped()).kill_on_drop(true).spawn().unwrap();
        let mut runtime = Runtime { child: Some(child), phase: "running".into(), generation: 7, ..Default::default() };
        assert!(stop_inner(&mut runtime).await.is_err());
        assert_eq!(runtime.phase, "failed");
        assert!(runtime.recovery_required);
        assert!(runtime.child.is_some());
        assert!(runtime.error.as_deref().unwrap().contains("cleanup incomplete"));
        runtime.child.as_mut().unwrap().kill().await.unwrap();
        stop_inner(&mut runtime).await.unwrap();
        assert_eq!(runtime.phase, "stopped");
        assert!(!runtime.recovery_required);
        assert!(runtime.child.is_none());
        assert!(runtime.error.is_none());
    }

    #[test]
    fn authorized_but_older_helper_cannot_start_new_managed_features() {
        let mut info = ipc::ProtocolInfo::current();
        require_compatible_helper(&info).unwrap();
        info.protocol.revision = ipc::MIN_REQUIRED_SERVICE_REVISION - 1;
        assert!(require_compatible_helper(&info).unwrap_err().to_string().contains("安装 / 修复服务"));
        info = ipc::ProtocolInfo::current();
        info.protocol.epoch += 1;
        assert!(require_compatible_helper(&info).is_err());
    }
    use super::*;
    #[test]
    fn clash_settings_are_authoritative_and_port_migration_preserves_custom_values() {
        let mut old: Settings = serde_json::from_value(json!({"mixedPort":15722})).unwrap();
        migrate_port_defaults(&mut old);
        assert_eq!(old.mixed_port,7890);
        old.mixed_port=15722;
        migrate_port_defaults(&mut old);
        assert_eq!(old.mixed_port,15722);
        let mut custom: Settings = serde_json::from_value(json!({"mixedPort":18888})).unwrap();
        migrate_port_defaults(&mut custom);
        assert_eq!(custom.mixed_port,18888);
        let settings=Settings {ipv6:true,unified_delay:false,log_level:"debug".into(),tun_stack:"mixed".into(),tun_mtu:1400,..Default::default()};
        let config: Yaml=serde_yaml_ng::from_str(&compose("ipv6: false\nlog-level: silent\nunified-delay: true",&settings,Path::new("/tmp/check.sock")).unwrap()).unwrap();
        assert_eq!(config["mixed-port"].as_u64(),Some(7890));
        assert_eq!(config["ipv6"].as_bool(),Some(true));
        assert_eq!(config["unified-delay"].as_bool(),Some(false));
        assert_eq!(config["log-level"].as_str(),Some("debug"));
        assert_eq!(config["tun"]["stack"].as_str(),Some("mixed"));
        assert_eq!(config["tun"]["mtu"].as_u64(),Some(1400));
        let mut invalid=settings;
        invalid.log_level="verbose".into();
        assert!(compose("{}",&invalid,Path::new("/tmp/check.sock")).is_err());
    }
    #[test]
    fn builtin_compatibility_can_be_disabled_without_disabling_control_isolation() {
        let input="proxies: [{name: legacy, type: hysteria, alpn: h3}]\nexternal-controller: 0.0.0.0:1234\n";
        for enabled in [true, false] {
            let settings = Settings {
                builtin_enhanced: enabled,
                ..Default::default()
            };
            let result: Yaml = serde_yaml_ng::from_str(
                &compose(input, &settings, Path::new("/tmp/fixture.sock")).unwrap(),
            )
            .unwrap();
            assert_eq!(result["proxies"][0]["alpn"].is_sequence(), enabled);
            assert!(result.get("external-controller").is_none());
        }
    }
    #[test]
    fn terminal_exports_use_live_port_and_never_include_credentials() {
        for shell in ["bash", "fish", "cmd", "powershell", "nushell"] {
            let command = terminal_env(shell, "127.0.0.1", 15888).unwrap();
            assert!(command.contains("127.0.0.1:15888"));
            assert!(!command.contains("15722"));
            assert!(command.contains("socks5://"));
        }
        assert!(terminal_env("bash; touch /tmp/invalid", "127.0.0.1", 15888).is_err());
    }
    #[test]
    fn portable_placeholders_cannot_become_a_lan_password_or_an_enhanced_proxy_secret() {
        let mut settings = Settings::default();
        settings.allow_lan = true;
        settings.lan_password = crate::portable_credentials::MISSING.into();
        assert!(compose("{}", &settings, Path::new("/tmp/fixture.sock")).is_err());
        settings.allow_lan = false;
        settings.merge = format!(
            "future: {{password: {}}}",
            crate::portable_credentials::MISSING
        );
        assert!(compose("{}", &settings, Path::new("/tmp/fixture.sock")).is_err());
    }
    #[test]
    fn composition_preserves_unknown_fields_but_enforces_private_control_plane() {
        let mut settings = Settings::default();
        settings.merge =
            "mixed-port: 7890\nallow-lan: true\nexternal-ui: /tmp/unsafe\nunknown: {nested: true}"
                .into();
        settings.script="function main(c){c['external-controller']='0.0.0.0:9090';c['mixed-port']=16721;return c}".into();
        let yaml = compose(
            "proxies: []\nunknown-original: 7",
            &settings,
            Path::new("/tmp/si-private.sock"),
        )
        .unwrap();
        let config: Mapping = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(config["mixed-port"].as_u64(), Some(7890));
        assert_eq!(config["allow-lan"].as_bool(), Some(false));
        assert!(config.get("external-controller").is_none());
        assert!(config.get("external-ui").is_none());
        assert_eq!(config["unknown-original"].as_u64(), Some(7));
        assert_eq!(config["unknown"]["nested"].as_bool(), Some(true));
        assert_eq!(config["tun"]["enable"].as_bool(), Some(false));
    }
    #[test]
    fn provider_paths_cannot_escape_managed_root() {
        for path in ["/etc/passwd", "../../outside", "providers/../../escape"] {
            let yaml = format!("proxy-providers:\n  bad:\n    type: file\n    path: '{path}'");
            assert!(compose(&yaml, &Settings::default(), Path::new("/tmp/check.sock")).is_err());
        }
        assert!(compose("proxy-providers: {ok: {type: http, path: providers/cache.yaml, url: 'https://example.com/sub'}}",&Settings::default(),Path::new("/tmp/check.sock")).is_ok());
    }
    #[test]
    fn script_is_unprivileged_and_must_return_an_object() {
        for script in [
            "function main(c){return require('fs').readFileSync('/etc/passwd')}",
            "function main(c){return 5}",
        ] {
            let mut settings = Settings::default();
            settings.script = script.into();
            assert!(compose("{}", &settings, Path::new("/tmp/check.sock")).is_err());
        }
    }
    #[test]
    fn invalid_and_conflicting_ports_are_rejected_before_launch() {
        for port in [0, 1024, 16721] {
            let mut settings = Settings::default();
            settings.mixed_port = port;
            assert!(compose("{}", &settings, Path::new("/tmp/check.sock")).is_err());
        }
    }
    #[tokio::test]
    async fn stopped_controller_never_contacts_an_external_endpoint() {
        assert!(control(&Runtime::default(), "GET", "/version", None)
            .await
            .is_err());
    }
    #[test]
    fn dialer_and_selector_cycles_are_rejected() {
        for yaml in [
            "proxies: [{name: a, dialer-proxy: b}, {name: b, dialer-proxy: a}]",
            "proxy-groups: [{name: a, proxies: [b]}, {name: b, proxies: [a]}]",
            "proxies: [{name: a}, {name: a}]",
        ] {
            assert!(validate_proxy_graph(&serde_yaml_ng::from_str(yaml).unwrap()).is_err());
        }
        assert!(validate_proxy_graph(&serde_yaml_ng::from_str("proxies: [{name: a, dialer-proxy: b}, {name: b}]\nproxy-groups: [{name: select, proxies: [a, DIRECT]}]").unwrap()).is_ok());
    }
    #[test]
    fn lan_requires_credentials_and_enforces_loopback_only_auth_exemption() {
        let mut settings = Settings {
            allow_lan: true,
            ..Default::default()
        };
        assert!(compose("{}", &settings, Path::new("/tmp/test.sock")).is_err());
        settings.lan_password = "fixture-long-password".into();
        let yaml = compose(
            "skip-auth-prefixes: [0.0.0.0/0]",
            &settings,
            Path::new("/tmp/test.sock"),
        )
        .unwrap();
        let config: Mapping = serde_yaml_ng::from_str(&yaml).unwrap();
        assert_eq!(config["bind-address"].as_str(), Some("*"));
        assert_eq!(
            config["skip-auth-prefixes"][0].as_str(),
            Some("127.0.0.0/8")
        );
        settings.http_port = settings.mixed_port;
        assert!(compose("{}", &settings, Path::new("/tmp/test.sock")).is_err());
    }
}
