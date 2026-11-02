//! One immutable client/route snapshot per AI attempt. Managed egress never falls back to direct.
use crate::proxy::error::ProxyError;
use once_cell::sync::Lazy;
use std::sync::RwLock;
#[derive(Clone, Default)]
struct Egress {
    mode: String,
    custom: Option<String>,
    port: Option<u16>,
    generation: u64,
    alive: bool,
    health: Option<Health>,
    selection_epoch: u64,
}
#[derive(Clone)]
struct Health {
    socket: std::path::PathBuf,
    session: Option<clash_verge_service_ipc::OwnerSessionProof>,
}
fn initial_egress() -> Egress {
    Egress {
        mode: "unavailable".into(),
        ..Default::default()
    }
}
static EGRESS: Lazy<RwLock<Egress>> = Lazy::new(|| {
    let mut egress = initial_egress();
    // Forwarder/server unit fixtures instantiate their subsystem without a
    // desktop setup phase. Their controlled localhost upstream uses direct.
    // Network::setup still closes this gate before loading preferences, even
    // in tests; the production initializer is exercised separately below.
    #[cfg(test)]
    {
        egress.mode = "direct".into();
    }
    RwLock::new(egress)
});
pub(super) fn validate(mode: &str, custom: Option<&str>) -> anyhow::Result<()> {
    anyhow::ensure!(
        ["direct", "managed-network", "custom-proxy"].contains(&mode),
        "invalid AI outbound policy"
    );
    if mode == "custom-proxy" {
        let parsed =
            url::Url::parse(custom.ok_or_else(|| anyhow::anyhow!("custom proxy URL required"))?)?;
        anyhow::ensure!(
            ["http", "https", "socks5", "socks5h"].contains(&parsed.scheme())
                && parsed.host_str().is_some(),
            "unsupported proxy URL"
        );
        anyhow::ensure!(
            (parsed.path() == "/" || parsed.path().is_empty())
                && parsed.query().is_none()
                && parsed.fragment().is_none(),
            "proxy URL must not contain a path or query"
        );
        if crate::proxy::http_client::is_loopback_url(parsed.as_str()) {
            anyhow::ensure!(
                ![16721, crate::proxy::http_client::get_proxy_port()]
                    .contains(&parsed.port_or_known_default().unwrap_or(0)),
                "custom proxy cannot point at the AI listener"
            );
        }
    }
    Ok(())
}
pub(super) fn invalidate_selection() {
    let mut egress = EGRESS.write().unwrap_or_else(|e| e.into_inner());
    egress.selection_epoch = egress.selection_epoch.wrapping_add(1);
}
pub(super) fn configure(mode: &str, custom: Option<String>) {
    let mut egress = EGRESS.write().unwrap_or_else(|e| e.into_inner());
    if egress.mode != mode || egress.custom != custom {
        egress.selection_epoch = egress.selection_epoch.wrapping_add(1);
    }
    egress.mode = mode.into();
    egress.custom = custom;
}
/// Cheap passive state: no control-channel I/O, DNS, authentication or proxy changes.
pub(crate) struct Observation {
    pub mode: String,
    pub available: bool,
    pub generation: u64,
    pub revision: String,
}
pub(crate) fn observe() -> Result<Observation, String> {
    let egress = EGRESS.read().map_err(|_| "outbound_unavailable")?;
    Ok(Observation {
        mode: egress.mode.clone(),
        available: egress.alive && egress.port.is_some() && egress.health.is_some(),
        generation: egress.generation,
        revision: crate::services::workspace_readiness::revision(
            "outbound",
            &(
                &egress.mode,
                &egress.custom,
                egress.port,
                egress.generation,
                egress.alive,
                egress.selection_epoch,
            ),
        )?,
    })
}
pub(super) fn core(port: Option<u16>, generation: u64, alive: bool) {
    let mut egress = EGRESS.write().unwrap_or_else(|e| e.into_inner());
    egress.port = port;
    egress.generation = generation;
    egress.alive = alive;
    if !alive {
        egress.health = None;
    }
}
pub(super) fn ready(
    port: Option<u16>,
    generation: u64,
    socket: std::path::PathBuf,
    session: Option<clash_verge_service_ipc::OwnerSessionProof>,
) {
    let mut egress = EGRESS.write().unwrap_or_else(|e| e.into_inner());
    egress.port = port;
    egress.generation = generation;
    egress.alive = true;
    egress.health = Some(Health { socket, session });
}
pub(crate) async fn snapshot() -> Result<(reqwest::Client, Option<String>), ProxyError> {
    snapshot_with_policy(false).await
}
pub(crate) async fn diagnostic_snapshot() -> Result<(reqwest::Client, Option<String>), ProxyError> {
    snapshot_with_policy(true).await
}
async fn snapshot_with_policy(
    diagnostic: bool,
) -> Result<(reqwest::Client, Option<String>), ProxyError> {
    let egress = EGRESS
        .read()
        .map_err(|_| ProxyError::ConfigError("AI outbound state unavailable".into()))?
        .clone();
    let generation = egress.generation;
    let mode = egress.mode.clone();
    let snapshot = snapshot_of_policy(egress, diagnostic).await?;
    if mode == "managed-network" {
        let current = EGRESS
            .read()
            .map_err(|_| ProxyError::ConfigError("AI outbound state unavailable".into()))?;
        if current.generation != generation || !current.alive || current.mode != mode {
            return Err(ProxyError::ForwardFailed(
                "managed-network changed during route selection; retry required".into(),
            ));
        }
    }
    Ok(snapshot)
}
#[cfg(test)]
async fn snapshot_of(egress: Egress) -> Result<(reqwest::Client, Option<String>), ProxyError> {
    snapshot_of_policy(egress, false).await
}
async fn snapshot_of_policy(
    egress: Egress,
    diagnostic: bool,
) -> Result<(reqwest::Client, Option<String>), ProxyError> {
    let proxy = match egress.mode.as_str() {
        "direct" => None,
        "managed-network" => {
            if !egress.alive {
                return Err(ProxyError::ForwardFailed(
                    "managed-network is unavailable; direct fallback is disabled".into(),
                ));
            }
            let health = egress.health.as_ref().ok_or_else(|| {
                ProxyError::ForwardFailed(
                    "managed-network has no authenticated control channel".into(),
                )
            })?;
            let runtime = super::Runtime {
                phase: "running".into(),
                managed: health.session.is_some(),
                socket: health.socket.clone(),
                session: health.session.clone(),
                ..Default::default()
            };
            tokio::time::timeout(
                std::time::Duration::from_secs(3),
                super::control(&runtime, "GET", "/version", None),
            )
            .await
            .map_err(|_| {
                ProxyError::ForwardFailed("managed-network health check timed out".into())
            })?
            .map_err(|_| {
                ProxyError::ForwardFailed(
                    "managed-network control unavailable; direct fallback is disabled".into(),
                )
            })?;
            Some(format!(
                "http://127.0.0.1:{}",
                egress.port.ok_or_else(|| ProxyError::ForwardFailed(
                    "managed-network has no bound port".into()
                ))?
            ))
        }
        "custom-proxy" => Some(egress.custom.ok_or_else(|| {
            ProxyError::ConfigError(
                "Custom proxy credentials are unavailable; re-enter the URL in network settings"
                    .into(),
            )
        })?),
        _ => return Err(ProxyError::ConfigError("invalid AI outbound policy".into())),
    };
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(30));
    if diagnostic {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    if let Some(proxy) = &proxy {
        builder = builder.proxy(
            reqwest::Proxy::all(proxy)
                .map_err(|_| ProxyError::ConfigError("invalid explicit proxy".into()))?,
        );
    }
    let client = builder
        .build()
        .map_err(|_| ProxyError::ConfigError("cannot build AI outbound client".into()))?;
    Ok((client, proxy))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_route_rejects_self_loop_and_unknown_schemes() {
        assert!(validate("custom-proxy", Some("http://127.0.0.1:16721")).is_err());
        assert!(validate("custom-proxy", Some("file:///etc/passwd")).is_err());
        assert!(validate("custom-proxy", Some("socks5h://127.0.0.1:15722")).is_ok());
        assert!(validate("direct", None).is_ok());
    }
    #[tokio::test]
    async fn production_initialization_never_sends_direct_before_preferences_load() {
        assert!(snapshot_of(initial_egress()).await.is_err());
    }
    #[tokio::test]
    async fn route_policy_uses_explicit_proxy_and_fails_closed_without_control() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let router = axum::Router::new().fallback(|| async { "fixture-proxy" });
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let (direct, url) = snapshot_of(Egress {
            mode: "direct".into(),
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(url.is_none());
        assert_eq!(
            direct
                .get(format!("http://127.0.0.1:{port}/v1"))
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "fixture-proxy"
        );
        let (custom, url) = snapshot_of(Egress {
            mode: "custom-proxy".into(),
            custom: Some(format!("http://127.0.0.1:{port}")),
            ..Default::default()
        })
        .await
        .unwrap();
        assert!(url.is_some());
        assert_eq!(
            custom
                .get("http://no-dns-fixture.invalid/v1")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "fixture-proxy"
        );
        assert!(snapshot_of(Egress {
            mode: "managed-network".into(),
            alive: true,
            port: Some(port),
            health: Some(Health {
                socket: std::path::PathBuf::from("/tmp/si-assist-no-such-fixture.sock"),
                session: None
            }),
            ..Default::default()
        })
        .await
        .is_err());
        assert!(snapshot_of(Egress {
            mode: "managed-network".into(),
            ..Default::default()
        })
        .await
        .is_err());
        server.abort();
    }
}
