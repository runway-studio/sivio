//! Claude's saved /model choice belongs to this device and routing scope,
//! not to the provider row. Commit it with the client write so detach/crash
//! recovery cannot restore an older choice. Never capture direct configuration
//! as a routed selection on startup.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::live::engine::{digest, read_current};
use crate::live::patch::{json as json_patch, Guarded, LivePatch, WholeFile};
use crate::live::project::claude::ClaudeProjection;
use crate::provider::Provider;
use crate::services::provider::claude_direct;

use super::operation::{AppWrite, FileChange};
use super::state::{self, PendingTarget};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Selections {
    pub active: Option<String>,
    pub choices: BTreeMap<String, Choice>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    /// Only the default settings: changing a credential or a fixed role must
    /// not reset the user's main model. An explicit new default does reset it.
    pub configured: Value,
    pub model: Option<String>,
}

pub fn scope(provider: &Provider, stack: bool) -> String {
    format!("{}:{}", if stack { "stack" } else { "route" }, provider.id)
}

fn configured(provider: &Provider) -> Value {
    json!({
        "model": provider.settings_config.get("model"),
        "default": provider.settings_config.pointer("/env/ANTHROPIC_MODEL"),
    })
}

fn picked(doc: &Value) -> Option<String> {
    doc.get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Captured while holding the app write lock; publish refuses an external
/// edit made after this read instead of overwriting a newer /model choice.
pub struct SelectionWrite<'a> {
    pub write: AppWrite<'a>,
    pre: Option<Vec<u8>>,
    pub live: Value,
    pub selections: Selections,
}

impl<'a> SelectionWrite<'a> {
    pub fn begin(db: &'a crate::database::Database, attached: bool) -> Result<Self, String> {
        let write = AppWrite::begin(db, "claude").map_err(|e| e.to_string())?;
        let path = claude_direct::settings_file().path;
        let pre = read_current(&path).map_err(|e| e.to_string())?;
        let (live, _) = json_patch::parse(&path, pre.as_deref()).map_err(|e| e.to_string())?;
        let mut selections = state::load(&write.store)
            .map_err(|e| e.to_string())?
            .apps
            .get("claude")
            .and_then(|a| a.claude_selection.clone())
            .unwrap_or_default();
        if attached {
            if let Some(choice) = selections
                .active
                .as_ref()
                .and_then(|key| selections.choices.get_mut(key))
            {
                choice.model = picked(&live);
            }
        }
        Ok(Self {
            write,
            pre,
            live,
            selections,
        })
    }

    pub fn select(
        &mut self,
        route: &Provider,
        stack: bool,
        same_route_legacy: bool,
        projection: &mut ClaudeProjection,
    ) {
        let key = scope(route, stack);
        let baseline = configured(route);
        let default = picked(&Value::Object(projection.top.clone()));
        let choice = self
            .selections
            .choices
            .entry(key.clone())
            .or_insert_with(|| Choice {
                configured: baseline.clone(),
                // Upgrade an already attached old version without losing /model.
                model: if same_route_legacy && self.live.get("model").is_some() {
                    picked(&self.live)
                } else {
                    default.clone()
                },
            });
        if choice.configured != baseline {
            choice.configured = baseline;
            choice.model = default;
        }
        // A removed Stack member must not remain the selected target.
        if stack {
            if let Some(model) = choice
                .model
                .as_ref()
                .filter(|m| m.starts_with("sias-claude-"))
            {
                let present = projection
                    .top
                    .get("modelPicker")
                    .and_then(|v| v.get("options"))
                    .and_then(Value::as_array)
                    .is_some_and(|rows| {
                        rows.iter()
                            .any(|row| row.get("model").and_then(Value::as_str) == Some(model))
                    });
                if !present {
                    choice.model = None;
                }
            }
        }
        if let Some(model) = &choice.model {
            projection
                .top
                .insert("model".into(), Value::String(model.clone()));
        } else {
            projection.top.shift_remove("model");
        }
        self.selections.active = Some(key);
    }

    pub fn commit(
        self,
        op: &str,
        patch: Option<&json_patch::JsonPatch>,
        mut target: PendingTarget,
    ) -> Result<(), String> {
        target.claude_selection = Some(self.selections);
        let file = claude_direct::settings_file();
        let guarded = patch
            .map(|patch| {
                patch
                    .apply(&file.path, self.pre.as_deref())
                    .map(|bytes| Guarded {
                        expected_pre: digest(self.pre.as_deref()),
                        then: WholeFile::Write(bytes),
                    })
            })
            .transpose()
            .map_err(|e| e.to_string())?;
        let changes: Vec<_> = guarded
            .as_ref()
            .map(|patch| FileChange { file, patch })
            .into_iter()
            .collect();
        self.write
            .run(op, &changes, target)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
