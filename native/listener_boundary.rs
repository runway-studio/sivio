//! LAN policy also covers custom inbound listeners, whose own `listen`/`users`
//! otherwise override Mihomo's global bind and authentication settings.
use anyhow::{ensure, Result};
use serde_yaml_ng::{Mapping, Value};
pub fn apply(config: &mut Mapping) -> Result<()> {
    let lan = config
        .get("allow-lan")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !lan {
        config.insert("bind-address".into(), "127.0.0.1".into());
    }
    if let Some(listeners) = config.get_mut("listeners") {
        let listeners = listeners
            .as_sequence_mut()
            .ok_or_else(|| anyhow::anyhow!("listeners must be a sequence"))?;
        for listener in listeners {
            let listener = listener
                .as_mapping_mut()
                .ok_or_else(|| anyhow::anyhow!("listener must be a mapping"))?;
            if !lan {
                listener.insert("listen".into(), "127.0.0.1".into());
                continue;
            }
            let kind = listener.get("type").and_then(Value::as_str).unwrap_or("");
            if ["http", "socks", "mixed"].contains(&kind) {
                if let Some(users) = listener.get("users") {
                    ensure!(users.as_sequence().is_some_and(|users|!users.is_empty() && users.iter().all(|user|user["username"].as_str().is_some_and(|name|!name.is_empty()) && user["password"].as_str().is_some_and(|password|password.len()>=16))),"Custom LAN proxy listeners require explicit strong credentials or inherited global authentication");
                }
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_listener_cannot_bypass_loopback_policy_or_global_authentication() {
        let mut config:Mapping=serde_yaml_ng::from_str("allow-lan: false\nbind-address: '*'\nlisteners: [{name: custom, type: mixed, port: 18889, listen: 0.0.0.0, users: []}]").unwrap();
        apply(&mut config).unwrap();
        assert_eq!(config["bind-address"].as_str(), Some("127.0.0.1"));
        assert_eq!(config["listeners"][0]["listen"].as_str(), Some("127.0.0.1"));
        config.insert("allow-lan".into(), true.into());
        assert!(apply(&mut config).is_err());
        config["listeners"][0]["users"] =
            serde_yaml_ng::from_str("[{username: fixture, password: fixture-only-long-password}]")
                .unwrap();
        assert!(apply(&mut config).is_ok());
    }
}
