import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { settingsApi } from "@/lib/api";
import { useUpdate } from "@/contexts/UpdateContext";
import appIcon from "@/assets/icons/app-icon.png";
function message(error: unknown) {
  return typeof error === "object" && error && "message" in error
    ? String(error.message)
    : String(error);
}
export function AboutSection({ isPortable }: { isPortable: boolean }) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [version, setVersion] = useState("0.1.0");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const update = useUpdate();
  const config = useQuery({
    queryKey: ["si-update-channel"],
    queryFn: () =>
      invoke<{ endpoint: string; publicKey: string }>("network_command", {
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
      setEndpoint(config.data.endpoint);
      setKey(config.data.publicKey);
    }
  }, [config.data]);
  const configured = !!config.data?.endpoint && !!config.data?.publicKey;
  async function save() {
    setBusy(true);
    try {
      await invoke("network_command", {
        action: "app.update.save",
        args: { endpoint, publicKey: key },
      });
      await client.invalidateQueries({ queryKey: ["si-update-channel"] });
      toast.success(zh ? "更新源设置已保存" : "Update channel saved");
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    try {
      if (update.hasUpdate && !isPortable) {
        await settingsApi.installUpdateAndRestart();
      } else {
        const available = await update.checkUpdate();
        if (!available)
          toast.success(
            zh
              ? "此更新源没有更新版本"
              : "No newer version on this update channel",
          );
      }
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function sources() {
    try {
      await invoke("network_command", { action: "about.sources", args: {} });
    } catch (error) {
      toast.error(message(error));
    }
  }
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
            v{version} · {zh ? "内部版本" : "Internal build"}
            {isPortable ? " · Portable" : ""}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!configured || busy || update.isChecking}
          onClick={() => void check()}
        >
          {busy || update.isChecking
            ? zh
              ? "正在处理…"
              : "Working…"
            : update.hasUpdate
              ? zh
                ? "安装更新并重启"
                : "Install and restart"
              : zh
                ? "检查更新"
                : "Check for updates"}
        </Button>
      </section>
      {update.hasUpdate && update.updateInfo && (
        <section className="rounded-xl border p-4 text-sm">
          <p>v{update.updateInfo.availableVersion}</p>
          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
            {update.updateInfo.notes}
          </p>
        </section>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h3 className="text-sm font-medium">
          {zh ? "Sivio 更新源" : "Sivio update channel"}
        </h3>
        <p className="text-xs leading-6 text-muted-foreground">
          {zh
            ? "默认未配置。仅使用 Sivio 的 HTTPS 更新服务与 Tauri 签名公钥；不使用上游应用的更新包。更新下载会先验证签名，验证失败不会替换应用。"
            : "Unconfigured by default. Use a Sivio HTTPS feed and Tauri signature public key. Updates are authenticated before replacing the app."}
        </p>
        <Input
          aria-label={
            zh ? "Sivio 更新服务地址" : "Sivio update endpoint"
          }
          placeholder="https://updates.example.com/{{target}}/{{arch}}/{{current_version}}"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <textarea
          aria-label={zh ? "Tauri 更新公钥" : "Tauri update public key"}
          className="min-h-24 w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder={
            zh ? "Tauri 公钥的 base64 内容" : "Base64 Tauri public key"
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {configured
            ? zh
              ? "已配置自有更新通道"
              : "Custom channel configured"
            : zh
              ? "更新通道未配置；清空两项并保存可禁用"
              : "Update channel not configured; clear both fields to disable"}
        </p>
        {config.error && (
          <p role="alert" className="text-xs text-destructive">
            {message(config.error)}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy || config.isLoading}
          onClick={() => void save()}
        >
          {zh ? "保存更新源" : "Save update channel"}
        </Button>
      </section>
      <section className="space-y-3 rounded-xl border p-5">
        <h3 className="text-sm font-medium">
          {zh ? "来源与许可" : "Sources and licenses"}
        </h3>
        <p className="text-xs leading-6 text-muted-foreground">
          {zh
            ? "本应用整合 CC Switch 的 AI 工具管理与 Clash Verge Rev 的网络能力，组合应用按 GPL-3.0-only 提供。随包附带移植源码、上游许可及依赖通知。"
            : "Combines CC Switch AI tooling and Clash Verge Rev networking under GPL-3.0-only. Source, upstream licenses and dependency notices accompany the app."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void sources()}>
            {zh ? "查看本应用源码与许可" : "View bundled source and licenses"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void settingsApi.openExternal(
                "https://github.com/farion1231/cc-switch",
              )
            }
          >
            CC Switch · MIT
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void settingsApi.openExternal(
                "https://github.com/clash-verge-rev/clash-verge-rev",
              )
            }
          >
            Clash Verge Rev · GPL-3.0
          </Button>
        </div>
      </section>
    </div>
  );
}
