import { useTranslation } from "react-i18next";
import type { AppId } from "@/lib/api";
import { useWorkspaceReadiness } from "@/lib/query/workspaceReadiness";
import { readinessReasonLabel } from "@/lib/workspaceReadiness";

export function ClientReadinessSummary({ app }: { app: AppId }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const query = useWorkspaceReadiness(app);
  if (query.isError || !query.data?.checks)
    return (
      <p className="text-xs text-muted-foreground">
        {query.isError
          ? zh
            ? "就绪状态暂不可用"
            : "Readiness unavailable"
          : zh
            ? "正在读取状态…"
            : "Loading status…"}
      </p>
    );
  const checks = query.data.checks;
  const failure = checks.find((check) => check.state === "fail");
  const model = checks.find((check) => check.id === "model");
  const configuration = checks.find((check) => check.id === "configuration");
  const primary = failure ?? model ?? configuration;
  const client = checks.find((check) => check.id === "client_read");
  return (
    <div className="text-xs" role="status">
      <p className={failure ? "text-destructive" : ""}>
        {primary
          ? readinessReasonLabel(primary.reasonCode, zh)
          : zh
            ? "状态待确认"
            : "Status unknown"}
      </p>
      <p className="mt-1 text-muted-foreground">
        {client
          ? readinessReasonLabel(client.reasonCode, zh)
          : zh
            ? "客户端读取待确认"
            : "Client reload unobserved"}
      </p>
      {query.data.diagnostic?.state === "pass" && model?.state === "pass" && (
        <p className="mt-1 text-muted-foreground">
          {new Date(query.data.diagnostic.observedAt).toLocaleTimeString(
            i18n.language,
          )}
        </p>
      )}
    </div>
  );
}
