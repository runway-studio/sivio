import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
export function SyncPrivacySection() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const client = useQueryClient();
  const [include, setInclude] = useState(false);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    filePath: string;
    revision: string;
    device: string;
    createdAt: string;
    encrypted: boolean;
  } | null>(null);
  async function bundle(
    action: "backup.export" | "backup.preview" | "backup.restore",
  ) {
    setBusy(true);
    try {
      const result = await invoke<{
        cancelled?: boolean;
        warning?: string;
        filePath: string;
        revision: string;
        device: string;
        createdAt: string;
        encrypted: boolean;
      }>("network_command", {
        action,
        args: action === "backup.restore" ? preview : {},
      });
      if (result.cancelled) return;
      if (action === "backup.preview") setPreview(result);
      else {
        setPreview(null);
        await client.invalidateQueries();
        if (result.warning) toast.warning(result.warning);
        else
          toast.success(
            zh
              ? action === "backup.export"
                ? "统一配置备份已导出"
                : "统一配置已恢复"
              : action === "backup.export"
                ? "Configuration bundle exported"
                : "Configuration restored",
          );
      }
    } catch (error) {
      toast.error(
        typeof error === "object" && error && "message" in error
          ? String(error.message)
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  }
  const query = useQuery({
    queryKey: ["sync-privacy"],
    queryFn: () =>
      invoke<{
        includeSecrets: boolean;
        passwordConfigured: boolean;
        rememberPassword: boolean;
      }>("network_command", { action: "sync.privacy.get", args: {} }),
  });
  useEffect(() => {
    if (query.data) {
      setInclude(query.data.includeSecrets);
      setRemember(query.data.rememberPassword);
    }
  }, [query.data]);
  const unsaved =
    !query.data ||
    include !== query.data.includeSecrets ||
    remember !== query.data.rememberPassword ||
    password.length > 0;
  async function save() {
    setBusy(true);
    try {
      await invoke("network_command", {
        action: "sync.privacy.save",
        args: {
          includeSecrets: include,
          rememberPassword: remember,
          ...(password ? { password } : {}),
        },
      });
      setPassword("");
      await client.invalidateQueries({ queryKey: ["sync-privacy"] });
      await client.invalidateQueries({ queryKey: ["settings"] });
      toast.success(zh ? "同步隐私设置已保存" : "Sync privacy settings saved");
    } catch (error) {
      toast.error(
        typeof error === "object" && error && "message" in error
          ? String(error.message)
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-5 space-y-3 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">
        {zh ? "AI 与网络统一同步" : "Unified AI and network sync"}
      </h3>
      <p className="text-xs leading-6 text-muted-foreground">
        {zh
          ? "网络配置现与 AI 配置一起备份和同步。默认不含管理的凭据；订阅地址、命令参数和自定义脚本可能需要在目标设备重新填写。WebDAV 与 S3 只能启用一个。"
          : "Network profiles share the AI backup and sync snapshot. Managed credentials are excluded by default; subscription URLs, command arguments and custom scripts may need re-entry. Enable either WebDAV or S3."}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => setInclude(e.target.checked)}
        />
        {zh
          ? "包含凭据，并在上传前加密整个快照"
          : "Include credentials and encrypt the snapshot before upload"}
      </label>
      <Input
        aria-label={zh ? "备份加密口令" : "Backup encryption password"}
        type="password"
        autoComplete="new-password"
        minLength={12}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={
          query.data?.passwordConfigured
            ? zh
              ? "口令已配置，留空保留"
              : "Password configured; leave blank to retain"
            : zh
              ? "至少 12 个字符"
              : "At least 12 characters"
        }
      />
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        {zh
          ? "将口令保存在本机配置文件（具有文件读取权限的进程可读取）"
          : "Remember the password in local configuration (readable by processes with file access)"}
      </label>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "未勾选保存时，口令仅在本次运行中保留。其他设备下载加密快照时需要相同口令。错误口令或文件篡改会在恢复前被拒绝。"
          : "Unless remembered, the password lasts only for this app session. Other devices need the same password. Wrong passwords or tampered files are rejected before restore."}
      </p>
      {query.error && (
        <p role="alert" className="text-xs text-destructive">
          {String(query.error)}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={busy || query.isLoading}
        onClick={() => void save()}
      >
        {zh ? "保存同步隐私设置" : "Save sync privacy"}
      </Button>
      <div className="space-y-3 border-t pt-3">
        {unsaved && (
          <p className="text-xs text-muted-foreground">
            {zh
              ? "导出或恢复前，请先保存上方隐私设置。"
              : "Save the privacy settings above before exporting or restoring."}
          </p>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          {zh
            ? "统一配置备份包含 AI、网络与 Skills，采用上方已保存的隐私设置。恢复会替换这些数据；请先停止网络与 AI 路由。恢复前会自动备份数据库。请求日志、运行状态和本机登录会话不包含在此配置包中。"
            : "Configuration bundles include AI, network and Skills using the saved privacy settings above. Restore replaces these data; stop network and AI routing first. A database safety backup is created. Request logs, runtime state and local login sessions are excluded."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || unsaved || query.isError}
            onClick={() => void bundle("backup.export")}
          >
            {zh ? "导出统一配置包" : "Export configuration bundle"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void bundle("backup.preview")}
          >
            {zh ? "选择备份并预览" : "Select backup and preview"}
          </Button>
        </div>
        {preview && (
          <div className="space-y-2 rounded-md border p-3 text-xs">
            <p className="break-all">{preview.filePath}</p>
            <p>
              {preview.device} · {preview.createdAt} ·{" "}
              {preview.encrypted
                ? zh
                  ? "已加密"
                  : "Encrypted"
                : zh
                  ? "不含管理的凭据"
                  : "Managed credentials excluded"}
            </p>
            <p className="text-muted-foreground">
              {zh
                ? "确认后将替换当前 AI、网络和 Skills 配置。"
                : "Confirming replaces the current AI, network and Skills configuration."}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || unsaved || query.isError}
                onClick={() => void bundle("backup.restore")}
              >
                {zh ? "确认恢复此备份" : "Restore this backup"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                {zh ? "取消" : "Cancel"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
