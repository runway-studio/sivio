//! Named model groups. No credentials are copied into persisted group definitions.
use crate::{app_config::AppType, database::Database, provider::Provider, store::AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
pub mod quota;
pub mod scheduler;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub provider_id: String,
    pub model: String,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    #[default]
    Order,
    Rotate,
    Usage,
    Smart,
    Pace,
}
impl Strategy {
    pub fn description(self) -> &'static str {
        match self {
            Self::Smart => "Smart · 最早重置优先",
            Self::Pace => "Pace · 周额度节奏",
            Self::Order => "Order · 按优先级故障切换",
            Self::Rotate => "Rotate · 逐请求轮换",
            Self::Usage => "Usage · 本机调度次数均衡",
        }
    }
    pub fn trace_mode(self) -> &'static str {
        match self {
            Self::Smart => "group_smart",
            Self::Pace => "group_pace",
            Self::Order => "group_order",
            Self::Rotate => "group_rotate",
            Self::Usage => "group_usage",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub members: Vec<Member>,
    #[serde(default)]
    pub strategy: Strategy,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub groups: Vec<Group>,
    pub revision: String,
}
pub fn alias(app: &AppType, id: &str) -> String {
    format!(
        "{}{}",
        if matches!(app, AppType::Claude) {
            "sivio-claude-group-"
        } else {
            "sivio-group-"
        },
        id
    )
}
pub fn group_id(model: &str) -> Option<&str> {
    model
        .strip_prefix("sivio-claude-group-")
        .or_else(|| model.strip_prefix("sivio-group-"))
}
pub fn read(db: &Database, app: &AppType) -> Result<Snapshot, String> {
    let raw = db
        .get_setting(&format!("routing_groups_{}", app.as_str()))
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "[]".into());
    Ok(Snapshot {
        groups: serde_json::from_str(&raw).map_err(|e| format!("Invalid routing groups: {e}"))?,
        revision: format!("{:x}", Sha256::digest(raw.as_bytes())),
    })
}
pub fn targets(db: &Database, app: &AppType, group: &Group) -> Result<Vec<Provider>, String> {
    if group.members.is_empty() || group.members.len() > 10 {
        return Err("路由组需要 1–10 个成员".into());
    }
    let all = db
        .get_all_providers(app.as_str())
        .map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    group
        .members
        .iter()
        .map(|m| {
            if !seen.insert(&m.provider_id) {
                return Err("同一组中每个供应商只能出现一次".into());
            }
            if matches!(app, AppType::Gemini)
                && m.model
                    .chars()
                    .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '%' | ':'))
            {
                return Err("Gemini 模型 ID 不能包含 URL 参数或动作后缀".into());
            }
            if group_id(&m.model).is_some() {
                return Err("首版不支持嵌套路由组".into());
            }
            let p = all.get(&m.provider_id).ok_or("成员供应商已删除")?;
            crate::mode::controller::reject_unsupported_official(app, p)?;
            if !crate::proxy::provider_router::provider_supports_failover(app.as_str(), p) {
                return Err("此账号不支持路由组故障切换".into());
            }
            let mut p = super::model_picker::with_model(app, p, &m.model)?;
            // Codex/Grok format converters also consult the top-level model field.
            p.settings_config["model"] = serde_json::json!(m.model.trim());
            Ok(p)
        })
        .collect()
}
pub fn update(
    state: &AppState,
    app: &AppType,
    mut group: Group,
    revision: &str,
    delete: bool,
) -> Result<Snapshot, String> {
    if !matches!(
        app,
        AppType::Claude | AppType::Codex | AppType::Gemini | AppType::GrokBuild
    ) {
        return Err("Unsupported client".into());
    }
    let _guard =
        crate::mode::controller::lock_settled_blocking(state, app).map_err(|e| e.to_string())?;
    let mut snap = read(&state.db, app)?;
    if snap.revision != revision {
        return Err("配置已变化，请刷新后重试".into());
    }
    if delete {
        let selected = super::model_picker::catalog(state, app)?.model;
        if selected.as_deref().and_then(group_id) == Some(group.id.as_str()) {
            return Err("请先切换当前模型，再删除正在使用的组".into());
        }
        if !snap.groups.iter().any(|g| g.id == group.id) {
            return Err("路由组已删除".into());
        }
        snap.groups.retain(|g| g.id != group.id);
    } else {
        group.name = group.name.trim().into();
        if group.name.is_empty()
            || group.name.chars().count() > 80
            || group.name.chars().any(char::is_control)
        {
            return Err("组名称需要 1–80 个字符".into());
        }
        for m in &mut group.members {
            m.model = m.model.trim().into();
        }
        targets(&state.db, app, &group)?;
        if group.id.is_empty() {
            group.id = uuid::Uuid::new_v4().to_string();
        } else if !snap.groups.iter().any(|g| g.id == group.id) {
            return Err("路由组已删除，请刷新".into());
        }
        if snap
            .groups
            .iter()
            .any(|g| g.name == group.name && g.id != group.id)
        {
            return Err("组名称已存在".into());
        }
        if let Some(old) = snap.groups.iter_mut().find(|g| g.id == group.id) {
            *old = group;
        } else {
            if snap.groups.len() >= 50 {
                return Err("每个客户端最多 50 个路由组".into());
            }
            snap.groups.push(group);
        }
    }
    {
        let mut conn = state.db.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![
                format!("routing_groups_{}", app.as_str()),
                serde_json::to_string(&snap.groups).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        // Prune deleted groups in the same transaction as publishing configuration.
        tx.execute(
            "DELETE FROM routing_group_scheduler WHERE app=?1 AND group_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?2))",
            rusqlite::params![app.as_str(), serde_json::to_string(&snap.groups).map_err(|e| e.to_string())?],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    read(&state.db, app)
}
