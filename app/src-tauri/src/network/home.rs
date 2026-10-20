//! Homepage requests use this core's explicit proxy, with no direct fallback.
use super::*;

fn target(id: &str) -> Result<&'static str> {
    match id {
        "apple" => Ok("https://www.apple.com"),
        "github" => Ok("https://github.com"),
        "google" => Ok("https://www.google.com/generate_204"),
        "youtube" => Ok("https://www.youtube.com/generate_204"),
        "ip" => Ok("https://speed.cloudflare.com/meta"),
        _ => bail!("Unknown homepage probe"),
    }
}

pub(super) async fn probe(state: &NetworkState, args: &Value) -> Result<Value> {
    let id = text(args, "id")?;
    let url = target(id)?;
    let generation = args["generation"]
        .as_u64()
        .context("Network generation required")?;
    let port = {
        let runtime = state.runtime.lock().await;
        ensure!(
            runtime.phase == "running" && runtime.generation == generation,
            "Start Sivio network or refresh before testing"
        );
        runtime.port.context("Network port unavailable")?
    };
    // Loopback clients are exempt from LAN authentication in generated core configs.
    let proxy = reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .proxy(proxy)
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let started = std::time::Instant::now();
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("Request failed or timed out through Sivio network"))?;
    let status = response.status().as_u16();
    let mut result = json!({"id":id,"httpStatus":status,"elapsedMs":started.elapsed().as_millis(),"successfulHttpResponse":response.status().is_success()});
    if id == "ip" {
        ensure!(
            response.status().is_success(),
            "IP provider returned HTTP {status}"
        );
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            ensure!(
                bytes.len() + chunk.len() <= 32 * 1024,
                "IP response too large"
            );
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).context("Invalid IP response")?;
        let ip = value["clientIp"]
            .as_str()
            .context("IP address unavailable")?;
        ip.parse::<std::net::IpAddr>()
            .context("Invalid IP address")?;
        result = json!({"ip":ip,"country":value["country"],"city":value["city"],"region":value["region"],"asn":value["asn"],"organization":value["asOrganization"],"source":"Cloudflare"});
    }
    let runtime = state.runtime.lock().await;
    ensure!(
        runtime.phase == "running" && runtime.generation == generation,
        "Network changed during request; retry required"
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_fixed_https_destinations_are_accepted() {
        for id in ["apple", "github", "google", "youtube", "ip"] {
            assert!(target(id).unwrap().starts_with("https://"));
        }
        assert!(target("http://localhost").is_err());
        assert!(target("").is_err());
    }
    #[tokio::test]
    async fn stopped_core_never_falls_back_to_direct() {
        let state = NetworkState::default();
        let error = probe(&state, &json!({"id":"ip","generation":0}))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Start Sivio"));
    }
}
