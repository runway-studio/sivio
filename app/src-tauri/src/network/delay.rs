//! Delay probes snapshot their target and release the lifecycle mutex before I/O.
use super::*;

/// Probe individual members. Mihomo's /group/.../delay resets forced choices
/// on URLTest/Fallback groups, so background measurement must never call it.
pub(super) async fn automatic(state: &NetworkState, settings: &Settings) -> Result<()> {
    use futures::{stream, StreamExt};
    let (target, generation) = {
        let mut runtime = state.runtime.lock().await;
        let now = chrono::Utc::now().timestamp();
        if settings.auto_delay_minutes == 0
            || runtime.phase != "running"
            || now.saturating_sub(runtime.last_delay)
                < settings.auto_delay_minutes.saturating_mul(60) as i64
        {
            return Ok(());
        }
        runtime.last_delay = now;
        (ControlTarget::from(&*runtime), runtime.generation)
    };
    let proxies = control_at(&target, "GET", "/proxies", None).await?;
    let nodes = automatic_nodes(&proxies);
    stream::iter(nodes)
        .for_each_concurrent(4, |node| async move {
            let _ = measure(
                state,
                &json!({
                    "node":node, "url":settings.latency_url,
                    "timeout":settings.latency_timeout, "generation":generation
                }),
            )
            .await;
        })
        .await;
    Ok(())
}

fn automatic_nodes(proxies: &Value) -> Vec<String> {
    let Some(items) = proxies["proxies"].as_object() else {
        return vec![];
    };
    items
        .values()
        .filter_map(|item| item["all"].as_array())
        .flatten()
        .filter_map(Value::as_str)
        .filter(|name| {
            items.get(*name).is_some_and(|item| {
                item.get("all").is_none()
                    && !matches!(item["type"].as_str(), Some("Reject" | "RejectDrop"))
            })
        })
        .map(str::to_owned)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .take(10000)
        .collect()
}

pub(super) async fn measure(state: &NetworkState, args: &Value) -> Result<Value> {
    let node = text(args, "node")?;
    ensure!(
        !node.is_empty() && node.len() <= 1024 && !node.chars().any(char::is_control),
        "invalid proxy name"
    );
    let url = text(args, "url")?;
    let parsed = url::Url::parse(url).context("测速地址必须是有效的 HTTP(S) URL")?;
    ensure!(
        url.len() <= 4096
            && matches!(parsed.scheme(), "http" | "https")
            && parsed.host_str().is_some()
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.fragment().is_none(),
        "测速地址必须是无凭据的 HTTP(S) URL"
    );
    let timeout = args
        .get("timeout")
        .and_then(Value::as_u64)
        .context("delay timeout required")?;
    ensure!(
        (100..=5000).contains(&timeout),
        "delay timeout must be 100–5000 ms"
    );
    let generation = args
        .get("generation")
        .and_then(Value::as_u64)
        .context("network generation required")?;
    let target = {
        let runtime = state.runtime.lock().await;
        ensure!(
            runtime.phase == "running" && runtime.generation == generation,
            "network core changed before delay test"
        );
        ControlTarget::from(&*runtime)
    };
    let encoded =
        percent_encoding::utf8_percent_encode(node, percent_encoding::NON_ALPHANUMERIC).to_string();
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("url", url)
        .append_pair("timeout", &timeout.to_string())
        .finish();
    let result = control_at(
        &target,
        "GET",
        &format!("/proxies/{encoded}/delay?{query}"),
        None,
    )
    .await?;
    let runtime = state.runtime.lock().await;
    ensure!(
        runtime.phase == "running" && runtime.generation == generation,
        "network core changed during delay test"
    );
    let delay = result
        .get("delay")
        .and_then(Value::as_u64)
        .context("delay result unavailable")?;
    Ok(json!({"node":node,"delay":delay,"generation":generation}))
}

#[cfg(test)]
mod tests;
