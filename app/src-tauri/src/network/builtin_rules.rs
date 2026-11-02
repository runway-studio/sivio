//! Fill gaps in older ChatGPT subscription rules, using the subscription's own
//! policy. Run before user transforms so prepend/delete/script remain authoritative.
use serde_yaml_ng::{Mapping, Value};

const RESOURCE_DOMAINS: [&str; 2] = ["oaiusercontent.com", "oaistatsig.com"];

fn fields(rule: &Value) -> Option<Vec<&str>> {
    Some(rule.as_str()?.split(',').map(str::trim).collect())
}

pub(super) fn apply(config: &mut Mapping) {
    let Some(rules) = config.get("rules").and_then(Value::as_sequence) else {
        return;
    };
    // Prefer the explicit ChatGPT policy, then the shared static/API policy.
    // A DIRECT/REJECT anchor is intentional and must not be replaced.
    let policy = [
        ("DOMAIN-SUFFIX", "chatgpt.com"),
        ("DOMAIN-SUFFIX", "oaistatic.com"),
        ("DOMAIN-SUFFIX", "openai.com"),
        ("DOMAIN-KEYWORD", "openai"),
    ]
    .into_iter()
    .find_map(|(kind, domain)| {
        rules.iter().filter_map(fields).find_map(|parts| {
            (parts.len() >= 3
                && parts[0].eq_ignore_ascii_case(kind)
                && parts[1].eq_ignore_ascii_case(domain))
            .then(|| parts[2].to_owned())
        })
    });
    let Some(policy) = policy else { return };
    if matches!(
        policy.as_str(),
        "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS"
    ) {
        return;
    }
    let policy_exists = ["proxy-groups", "proxies"].iter().any(|key| {
        config
            .get(*key)
            .and_then(Value::as_sequence)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("name").and_then(Value::as_str) == Some(policy.as_str()))
            })
    });
    if !policy_exists {
        return;
    }
    let additions: Vec<Value> = RESOURCE_DOMAINS
        .into_iter()
        .filter(|domain| {
            !rules.iter().filter_map(fields).any(|parts| {
                parts.len() >= 3
                    && parts[0].eq_ignore_ascii_case("DOMAIN-SUFFIX")
                    && parts[1].eq_ignore_ascii_case(domain)
            })
        })
        .map(|domain| Value::String(format!("DOMAIN-SUFFIX,{domain},{policy}")))
        .collect();
    // Keep subscription-specific rules ahead of these fallback defaults, but
    // never append after MATCH/FINAL where the rules would be unreachable.
    let insertion = rules
        .iter()
        .position(|rule| {
            fields(rule).is_some_and(|parts| {
                parts[0].eq_ignore_ascii_case("MATCH") || parts[0].eq_ignore_ascii_case("FINAL")
            })
        })
        .unwrap_or(rules.len());
    if let Some(rules) = config.get_mut("rules").and_then(Value::as_sequence_mut) {
        rules.splice(insertion..insertion, additions);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network::{profile_enhance, Settings};
    use serde_json::json;

    fn fixture(rules: &[&str]) -> Mapping {
        let mut config: Mapping = serde_yaml_ng::from_str(
            "proxy-groups:\n- {name: AI, type: select, proxies: [DIRECT]}\n",
        )
        .unwrap();
        config.insert("rules".into(), serde_yaml_ng::to_value(rules).unwrap());
        config
    }

    #[test]
    fn fills_missing_resources_before_match_and_is_idempotent() {
        let mut config = fixture(&["DOMAIN-SUFFIX,chatgpt.com,AI", "MATCH,DIRECT"]);
        apply(&mut config);
        assert_eq!(config["rules"][1], "DOMAIN-SUFFIX,oaiusercontent.com,AI");
        assert_eq!(config["rules"][2], "DOMAIN-SUFFIX,oaistatsig.com,AI");
        assert_eq!(config["rules"][3], "MATCH,DIRECT");
        let once = config.clone();
        apply(&mut config);
        assert_eq!(config, once);
    }

    #[test]
    fn preserves_existing_domain_policy() {
        let mut config = fixture(&[
            "DOMAIN-SUFFIX,chatgpt.com,AI",
            "DOMAIN-SUFFIX,oaiusercontent.com,DIRECT",
            "DOMAIN,files.oaiusercontent.com,REJECT",
            "MATCH,DIRECT",
        ]);
        apply(&mut config);
        assert_eq!(
            config["rules"][1],
            "DOMAIN-SUFFIX,oaiusercontent.com,DIRECT"
        );
        assert_eq!(config["rules"][2], "DOMAIN,files.oaiusercontent.com,REJECT");
        assert_eq!(config["rules"].as_sequence().unwrap().len(), 5);
    }

    #[test]
    fn does_not_guess_a_policy_or_override_direct_chatgpt() {
        for rules in [
            vec!["MATCH,DIRECT"],
            vec!["DOMAIN-SUFFIX,chatgpt.com,Missing", "MATCH,DIRECT"],
            vec![
                "DOMAIN-SUFFIX,chatgpt.com,DIRECT",
                "DOMAIN-KEYWORD,openai,AI",
            ],
        ] {
            let mut config = fixture(&rules);
            let original = config.clone();
            apply(&mut config);
            assert_eq!(config, original);
        }
    }

    #[test]
    fn supports_subscriptions_with_only_openai_keyword_and_no_match() {
        let mut config = fixture(&["DOMAIN-KEYWORD,openai,AI"]);
        apply(&mut config);
        assert_eq!(config["rules"].as_sequence().unwrap().len(), 3);
    }

    #[test]
    fn builtin_toggle_and_user_transforms_remain_authoritative() {
        let input = fixture(&["DOMAIN-SUFFIX,chatgpt.com,AI", "MATCH,DIRECT"]);
        let disabled = Settings {
            builtin_enhanced: false,
            ..Default::default()
        };
        let result = profile_enhance::apply(input.clone(), &disabled, None, "test").unwrap();
        assert_eq!(result["rules"], input["rules"]);

        let global = Settings {
            rules: "prepend: [\"DOMAIN-SUFFIX,oaiusercontent.com,DIRECT\"]\nappend: []\ndelete: [\"DOMAIN-SUFFIX,oaiusercontent.com,AI\"]".into(),
            ..Default::default()
        };
        let profile = json!({"enabled":true,"rules":"prepend: []\nappend: []\ndelete: [\"DOMAIN-SUFFIX,oaistatsig.com,AI\"]"});
        let result = profile_enhance::apply(input, &global, Some(&profile), "test").unwrap();
        assert_eq!(
            result["rules"][0],
            "DOMAIN-SUFFIX,oaiusercontent.com,DIRECT"
        );
        assert_eq!(result["rules"].as_sequence().unwrap().len(), 3);
    }
}
