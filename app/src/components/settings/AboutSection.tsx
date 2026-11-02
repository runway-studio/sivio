import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "@/lib/toast";
import { settingsApi } from "@/lib/api";
import { useUpdate } from "@/contexts/UpdateContext";
import appIcon from "@/assets/icons/app-icon.png";
interface Channel {
  mode: "official" | "custom" | "disabled";
  endpoint: string;
  publicKey: string;
  configured: boolean;
  releasePage: string;
  signingMode: string;
}
export function AboutSection({ isPortable }: { isPortable: boolean }) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState<Channel["mode"]>("official");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient();
  const update = useUpdate();
  const busy = [
    "checking",
    "downloading",
    "verifying",
    "installing",
    "restarting",
  ].includes(update.stage);
  const config = useQuery({
    queryKey: ["si-update-channel"],
    queryFn: () =>
      invoke<Channel>("network_command", {
        action: "app.update.get",
        args: {},
      }),
  });
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (config.data) {
      setMode(config.data.mode);
      setEndpoint(config.data.endpoint);
      setKey(config.data.publicKey);
    }
  }, [config.data]);
  async function save() {
    setSaving(true);
    try {
      await invoke("network_command", {
        action: "app.update.save",
        args: {
          mode,
          endpoint: mode === "custom" ? endpoint : "",
          publicKey: mode === "custom" ? key : "",
        },
      });
      update.resetUpdate();
      await client.invalidateQueries({ queryKey: ["si-update-channel"] });
      toast.success(text("更新设置已保存", "Update settings saved"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  }
  async function check() {
    try {
      if (!(await update.checkUpdate()))
        toast.success(
          text("已是此通道的最新版本", "You are up to date on this channel"),
        );
    } catch {
      /* Context displays the check error, never an up-to-date toast. */
    }
  }
  const stageLabel: Record<string, string> = {
    checking: text("正在检查更新…", "Checking for updates…"),
    downloading: text("正在下载…", "Downloading…"),
    verifying: text("正在验证更新包…", "Verifying update…"),
    ready: text("下载和验证完成", "Download verified"),
    installing: text(
      "正在安装，网络将短暂中断…",
      "Installing; networking will pause briefly…",
    ),
    restarting: text("正在重启…", "Restarting…"),
  };
  const progress = update.progress;
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;
  const releasePage =
    config.data?.releasePage ??
    "https://github.com/runway-studio/sivio/releases";
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5">
        <img src={appIcon} alt="Sivio" className="h-12 w-12" />
        <div className="flex-1">
          <h2 className="font-semibold">Sivio</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("app.description")}
          </p>
          <p className="text-xs text-muted-foreground">
            v{version || "—"} · {text("内部签名版", "Internally signed")}
            {isPortable ? " · Portable" : ""}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!config.data?.configured || busy || saving}
          onClick={() => void check()}
        >
          {text("检查更新", "Check for updates")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void settingsApi.openExternal(releasePage)}
        >
          {text("发行说明与下载", "Releases and downloads")}
        </Button>
      </section>
      {update.updateInfo && (
        <section className="space-y-3 rounded-xl border p-4 text-sm">
          <p className="font-medium">
            {text("可用更新", "Update available")} v
            {update.updateInfo.availableVersion}
          </p>
          <p className="whitespace-pre-wrap text-muted-foreground">
            {update.updateInfo.notes}
          </p>
          {stageLabel[update.stage] && (
            <p role="status">{stageLabel[update.stage]}</p>
          )}
          {update.stage === "downloading" && progress && (
            <p role="status">
              {(progress.downloaded / 1024 / 1024).toFixed(1)} MB
              {percent !== null ? ` · ${percent}%` : ""}
            </p>
          )}
          <div className="flex gap-2">
            {update.stage === "ready" ? (
              <Button disabled={isPortable} onClick={() => setConfirm(true)}>
                {text("安装更新并重启", "Install and restart")}
              </Button>
            ) : (
              <Button
                disabled={busy || isPortable}
                onClick={() => void update.downloadUpdate()}
              >
                {text("下载更新", "Download update")}
              </Button>
            )}
            {["downloading", "verifying", "ready"].includes(update.stage) && (
              <Button
                variant="outline"
                onClick={() => void update.cancelUpdate()}
              >
                {text("取消更新", "Cancel update")}
              </Button>
            )}
          </div>
          {isPortable && (
            <p>
              {text(
                "请从发行页面下载并手动安装。",
                "Download and install manually from Releases.",
              )}
            </p>
          )}
        </section>
      )}
      {update.error && (
        <p role="alert" className="text-sm text-destructive">
          {update.error}
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-5 text-sm">
        <p>
          {text("更新来源", "Update source")}：
          {config.data?.mode === "custom"
            ? text("自定义", "Custom")
            : config.data?.mode === "disabled"
              ? text("已禁用", "Disabled")
              : text("Sivio 官方", "Sivio official")}
        </p>
        <p className="text-xs text-muted-foreground">
          {text(
            "下载后会验证签名；安装前需要确认并短暂重启网络。首次安装可能显示 macOS 安全提示。",
            "Downloads are signature-verified. Installation requires confirmation and briefly restarts networking. macOS may show a security prompt on first installation.",
          )}
        </p>
        <details>
          <summary className="cursor-pointer">
            {text("高级更新设置", "Advanced update settings")}
          </summary>
          <div className="mt-3 space-y-3">
            <select
              aria-label={text("更新通道", "Update channel")}
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as Channel["mode"])
              }
              className="rounded border bg-background p-2"
            >
              <option value="official">{text("官方", "Official")}</option>
              <option value="custom">{text("自定义", "Custom")}</option>
              <option value="disabled">{text("禁用", "Disabled")}</option>
            </select>
            {mode === "custom" && (
              <>
                <Input
                  aria-label={text(
                    "Sivio 更新服务地址",
                    "Sivio update endpoint",
                  )}
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
                <textarea
                  aria-label={text("Tauri 更新公钥", "Tauri update public key")}
                  className="min-h-24 w-full rounded border bg-background p-3 font-mono text-xs"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
              </>
            )}
            <Button
              variant="outline"
              disabled={busy || saving || config.isLoading}
              onClick={() => void save()}
            >
              {text("保存更新设置", "Save update settings")}
            </Button>
          </div>
        </details>
        {config.error && <p role="alert">{String(config.error)}</p>}
      </section>
      <section className="space-y-3 rounded-xl border p-5 text-sm">
        <h3 className="font-medium">
          {text("来源与许可", "Sources and licenses")}
        </h3>
        <p>
          {text(
            "Sivio 整合 CC Switch 与 Clash Verge Rev，按 GPL-3.0-only 提供。对应源码与许可证随版本发布。",
            "Sivio combines CC Switch and Clash Verge Rev under GPL-3.0-only. Corresponding source and licenses accompany each release.",
          )}
        </p>
        <Button
          variant="outline"
          onClick={() =>
            void invoke("network_command", {
              action: "about.sources",
              args: {},
            }).catch((error) => toast.error(String(error)))
          }
        >
          {text("查看来源与许可", "View sources and licenses")}
        </Button>
      </section>
      <ConfirmDialog
        isOpen={confirm}
        variant="info"
        title={text("安装更新并重启？", "Install and restart?")}
        message={text(
          "Sivio 将短暂停止自己的网络与 AI 网关，安装已验证的新版本后重启。配置和数据会保留。",
          "Sivio will briefly stop its network and AI gateway, install the verified update and restart. Your configuration and data are retained.",
        )}
        confirmText={text("安装并重启", "Install and restart")}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          update.installUpdate();
        }}
      />
    </div>
  );
}
