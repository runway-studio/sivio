import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { V7Dialog } from "@/components/mcp/formBits";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { modelHubApi } from "@/lib/api/model-hub";
import { extractErrorMessage } from "@/utils/errorUtils";
export function RouteDecisionsDialog({
  open,
  onOpenChange,
  app,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: ProxyAppId;
}) {
  return (
    <V7Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={860}
      className="gap-2 overflow-y-auto"
    >
      {open && (
        <RouteDecisionsContent
          key={app ?? "all"}
          initialApp={app}
          close={() => onOpenChange(false)}
        />
      )}
    </V7Dialog>
  );
}
export function RouteDecisionsContent({
  initialApp,
  close,
  page = false,
  onClientChange,
}: {
  initialApp?: ProxyAppId;
  close?: () => void;
  page?: boolean;
  onClientChange?: (app: ProxyAppId | undefined) => void;
}) {
  const { t } = useTranslation();
  const [app, setApp] = useState<ProxyAppId | undefined>(initialApp);
  const query = useQuery({
    queryKey: ["route-decisions", app],
    queryFn: () => modelHubApi.decisions(app),
    refetchInterval: 3000,
  });
  return (
    <>
      {page ? (
        <p className="text-sm leading-6 text-fg-3">
          {t("modelHub.recordsHint")}
        </p>
      ) : (
        <>
          <DialogTitle>{t("modelHub.records")}</DialogTitle>
          <DialogDescription>{t("modelHub.recordsHint")}</DialogDescription>
        </>
      )}
      <div className="my-3 flex items-center justify-between gap-3">
        <select
          aria-label={t("modelHub.client")}
          className={`${fieldClass} h-9 max-w-56`}
          value={app ?? ""}
          onChange={(e) => {
            const next = (e.target.value || undefined) as
              | ProxyAppId
              | undefined;
            setApp(next);
            onClientChange?.(next);
          }}
        >
          <option value="">{t("modelHub.allClients")}</option>
          {PROXY_APP_IDS.map((id) => (
            <option key={id} value={id}>
              {APP_DISPLAY_NAME[id]}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={14} />
          {t("modelHub.refresh")}
        </Button>
      </div>
      {query.error && (
        <p role="alert" className="text-destructive">
          {extractErrorMessage(query.error)}
        </p>
      )}
      <div
        className={
          page ? "space-y-3" : "max-h-[62vh] space-y-2 overflow-y-auto"
        }
      >
        {query.isLoading && (
          <p className="p-5 text-sm">{t("modelHub.loading")}</p>
        )}
        {!query.isLoading && !query.error && !query.data?.length && (
          <p className="p-5 text-sm text-muted-foreground">
            {t("modelHub.noRecords")}
          </p>
        )}
        {query.data?.map((record) => (
          <details key={record.id} className="rounded-xl border p-3">
            <summary className="cursor-pointer break-words text-sm">
              <span className="mr-2 text-xs text-muted-foreground">
                {new Date(record.createdAt).toLocaleString()}
              </span>
              <strong>
                {APP_DISPLAY_NAME[record.app as ProxyAppId] ?? record.app}
              </strong>{" "}
              · {record.requestModel} ·{" "}
              {t(`modelHub.result.${record.result}`, {
                defaultValue: record.result,
              })}{" "}
              · {record.elapsedMs}ms
            </summary>
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
              {record.group && (
                <>
                  <dt>{t("nav.routingGroups")}</dt>
                  <dd className="break-words">
                    {record.group.name} ·{" "}
                    {t(
                      `routingGroups.strategies.${record.group.strategy ?? "order"}`,
                    )}
                    <br />
                    {record.group.members
                      .map((m) => `${m.providerId} / ${m.model}`)
                      .join(" → ")}
                  </dd>
                </>
              )}
              {record.selection && (
                <>
                  <dt>{t("routingGroups.decisionReason")}</dt>
                  <dd className="break-words space-y-2">
                    <p>
                      {t(`routingGroups.reasons.${record.selection.strategy}`)}
                    </p>
                    {record.selection.fallbackReason && (
                      <p className="font-medium">
                        {t("routingGroups.quotaFallback")}
                      </p>
                    )}
                    <ol className="space-y-1">
                      {record.selection.ranking.map((r, i) => (
                        <li key={r.providerId}>
                          {i + 1}.{" "}
                          {record.candidates.find((c) => c.id === r.providerId)
                            ?.name ?? r.providerId}
                          {" / "}
                          {r.model} ·{" "}
                          {t("routingGroups.dispatchCount", {
                            count: r.dispatches,
                          })}
                          {r.quota && (
                            <div className="mt-1 space-y-1 text-muted-foreground">
                              <p>
                                {t(
                                  `routingGroups.quotaStatus.${r.quota.status}`,
                                  { defaultValue: r.quota.status },
                                )}
                                {r.quota.source !== "none" && (
                                  <>
                                    {" "}
                                    ·{" "}
                                    {t("routingGroups.quotaSource", {
                                      source: t(
                                        `routingGroups.quotaSources.${r.quota.source}`,
                                        { defaultValue: r.quota.source },
                                      ),
                                    })}
                                  </>
                                )}
                              </p>
                              {r.quota.remainingPercent != null && (
                                <p>
                                  {r.quota.window && (
                                    <>
                                      {t(
                                        `routingGroups.quotaWindows.${r.quota.window}`,
                                        { defaultValue: r.quota.window },
                                      )}{" "}
                                      ·{" "}
                                    </>
                                  )}
                                  {t("routingGroups.quotaRemaining", {
                                    value: r.quota.remainingPercent.toFixed(1),
                                  })}
                                  {r.quota.pacePerHour != null && (
                                    <>
                                      {" "}
                                      ·{" "}
                                      {t("routingGroups.quotaPace", {
                                        value: r.quota.pacePerHour.toFixed(2),
                                      })}
                                    </>
                                  )}
                                </p>
                              )}
                              {r.quota.resetsAt != null && (
                                <p>
                                  {t("routingGroups.quotaReset", {
                                    time: new Date(
                                      r.quota.resetsAt,
                                    ).toLocaleString(),
                                  })}
                                </p>
                              )}
                              {r.quota.queriedAt != null && (
                                <p>
                                  {t("routingGroups.quotaQueried", {
                                    time: new Date(
                                      r.quota.queriedAt,
                                    ).toLocaleString(),
                                  })}
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground">
                      {t(
                        record.selection.strategy === "smart" ||
                          record.selection.strategy === "pace"
                          ? "routingGroups.quotaNote"
                          : "routingGroups.counterNote",
                      )}
                    </p>
                  </dd>
                </>
              )}
              <dt>{t("modelHub.decisionMode")}</dt>
              <dd>
                {t(`modelHub.routeMode.${record.mode}`, {
                  defaultValue: record.mode,
                })}
              </dd>
              <dt>{t("modelHub.candidates")}</dt>
              <dd className="break-words">
                {record.candidates.map((c) => c.name).join(" → ") || "—"}
              </dd>
              <dt>{t("modelHub.responseModel")}</dt>
              <dd className="break-all">
                {record.responseModel ?? t("modelHub.notReported")}
              </dd>
              <dt>{t("modelHub.bodyState")}</dt>
              <dd>
                {t(`modelHub.body.${record.bodyState}`, {
                  defaultValue: record.bodyState,
                })}
              </dd>
              <dt>{t("modelHub.recordId")}</dt>
              <dd className="break-all font-mono">{record.id}</dd>
            </dl>
            <ol className="mt-3 space-y-2">
              {record.attempts.map((a, index) => (
                <li key={index} className="rounded-lg bg-muted/50 p-3 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong className="min-w-0 break-all">
                      {index + 1}. {a.provider.name}
                    </strong>
                    <span>
                      {t(`modelHub.result.${a.result}`, {
                        defaultValue: a.result,
                      })}
                      {a.status ? ` · HTTP ${a.status}` : ""} · {a.elapsedMs}ms
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono">
                    {record.requestModel} →{" "}
                    {a.outboundModel ?? t("modelHub.notSent")}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
      {!page && (
        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={close}>
            {t("common.close")}
          </Button>
        </div>
      )}
    </>
  );
}
