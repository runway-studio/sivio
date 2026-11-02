//! Global transforms run first; each subscription can add its own isolated
//! Merge/sequence/script pipeline and choose its DNS override independently.
use super::{enhance, Settings, LIMIT};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_yaml_ng::{Mapping, Value as Yaml};
use std::time::Duration;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileEnhancement {
    pub enabled: bool,
    pub merge: String,
    pub script: String,
    pub rules: String,
    pub proxies: String,
    pub groups: String,
    pub dns_mode: String,
    pub dns: String,
    // A migrated source-global pipeline stays with its profiles instead of
    // changing unrelated profiles already managed by Sivio.
    pub imported_global: Option<super::Settings>,
}
impl Default for ProfileEnhancement {
    fn default() -> Self {
        Self {
            enabled: false,
            merge: "{}".into(),
            script: "".into(),
            rules: "prepend: []\nappend: []\ndelete: []".into(),
            proxies: "prepend: []\nappend: []\ndelete: []".into(),
            groups: "prepend: []\nappend: []\ndelete: []".into(),
            dns_mode: "inherit".into(),
            dns: "{}".into(),
            imported_global: None,
        }
    }
}
fn transform(
    mut config: Mapping,
    merge: &str,
    rules: &str,
    proxies: &str,
    groups: &str,
    script: &str,
    name: &str,
) -> Result<Mapping> {
    for text in [merge, rules, proxies, groups, script] {
        ensure!(text.len() <= LIMIT, "enhancement exceeds 16 MiB");
    }
    let merge: Mapping = serde_yaml_ng::from_str(merge).context("invalid Merge YAML")?;
    config = enhance::merge::use_merge(&merge, config);
    for (field, data) in [
        ("rules", rules),
        ("proxies", proxies),
        ("proxy-groups", groups),
    ] {
        let seq: enhance::seq::SeqMap = serde_yaml_ng::from_str(data)
            .with_context(|| format!("invalid {field} enhancement"))?;
        config = enhance::seq::use_seq(seq, config, field);
    }
    if !script.trim().is_empty() {
        let input = serde_json::to_string(&config)?;
        ensure!(input.len() <= LIMIT, "script input exceeds 16 MiB");
        let code = format!(
            "{script}\nJSON.stringify(main(JSON.parse({}), {}))",
            serde_json::to_string(&input)?,
            serde_json::to_string(name)?
        );
        let runtime = rquickjs::Runtime::new()?;
        runtime.set_memory_limit(32 * 1024 * 1024);
        runtime.set_max_stack_size(256 * 1024);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        runtime.set_interrupt_handler(Some(Box::new(move || std::time::Instant::now() > deadline)));
        let context = rquickjs::Context::full(&runtime)?;
        let output: String = context.with(|ctx| ctx.eval(code))?;
        ensure!(output.len() <= LIMIT, "script output exceeds 16 MiB");
        config = serde_json::from_str(&output).context("script must return an object")?;
    }
    Ok(config)
}
pub fn apply(
    mut config: Mapping,
    global: &Settings,
    profile: Option<&Value>,
    name: &str,
) -> Result<Mapping> {
    if global.builtin_enhanced {
        super::builtin_rules::apply(&mut config);
    }
    let profile: ProfileEnhancement = profile
        .map(|value| serde_json::from_value(value.clone()))
        .transpose()?
        .unwrap_or_default();
    ensure!(
        ["inherit", "profile", "subscription"].contains(&profile.dns_mode.as_str()),
        "DNS mode must be inherit, profile or subscription"
    );
    let subscription_dns = config.get("dns").cloned();
    let mut config = transform(
        config,
        &global.merge,
        &global.rules,
        &global.proxies,
        &global.groups,
        &global.script,
        name,
    )?;
    if profile.enabled {
        if let Some(imported) = &profile.imported_global {
            config = transform(
                config,
                &imported.merge,
                &imported.rules,
                &imported.proxies,
                &imported.groups,
                &imported.script,
                name,
            )?;
        }
        config = transform(
            config,
            &profile.merge,
            &profile.rules,
            &profile.proxies,
            &profile.groups,
            &profile.script,
            name,
        )?;
    }
    let dns = match profile.dns_mode.as_str() {
        "profile" => Some(profile.dns.as_str()),
        "subscription" => None,
        _ => if global.dns_override { Some(global.dns.as_str()) } else { None },
    };
    if let Some(dns) = dns {
        ensure!(dns.len() <= LIMIT, "DNS settings exceed 16 MiB");
        let dns: Mapping = serde_yaml_ng::from_str(dns).context("invalid DNS YAML")?;
        if !dns.is_empty() {
            config.insert("dns".into(), dns.into());
        }
    } else {
        config.remove("dns");
        if let Some(dns) = subscription_dns {
            config.insert(Yaml::from("dns"), dns);
        }
    }
    Ok(config)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn disabling_global_dns_override_preserves_subscription_dns() {
        let global = Settings {dns_override:false,dns:"nameserver: [global.invalid]".into(),..Default::default()};
        let input:Mapping=serde_yaml_ng::from_str("dns: {nameserver: [subscription.invalid]}").unwrap();
        let result=apply(input,&global,None,"test").unwrap();
        assert_eq!(result["dns"]["nameserver"][0].as_str(),Some("subscription.invalid"));
    }
    #[test]
    fn local_transforms_follow_global_and_subscription_dns_can_be_preserved() {
        let mut global = Settings::default();
        global.merge = "future: global\nkeep: true".into();
        global.dns = "nameserver: [global.invalid]".into();
        let input: Mapping =
            serde_yaml_ng::from_str("future: base\ndns: {nameserver: [subscription.invalid]}")
                .unwrap();
        let profile = json!({"enabled":true,"merge":"future: local","script":"function main(c,name){c.profileName=name;return c}","dnsMode":"subscription"});
        let result = apply(input, &global, Some(&profile), "Fixture subscription").unwrap();
        assert_eq!(result["future"].as_str(), Some("local"));
        assert_eq!(result["keep"].as_bool(), Some(true));
        assert_eq!(result["profileName"].as_str(), Some("Fixture subscription"));
        assert_eq!(
            result["dns"]["nameserver"][0].as_str(),
            Some("subscription.invalid")
        );
    }
    #[test]
    fn disabled_local_pipeline_stays_off_but_dns_choice_remains_independent() {
        let profile = json!({"enabled":false,"merge":"unexpected: true","dnsMode":"profile","dns":"nameserver: [profile.invalid]"});
        let result = apply(
            Mapping::new(),
            &Settings::default(),
            Some(&profile),
            "Fixture",
        )
        .unwrap();
        assert!(!result.contains_key("unexpected"));
        assert_eq!(
            result["dns"]["nameserver"][0].as_str(),
            Some("profile.invalid")
        );
    }
}
