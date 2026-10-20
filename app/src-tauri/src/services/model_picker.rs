//! One client-aware catalog; selection reuses the existing guarded mode writer.
use super::ProviderService;
use crate::{app_config::AppType, provider::Provider, store::AppState};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProvider {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
    pub disabled: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub providers: Vec<ModelProvider>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub mode: String,
    pub revision: String,
}
fn supported(app: &AppType) -> Result<(), String> {
    if matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    ) {
        Ok(())
    } else {
        Err("This client does not support unified model selection".into())
    }
}
fn text_model(config: &Value) -> Option<String> {
    config
        .get("config")?
        .as_str()?
        .parse::<toml_edit::DocumentMut>()
        .ok()?
        .get("model")?
        .as_str()
        .map(str::to_string)
}
pub fn configured_model(app: &AppType, provider: &Provider) -> Option<String> {
    let c = &provider.settings_config;
    match app {
        AppType::Claude => c
            .pointer("/env/ANTHROPIC_MODEL")
            .or_else(|| c.get("model"))
            .and_then(Value::as_str)
            .map(str::to_string),
        AppType::Codex => text_model(c),
        AppType::Gemini => c
            .pointer("/config/model/name")
            .or_else(|| c.pointer("/env/GEMINI_MODEL"))
            .and_then(Value::as_str)
            .map(str::to_string),
        AppType::GrokBuild => crate::live::project::grok::GrokProjection::of(c, false)
            .ok()?
            .table?
            .1
            .get("model")?
            .as_str()
            .map(str::to_string),
        _ => None,
    }
}
fn models(app: &AppType, p: &Provider) -> Vec<String> {
    let mut ids = BTreeSet::new();
    if let Some(m) = configured_model(app, p) {
        ids.insert(m);
    }
    if matches!(app, AppType::Claude) {
        for m in crate::mode::stack::claude_models("picker", p) {
            ids.insert(m.upstream);
        }
    }
    if matches!(app, AppType::Codex) {
        for m in crate::codex_config::codex_published_models(
            &p.settings_config,
            p.settings_config
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ) {
            ids.insert(m);
        }
    }
    ids.into_iter().filter(|m| !m.trim().is_empty()).collect()
}
fn live_model(app: &AppType) -> Option<String> {
    match app {
        AppType::Claude => {
            let path = crate::config::get_claude_settings_path();
            let bytes = std::fs::read(&path).ok()?;
            let (doc, _) = crate::live::patch::json::parse(&path, Some(&bytes)).ok()?;
            let model = if crate::mode::current::is_proxy(app) {
                doc.get("model")
            } else {
                doc.pointer("/env/ANTHROPIC_MODEL")
                    .or_else(|| doc.get("model"))
            };
            model.and_then(Value::as_str).map(str::to_string)
        }
        AppType::Codex => {
            text_model(&json!({"config":crate::codex_config::read_codex_config_text().ok()?}))
        }
        AppType::Gemini => {
            let env = crate::gemini_config::read_gemini_env()
                .ok()
                .and_then(|env| env.get("GEMINI_MODEL").cloned());
            env.or_else(|| {
                let bytes = std::fs::read(crate::gemini_config::get_gemini_settings_path()).ok()?;
                let value: Value = serde_json::from_slice(&bytes).ok()?;
                value
                    .pointer("/model/name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
        }
        AppType::GrokBuild => {
            let doc = std::fs::read_to_string(crate::grok_config::get_grok_config_path())
                .ok()?
                .parse::<toml_edit::DocumentMut>()
                .ok()?;
            let name = doc.get("models")?.get("default")?.as_str()?;
            Some(
                doc.get("model")
                    .and_then(|v| v.get(name))
                    .and_then(|v| v.get("model"))
                    .and_then(toml_edit::Item::as_str)
                    .unwrap_or(name)
                    .into(),
            )
        }
        _ => None,
    }
}
pub fn catalog(state: &AppState, app: &AppType) -> Result<Catalog, String> {
    supported(app)?;
    let providers = state
        .db
        .get_all_providers(app.as_str())
        .map_err(|e| e.to_string())?;
    let mode = crate::mode::controller::app_mode_view(state, app)?;
    let mut id = if mode.mode == "direct" {
        mode.direct_provider_id.clone()
    } else {
        mode.route_provider_id.clone()
    };
    let mut model = live_model(app);
    if mode.mode == "route" && !mode.attached {
        let saved = crate::mode::state::load(&crate::live::engine::DeviceStore::for_device())
            .map_err(|e| e.to_string())?;
        if let Some(entry) = saved.apps.get(app.as_str()) {
            model = if matches!(app, AppType::Claude) {
                entry
                    .claude_selection
                    .as_ref()
                    .and_then(|s| s.active.as_ref().and_then(|key| s.choices.get(key)))
                    .and_then(|c| c.model.clone())
                    .or(model)
            } else {
                entry.routing_group.clone().or(model)
            };
        }
    }
    if let Some(raw) = &model {
        if let Ok(crate::mode::stack::Resolved::Hit(target)) = crate::mode::stack::resolve(
            &state.db,
            &crate::live::engine::DeviceStore::for_device(),
            app,
            raw,
        ) {
            id = Some(target.provider.id);
            model = Some(target.upstream_model);
        }
    }
    let groups = super::routing_groups::read(&state.db, app)?;
    if let Some(group) = model.as_deref().and_then(super::routing_groups::group_id) {
        id = Some(format!("@group:{group}"));
    }
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(&providers, &mode, &id, &model, &groups.revision))
                .map_err(|e| e.to_string())?
        )
    );
    let mut entries: Vec<ModelProvider> = providers
        .values()
        .map(|p| {
            let mut values = models(app, p);
            if id.as_deref() == Some(&p.id) {
                if let Some(model) = &model {
                    if !values.contains(model) {
                        values.insert(0, model.clone());
                    }
                }
            }
            let disabled = if mode.mode != "direct" {
                crate::mode::controller::reject_unsupported_official(app, p).err()
            } else if matches!(app, AppType::GrokBuild) && p.category.as_deref() == Some("official")
            {
                Some("官方 Grok 模型请在客户端选择".into())
            } else {
                None
            };
            ModelProvider {
                id: p.id.clone(),
                name: p.name.clone(),
                models: values,
                disabled,
            }
        })
        .collect();
    for group in &groups.groups {
        entries.push(ModelProvider {
            id: format!("@group:{}", group.id),
            name: format!("路由组 · {}", group.name),
            models: vec![super::routing_groups::alias(app, &group.id)],
            disabled: if mode.mode != "route" {
                Some("请先切换到路由模式".into())
            } else {
                super::routing_groups::targets(&state.db, app, group).err()
            },
        });
    }
    Ok(Catalog {
        providers: entries,
        provider_id: id,
        model,
        mode: mode.mode.into(),
        revision,
    })
}
pub fn with_model(app: &AppType, provider: &Provider, model: &str) -> Result<Provider, String> {
    if model.trim().starts_with("sias-")
        || model.trim().is_empty()
        || model.chars().count() > 256
        || model.chars().any(char::is_control)
    {
        return Err("Invalid model ID".into());
    }
    let mut p = provider.clone();
    let model = model.trim();
    match app {
        AppType::Claude => {
            if !p.settings_config.is_object() {
                return Err("Invalid Claude configuration".into());
            }
            if p.settings_config.get("env").is_none() {
                p.settings_config["env"] = json!({});
            }
            if !p.settings_config["env"].is_object() {
                return Err("Invalid Claude environment".into());
            }
            p.settings_config["env"]["ANTHROPIC_MODEL"] = json!(model);
            p.settings_config["model"] = json!(model);
        }
        AppType::Codex => {
            let mut doc = p
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .unwrap_or("")
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| e.to_string())?;
            doc["model"] = toml_edit::value(model);
            p.settings_config["config"] = json!(doc.to_string());
        }
        AppType::Gemini => {
            for key in ["env", "config"] {
                if p.settings_config.get(key).is_none() {
                    p.settings_config[key] = json!({});
                }
                if !p.settings_config[key].is_object() {
                    return Err(format!("Invalid Gemini {key}"));
                }
            }
            if p.settings_config["config"].get("model").is_none() {
                p.settings_config["config"]["model"] = json!({});
            }
            if !p.settings_config["config"]["model"].is_object() {
                return Err("Invalid Gemini model configuration".into());
            }
            p.settings_config["env"]["GEMINI_MODEL"] = json!(model);
            p.settings_config["config"]["model"]["name"] = json!(model);
        }
        AppType::GrokBuild => {
            let projection =
                crate::live::project::grok::GrokProjection::of(&p.settings_config, false)
                    .map_err(|e| e.to_string())?;
            let name = projection
                .table_name()
                .ok_or("Missing Grok model table")?
                .to_string();
            let mut doc = p.settings_config["config"]
                .as_str()
                .ok_or("Missing Grok config")?
                .parse::<toml_edit::DocumentMut>()
                .map_err(|e| e.to_string())?;
            doc["model"][&name]["model"] = toml_edit::value(model);
            p.settings_config["config"] = json!(doc.to_string());
        }
        _ => return Err("Unsupported client".into()),
    }
    Ok(p)
}
pub fn select(
    state: &AppState,
    app: AppType,
    provider_id: &str,
    model: &str,
    revision: &str,
) -> Result<Catalog, String> {
    supported(&app)?;
    let _guard =
        crate::mode::controller::lock_settled_blocking(state, &app).map_err(|e| e.to_string())?;
    let current = catalog(state, &app)?;
    if current.revision != revision {
        return Err("配置已发生变化，请刷新模型列表后重试".into());
    }
    let choice = current
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or("Provider no longer exists")?;
    if let Some(error) = &choice.disabled {
        return Err(error.clone());
    }
    let group = provider_id
        .strip_prefix("@group:")
        .map(|id| {
            super::routing_groups::read(&state.db, &app)?
                .groups
                .into_iter()
                .find(|g| g.id == id)
                .ok_or_else(|| "路由组已删除".to_string())
        })
        .transpose()?;
    let provider_id = if let Some(group) = &group {
        if current.mode != "route" || model != super::routing_groups::alias(&app, &group.id) {
            return Err("请选择有效的路由组，并先启用路由模式".into());
        }
        super::routing_groups::targets(&state.db, &app, group)?;
        group.members[0].provider_id.as_str()
    } else {
        if super::routing_groups::group_id(model).is_some() {
            return Err("请从路由组目录选择，不要手工填写组别名".into());
        }
        provider_id
    };
    let mut providers = state
        .db
        .get_all_providers(app.as_str())
        .map_err(|e| e.to_string())?;
    let old = providers
        .get(provider_id)
        .ok_or("Provider no longer exists")?
        .clone();
    let updated = with_model(&app, &old, model)?;
    let mode = crate::mode::current::mode_state(&app);
    if mode.is_proxy() && !mode.attached {
        return Err("请先启动并接管客户端，再选择模型".into());
    }
    if mode.is_proxy() && (matches!(app, AppType::Claude) || group.is_some()) {
        // The routed choice belongs to this device, not the provider's direct default.
        futures::executor::block_on(crate::mode::controller::pick_route_model_locked(
            state,
            &app,
            &old,
            model.trim(),
        ))?;
    } else {
        ProviderService::validate_provider_settings(&app, &updated).map_err(|e| e.to_string())?;
        state
            .db
            .save_provider(app.as_str(), &updated)
            .map_err(|e| e.to_string())?;
        providers.insert(provider_id.into(), updated.clone());
        let result: Result<(), String> = if mode.is_proxy() {
            futures::executor::block_on(crate::mode::controller::switch_route_locked(
                state, &app, &updated,
            ))
        } else {
            ProviderService::switch_normal(state, app.clone(), provider_id, &providers)
                .map(|_| ())
                .map_err(|e| e.to_string())
        };
        if let Err(error) = result {
            if !crate::mode::operation::has_pending(app.as_str()) {
                state
                    .db
                    .save_provider(app.as_str(), &old)
                    .map_err(|rollback| format!("{error}; rollback: {rollback}"))?;
            }
            return Err(error);
        }
    }
    catalog(state, &app)
}
