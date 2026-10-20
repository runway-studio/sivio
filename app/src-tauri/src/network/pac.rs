//! A loopback-only PAC server whose lifetime follows the owned system proxy.
use anyhow::{ensure, Result};
pub const DEFAULT_SCRIPT: &str = r#"function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === 'localhost' || shExpMatch(host, '127.*') || host === '::1') return 'DIRECT';
  return 'PROXY 127.0.0.1:__MIXED_PORT__';
}"#;
pub fn validate(script: &str) -> Result<()> {
    ensure!(script.len() <= 256 * 1024, "PAC script exceeds 256 KiB");
    let runtime = rquickjs::Runtime::new()?;
    runtime.set_memory_limit(4 * 1024 * 1024);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(200);
    runtime.set_interrupt_handler(Some(Box::new(move || std::time::Instant::now() > deadline)));
    let context = rquickjs::Context::full(&runtime)?;
    let callable: bool =
        context.with(|ctx| ctx.eval(format!("{script}\ntypeof FindProxyForURL === 'function'")))?;
    ensure!(callable, "PAC must define FindProxyForURL");
    Ok(())
}
pub async fn start(port: u16, mixed: u16, script: &str) -> Result<tokio::task::JoinHandle<()>> {
    validate(script)?;
    let body = script.replace("__MIXED_PORT__", &mixed.to_string());
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let router = axum::Router::new().route(
        "/commands/pac",
        axum::routing::get(move || {
            let body = body.clone();
            async move {
                (
                    [
                        ("content-type", "application/x-ns-proxy-autoconfig"),
                        ("cache-control", "no-store"),
                    ],
                    body,
                )
            }
        }),
    );
    Ok(tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            log::warn!("Sivio PAC server stopped: {error}");
        }
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn serves_only_pac_route_on_owned_loopback_listener() {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let server = start(port, 15722, DEFAULT_SCRIPT).await.unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("http://127.0.0.1:{port}/commands/pac"))
            .send()
            .await
            .unwrap();
        assert!(response.status().is_success());
        let text = response.text().await.unwrap();
        assert!(text.contains("PROXY 127.0.0.1:15722"));
        assert!(!text.contains("; DIRECT"));
        assert_eq!(
            client
                .get(format!("http://127.0.0.1:{port}/secret"))
                .send()
                .await
                .unwrap()
                .status(),
            404
        );
        server.abort();
    }
    #[test]
    fn invalid_or_hanging_pac_is_rejected() {
        assert!(validate("var missing = 1;").is_err());
        assert!(validate("while(true){}").is_err());
        assert!(validate(DEFAULT_SCRIPT).is_ok());
    }
}
