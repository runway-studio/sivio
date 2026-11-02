//! Passive observations only. Reading this service must never dispatch a model request,
//! refresh a login, start a listener or rewrite client configuration.
use crate::{app_config::AppType, store::AppState};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckState {
    Unknown,
    Pending,
    Stale,
    Pass,
    Fail,
    Unsupported,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: &'static str,
    pub state: CheckState,
    pub reason_code: &'static str,
    pub action_id: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub app: String,
    pub configuration_revision: String,
    pub credential_epoch: String,
    pub network_generation: u64,
    pub outbound_revision: String,
    pub observed_at: i64,
    pub checks: Vec<Check>,
    pub diagnostic: Option<super::client_diagnostic::Run>,
}

/// Process-local HMACs prevent exposed revisions from being usable as unsalted
/// credential hashes. A restart invalidates any frontend-cached observations.
pub(crate) fn revision<T: Serialize>(domain: &str, value: &T) -> Result<String, String> {
    static KEY: OnceLock<[u8; 16]> = OnceLock::new();
    let key = KEY.get_or_init(|| *uuid::Uuid::new_v4().as_bytes());
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC accepts a 16-byte key");
    mac.update(domain.as_bytes());
    mac.update(&[0]);
    mac.update(&serde_json::to_vec(value).map_err(|_| "readiness_serialization_failed")?);
    Ok(mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

pub(crate) struct LocalFacts {
    pub app: String,
    pub configuration_revision: String,
    pub credential_epoch: String,
    pub configured: bool,
    pub gateway_supported: bool,
    pub mode: Option<String>,
}

pub(crate) fn local_facts(state: &AppState, app: &AppType) -> Result<LocalFacts, String> {
    let providers = state
        .db
        .get_all_providers(app.as_str())
        .map_err(|_| "configuration_unavailable".to_string())?;
    let gateway_supported = matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    );
    // Reuse the selection catalog's revision, including selected model, mode and groups.
    // Errors are not converted into an empty, apparently healthy configuration.
    let catalog = if gateway_supported {
        Some(
            super::model_picker::catalog(state, app)
                .map_err(|_| "configuration_unavailable".to_string())?,
        )
    } else {
        None
    };
    let current = state
        .db
        .get_current_provider(app.as_str())
        .map_err(|_| "configuration_unavailable".to_string())?;
    let configuration_revision = revision(
        "configuration",
        &(
            app.as_str(),
            &providers,
            current,
            catalog.as_ref().map(|c| &c.revision),
        ),
    )?;
    // This is the stored-credential revision only. Managed OAuth/client login evidence
    // is deliberately not claimed by passive inspection; model remains unverified.
    let credential_epoch = revision("stored-credentials", &(app.as_str(), &providers))?;
    Ok(LocalFacts {
        app: app.as_str().into(),
        configuration_revision,
        credential_epoch,
        configured: !providers.is_empty(),
        gateway_supported,
        mode: catalog.map(|c| c.mode),
    })
}

pub(crate) fn assemble(
    local: LocalFacts,
    gateway_running: bool,
    outbound: crate::network::outbound::Observation,
    now: i64,
) -> Snapshot {
    let (gateway_state, gateway_reason) = if !local.gateway_supported {
        (CheckState::Unsupported, "gateway_unsupported")
    } else if local.mode.as_deref() == Some("direct") {
        (CheckState::Unsupported, "gateway_not_required")
    } else if gateway_running {
        (CheckState::Pass, "listener_running")
    } else {
        (CheckState::Fail, "listener_stopped")
    };
    let (outbound_state, outbound_reason) = match outbound.mode.as_str() {
        "managed-network" if !outbound.available => {
            (CheckState::Fail, "managed_outbound_unavailable")
        }
        "managed-network" => (CheckState::Unknown, "managed_outbound_unverified"),
        "custom-proxy" => (CheckState::Unknown, "custom_outbound_unverified"),
        "direct" => (CheckState::Unknown, "direct_outbound_unverified"),
        _ => (CheckState::Unknown, "outbound_unavailable"),
    };
    let mut snapshot = Snapshot {
        diagnostic: None,
        app: local.app,
        configuration_revision: local.configuration_revision,
        credential_epoch: local.credential_epoch,
        network_generation: outbound.generation,
        outbound_revision: outbound.revision,
        observed_at: now,
        checks: vec![
            Check {
                id: "configuration",
                state: if local.configured {
                    CheckState::Pass
                } else {
                    CheckState::Unknown
                },
                reason_code: if local.configured {
                    "configuration_saved"
                } else {
                    "configuration_missing"
                },
                action_id: Some("manage_providers"),
            },
            Check {
                id: "client_read",
                state: CheckState::Unknown,
                reason_code: "client_reload_unobserved",
                action_id: None,
            },
            Check {
                id: "gateway",
                state: gateway_state,
                reason_code: gateway_reason,
                action_id: Some("manage_providers"),
            },
            Check {
                id: "outbound",
                state: if local.gateway_supported {
                    outbound_state
                } else {
                    CheckState::Unsupported
                },
                reason_code: if local.gateway_supported {
                    outbound_reason
                } else {
                    "client_outbound_unobserved"
                },
                action_id: Some("manage_network"),
            },
            Check {
                id: "model",
                state: if local.gateway_supported {
                    CheckState::Unknown
                } else {
                    CheckState::Unsupported
                },
                reason_code: if local.gateway_supported {
                    "model_unverified"
                } else {
                    "model_verification_unsupported"
                },
                action_id: None,
            },
        ],
    };
    snapshot.diagnostic =
        super::client_diagnostic::latest(&super::client_diagnostic::Identity::from(&snapshot), now);
    if let Some(run) = &snapshot.diagnostic {
        let check = snapshot
            .checks
            .iter_mut()
            .find(|c| c.id == "model")
            .unwrap();
        check.state = run.state;
        // Run owns a dynamic reason; the check carries a controlled generic code.
        check.reason_code = match run.state {
            CheckState::Pass => "model_verified",
            CheckState::Pending => "diagnostic_pending",
            CheckState::Stale => "diagnostic_stale",
            CheckState::Unsupported => "model_verification_unsupported",
            _ => "diagnostic_failed",
        };
    }
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    fn facts(supported: bool, mode: &str) -> LocalFacts {
        LocalFacts {
            app: "claude".into(),
            configuration_revision: "c".into(),
            credential_epoch: "e".into(),
            configured: true,
            gateway_supported: supported,
            mode: Some(mode.into()),
        }
    }
    fn outbound(mode: &str, available: bool) -> crate::network::outbound::Observation {
        crate::network::outbound::Observation {
            mode: mode.into(),
            available,
            generation: 3,
            revision: "o".into(),
        }
    }
    #[test]
    fn running_listener_does_not_prove_model_or_client_readiness() {
        let s = assemble(
            facts(true, "route"),
            true,
            outbound("managed-network", true),
            123,
        );
        assert_eq!(s.checks[2].state, CheckState::Pass);
        for i in [1, 3, 4] {
            assert_eq!(s.checks[i].state, CheckState::Unknown);
        }
    }
    #[test]
    fn stopped_core_only_blocks_managed_egress() {
        let managed = assemble(
            facts(true, "route"),
            true,
            outbound("managed-network", false),
            123,
        );
        assert_eq!(managed.checks[3].state, CheckState::Fail);
        for mode in ["direct", "custom-proxy"] {
            let s = assemble(facts(true, "direct"), false, outbound(mode, false), 123);
            assert_eq!(s.checks[2].reason_code, "gateway_not_required");
            assert_eq!(s.checks[3].state, CheckState::Unknown);
        }
    }
    #[test]
    fn unsupported_clients_do_not_appear_verified() {
        let s = assemble(facts(false, "direct"), true, outbound("direct", true), 123);
        for i in [2, 3, 4] {
            assert_eq!(s.checks[i].state, CheckState::Unsupported);
        }
    }
    #[test]
    fn fingerprints_are_stable_domain_separated_and_change_with_credentials() {
        let first = revision("configuration", &"secret-one").unwrap();
        assert_eq!(first, revision("configuration", &"secret-one").unwrap());
        assert_ne!(first, revision("configuration", &"secret-two").unwrap());
        assert_ne!(
            first,
            revision("stored-credentials", &"secret-one").unwrap()
        );
        assert!(!first.contains("secret"));
    }
    #[test]
    fn snapshot_wire_format_only_contains_controlled_metadata() {
        let s = assemble(
            facts(true, "route"),
            false,
            outbound("unavailable", false),
            123,
        );
        let v = serde_json::to_value(s).unwrap();
        assert_eq!(v["observedAt"], 123);
        assert_eq!(v["networkGeneration"], 3);
        assert_eq!(v["checks"][4]["reasonCode"], "model_unverified");
        assert!(v.get("credentials").is_none());
    }
}
