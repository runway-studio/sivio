//! Cache native menu data away from AppKit. Never open Keychain or await the core
//! while constructing a menu on the main thread.
use super::*;
use once_cell::sync::Lazy;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    RwLock,
};
use tauri::Emitter;
#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct ProfileChoice {
    pub id: String,
    pub name: String,
    pub selected: bool,
}
#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct GroupChoice {
    pub name: String,
    pub selected: String,
    pub nodes: Vec<String>,
    pub more: bool,
}
#[derive(Clone, Default, PartialEq, Eq)]
pub(crate) struct MenuSnapshot {
    pub revision: u64,
    pub generation: u64,
    pub running: bool,
    pub selected_profile: bool,
    pub phase: String,
    pub mode: String,
    pub system_proxy: bool,
    pub tun: bool,
    pub profiles: Vec<ProfileChoice>,
    pub groups: Vec<GroupChoice>,
    pub more_profiles: bool,
    pub more_groups: bool,
}
static CACHE: Lazy<RwLock<MenuSnapshot>> = Lazy::new(Default::default);
static BUSY: AtomicBool = AtomicBool::new(false);
pub(crate) fn cached() -> MenuSnapshot {
    CACHE.read().unwrap_or_else(|e| e.into_inner()).clone()
}
fn publish(mut next: MenuSnapshot) -> bool {
    let mut current = CACHE.write().unwrap_or_else(|e| e.into_inner());
    next.revision = current.revision;
    if *current == next {
        return false;
    }
    next.revision = current.revision.wrapping_add(1);
    *current = next;
    true
}
fn speed(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1}M", bytes as f64 / (1024. * 1024.))
    } else {
        format!("{:.0}K", bytes as f64 / 1024.)
    }
}
pub(super) fn start(app: tauri::AppHandle, state: NetworkState) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let Ok(catalog) = read_catalog() else {
                continue;
            };
            let Ok(runtime) = state.runtime.try_lock() else {
                continue;
            };
            let mut next = MenuSnapshot {
                generation: runtime.generation,
                running: runtime.phase == "running",
                selected_profile: catalog.active.is_some(),
                phase: runtime.phase.clone(),
                mode: catalog.settings.mode.clone(),
                system_proxy: catalog.settings.system_proxy,
                tun: catalog.settings.tun,
                more_profiles: catalog.profiles.len() > 30,
                profiles: catalog
                    .profiles
                    .iter()
                    .take(30)
                    .map(|p| ProfileChoice {
                        id: p.id.clone(),
                        name: p.name.clone(),
                        selected: catalog.active.as_deref() == Some(&p.id),
                    })
                    .collect(),
                ..Default::default()
            };
            let preferences = crate::desktop_preferences::current(&app);
            if let Some(tray) = app.tray_by_id(crate::tray::TRAY_ID) {
                let title = if preferences.tray_speed && next.running {
                    tokio::time::timeout(
                        Duration::from_secs(2),
                        control(&runtime, "GET", "/traffic", None),
                    )
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .map(|metric| {
                        format!(
                            "↑{} ↓{}",
                            speed(metric["up"].as_u64().unwrap_or(0)),
                            speed(metric["down"].as_u64().unwrap_or(0))
                        )
                    })
                } else {
                    None
                };
                let _ = tray.set_title(title.as_deref());
            }
            if next.running {
                if let Ok(Ok(proxies)) = tokio::time::timeout(
                    Duration::from_secs(2),
                    control(&runtime, "GET", "/proxies", None),
                )
                .await
                {
                    if let Some(proxies) = proxies["proxies"].as_object() {
                        let mut groups = proxies
                            .iter()
                            .filter(|(_, item)| item["all"].is_array())
                            .collect::<Vec<_>>();
                        groups.sort_by(|a, b| a.0.cmp(b.0));
                        next.more_groups = groups.len() > 20;
                        next.groups = groups
                            .into_iter()
                            .take(20)
                            .map(|(name, item)| GroupChoice {
                                name: name.clone(),
                                selected: item["now"].as_str().unwrap_or_default().into(),
                                more: item["all"].as_array().is_some_and(|a| a.len() > 100),
                                nodes: item["all"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .take(100)
                                    .map(str::to_owned)
                                    .collect(),
                            })
                            .collect();
                    }
                }
            }
            drop(runtime);
            if publish(next) {
                let handle = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    crate::tray::refresh_tray_menu(&handle)
                });
            }
        }
    });
}
/// Menu IDs contain only a cache revision and indices. Stale open menus cannot
/// select a different node after the core or subscription list changes.
pub(crate) fn handle(app: &tauri::AppHandle, event: &str) -> bool {
    let Some(event) = event.strip_prefix("network:") else {
        return false;
    };
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return true;
    }
    let app = app.clone();
    let event = event.to_owned();
    tauri::async_runtime::spawn(async move {
        let result=async {
            let parts=event.split(':').collect::<Vec<_>>();
            let state=app.try_state::<NetworkState>().context("Network workspace is not ready")?;
            match parts.as_slice(){
                ["start"]=>execute(&app,&state,"start",json!({})).await?,
                ["stop"]=>execute(&app,&state,"stop",json!({})).await?,
                ["action",action]=>shortcut(&app,action).await?,
                ["profile",revision,index]=>{
                    let menu=cached();ensure!(revision.parse::<u64>()?==menu.revision,"Menu changed; reopen it");
                    let profile=menu.profiles.get(index.parse::<usize>()?).context("Profile is no longer available")?;
                    execute(&app,&state,"profile.select",json!({"id":profile.id})).await?
                },
                ["node",revision,group,node]=>{
                    let menu=cached();ensure!(revision.parse::<u64>()?==menu.revision,"Menu changed; reopen it");
                    let group=menu.groups.get(group.parse::<usize>()?).context("Group is no longer available")?;
                    let node=group.nodes.get(node.parse::<usize>()?).context("Node is no longer available")?;
                    execute(&app,&state,"controller",json!({"method":"PUT","expectedGeneration":menu.generation,"path":format!("/proxies/{}",percent_encoding::utf8_percent_encode(&group.name,percent_encoding::NON_ALPHANUMERIC)),"body":{"name":node}})).await?
                },
                _=>bail!("Unknown network menu action"),
            };
            Ok::<_,anyhow::Error>(())
        }.await;
        BUSY.store(false, Ordering::Release);
        crate::desktop_preferences::notify_result(
            &app,
            "network-menu",
            result.err().map(|_| {
                "Network menu action failed; reopen the menu or review the network workspace"
                    .to_owned()
            }),
        );
        let _ = app.emit("network-state-changed", ());
    });
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_revision_changes_only_when_menu_identity_or_effective_state_changes() {
        let initial = cached();
        let mut next = initial.clone();
        next.phase = "fixture-running".into();
        assert!(publish(next));
        let next = cached();
        assert!(next.revision > initial.revision);
        assert!(!publish(next.clone()));
        let mut changed = next.clone();
        changed.groups.push(GroupChoice {
            name: "a:b/../c".into(),
            selected: "含冒号:name".into(),
            nodes: vec!["含冒号:name".into()],
            more: false,
        });
        assert!(publish(changed));
        assert_ne!(cached().revision, next.revision);
    }
}
