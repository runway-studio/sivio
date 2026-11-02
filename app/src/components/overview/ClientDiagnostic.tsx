import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { isProxyAppId } from "@/config/appConfig";
import { modelHubApi } from "@/lib/api/model-hub";
import type { AppId } from "@/lib/api";
import {
  readinessReasonLabel,
  type ReadinessSnapshot,
  type DiagnosticRun,
} from "@/lib/workspaceReadiness";
import { Button } from "@/components/ui/button";

export function ClientDiagnostic({
  app,
  snapshot,
}: {
  app: AppId;
  snapshot: ReadinessSnapshot;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const cache = useQueryClient();
  const catalog = useQuery({
    queryKey: ["model-picker", app],
    queryFn: () =>
      modelHubApi.catalog(app as Parameters<typeof modelHubApi.catalog>[0]),
    enabled: open && isProxyAppId(app),
  });
  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["providers", app, "readiness"] });
  const start = useMutation({
    mutationFn: () =>
      invoke<DiagnosticRun>("start_client_diagnostic", {
        appType: app,
        providerId: provider,
        model: model.trim(),
        activeProbe: confirmed,
        expected: {
          app,
          configurationRevision: snapshot.configurationRevision,
          credentialEpoch: snapshot.credentialEpoch,
          networkGeneration: snapshot.networkGeneration,
          outboundRevision: snapshot.outboundRevision,
        },
      }),
    onSuccess: async () => {
      setConfirmed(false);
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      invoke("cancel_client_diagnostic", { runId: snapshot.diagnostic?.runId }),
    onSuccess: refresh,
  });
  const run = snapshot.diagnostic;
  const pending = run?.state === "pending" || start.isPending;
  if (!isProxyAppId(app))
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        {tr(
          "此客户端请在新会话中手动发送测试消息。",
          "Send a test message in a new session of this client.",
        )}
      </p>
    );
  return (
    <div className="mt-3 space-y-3">
      {run && (
        <div className="text-sm" role="status">
          <p>
            {run.providerId} · {run.model} —{" "}
            {readinessReasonLabel(run.reasonCode, zh)}
          </p>
          <p className="text-xs text-muted-foreground">
            {tr(
              "诊断费用未知；预算控制尚未启用。",
              "Diagnostic cost unknown; budget enforcement is not enabled.",
            )}
          </p>
          {run.reasonCode === "authentication_failed" && (
            <p>
              {tr(
                "请在该供应商配置或授权中心检查凭据。",
                "Check credentials in provider configuration or Authorization.",
              )}
            </p>
          )}
        </div>
      )}
      {pending ? (
        <Button
          variant="outline"
          size="sm"
          disabled={!run || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {tr("取消诊断", "Cancel diagnostic")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          {tr("验证模型响应", "Verify model response")}
        </Button>
      )}
      {open && !pending && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm">
            {tr(
              "仅验证指定候选，不自动切换供应商。支持静态 API Key；托管 OAuth 请手动验证。",
              "Verify one candidate without failover. Static API keys are supported; verify managed OAuth manually.",
            )}
          </p>
          {catalog.isError ? (
            <Button variant="outline" onClick={() => void catalog.refetch()}>
              {tr("重新读取供应商", "Reload providers")}
            </Button>
          ) : (
            <>
              <label className="block text-sm">
                {tr("验证供应商", "Diagnostic provider")}
                <select
                  className="ml-2 max-w-full rounded border bg-background p-2"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModel("");
                    setConfirmed(false);
                    start.reset();
                  }}
                >
                  <option value="">{tr("请选择", "Select")}</option>
                  {catalog.data?.providers
                    .filter((p) => !p.id.startsWith("@group:"))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm">
                {tr("验证模型 ID", "Diagnostic model ID")}
                <input
                  className="ml-2 max-w-full rounded border bg-background p-2"
                  value={model}
                  maxLength={512}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setConfirmed(false);
                    start.reset();
                  }}
                  list={`diagnostic-models-${app}`}
                />
                <datalist id={`diagnostic-models-${app}`}>
                  {catalog.data?.providers
                    .find((p) => p.id === provider)
                    ?.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                </datalist>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {tr(
                  "确认向此供应商发送固定测试消息，可能消耗额度；最多等待30秒，取消不退还已发生费用。",
                  "Send a fixed test message to this provider, which may incur charges. Maximum wait: 30 seconds. Cancellation does not refund incurred costs.",
                )}
              </label>
              <Button
                size="sm"
                disabled={
                  !confirmed ||
                  !provider ||
                  !model.trim() ||
                  start.isPending ||
                  catalog.isError
                }
                onClick={() => start.mutate()}
              >
                {tr("开始诊断", "Start diagnostic")}
              </Button>
            </>
          )}
        </div>
      )}
      {(start.isError || cancel.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {readinessReasonLabel(String(start.error ?? cancel.error), zh)}{" "}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              start.reset();
              cancel.reset();
              void refresh();
            }}
          >
            {tr("刷新状态", "Refresh state")}
          </Button>
        </p>
      )}
    </div>
  );
}
