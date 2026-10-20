//! Read the pinned Clash Verge Rev backup layout without executing scripts,
//! fetching URLs, starting a core, or importing its service/runtime identity.
use super::{
    digest, profile_enhance::ProfileEnhancement, repository::Repository, Catalog, Profile, Settings,
};
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn yaml(files: &BTreeMap<String, Vec<u8>>, name: &str) -> Result<Value> {
    Ok(serde_yaml_ng::from_slice(
        files
            .get(name)
            .with_context(|| format!("Missing source file {name}"))?,
    )?)
}
fn content(files: &BTreeMap<String, Vec<u8>>, item: &Value) -> Result<String> {
    let file = item["file"].as_str().context("Profile file is missing")?;
    ensure!(
        !file.is_empty()
            && std::path::Path::new(file).components().count() == 1
            && !file.contains(['/', '\\'])
            && file != "..",
        "Invalid profile file name"
    );
    Ok(std::str::from_utf8(
        files
            .get(&format!("profiles/{file}"))
            .context("A referenced profile/enhancement file is missing")?,
    )?
    .into())
}
pub(crate) fn merge(
    files: &BTreeMap<String, Vec<u8>>,
    current: Option<&str>,
    replace: bool,
) -> Result<(String, Value)> {
    let source = yaml(files, "profiles.yaml")?;
    let items = source["items"]
        .as_array()
        .context("Invalid profiles.yaml items")?;
    ensure!(items.len() <= 10_000, "Too many profiles");
    let unavailable = current
        .map(crate::credential_vault::pending)
        .transpose()?
        .unwrap_or(false);
    ensure!(!unavailable || replace, "旧网络配置尚未迁移。可先迁移凭据，或勾选替换后从原应用重建整份网络配置（原配置会备份）。Legacy network configuration requires migration or explicit replacement.");
    let current = if unavailable && replace {
        None
    } else {
        current
    };
    let mut record: Repository = if let Some(raw) = current {
        let document: Value = crate::credential_vault::from_str(raw)?;
        serde_json::from_value(document["config"].clone())?
    } else {
        Repository {
            schema: 1,
            catalog: Catalog::default(),
            payloads: BTreeMap::new(),
            custom_proxy: None,
            legacy: None,
        }
    };
    ensure!(
        record.schema == 1 && record.catalog.schema <= 1,
        "Unsupported network repository schema"
    );
    let get = |uid: &str, default: &str| -> Result<String> {
        match items.iter().find(|item| item["uid"].as_str() == Some(uid)) {
            Some(item) => content(files, item),
            None => Ok(default.into()),
        }
    };
    let global = Settings {
        merge: get("Merge", "{}")?,
        script: get("Script", "")?,
        ..Default::default()
    };
    let mut seen = std::collections::BTreeSet::new();
    let (mut added, mut conflicts, mut kept) = (0, 0, 0);
    for item in items {
        let kind = item["type"].as_str().context("Invalid profile type")?;
        if !["local", "remote"].contains(&kind) {
            continue;
        }
        let uid = item["uid"].as_str().context("Profile UID missing")?;
        ensure!(
            !uid.is_empty() && seen.insert(uid),
            "Duplicate/empty profile UID"
        );
        let id = format!("cv-{}", &digest(uid.as_bytes())[..24]);
        let index = record.catalog.profiles.iter().position(|p| p.id == id);
        if index.is_some() {
            conflicts += 1;
            if !replace {
                kept += 1;
                continue;
            }
        }
        let raw = content(files, item)?;
        let _: serde_yaml_ng::Mapping =
            serde_yaml_ng::from_str(&raw).context("Invalid profile YAML")?;
        let option = &item["option"];
        let enhancement = ProfileEnhancement {
            enabled: true,
            merge: get(option["merge"].as_str().unwrap_or(""), "{}")?,
            script: get(option["script"].as_str().unwrap_or(""), "")?,
            rules: get(
                option["rules"].as_str().unwrap_or("Rules"),
                "prepend: []\nappend: []\ndelete: []",
            )?,
            proxies: get(
                option["proxies"].as_str().unwrap_or("Proxies"),
                "prepend: []\nappend: []\ndelete: []",
            )?,
            groups: get(
                option["groups"].as_str().unwrap_or("Groups"),
                "prepend: []\nappend: []\ndelete: []",
            )?,
            imported_global: Some(global.clone()),
            ..Default::default()
        };
        // Validate YAML only. Migration must never run source JS.
        let _: serde_yaml_ng::Mapping = serde_yaml_ng::from_str(&enhancement.merge)?;
        for sequence in [
            &enhancement.rules,
            &enhancement.proxies,
            &enhancement.groups,
        ] {
            let _: super::enhance::seq::SeqMap = serde_yaml_ng::from_str(sequence)?;
        }
        let mut request = super::subscription::Options::default();
        request.user_agent = option["user_agent"]
            .as_str()
            .unwrap_or(&request.user_agent)
            .into();
        request.timeout_seconds = option["timeout_seconds"].as_u64().unwrap_or(20);
        request.via = if option["self_proxy"].as_bool() == Some(true) {
            "managed-network"
        } else if option["with_proxy"].as_bool() == Some(true) {
            "system-proxy"
        } else {
            "direct"
        }
        .into();
        request.accept_invalid_certs = option["danger_accept_invalid_certs"]
            .as_bool()
            .unwrap_or(false);
        request.validate()?;
        let payload = json!({"yaml":raw,"url":item["url"].as_str().unwrap_or(""),"requestOptions":request,"enhancement":enhancement,"legacyClashVerge":item});
        let revision = digest(&serde_json::to_vec(&payload)?);
        let profile = Profile {
            id: id.clone(),
            name: item["name"].as_str().unwrap_or(uid).into(),
            kind: kind.into(),
            revision: revision.clone(),
            updated: item["updated"].as_i64().unwrap_or(0),
            interval: 0,
            usage: item.get("extra").map(|v| v.to_string()),
            last_attempt: 0,
            last_error: None,
        };
        if let Some(index) = index {
            record.catalog.profiles[index] = profile;
        } else {
            record.catalog.profiles.push(profile);
            added += 1;
        }
        record
            .payloads
            .retain(|key, _| !key.starts_with(&format!("profile:{id}:")));
        record
            .payloads
            .insert(format!("profile:{id}:{revision}"), payload);
        if let Some(selected) = item["selected"].as_array() {
            let mut choices = BTreeMap::new();
            for selection in selected {
                if let (Some(group), Some(node)) =
                    (selection["name"].as_str(), selection["now"].as_str())
                {
                    choices.insert(group.into(), node.into());
                }
            }
            record.catalog.selections.insert(id, choices);
        }
    }
    // Preserve source preferences/config losslessly for review without silently
    // applying its ports, system proxy, TUN, scheduling or update infrastructure.
    let mut legacy = serde_json::Map::new();
    for (key, name) in [
        ("config", "config.yaml"),
        ("preferences", "verge.yaml"),
        ("dns", "dns_config.yaml"),
    ] {
        if files.contains_key(name) {
            let value = yaml(files, name)?;
            ensure!(value.is_object(), "Invalid source settings YAML");
            legacy.insert(key.into(), value);
        }
    }
    record.legacy = Some(legacy.into());
    let document = json!({"config":record});
    ensure!(
        serde_json::to_vec(&document)?.len() <= super::LIMIT,
        "Migrated network configuration exceeds 16 MiB"
    );
    Ok((
        serde_json::to_string(&document)?,
        json!({"networkProfiles":{"added":added,"conflicts":conflicts,"kept":kept}}),
    ))
}

#[cfg(test)]
mod local_credential_tests {
    use super::*;
    #[test]
    fn unreadable_old_network_requires_explicit_replacement_and_never_authorizes() {
        let files = BTreeMap::from([("profiles.yaml".into(), b"items: []\n".to_vec())]);
        let old = r#"{"config":{"$siCredential":"unavailable-fixture"}}"#;
        assert!(merge(&files, Some(old), false).is_err());
        let (raw, _) = merge(&files, Some(old), true).unwrap();
        assert!(!crate::credential_vault::pending(&raw).unwrap());
        let document: Value = crate::credential_vault::from_str(&raw).unwrap();
        assert!(document["config"]["catalog"]["active"].is_null());
    }
}
