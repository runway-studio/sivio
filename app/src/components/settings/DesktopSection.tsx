import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  defaultDesktopPreferences,
  desktopActions,
  useDesktopPreferences,
  type DesktopPreferences,
  type DesktopSnapshot,
} from "@/lib/desktopPreferences";
import { usePendingMutation, useUnsavedValue } from "@/lib/unsavedChanges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrayImageFields } from "./TrayImageFields";
import { WorkspacePresentationFields } from "./WorkspacePresentationFields";
const names = {
  open_or_close_dashboard: ["显示 / 隐藏主窗口", "Show / hide window"],
  clash_mode_rule: ["网络规则模式", "Network rule mode"],
  clash_mode_global: ["网络全局模式", "Network global mode"],
  clash_mode_direct: ["网络直连模式", "Network direct mode"],
  toggle_system_proxy: ["切换系统代理", "Toggle system proxy"],
  toggle_tun_mode: ["切换 TUN", "Toggle TUN"],
  entry_lightweight_mode: ["进入轻量模式", "Enter lightweight mode"],
  reactivate_profiles: ["重新应用网络配置", "Reapply network profile"],
  quit: ["退出 Sivio", "Quit Sivio"],
  hide: ["隐藏主窗口", "Hide window"],
} as const;
export function DesktopSection() {
  const { i18n } = useTranslation();
  const zh = (i18n.language ?? "zh").startsWith("zh");
  const copy = (cn: string, en: string) => (zh ? cn : en);
  const query = useDesktopPreferences();
  const client = useQueryClient();
  const [draft, setDraft] = useState<DesktopPreferences>(
    defaultDesktopPreferences,
  );
  const [original, setOriginal] = useState<DesktopPreferences>(
    defaultDesktopPreferences,
  );
  const [revision, setRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  useUnsavedValue(dirty);
  usePendingMutation(busy);
  useEffect(() => {
    if (query.data && !dirty) {
      const upgraded = {
        ...defaultDesktopPreferences,
        ...query.data.preferences,
      };
      setDraft(upgraded);
      setOriginal(upgraded);
      setRevision(query.data.revision);
    }
  }, [query.data, dirty]);
  const patch = (value: Partial<DesktopPreferences>) =>
    setDraft((previous) => ({ ...previous, ...value }));
  async function save(reset = false) {
    setBusy(true);
    setError("");
    try {
      const saved = await invoke<DesktopSnapshot>("network_command", {
        action: reset ? "desktop.reset" : "desktop.save",
        args: reset ? {} : { preferences: draft, revision },
      });
      client.setQueryData(["desktop-preferences"], saved);
      setDraft(saved.preferences);
      setOriginal(saved.preferences);
      setRevision(saved.revision);
    } catch (error) {
      setError(
        typeof error === "object" && error && "message" in error
          ? String(error.message)
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-5 space-y-4 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">
        {copy("桌面、托盘与全局快捷键", "Desktop, tray and global shortcuts")}
      </h3>
      <p className="text-xs leading-6 text-muted-foreground">
        {copy(
          "自动轻量模式只在窗口失去焦点后计时，遇到未保存内容或进行中的操作会跳过。快捷键默认关闭；注册冲突会保留原设置。网络快捷键作用于当前选择的网络配置。",
          "Automatic lightweight mode counts time only while the window is unfocused and skips unsaved drafts or active operations. Global shortcuts default to off; conflicts preserve your previous settings. Network shortcuts use the selected network profile.",
        )}
      </p>
      {(query.error || error || query.data?.registrationError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || query.error?.message || query.data?.registrationError}
        </p>
      )}
      {query.data?.localBackup && (
        <p
          role={query.data.localBackup.error ? "alert" : "status"}
          className="text-xs text-muted-foreground"
        >
          {query.data.localBackup.error ||
            `${copy("最近配置变更备份", "Last configuration-change backup")}: ${new Date(query.data.localBackup.at * 1000).toLocaleString()} · ${query.data.localBackup.file ?? ""}`}
        </p>
      )}
      <fieldset
        disabled={busy || !query.data}
        className="grid min-w-0 gap-4 md:grid-cols-2"
      >
        <label className="space-y-2 text-xs">
          {copy("启动页", "Startup page")}
          <select
            aria-label={copy("启动页", "Startup page")}
            className="block h-9 w-full rounded-md border bg-background px-3"
            value={draft.startPage}
            onChange={(e) => patch({ startPage: e.target.value })}
          >
            {[
              ["remember", "记住上次页面", "Remember last page"],
              ["overview", "概览", "Overview"],
              ["network", "网络", "Network"],
              ["providers", "供应商", "Providers"],
              ["usage", "用量", "Usage"],
              ["auth", "授权中心", "Authorization"],
              ["mcp", "MCP", "MCP"],
              ["skills", "Skills", "Skills"],
              ["prompts", "提示词", "Prompts"],
              ["sessions", "会话", "Sessions"],
              ["apps", "应用", "Apps"],
            ].map(([key, cn, en]) => (
              <option key={key} value={key}>
                {copy(cn, en)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-xs">
          {copy(
            "自动轻量模式（分钟，0 关闭）",
            "Automatic lightweight mode (minutes; 0 disables)",
          )}
          <Input
            aria-label={copy("自动轻量分钟数", "Automatic lightweight minutes")}
            type="number"
            min={0}
            max={1440}
            value={draft.autoLightweightMinutes}
            onChange={(e) =>
              patch({ autoLightweightMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label className="space-y-2 text-xs">
          {copy("托盘左键", "Tray left click")}
          <select
            aria-label={copy("托盘左键", "Tray left click")}
            className="block h-9 w-full rounded-md border bg-background px-3"
            value={draft.trayClickAction}
            onChange={(e) =>
              patch({
                trayClickAction: e.target
                  .value as DesktopPreferences["trayClickAction"],
              })
            }
          >
            <option value="menu">{copy("打开菜单", "Open menu")}</option>
            <option value="window">{copy("显示窗口", "Show window")}</option>
          </select>
        </label>
        <label className="space-y-2 text-xs">
          {copy("托盘图标", "Tray icon")}
          <select
            aria-label={copy("托盘图标", "Tray icon")}
            className="block h-9 w-full rounded-md border bg-background px-3"
            value={draft.trayIcon}
            onChange={(e) =>
              patch({
                trayIcon: e.target.value as DesktopPreferences["trayIcon"],
              })
            }
          >
            <option value="template">
              {copy("跟随菜单栏明暗", "Follow menu bar appearance")}
            </option>
            <option value="color">
              {copy("彩色 Sivio", "Color Sivio")}
            </option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input
            aria-label={copy("启用全局快捷键", "Enable global shortcuts")}
            type="checkbox"
            checked={draft.globalShortcutsEnabled}
            onChange={(e) =>
              patch({ globalShortcutsEnabled: e.target.checked })
            }
          />
          {copy("启用全局快捷键", "Enable global shortcuts")}
        </label>
        <WorkspacePresentationFields draft={draft} patch={patch} zh={zh} />
        <TrayImageFields draft={draft} patch={patch} zh={zh} onBusy={setBusy} />
        {desktopActions.map((action) => (
          <label key={action} className="space-y-2 text-xs">
            {names[action][zh ? 0 : 1]}
            <Input
              aria-label={names[action][zh ? 0 : 1]}
              value={draft.hotkeys[action] ?? ""}
              placeholder="Command+Shift+K"
              onChange={(e) =>
                patch({
                  hotkeys: { ...draft.hotkeys, [action]: e.target.value },
                })
              }
            />
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {copy(
          "快捷键需包含 Command、Control 或 Option；留空取消该动作。关闭全局开关会释放已注册的按键。",
          "Use Command, Control or Option. Leave a field blank to unbind an action. Turning the global switch off releases registered keys.",
        )}
      </p>
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs">
          {copy(
            "本机启动脚本（单独授权，不随配置包迁移）",
            "Local startup script (separate approval; excluded from configuration restore)",
          )}
        </p>
        <p
          role={query.data?.startupScript?.error ? "alert" : "status"}
          className="break-all text-xs text-muted-foreground"
        >
          {query.data?.startupScript?.error ||
            [
              query.data?.startupScript?.state ?? "none",
              query.data?.startupScript?.path,
            ]
              .filter(Boolean)
              .join(" · ")}
        </p>
        <div className="flex gap-2">
          {(
            [
              [
                "choose",
                copy("选择并授权启动脚本", "Choose and approve startup script"),
              ],
              [
                "clear",
                copy("取消启动脚本授权", "Remove startup script approval"),
              ],
            ] as const
          ).map(([action, label]) => (
            <Button
              key={action}
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void invoke("network_command", {
                  action: `desktop.startupScript.${action}`,
                  args: {},
                })
                  .then(() => query.refetch())
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void emit("lightweight-requested", { automatic: false }).catch(
            (error) => setError(String(error)),
          )
        }
      >
        {copy("立即进入轻量模式", "Enter lightweight mode now")}
      </Button>
      <div className="flex gap-2">
        <Button
          disabled={busy || !query.data || !dirty}
          onClick={() => void save()}
        >
          {copy("应用桌面设置", "Apply desktop settings")}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (
              dirty &&
              !window.confirm(
                copy(
                  "放弃未保存的桌面设置？",
                  "Discard unsaved desktop preferences?",
                ),
              )
            )
              return;
            setDirtyReload();
          }}
        >
          {copy("重载桌面设置", "Reload desktop settings")}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                copy(
                  "恢复默认桌面设置并释放自定义全局快捷键？",
                  "Reset desktop settings and release custom global shortcuts?",
                ),
              )
            )
              void save(true);
          }}
        >
          {copy("恢复默认桌面设置", "Reset desktop settings")}
        </Button>
      </div>
    </section>
  );
  function setDirtyReload() {
    setDraft(original);
    setError("");
    void query.refetch();
  }
}
