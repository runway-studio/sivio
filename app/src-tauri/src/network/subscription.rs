use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct Options {
    pub user_agent: String,
    pub timeout_seconds: u64,
    pub via: String,
    pub accept_invalid_certs: bool,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            user_agent: "Sivio/0.1 Mihomo".into(),
            timeout_seconds: 60,
            via: "direct".into(),
            accept_invalid_certs: false,
        }
    }
}
impl Options {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            (1..=300).contains(&self.timeout_seconds),
            "Subscription timeout must be 1–300 seconds"
        );
        ensure!(
            ["direct", "system-proxy", "managed-network"].contains(&self.via.as_str()),
            "Invalid subscription download route"
        );
        ensure!(
            self.user_agent.len() <= 512
                && reqwest::header::HeaderValue::from_str(&self.user_agent).is_ok(),
            "Invalid subscription User-Agent"
        );
        Ok(())
    }
    pub fn client(&self, port: Option<u16>) -> Result<reqwest::Client> {
        self.validate()?;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(self.timeout_seconds))
            .redirect(reqwest::redirect::Policy::limited(5))
            .danger_accept_invalid_certs(self.accept_invalid_certs);
        if let Some(port) = port {
            builder = builder.proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{port}"))?);
        } else if self.via == "system-proxy" {
            let system = sysproxy::Sysproxy::get_system_proxy()
                .map_err(|_| anyhow::anyhow!("System proxy is unavailable"))?;
            ensure!(
                system.enable && !system.host.is_empty() && system.port > 0,
                "System proxy is not enabled; direct fallback is disabled"
            );
            let host = if system.host.contains(':') && !system.host.starts_with('[') {
                format!("[{}]", system.host)
            } else {
                system.host
            };
            builder = builder.proxy(reqwest::Proxy::all(format!(
                "http://{host}:{}",
                system.port
            ))?);
        } else {
            ensure!(
                self.via != "managed-network",
                "Managed network is unavailable; direct fallback is disabled"
            );
        }
        Ok(builder.build()?)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_options_validate_and_never_fall_back_from_managed_network() {
        let mut options = Options::default();
        assert!(options.validate().is_ok());
        options.via = "managed-network".into();
        assert!(options.client(None).is_err());
        assert!(options.client(Some(15722)).is_ok());
        options.timeout_seconds = 301;
        assert!(options.validate().is_err());
        options.timeout_seconds = 1;
        options.user_agent = "header\r\ninjected:true".into();
        assert!(options.validate().is_err());
    }
}
