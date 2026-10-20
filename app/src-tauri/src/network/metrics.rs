//! Bounded metric reads must never hold the lifecycle mutex while awaiting a
//! streaming response. Traffic and the slower memory stream are independent.
use super::*;

struct Target {
    generation: u64,
    socket: PathBuf,
    managed: bool,
    session: Option<ipc::OwnerSessionProof>,
}
impl Target {
    async fn read(&self, path: &str) -> Result<Value> {
        if !self.managed {
            return ipc::read_mihomo_metric(&self.socket, path).await;
        }
        // Keep the existing authenticated, allow-listed helper boundary. No
        // privileged socket or unbounded stream is exposed to the renderer.
        let response = ipc::control_mihomo(
            &credentials()?,
            self.session.as_ref().context("owner proof unavailable")?,
            &ipc::MihomoControlRequest {
                method: "GET".into(),
                path: path.into(),
                body: None,
            },
        )
        .await?;
        ensure!(response.code == 0, "managed control rejected: {}", response.message);
        response.data.context("managed control omitted result")
    }
}

pub(super) async fn sample(state: &NetworkState, args: &Value) -> Result<Value> {
    let metric = args.get("metric").and_then(Value::as_str);
    ensure!(metric.is_none() || matches!(metric, Some("traffic" | "memory")), "unknown metric");
    let target = {
        let runtime = state.runtime.lock().await;
        ensure!(runtime.phase == "running", "network core is not running");
        ensure!(args.get("generation").and_then(Value::as_u64).map_or(true, |g| g == runtime.generation), "network core changed during sampling");
        Target {
            generation: runtime.generation,
            socket: runtime.socket.clone(),
            managed: runtime.managed,
            session: runtime.session.clone(),
        }
    };
    let mut result = json!({"generation":target.generation});
    match metric {
        Some("traffic") => result["traffic"] = target.read("/traffic").await?,
        Some("memory") => result["memory"] = target.read("/memory").await?,
        _ => {
            // Retain the original command shape for older callers.
            let (traffic, memory) = tokio::join!(target.read("/traffic"), target.read("/memory"));
            result["traffic"] = traffic?;
            result["memory"] = memory?;
        }
    }
    let runtime = state.runtime.lock().await;
    ensure!(runtime.phase == "running" && runtime.generation == target.generation, "network core changed during sampling");
    result["sampledAt"] = chrono::Utc::now().timestamp_millis().into();
    Ok(result)
}

#[cfg(test)]
mod tests;
