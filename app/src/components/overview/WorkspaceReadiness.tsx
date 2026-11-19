import { ClientDiagnostic } from "./ClientDiagnostic";
import { useIsMutating } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_IDS, getAppLabel } from "@/config/appConfig";
import type { AppId } from "@/lib/api/types";
import {
  diagnosticStartKey,
  useWorkspaceReadiness,
} from "@/lib/query/workspaceReadiness";
import {
  readinessReasonLabel,
  type ReadinessCheckId,
} from "@/lib/workspaceReadiness";
import { Button } from "@/components/ui/button";

type ReadinessProps = {
  fixedApp?: AppId;
  onManageProviders?: (app: AppId) => void;
  onManageNetwork?: () => void;
};

export function WorkspaceReadinessDetails(props: ReadinessProps) {
  const { i18n } = useTranslation();
  const [expanded, setExpanded] = useState<boolean>();
  return (
    <details
      className="rounded-xl border"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        {i18n.language.startsWith("zh")
          ? "客户端诊断与详细状态"
          : "Client diagnostics and detailed status"}
      </summary>
      {expanded !== undefined && (
        <div className="px-4 pb-4">
          <WorkspaceReadiness {...props} visible={expanded} />
        </div>
      )}
    </details>
  );
}

export function WorkspaceReadiness({
  onManageProviders,
  onManageNetwork,
  fixedApp,
  visible = true,
}: ReadinessProps & { visible?: boolean }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const [selectedApp, setApp] = useState<AppId>("claude");
  const app = fixedApp ?? selectedApp;
  // A collapse can arrive between submitting a diagnostic and reading its pending state.
  const starting = useIsMutating({ mutationKey: diagnosticStartKey(app) }) > 0;
  const query = useWorkspaceReadiness(app, visible || starting);
  const id = useId();
  const labels: Record<ReadinessCheckId, string> = {
    configuration: tr("已保存配置", "Saved configuration"),
    client_read: tr("客户端读取", "Client reload"),
    gateway: tr("本地网关", "Local gateway"),
    outbound: tr("所选出口", "Selected outbound"),
    model: tr("模型验证", "Model verification"),
  };
  return (
    <section className="rounded-2xl border p-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="font-medium">
          {tr("客户端就绪状态", "Client readiness")}
        </h2>
        <label className="flex items-center gap-2 text-sm">
          {tr("客户端", "Client")}
          <select
            className="rounded-md border bg-background p-2"
            disabled={!!fixedApp}
            value={app}
            onChange={(e) => setApp(e.target.value as AppId)}
          >
            {APP_IDS.map((item) => (
              <option key={item} value={item}>
                {getAppLabel(item)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {tr(
          "自动刷新仅检查本地状态；主动验证需确认，配置保存不代表客户端已读取。",
          "Automatic refresh reads local state only. Active verification requires confirmation; saving configuration does not confirm a client reload.",
        )}
      </p>
      {query.isError ? (
        <div className="mt-3 flex items-center gap-3" role="status">
          <p>{tr("就绪状态暂不可用", "Readiness unavailable")}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {tr("重试", "Retry")}
          </Button>
        </div>
      ) : !query.data?.checks ? (
        <p className="mt-3 text-sm" role="status">
          {tr("正在读取本地状态…", "Reading local state…")}
        </p>
      ) : (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {query.data.checks.map((check) => (
            <div key={check.id} className="rounded-lg bg-muted p-3">
              <dt className="text-xs text-muted-foreground">
                {labels[check.id]}
              </dt>
              <dd
                className={`mt-2 text-sm ${check.state === "fail" ? "text-destructive" : ""}`}
              >
                {readinessReasonLabel(check.reasonCode, zh)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!query.isError && query.data?.checks && (
        <ClientDiagnostic
          key={app}
          app={app}
          snapshot={query.data}
          visible={visible}
        />
      )}
      {(onManageProviders || onManageNetwork) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onManageProviders && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onManageProviders(app)}
            >
              {query.data?.diagnostic?.reasonCode === "authentication_failed"
                ? tr("修复授权配置", "Repair authentication")
                : tr("管理客户端配置", "Manage client configuration")}
            </Button>
          )}
          {onManageNetwork && (
            <Button size="sm" variant="ghost" onClick={onManageNetwork}>
              {tr("检查出口设置", "Check outbound settings")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
