use std::{path::Path, sync::Arc, time::Duration};

#[cfg(windows)]
use anyhow::Result;
#[cfg(unix)]
use anyhow::{Result, anyhow};
use kode_bridge::{ClientConfig, IpcHttpClient};
use log::{debug, warn};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

#[cfg(all(windows, any(not(feature = "test"), test)))]
mod windows_identity;

use crate::{
    AuthenticatedRequest, AuthenticatedSessionRequest, IPC_AUTH_EXPECT, IPC_PATH, IpcCommand,
    MIN_REQUIRED_SERVICE_REVISION, MacosProxyConfig, OwnerCredentials, OwnerSessionProof, ProtocolInfo,
    ProtocolVersion, ProxyApplyOutcome, RuntimeBundle, RuntimeFileOutcome, RuntimeFileRequest, ServiceStatusSnapshot,
    StageRuntimeOutcome, StartClashRequest, StartClashResult, WriterConfig,
    core::structure::{JsonConvert, Response},
};

static CLIENT_CONFIG: Lazy<Arc<RwLock<Option<IpcConfig>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

static IPC_AUTH_HEADER_KEY: &str = "X-IPC-Magic";
const LIFECYCLE_TIMEOUT: Duration = Duration::from_secs(30);
// Large cache chunks need a longer timeout than control messages.
const RUNTIME_FILE_TIMEOUT: Duration = Duration::from_secs(15);

fn protected<'a>(request: kode_bridge::HttpRequestBuilder<'a>) -> kode_bridge::HttpRequestBuilder<'a> {
    request.header(
        crate::SERVICE_PROTOCOL_HEADER,
        ProtocolVersion::current().header_value(),
    )
}

#[derive(Clone, Copy)]
enum Verb {
    Get,
    Post,
    Put,
    Delete,
}

/// Sends a versioned, authenticated request using the route's required envelope.
/// `session` selects owner-only or active-session authentication.
async fn protected_call<P, R>(
    verb: Verb,
    command: IpcCommand,
    credentials: &OwnerCredentials,
    session: Option<&OwnerSessionProof>,
    payload: P,
    timeout: Option<Duration>,
) -> Result<Response<R>>
where
    P: serde::Serialize + for<'de> serde::Deserialize<'de>,
    R: for<'de> serde::Deserialize<'de>,
{
    // After wake, verifying the peer can take longer than the normal 50 ms probe.
    // Give renewal its own handshake budget within the desktop heartbeat deadline.
    let handshake_timeout = matches!(command, IpcCommand::RenewOwner).then(|| Duration::from_millis(750));
    let client = connect_with_handshake_timeout(handshake_timeout).await?;
    let body = match session {
        None => AuthenticatedRequest {
            credentials: credentials.clone(),
            payload,
        }
        .to_json_value()?,
        Some(session) => AuthenticatedSessionRequest {
            credentials: credentials.clone(),
            session: session.clone(),
            payload,
        }
        .to_json_value()?,
    };
    let path = command.as_ref();
    let request = protected(match verb {
        Verb::Get => client.get(path),
        Verb::Post => client.post(path),
        Verb::Put => client.put(path),
        Verb::Delete => client.delete(path),
    });
    let request = match timeout {
        Some(timeout) => request.timeout(timeout),
        None => request,
    };
    let response = request.json_body(&body).send().await?.json::<Response<R>>()?;
    Ok(response)
}

#[derive(Debug, Clone)]
pub struct IpcConfig {
    pub default_timeout: Duration,
    pub max_retries: usize,
    pub retry_delay: Duration,
}

impl Default for IpcConfig {
    fn default() -> Self {
        Self {
            default_timeout: Duration::from_millis(50),
            max_retries: 8,
            retry_delay: Duration::from_millis(150),
        }
    }
}

pub async fn set_config(config: Option<IpcConfig>) {
    let mut guard = CLIENT_CONFIG.write().await;
    *guard = config;
}

pub async fn connect() -> Result<IpcHttpClient> {
    connect_with_handshake_timeout(None).await
}

async fn connect_with_handshake_timeout(handshake_timeout: Option<Duration>) -> Result<IpcHttpClient> {
    debug!("Connecting to IPC at {}", IPC_PATH);

    #[cfg(unix)]
    {
        if let Err(err) = Path::metadata(IPC_PATH.as_ref()) {
            return Err(anyhow!("IPC path unavailable: {err}"));
        }
    }

    let c = { CLIENT_CONFIG.read().await.clone() }.unwrap_or_default();
    debug!("Using config: {:?}", c);
    let client = kode_bridge::IpcHttpClient::with_config(
        IPC_PATH,
        ClientConfig {
            default_timeout: c.default_timeout,
            max_retries: c.max_retries,
            retry_delay: c.retry_delay,
            enable_pooling: true,
            require_windows_server_system: false,
            #[cfg(all(windows, not(feature = "test")))]
            windows_server_pid_verifier: Some(windows_identity::verify_registered_service_process_id),
            #[cfg(all(windows, feature = "test"))]
            windows_server_pid_verifier: None,
            ..Default::default()
        },
    )?;

    let probe = client
        .get(IpcCommand::Magic.as_ref())
        .header(IPC_AUTH_HEADER_KEY, IPC_AUTH_EXPECT);
    let probe = match handshake_timeout {
        Some(timeout) => probe.timeout(timeout),
        None => probe,
    };
    if let Err(e) = probe.send().await {
        warn!("Failed to connect to IPC server: {}", e);
        return Err(anyhow::anyhow!("Failed to connect to IPC server: {}", e));
    }

    Ok(client)
}

pub fn is_ipc_path_exists() -> bool {
    Path::new(IPC_PATH).exists()
}

pub async fn get_version() -> Result<Response<ProtocolInfo>> {
    let client = connect().await?;
    let response = client
        .get(IpcCommand::GetVersion.as_ref())
        .header(IPC_AUTH_HEADER_KEY, IPC_AUTH_EXPECT)
        .send()
        .await?
        .json::<Response<ProtocolInfo>>()?;
    Ok(response)
}

pub async fn get_status(credentials: &OwnerCredentials) -> Result<Response<ServiceStatusSnapshot>> {
    protected_call(Verb::Get, IpcCommand::Status, credentials, None, (), None).await
}

pub async fn is_reinstall_service_needed() -> bool {
    is_ipc_path_exists()
        && match get_version().await {
            Ok(resp) => resp
                .data
                .is_none_or(|info| !info.supports_client(ProtocolVersion::current(), MIN_REQUIRED_SERVICE_REVISION)),
            Err(_) => true,
        }
}

pub async fn start_clash(
    credentials: &OwnerCredentials,
    body: &StartClashRequest,
) -> Result<Response<StartClashResult>> {
    protected_call(
        Verb::Post,
        IpcCommand::StartClash,
        credentials,
        None,
        body.clone(),
        Some(LIFECYCLE_TIMEOUT),
    )
    .await
}

/// Conditional start: an old client must never take over a newer owner's core.
pub async fn reconnect_clash(
    credentials: &OwnerCredentials,
    expired_generation: u64,
    body: &StartClashRequest,
) -> Result<Response<StartClashResult>> {
    protected_call(Verb::Post, IpcCommand::ReconnectClash, credentials, None,
        (expired_generation, body.clone()), Some(LIFECYCLE_TIMEOUT)).await
}

pub async fn get_clash_logs(credentials: &OwnerCredentials) -> Result<Response<Vec<String>>> {
    protected_call(Verb::Get, IpcCommand::GetClashLogs, credentials, None, (), None).await
}

pub async fn get_clash_logs_since(credentials: &OwnerCredentials, cursor: &crate::log_cursor::LogCursor) -> Result<Response<crate::log_cursor::LogBatch>> {
    protected_call(Verb::Get, IpcCommand::GetClashLogsSince, credentials, None, cursor.clone(), None).await
}
pub async fn get_clash_log_snapshot(credentials: &OwnerCredentials) -> Result<Response<String>> {
    protected_call(Verb::Get, IpcCommand::GetClashLogSnapshot, credentials, None, (), None).await
}

pub async fn stop_clash(credentials: &OwnerCredentials, session: &OwnerSessionProof) -> Result<Response<()>> {
    protected_call(
        Verb::Delete,
        IpcCommand::StopClash,
        credentials,
        Some(session),
        (),
        Some(LIFECYCLE_TIMEOUT),
    )
    .await
}

/// Stages `body` into the running core's generation without restarting it.
/// Call only when [`ProtocolInfo::supports_runtime_staging`] is true; `RestartRequired` is a
/// successful response that asks the caller to fall back to stop and start.
pub async fn stage_runtime(
    credentials: &OwnerCredentials,
    session: &OwnerSessionProof,
    body: &RuntimeBundle,
) -> Result<Response<StageRuntimeOutcome>> {
    protected_call(
        Verb::Put,
        IpcCommand::StageRuntime,
        credentials,
        Some(session),
        body.clone(),
        Some(LIFECYCLE_TIMEOUT),
    )
    .await
}

/// Requires [`ProtocolInfo::supports_runtime_file_read`]; advance `offset` until `len` is reached.
pub async fn read_runtime_file(
    credentials: &OwnerCredentials,
    session: &OwnerSessionProof,
    body: &RuntimeFileRequest,
) -> Result<Response<RuntimeFileOutcome>> {
    protected_call(
        Verb::Get,
        IpcCommand::ReadRuntimeFile,
        credentials,
        Some(session),
        body.clone(),
        Some(RUNTIME_FILE_TIMEOUT),
    )
    .await
}

pub async fn update_writer(
    credentials: &OwnerCredentials,
    session: &OwnerSessionProof,
    body: &WriterConfig,
) -> Result<Response<()>> {
    protected_call(
        Verb::Put,
        IpcCommand::UpdateWriter,
        credentials,
        Some(session),
        body.clone(),
        None,
    )
    .await
}

pub async fn set_system_proxy(
    credentials: &OwnerCredentials,
    session: &OwnerSessionProof,
    body: &MacosProxyConfig,
) -> Result<Response<ProxyApplyOutcome>> {
    protected_call(
        Verb::Put,
        IpcCommand::SetSystemProxy,
        credentials,
        Some(session),
        body.clone(),
        None,
    )
    .await
}

/// Inspects approved cores and global occupancy without exposing another owner's session.
pub async fn inspect_installation(requirements: &[crate::CoreRequirement]) -> Result<crate::InstallationStatus> {
    inspect_installation_with_digest(requirements, false).await
}

pub(crate) async fn inspect_installation_with_digest(
    requirements: &[crate::CoreRequirement],
    include_service_digest: bool,
) -> Result<crate::InstallationStatus> {
    let client = connect().await?;
    let response = protected(client.post(IpcCommand::InspectInstallation.as_ref()))
        .timeout(LIFECYCLE_TIMEOUT)
        .header(IPC_AUTH_HEADER_KEY, IPC_AUTH_EXPECT)
        .header(
            "X-Service-Digest",
            if include_service_digest { "true" } else { "false" },
        )
        .json_body(&serde_json::to_value(requirements)?)
        .send()
        .await?
        .json::<Response<crate::InstallationStatus>>()?;
    anyhow::ensure!(
        response.code == 0,
        "installation inspection rejected: {} ({})",
        response.message,
        response.code
    );
    response
        .data
        .ok_or_else(|| anyhow::anyhow!("service omitted installation status"))
}

/// Renew only the authenticated, currently active generation; callers schedule every five seconds.
pub async fn renew_owner(credentials: &OwnerCredentials, session: &OwnerSessionProof) -> Result<Response<()>> {
    protected_call(Verb::Post, IpcCommand::RenewOwner, credentials, Some(session), (), Some(Duration::from_secs(3))).await
}

pub async fn control_mihomo(credentials:&OwnerCredentials,session:&OwnerSessionProof,request:&crate::MihomoControlRequest)->Result<Response<serde_json::Value>> {protected_call(Verb::Post,IpcCommand::MihomoControl,credentials,Some(session),request.clone(),Some(Duration::from_secs(10))).await}
