import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MigrationStatus = {
  pending: number;
  running: boolean;
  error: string | null;
  backupPath: string | null;
};

export function CredentialMigrationNotice({
  onImport,
}: {
  onImport: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await invoke<MigrationStatus>("credential_migration_status");
      if (typeof next?.pending === "number") {
        setStatus(next);
        setError(null);
      }
    } catch {
      // A failed inspection must not trigger migration or a Keychain read.
      setError("无法检查旧凭据，请重试。Could not inspect legacy credentials.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);
  const migrate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<MigrationStatus>("migrate_legacy_credentials");
      setStatus(next);
      setFinished(next.pending === 0 && !next.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || status?.running;
  if (!status?.pending && !error && !finished && !working) return null;
  return (
    <>
      <div
        className="fixed bottom-4 right-4 z-50 flex max-w-lg items-center gap-3 rounded-xl border bg-background p-3 shadow-lg"
        role="status"
      >
        <p className="text-sm">
          {finished
            ? text(
                "旧凭据已迁移，重启后即可使用。",
                "Credentials migrated. Restart to continue.",
              )
            : text(
                "旧配置需要迁移，完成后无需反复授权钥匙串。",
                "Migrate old configuration to stop repeated Keychain prompts.",
              )}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setOpen(true);
            void refresh();
          }}
        >
          {text("查看", "Review")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent zIndex="alert" className="max-w-xl overflow-y-auto p-4">
          <DialogHeader>
            <DialogTitle>
              {text("迁移旧凭据", "Migrate legacy credentials")}
            </DialogTitle>
            <DialogDescription>
              {text(
                "新版本像 CC Switch 一样，将配置和凭据保存在本机文件中，并限制文件访问权限。迁移完成后，日常打开和切换配置不再访问 Sivio 的钥匙串条目。",
                "Like CC Switch, this version stores configuration and credentials in local files with restricted permissions. After migration, normal startup and configuration switching no longer access Sivio Keychain items.",
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {text(
              "本地凭据可被有权限读取这些文件的进程读取。迁移会先备份原配置；旧条目可能仍需多次系统授权。拒绝或暂停后保留已完成进度，不会删除原钥匙串条目。",
              "Processes that can read these files can read the credentials. Migration backs up the original configuration first. Old items may still require several system authorizations. Denying or pausing preserves completed work and keeps the original Keychain items.",
            )}
          </p>
          <p className="text-sm" aria-live="polite">
            {finished
              ? text(
                  "迁移完成。请重启应用以重新加载工作区。",
                  "Migration complete. Restart the app to reload the workspace.",
                )
              : text(
                  `剩余 ${status?.pending ?? "—"} 份配置`,
                  `${status?.pending ?? "—"} documents remaining`,
                )}
          </p>
          {(error || status?.error) && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error || status?.error}
            </p>
          )}
          {status?.backupPath && (
            <p className="break-all text-xs text-muted-foreground">
              {text("原始备份：", "Original backup: ")}
              {status.backupPath}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={!!working}
              onClick={() => setOpen(false)}
            >
              {text("稍后", "Later")}
            </Button>
            <Button
              variant="outline"
              disabled={!!working}
              onClick={() => {
                setOpen(false);
                onImport();
              }}
            >
              {text("从原应用导入配置", "Import configuration")}
            </Button>
            {finished ? (
              <Button
                onClick={() =>
                  void relaunch().catch((e) => setError(String(e)))
                }
              >
                {text("重启应用", "Restart app")}
              </Button>
            ) : working ? (
              <Button
                variant="outline"
                onClick={() =>
                  void invoke("cancel_credential_migration").catch((e) =>
                    setError(String(e)),
                  )
                }
              >
                {text(
                  "暂停（系统弹窗中可点拒绝）",
                  "Pause (deny the current system prompt)",
                )}
              </Button>
            ) : (
              <Button
                disabled={!status?.pending}
                onClick={() => void migrate()}
              >
                {text("开始 / 继续迁移", "Start / resume migration")}
              </Button>
            )}
            {!working && !status && (
              <Button onClick={() => void refresh()}>
                {text("重试检查", "Retry inspection")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
