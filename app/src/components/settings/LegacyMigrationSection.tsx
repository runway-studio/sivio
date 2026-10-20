import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
type Source = {
  kind: "cc-switch" | "clash-verge";
  filePath: string;
  available?: boolean;
  cancelled?: boolean;
};
type Preview = Source & {
  revision: string;
  replace: boolean;
  counts: Record<string, { added: number; conflicts: number; kept: number }>;
  warnings: string[];
};
export function LegacyMigrationSection() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const client = useQueryClient();
  const [kind, setKind] = useState<Source["kind"]>("cc-switch");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(
        e && typeof e === "object" && "message" in e
          ? String(e.message)
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function review(source: Source) {
    setPreview(null);
    const result = await invoke<Preview>("network_command", {
      action: "migration.preview",
      args: { ...source, replace },
    });
    setPreview(result);
  }
  async function choose(directory: boolean) {
    setPreview(null);
    const source = await invoke<Source>("network_command", {
      action: "migration.choose",
      args: { kind, directory },
    });
    if (!source.cancelled) await review(source);
  }
  return (
    <section className="mb-5 space-y-3 rounded-xl border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">
        {zh
          ? "从 CC Switch / Clash Verge Rev 迁移"
          : "Migrate from CC Switch / Clash Verge Rev"}
      </h3>
      <p className="text-xs leading-6 text-muted-foreground">
        {zh
          ? "只读扫描并合并数据，原应用和客户端文件保持原样。先退出原应用，再选择其数据目录或备份；确认导入前请停止 Sivio 网络和 AI 路由。新导入对象保持未启用，登录账号需重新授权。"
          : "Read-only source scan and data merge. Quit the original app before choosing its data directory or backup. Stop Sivio network and AI routing before importing. Imported objects stay inactive; accounts require fresh authorization."}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          {zh ? "来源 " : "Source "}
          <select
            aria-label={zh ? "迁移来源" : "Migration source"}
            className="rounded border bg-background px-2 py-1"
            disabled={busy}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Source["kind"]);
              setPreview(null);
            }}
          >
            <option value="cc-switch">CC Switch</option>
            <option value="clash-verge">Clash Verge Rev</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={replace}
            disabled={busy}
            onChange={(e) => {
              setReplace(e.target.checked);
              setPreview(null);
            }}
          />
          {zh
            ? "替换冲突；若旧网络配置无法读取，将整份网络配置替换为导入来源（原配置会备份）"
            : "Replace conflicts; if old network configuration is unreadable, replace it entirely from this source (original backed up)"}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setSources(
                await invoke<Source[]>("network_command", {
                  action: "migration.scan",
                  args: {},
                }),
              );
            })
          }
        >
          {zh ? "扫描默认目录" : "Scan default directories"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => choose(true))}
        >
          {zh ? "选择数据目录" : "Choose data directory"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => choose(false))}
        >
          {zh ? "选择备份文件" : "Choose backup file"}
        </Button>
      </div>
      {sources.map((source) => (
        <div key={source.kind} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 break-all">
            {source.kind} · {source.filePath}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !source.available}
            onClick={() => void run(() => review(source))}
          >
            {source.available
              ? zh
                ? "预览"
                : "Preview"
              : zh
                ? "未发现"
                : "Not found"}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {zh ? "正在校验配置…" : "Validating configuration…"}
        </p>
      )}
      {preview && (
        <div className="space-y-3 rounded-lg border p-3 text-xs">
          <p className="break-all">{preview.filePath}</p>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>{zh ? "对象" : "Objects"}</th>
                <th>{zh ? "新增" : "New"}</th>
                <th>{zh ? "冲突" : "Conflicts"}</th>
                <th>{zh ? "保留" : "Kept"}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(preview.counts).map(([name, count]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{count.added}</td>
                  <td>{count.conflicts}</td>
                  <td>{count.kept}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings.map((message) => (
            <p key={message} className="leading-5 text-muted-foreground">
              {message}
            </p>
          ))}
          <p>
            {zh
              ? "导入前会创建可恢复快照。来源或当前数据有变化时，本预览会失效。"
              : "A recoverable snapshot is created before import. Changes to either source or current data invalidate this preview."}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke("network_command", {
                    action: "migration.apply",
                    args: preview,
                  });
                  setPreview(null);
                  await client.invalidateQueries();
                  toast.success(
                    zh
                      ? "迁移完成，请检查并手动启用所需对象"
                      : "Migration completed; review and enable objects manually",
                  );
                })
              }
            >
              {zh ? "确认合并导入" : "Confirm merge import"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {zh ? "取消" : "Cancel"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
