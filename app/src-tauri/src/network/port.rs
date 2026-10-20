//! Check live loopback ownership before testing a reusable listener (including LAN binds).
use super::Settings;
use anyhow::{Context, Result};
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream, ToSocketAddrs, UdpSocket},
    time::Duration,
};

fn dns_listener(yaml: &str) -> Result<Option<SocketAddr>> {
    let config: serde_yaml_ng::Value = serde_yaml_ng::from_str(yaml)?;
    dns_address(&config["dns"])
}

fn dns_address(dns: &serde_yaml_ng::Value) -> Result<Option<SocketAddr>> {
    if dns["enable"].as_bool() != Some(true) {
        return Ok(None);
    }
    let Some(address) = dns["listen"].as_str().filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let address = if address.starts_with(':') {
        format!("0.0.0.0{address}")
    } else {
        address.into()
    };
    let address = address
        .to_socket_addrs()
        .context("DNS listen address is invalid")?
        .next()
        .context("DNS listen address is unavailable")?;
    Ok((address.port() != 0).then_some(address))
}

pub(super) fn validate_dns_ports(
    config: &serde_yaml_ng::Mapping,
    settings: &Settings,
) -> Result<()> {
    let Some(dns) = config.get("dns") else {
        return Ok(());
    };
    let Some(address) = dns_address(dns)? else {
        return Ok(());
    };
    let port = address.port();
    anyhow::ensure!(
        ![
            settings.mixed_port,
            settings.http_port,
            settings.socks_port,
            settings.redir_port
        ]
        .contains(&port)
            && !(settings.system_proxy
                && settings.proxy_mode == "pac"
                && settings.pac_port == port)
            && !(settings.controller_enabled && settings.controller_port == port),
        "DNS listen port must be distinct from proxy, PAC and controller ports"
    );
    Ok(())
}

fn reachable(mut address: SocketAddr) -> SocketAddr {
    if address.ip().is_unspecified() {
        address.set_ip(if address.is_ipv4() {
            std::net::Ipv4Addr::LOCALHOST.into()
        } else {
            std::net::Ipv6Addr::LOCALHOST.into()
        });
    }
    address
}

pub(super) fn check_dns(next: &str, current: Option<&str>, managed: bool) -> Result<()> {
    let Some(address) = dns_listener(next)? else {
        return Ok(());
    };
    if let Some(current) = current {
        let config: serde_yaml_ng::Value = serde_yaml_ng::from_str(current)?;
        if dns_listener(current)?.is_some_and(|old| old.port() == address.port())
            || ["mixed-port", "port", "socks-port", "redir-port"]
                .into_iter()
                .any(|key| config[key].as_u64() == Some(u64::from(address.port())))
        {
            return Ok(());
        }
    }
    let conflict = || format!("DNS 监听端口 {} 不可用；旧网络未被修改", address.port());
    if TcpStream::connect_timeout(&reachable(address), Duration::from_millis(150)).is_ok() {
        anyhow::bail!(conflict());
    }
    // A root-owned listener can use a port this user's bind cannot test.
    for bind in [
        UdpSocket::bind(address).map(drop),
        if managed {
            Ok(())
        } else {
            TcpListener::bind(address).map(drop)
        },
    ] {
        match bind {
            Err(error) if managed && error.kind() == std::io::ErrorKind::PermissionDenied => {}
            result => result.with_context(conflict)?,
        }
    }
    Ok(())
}

pub(super) async fn dns_ready(yaml: &str) -> bool {
    use tokio::net::{TcpStream, UdpSocket};
    let address = match dns_listener(yaml) {
        Ok(Some(address)) => reachable(address),
        Ok(None) => return true,
        Err(_) => return false,
    };
    let result = tokio::time::timeout(Duration::from_millis(300), async {
        let _tcp = TcpStream::connect(address).await?;
        let udp = UdpSocket::bind(if address.is_ipv4() {
            "127.0.0.1:0"
        } else {
            "[::1]:0"
        })
        .await?;
        udp.connect(address).await?;
        // An empty-question DNS packet elicits a local error response without
        // querying an upstream resolver (Mihomo rejects it before resolution).
        udp.send(&[0x53, 0x49, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            .await?;
        let mut response = [0; 512];
        let size = udp.recv(&mut response).await?;
        Ok::<bool, std::io::Error>(
            size >= 12 && response[..2] == [0x53, 0x49] && response[2] & 0x80 != 0,
        )
    })
    .await;
    matches!(result, Ok(Ok(true)))
}

pub(super) fn check(port: u16, lan: bool, managed: bool) -> Result<()> {
    check_with(port, lan, managed, |address| {
        TcpListener::bind(address).map(drop)
    })
}

fn listeners(settings: &Settings, managed: bool) -> Vec<(u16, bool, bool)> {
    let mut ports = [
        settings.mixed_port,
        settings.http_port,
        settings.socks_port,
        settings.redir_port,
    ]
    .into_iter()
    .filter(|port| *port != 0)
    .map(|port| (port, settings.allow_lan, managed))
    .collect::<Vec<_>>();
    if settings.system_proxy && settings.proxy_mode == "pac" {
        ports.push((settings.pac_port, false, false));
    }
    if settings.controller_enabled {
        ports.push((settings.controller_port, false, false));
    }
    ports
}

pub(super) fn check_settings(
    next: &Settings,
    current: Option<&Settings>,
    managed: bool,
) -> Result<()> {
    let owned = current
        .map(|settings| listeners(settings, managed))
        .unwrap_or_default();
    for (port, lan, root) in listeners(next, managed) {
        // An unchanged or exchanged self-owned listener is released by our
        // serialized stop. All ports are checked again before starting.
        if !owned.iter().any(|(old, _, _)| *old == port) {
            check(port, lan, root)?;
        }
    }
    Ok(())
}

pub(super) async fn listeners_ready(settings: &Settings) -> bool {
    for port in [
        settings.mixed_port,
        settings.http_port,
        settings.socks_port,
        settings.redir_port,
    ] {
        if port != 0
            && !matches!(
                tokio::time::timeout(
                    Duration::from_millis(200),
                    tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                )
                .await,
                Ok(Ok(_))
            )
        {
            return false;
        }
    }
    true
}

fn check_with(
    port: u16,
    lan: bool,
    managed: bool,
    bind: impl FnOnce(SocketAddrV4) -> std::io::Result<()>,
) -> Result<()> {
    let conflict = || format!("代理端口 {port} 正被使用，请在网络设置中更换端口；现有进程未被修改");
    // Darwin permits a reusable wildcard listener beside a specific-address
    // listener. Probe loopback first; do not mistake that coexistence for a free port.
    match TcpStream::connect_timeout(
        &SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into(),
        Duration::from_millis(150),
    ) {
        Ok(_) => anyhow::bail!(conflict()),
        Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {}
        Err(error) => return Err(error).context(conflict()),
    }
    // A service core runs as root. Darwin can reject this user's bind while
    // that core's closed connections are in TIME_WAIT, although the service
    // can restart its own listener. Only probe live ownership here; the helper
    // remains responsible for binding and validating its managed runtime.
    if managed {
        return Ok(());
    }
    // An ordinary core shares this user's authority, so bind/listen is valid.
    let host = if lan {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    };
    bind(SocketAddrV4::new(host, port)).with_context(conflict)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
    };

    #[test]
    fn rejects_udp_only_dns_conflicts_before_stopping_and_preserves_owned_dns() {
        let foreign = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = foreign.local_addr().unwrap().port();
        let yaml = format!("dns: {{enable: true, listen: '127.0.0.1:{port}'}}");
        assert!(check_dns(&yaml, None, false).is_err());
        check_dns(&yaml, Some(&yaml), false).unwrap();
        check_dns("dns: {enable: false}", None, false).unwrap();
        assert_eq!(foreign.local_addr().unwrap().port(), port);
        let settings = Settings::default();
        let config = serde_yaml_ng::from_str(&format!(
            "dns: {{enable: true, listen: '127.0.0.1:{}'}}",
            settings.mixed_port
        ))
        .unwrap();
        assert!(validate_dns_ports(&config, &settings).is_err());
    }

    #[tokio::test]
    async fn dns_readiness_does_not_accept_a_udp_listener_without_its_tcp_service() {
        let udp = UdpSocket::bind("127.0.0.1:0").unwrap();
        let yaml = format!(
            "dns: {{enable: true, listen: '127.0.0.1:{}'}}",
            udp.local_addr().unwrap().port()
        );
        assert!(!dns_ready(&yaml).await);
    }

    #[test]
    fn checks_secondary_listeners_and_allows_owned_port_swaps_before_stop() {
        let mixed = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let socks = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let foreign = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let old = Settings {
            mixed_port: mixed.local_addr().unwrap().port(),
            socks_port: socks.local_addr().unwrap().port(),
            ..Settings::default()
        };
        let next = Settings {
            mixed_port: old.socks_port,
            socks_port: old.mixed_port,
            ..old.clone()
        };
        check_settings(&next, Some(&old), false).unwrap();
        let blocked = Settings {
            http_port: foreign.local_addr().unwrap().port(),
            ..old.clone()
        };
        assert!(check_settings(&blocked, Some(&old), false).is_err());
        // The running old listeners cannot be exempted after stop.
        assert!(check_settings(&next, None, false).is_err());
        assert!(TcpStream::connect(foreign.local_addr().unwrap()).is_ok());
    }

    #[tokio::test]
    async fn readiness_requires_all_enabled_proxy_ports() {
        let mixed = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let secondary = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let settings = Settings {
            mixed_port: mixed.local_addr().unwrap().port(),
            http_port: secondary.local_addr().unwrap().port(),
            ..Settings::default()
        };
        assert!(listeners_ready(&settings).await);
        drop(secondary);
        assert!(!listeners_ready(&settings).await);
    }

    #[test]
    fn managed_preflight_does_not_bind_with_the_wrong_user_authority() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        check_with(port, false, true, |_| {
            panic!("App must not bind the root service port")
        })
        .unwrap();
        assert!(check_with(port, false, false, |_| Err(
            std::io::ErrorKind::AddrInUse.into()
        ))
        .is_err());
    }
    #[test]
    fn rejects_live_listener_without_interrupting_it() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        assert!(check(address.port(), false, false).is_err());
        assert!(check(address.port(), true, false).is_err());
        assert!(check(address.port(), false, true).is_err());
        assert!(check(address.port(), true, true).is_err());
        let _client = TcpStream::connect(address).unwrap();
        assert!(listener.accept().is_ok());
    }

    #[test]
    fn closed_connections_do_not_block_immediate_restarts() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (mut accepted, _) = listener.accept().unwrap();
        accepted.write_all(b"x").unwrap();
        accepted.shutdown(std::net::Shutdown::Write).unwrap();
        let mut bytes = Vec::new();
        client.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, b"x");
        client.shutdown(std::net::Shutdown::Write).unwrap();
        accepted.read_to_end(&mut Vec::new()).unwrap();
        drop(accepted);
        drop(client);
        drop(listener);
        for _ in 0..5 {
            check(address.port(), false, false).unwrap();
            check(address.port(), false, true).unwrap();
        }
    }
}
