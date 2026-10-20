//! Explicit system-proxy destinations are data, never shell commands or control endpoints.
use anyhow::{ensure, Result};
pub fn validate_host(host: &str) -> Result<()> {
    ensure!(
        !host.is_empty() && host.len() <= 253 && host.is_ascii(),
        "Proxy host must be an ASCII hostname or IP address (1–253 bytes)"
    );
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        ensure!(
            !ip.is_unspecified() && !ip.is_multicast(),
            "Proxy host cannot be unspecified or multicast"
        );
        if let std::net::IpAddr::V4(ip) = ip {
            ensure!(!ip.is_broadcast(), "Proxy host cannot be broadcast");
        }
        return Ok(());
    }
    ensure!(
        matches!(url::Host::parse(host), Ok(url::Host::Domain(_))),
        "Use a canonical IP address or hostname"
    );
    ensure!(
        !host.ends_with('.')
            && host.split('.').all(|label| !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')),
        "Proxy host must not contain a URL, port, credentials or control characters"
    );
    Ok(())
}
pub fn needs_revision9(host: &str) -> bool {
    !host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}
pub fn authority(host: &str) -> String {
    if host.contains(':') {
        format!("[{host}]")
    } else {
        host.into()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_destination_data_without_expanding_control_or_shell_syntax() {
        for host in ["127.0.0.1", "::1", "localhost", "proxy.example.invalid", "192.0.2.1"] {
            assert!(validate_host(host).is_ok(), "{host}");
        }
        for host in [
            "",
            "0.0.0.0",
            "::",
            "224.0.0.1",
            "255.255.255.255",
            "user@host",
            "host:7890",
            "host\n",
            "https://host",
            "-host.invalid",
            "host..invalid",
            "a;echo",
        ] {
            assert!(validate_host(host).is_err(), "{host}");
        }
        assert!(needs_revision9("localhost"));
        assert!(!needs_revision9("127.0.0.1"));
    }
}
