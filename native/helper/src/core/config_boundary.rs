//! Validate untrusted YAML again at the privilege boundary, before publishing a runtime.
use anyhow::{ensure, Result};
use serde_yaml_ng::{Mapping, Value};
#[cfg(test)]
mod marker_tests {
    #[test]
    fn portable_marker_is_not_a_valid_privileged_lan_password() {
        assert!(super::sanitize(&format!(
            "allow-lan: true\nauthentication: [fixture:{}]",
            super::credential_marker::MISSING
        ))
        .is_err());
    }
}
#[path = "../../../credential_marker.rs"]
mod credential_marker;
#[path = "../../../listener_boundary.rs"]
mod listener_boundary;
pub fn sanitize(yaml: &str) -> Result<String> {
    ensure!(yaml.len() <= 16 * 1024 * 1024, "runtime YAML exceeds 16 MiB");
    ensure!(
        !yaml.contains(credential_marker::MISSING),
        "missing credentials must be re-entered before starting a privileged runtime"
    );
    let mut config: Mapping =
        serde_yaml_ng::from_str(yaml).map_err(|_| anyhow::anyhow!("runtime YAML must be a valid mapping"))?;
    for key in [
        "external-controller",
        "external-controller-tls",
        "external-controller-unix",
        "external-controller-pipe",
        "external-controller-cors",
        "external-ui",
        "external-ui-url",
        "external-ui-name",
        "secret",
    ] {
        config.remove(key);
    }
    for field in ["proxy-providers", "rule-providers"] {
        if let Some(map) = config.get(field).and_then(Value::as_mapping) {
            for (_, item) in map {
                if let Some(path) = item.get("path").and_then(Value::as_str) {
                    let path = std::path::Path::new(path);
                    ensure!(
                        !path.is_absolute() && path.components().all(|c| matches!(c, std::path::Component::Normal(_))),
                        "provider path escapes the private runtime"
                    );
                }
            }
        }
    }
    if config.get("allow-lan").and_then(Value::as_bool) == Some(true) {
        ensure!(
            config
                .get("authentication")
                .and_then(Value::as_sequence)
                .is_some_and(|s| !s.is_empty()
                    && s.iter().all(|v| v
                        .as_str()
                        .is_some_and(|s| s.split_once(':').is_some_and(|(u, p)| !u.is_empty() && p.len() >= 16)))),
            "LAN requires explicit access credentials"
        );
        config.insert(
            "skip-auth-prefixes".into(),
            vec![Value::from("127.0.0.0/8"), Value::from("::1/128")].into(),
        );
    }
    listener_boundary::apply(&mut config)?;
    Ok(serde_yaml_ng::to_string(&config)?)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn privileged_control_endpoints_are_removed() {
        let yaml =
            sanitize("external-controller: 0.0.0.0:9090\nexternal-ui: /private/var/root\nunknown: {future: true}")
                .unwrap();
        let v: Mapping = serde_yaml_ng::from_str(&yaml).unwrap();
        assert!(!v.contains_key("external-controller"));
        assert!(!v.contains_key("external-ui"));
        assert_eq!(v["unknown"]["future"].as_bool(), Some(true));
    }
    #[test]
    fn paths_and_unauthenticated_lan_are_rejected() {
        assert!(sanitize("proxy-providers: {bad: {type: file, path: /etc/sudoers}}").is_err());
        assert!(sanitize("allow-lan: true").is_err());
    }
}
