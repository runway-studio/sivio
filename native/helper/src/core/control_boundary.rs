//! The privileged core socket stays root-private. Only this closed control surface
//! crosses the authenticated owner boundary; config-file reload and restart do not.
use crate::MihomoControlRequest;
use anyhow::{ensure, Result};

/// Only these bounded, read-only metrics may run outside the lifecycle lock.
pub fn is_metric_read(request: &MihomoControlRequest) -> bool {
    request.method == "GET"
        && matches!(request.path.as_str(), "/traffic" | "/memory")
        && request.body.is_none()
}
/// Proxy delay reads use the bounded control client and must not block leases.
pub fn is_observation_read(request: &MihomoControlRequest) -> bool {
    if is_metric_read(request) { return true; }
    let path = request.path.split('?').next().unwrap_or("");
    request.method == "GET" && request.body.is_none()
        && path.strip_prefix("/proxies/").and_then(|p| p.strip_suffix("/delay"))
            .is_some_and(|name| !name.is_empty() && !name.contains('/'))
        && validate(request).is_ok()
}
pub fn validate(request: &MihomoControlRequest) -> Result<()> {
    ensure!(request.path.len() <= 4096, "control path too long");
    let path = request.path.split('?').next().unwrap_or("");
    ensure!(
        path.starts_with('/') && !path.starts_with("//") && !path.contains('\\') && !request.path.contains('#'),
        "invalid control path"
    );
    validate_decoded_path(path)?;
    let url = url::Url::parse(&format!("http://localhost{}", request.path))?;
    ensure!(url.path() == path, "control path must not normalize");
    let named = |prefix: &str| {
        path.strip_prefix(prefix)
            .is_some_and(|name| !name.is_empty() && !name.contains('/'))
    };
    match request.method.as_str() {
        "GET" => {
            ensure!(request.body.is_none(), "read does not accept a body");
            ensure!(
                [
                    "/version",
                    "/configs",
                    "/proxies",
                    "/rules",
                    "/connections",
                    "/providers/proxies",
                    "/providers/rules",
                    "/dns/query",
                    "/memory",
                    "/traffic"
                ]
                .contains(&path)
                    || path.starts_with("/proxies/")
                    || path.starts_with("/group/")
                    || path.starts_with("/providers/proxies/")
                    || path.starts_with("/providers/rules/"),
                "control read route not allowed"
            );
            if ["/traffic", "/memory"].contains(&path) {
                ensure!(request.path == path, "metric queries do not accept parameters");
            }
        }
        "PUT" if named("/proxies/") => {
            let body = request
                .body
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| anyhow::anyhow!("selection requires a name"))?;
            ensure!(
                body.len() == 1
                    && body
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|s| s.len() <= 1024),
                "only a proxy selection name is accepted"
            );
        }
        "PUT" if named("/providers/proxies/") || named("/providers/rules/") => {
            ensure!(request.body.is_none(), "provider refresh does not accept a body")
        }
        "DELETE" if named("/proxies/") => ensure!(request.body.is_none(), "unfix does not accept a body"),
        "DELETE" if path == "/connections" || named("/connections/") => {
            ensure!(request.body.is_none(), "connection close does not accept a body")
        }
        "POST" if ["/cache/fakeip/flush", "/cache/dns/flush", "/configs/geo"].contains(&path) => {
            ensure!(request.body.is_none(), "cache flush does not accept a body")
        }
        "PATCH" if path == "/configs" => {
            let body = request
                .body
                .as_ref()
                .and_then(serde_json::Value::as_object)
                .ok_or_else(|| anyhow::anyhow!("mode required"))?;
            ensure!(
                body.len() == 1
                    && body
                        .get("mode")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|m| ["direct", "global", "rule"].contains(&m)),
                "only the runtime mode may be patched"
            );
        }
        _ => anyhow::bail!("privileged control mutation is not allowed"),
    };
    Ok(())
}
fn validate_decoded_path(path: &str) -> Result<()> {
    let mut current = path.to_owned();
    for _ in 0..6 {
        ensure!(
            !current.starts_with("//")
                && !current.contains('\\')
                && !current.chars().any(char::is_control)
                && !current.split('/').any(|part| part == "." || part == ".."),
            "encoded path traversal is not allowed"
        );
        let bytes = current.as_bytes();
        let mut output = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(a), Some(b)) = ((bytes[i + 1] as char).to_digit(16), (bytes[i + 2] as char).to_digit(16)) {
                    output.push((a * 16 + b) as u8);
                    i += 3;
                    continue;
                }
            }
            output.push(bytes[i]);
            i += 1;
        }
        let next = String::from_utf8(output)?;
        if next == current {
            return Ok(());
        }
        current = next;
    }
    anyhow::bail!("control path encoding is nested too deeply")
}
#[cfg(feature = "standalone")]
pub async fn execute(identity: &crate::OwnerIdentity, request: &MihomoControlRequest) -> Result<serde_json::Value> {
    validate(request)?;
    if ["/traffic", "/memory"].contains(&request.path.as_str()) {
        return metric_snapshot(std::path::Path::new(&crate::mihomo_ipc_path(identity)), &request.path).await;
    }
    let client = kode_bridge::IpcHttpClient::with_config(
        crate::mihomo_ipc_path(identity),
        kode_bridge::ClientConfig {
            default_timeout: std::time::Duration::from_secs(8),
            max_retries: 1,
            ..Default::default()
        },
    )?;
    let builder = match request.method.as_str() {
        "GET" => client.get(&request.path),
        "PUT" => client.put(&request.path),
        "PATCH" => client.patch(&request.path),
        "DELETE" => client.delete(&request.path),
        "POST" => client.post(&request.path),
        _ => unreachable!(),
    };
    let builder = if let Some(body) = &request.body {
        builder.json_body(body)
    } else {
        builder
    };
    let response = builder.send().await?;
    ensure!(response.is_success(), "Mihomo control returned {}", response.status());
    let text = response.body()?;
    ensure!(text.len() <= 8 * 1024 * 1024, "control response exceeds limit");
    if text.is_empty() {
        Ok(serde_json::json!({"ok":true}))
    } else {
        Ok(serde_json::from_str(&text)?)
    }
}
/// Read a bounded metric sample and drop its stream. Memory's first upstream
/// frame is deliberately zero, so wait for its second frame. No stream escapes
/// the authenticated owner boundary or accumulates an unbounded response.
#[cfg(any(feature = "client", feature = "standalone"))]
pub async fn metric_snapshot(socket: &std::path::Path, path: &str) -> Result<serde_json::Value> {
    ensure!(["/traffic", "/memory"].contains(&path), "unknown metric");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let client = kode_bridge::IpcStreamClient::with_config(
            socket,
            kode_bridge::StreamClientConfig {
                default_timeout: std::time::Duration::from_secs(4),
                max_retries: 1,
                ..Default::default()
            },
        )?;
        let response = client.get(path).send().await?;
        ensure!(response.is_success(), "metric request failed");
        let mut snapshot = None;
        let mut frames = 0;
        let wanted = if path == "/memory" { 2 } else { 1 };
        response
            .into_inner()
            .process_lines_with_timeout(std::time::Duration::from_secs(3), |line| {
                if line.len() > 8192 {
                    return Err("metric frame exceeds limit".into());
                }
                // Go's flushed HTTP response may include chunk framing lines. Only its
                // bounded JSON objects are data; TCP fragmentation is handled by LinesCodec.
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                    if value.is_object() {
                        let keys = if path == "/memory" {
                            vec!["inuse", "oslimit"]
                        } else {
                            vec!["up", "down", "upTotal", "downTotal"]
                        };
                        let mut bounded = serde_json::Map::new();
                        for key in keys {
                            if let Some(number) = value.get(key).and_then(serde_json::Value::as_u64) {
                                bounded.insert(key.into(), number.into());
                            }
                        }
                        if bounded.len() != if path == "/memory" { 2 } else { 4 } {
                            return Err("invalid metric frame".into());
                        }
                        frames += 1;
                        snapshot = Some(bounded.into());
                        if frames >= wanted {
                            return Ok(false);
                        }
                    }
                }
                Ok(true)
            })
            .await?;
        ensure!(
            frames >= wanted,
            "metric stream ended or timed out before a usable frame"
        );
        snapshot.ok_or_else(|| anyhow::anyhow!("metric sample unavailable"))
    })
    .await
    .map_err(|_| anyhow::anyhow!("metric sample timed out"))?
}
#[cfg(all(test, any(feature = "client", feature = "standalone"), unix))]
mod metric_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn bounded_metrics_handle_chunk_framing_skip_initial_memory_zero_and_close_live_stream() {
        for (path, frames, expected_key, expected) in [
            (
                "/traffic",
                vec![r#"{"up":12,"down":34,"upTotal":120,"downTotal":340}"#],
                "up",
                12,
            ),
            (
                "/memory",
                vec![r#"{"inuse":0,"oslimit":0}"#, r#"{"inuse":6543,"oslimit":0}"#],
                "inuse",
                6543,
            ),
        ] {
            let temp = tempfile::tempdir().unwrap();
            let socket = temp.path().join("metric.sock");
            let listener = tokio::net::UnixListener::bind(&socket).unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 4096];
                let count = stream.read(&mut request).await.unwrap();
                assert!(std::str::from_utf8(&request[..count]).unwrap().contains(path));
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n",
                    )
                    .await
                    .unwrap();
                for frame in frames {
                    let frame = format!("{frame}\n");
                    stream
                        .write_all(format!("{:x}\r\n{}\r\n", frame.len(), frame).as_bytes())
                        .await
                        .unwrap();
                }
                // Deliberately leave the response open. The sampler must cancel its socket.
                let count = tokio::time::timeout(std::time::Duration::from_secs(3), stream.read(&mut request))
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(count, 0);
            });
            let sample = metric_snapshot(&socket, path).await.unwrap();
            assert_eq!(sample[expected_key], expected);
            server.await.unwrap();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_exact_bounded_metric_reads_bypass_lifecycle_lock() {
        for path in ["/traffic", "/memory"] {
            assert!(is_metric_read(&request("GET", path, None)));
            assert!(!is_metric_read(&request("PUT", path, None)));
            assert!(!is_metric_read(&request("GET", path, Some(serde_json::json!({})))));
        }
        for path in ["/connections", "/configs", "/traffic?interval=0", "/memory/", "/%74raffic"] {
            assert!(!is_metric_read(&request("GET", path, None)));
        }
    }

    #[test]
    fn observation_unlock_only_allows_bounded_delay_or_metrics() {
        assert!(is_observation_read(&request("GET","/proxies/%E9%A6%99%E6%B8%AF%20%2B%201/delay?url=http%3A%2F%2Flocalhost&timeout=5000",None)));
        for path in ["/proxies/", "/proxies/A", "/group/A/delay", "/proxies/A/delay/extra", "/proxies/../delay", "/configs"] {
            assert!(!is_observation_read(&request("GET",path,None)), "{path}");
        }
        assert!(!is_observation_read(&request("PUT","/proxies/A/delay",None)));
        assert!(!is_observation_read(&request("GET","/proxies/A/delay",Some(serde_json::json!({})))));
    }

    fn request(method: &str, path: &str, body: Option<serde_json::Value>) -> MihomoControlRequest {
        MihomoControlRequest {
            method: method.into(),
            path: path.into(),
            body,
        }
    }
    #[test]
    fn root_file_reload_restart_and_tun_patch_are_rejected() {
        for req in [
            request("PUT", "/configs", Some(json!({"path":"/etc/sudoers"}))),
            request("POST", "/restart", None),
            request("PATCH", "/configs", Some(json!({"tun":{"enable":true}}))),
            request("GET", "/proxies/%2e%2e/restart", None),
            request("GET", "//example.com/configs", None),
            request("PUT", "/proxies/%252e%252e%252fconfigs", Some(json!({"name":"x"}))),
        ] {
            assert!(validate(&req).is_err());
        }
    }
    #[test]
    fn encoded_slash_in_a_proxy_name_is_not_path_traversal() {
        assert!(validate(&request("PUT", "/proxies/Auto%2FSelect", Some(json!({"name":"node"})))).is_ok());
        assert!(validate(&request(
            "GET",
            "/proxies/Region%2FNode/delay?url=https%3A%2F%2Fexample.com&timeout=5000",
            None
        ))
        .is_ok());
    }
    #[test]
    fn typed_selection_and_read_work() {
        assert!(validate(&request("PUT", "/proxies/group", Some(json!({"name":"node"})))).is_ok());
        assert!(validate(&request("GET", "/dns/query?name=example.com&type=A", None)).is_ok());
        assert!(validate(&request("PATCH", "/configs", Some(json!({"mode":"rule"})))).is_ok());
        assert!(validate(&request(
            "PUT",
            "/proxies/group",
            Some(json!({"name":"node","path":"/root"}))
        ))
        .is_err());
    }
}
