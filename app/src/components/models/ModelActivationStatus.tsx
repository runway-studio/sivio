import { useTranslation } from "react-i18next";
import { useWorkspaceReadiness } from "@/lib/query/workspaceReadiness";
import {
  readinessReasonLabel,
  type ReadinessCheckId,
} from "@/lib/workspaceReadiness";
import type { AppId } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Saving and launching never substitute for observed client/model evidence. */
export function ModelActivationStatus({
  app,
  disabled,
  onVerify,
}: {
  app: AppId;
  disabled: boolean;
  onVerify?: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const query = useWorkspaceReadiness(app);
  const checks = query.isError ? undefined : query.data?.checks;
  const stages: [ReadinessCheckId, string][] = [
    ["configuration", tr("配置保存", "Configuration saved")],
    ["client_read", tr("客户端读取", "Client reload")],
    ["model", tr("模型响应", "Model response")],
  ];
  return (
    <section
      className="rounded-lg border p-4"
      aria-label={tr("模型生效状态", "Model activation status")}
    >
      <ol className="grid gap-3 sm:grid-cols-3">
        {stages.map(([id, label], index) => {
          const check = checks?.find((item) => item.id === id);
          return (
            <li key={id}>
              <p className="text-xs text-muted-foreground">
                {index + 1}. {label}
              </p>
              <p
                className={`mt-1 text-sm ${check?.state === "fail" ? "text-destructive" : ""}`}
              >
                {check
                  ? readinessReasonLabel(check.reasonCode, zh)
                  : query.isError
                    ? tr("状态暂不可用", "Status unavailable")
                    : tr("正在读取状态…", "Reading status…")}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {disabled
          ? tr(
              "请先应用或撤销当前更改，再验证已保存的配置。",
              "Apply or discard your changes before verifying the saved configuration.",
            )
          : tr(
              "已有会话可能继续使用旧配置。请新开客户端会话验证；打开客户端本身不代表已读取新配置。",
              "Existing sessions may keep the old configuration. Verify in a new client session; opening the client alone does not prove a reload.",
            )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onVerify && (
          <Button
            size="sm"
            variant="outline"
            disabled={
              disabled ||
              !checks ||
              !checks.some(
                (check) =>
                  check.id === "configuration" && check.state === "pass",
              )
            }
            onClick={onVerify}
          >
            {tr("验证与打开客户端", "Verify and open client")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {tr("刷新生效状态", "Refresh activation status")}
        </Button>
      </div>
    </section>
  );
}
