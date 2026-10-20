import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Activity, RefreshCw } from "lucide-react";
import { AppGlyph, APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import { proxyApi } from "@/lib/api/proxy";
import {
  routingLiveApi,
  type RoutingLiveRecord,
  type RoutingLiveStats,
  type RoutingGroup,
  type ModelProvider,
} from "@/lib/api/model-hub";
import logo from "@/assets/icons/logo.svg";
import "./RoutingLivePanel.css";

export const isRoutingActive = (r: RoutingLiveRecord) =>
  ["selecting", "connecting", "streaming"].includes(r.phase);
const colors: Record<string, string> = {
  claude: "#d97757",
  codex: "#7864df",
  gemini: "#3186d5",
  grokbuild: "#c18b24",
};
const key = (app: string, id: string, model: string) =>
  JSON.stringify([app, id, model]);
const modelFor = (r: RoutingLiveRecord, id: string) =>
  r.decision.group?.members.find((m) => m.providerId === id)?.model ?? "";
export function routingTotals(stats: RoutingLiveStats[]) {
  return stats.reduce(
    (sum, s) => ({
      requests: sum.requests + s.requests,
      active: sum.active + s.active,
      rerouted: sum.rerouted + s.rerouted,
      completed: sum.completed + s.completed,
      failed: sum.failed + s.failed,
      interrupted: sum.interrupted + s.interrupted,
    }),
    {
      requests: 0,
      active: 0,
      rerouted: 0,
      completed: 0,
      failed: 0,
      interrupted: 0,
    },
  );
}
export function RoutingLivePanel({
  app,
  group,
  providers,
  onAll,
}: {
  app: ProxyAppId;
  group?: RoutingGroup;
  providers: ModelProvider[];
  onAll: () => void;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(() => !document.hidden);
  const [clock, setClock] = useState(Date.now());
  const [requestId, setRequestId] = useState("");
  const [details, setDetails] = useState(false);
  const map = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      document.removeEventListener("visibilitychange", change);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setRequestId("");
    setDetails(false);
  }, [app, group?.id]);
  const query = useQuery({
    queryKey: ["routing-live"],
    queryFn: routingLiveApi.snapshot,
    enabled: visible,
    refetchInterval: visible ? 750 : false,
    retry: false,
  });
  const gateway = useQuery({
    queryKey: ["proxy-status"],
    queryFn: proxyApi.getProxyStatus,
    enabled: visible,
    refetchInterval: visible ? 3000 : false,
    retry: false,
  });
  const fresh =
    visible &&
    !query.error &&
    !!query.data &&
    clock - query.dataUpdatedAt < 5000;
  const now = query.data
    ? query.data.now + Math.max(0, clock - query.dataUpdatedAt)
    : clock;
  const records = (query.data?.records ?? []).filter(
    (r) =>
      !group || (r.decision.app === app && r.decision.group?.id === group.id),
  );
  const stats = routingTotals(
    (query.data?.stats ?? []).filter(
      (s) => !group || (s.app === app && s.groupId === group.id),
    ),
  );
  useEffect(() => {
    if (
      requestId &&
      query.data &&
      !records.some((r) => r.decision.id === requestId)
    )
      setRequestId("");
  }, [query.data, requestId, app, group?.id]);
  const latest = records.find((r) => r.decision.id === requestId) ?? records[0];
  const requestOptions = records.slice(0, 30);
  if (requestId && latest && !requestOptions.includes(latest))
    requestOptions.push(latest);
  // Active requests always get graph space before completed history.
  const graphRecords = [
    ...records.filter(isRoutingActive),
    ...records.filter((r) => !isRoutingActive(r)).slice(0, 12),
  ];
  const members = new Map<
    string,
    { app: string; id: string; model: string; name: string }
  >();
  if (group)
    for (const m of group.members)
      members.set(key(app, m.providerId, m.model), {
        app,
        id: m.providerId,
        model: m.model,
        name:
          providers.find((p) => p.id === m.providerId)?.name ?? m.providerId,
      });
  for (const r of graphRecords)
    for (const m of r.decision.group?.members ?? []) {
      const k = key(r.decision.app, m.providerId, m.model);
      if (!members.has(k) && members.size < 40)
        members.set(k, {
          app: r.decision.app,
          id: m.providerId,
          model: m.model,
          name:
            r.decision.candidates.find((p) => p.id === m.providerId)?.name ??
            m.providerId,
        });
    }
  const rows = [...members.entries()];
  const clients = PROXY_APP_IDS.filter(
    (id) =>
      graphRecords.some((r) => r.decision.app === id) || (group && id === app),
  );
  // Layout uses measured card positions, including translated/wrapped content.
  useLayoutEffect(() => {
    const el = map.current;
    if (!el) return;
    const draw = () => {
      const rect = el.getBoundingClientRect();
      const hub = el
        .querySelector<HTMLElement>(".routing-live-hub")
        ?.getBoundingClientRect();
      if (!hub) return;
      for (const path of el.querySelectorAll<SVGPathElement>(
        "path[data-node]",
      )) {
        const node = el
          .querySelector<HTMLElement>(
            `[data-route-node="${path.dataset.node}"]`,
          )
          ?.getBoundingClientRect();
        if (!node) continue;
        const incoming = path.dataset.side === "in";
        const x1 = (incoming ? node.right : hub.right) - rect.left;
        const x2 = (incoming ? hub.left : node.left) - rect.left;
        const y1 =
          (incoming ? node.top + node.height / 2 : hub.top + hub.height / 2) -
          rect.top;
        const y2 =
          (incoming ? hub.top + hub.height / 2 : node.top + node.height / 2) -
          rect.top;
        path.setAttribute(
          "d",
          `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`,
        );
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    el.querySelectorAll<HTMLElement>(
      "[data-route-node], .routing-live-hub",
    ).forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  });
  const phase = (r: RoutingLiveRecord) =>
    t(
      `routingLive.phases.${!fresh && isRoutingActive(r) ? "unknown" : r.phase}`,
    );
  const statusFor = (m: (typeof rows)[number][1]) => {
    const relevant = records.filter(
      (r) => r.decision.app === m.app && modelFor(r, m.id) === m.model,
    );
    const active = relevant.filter(
      (r) => isRoutingActive(r) && r.currentProvider?.id === m.id,
    );
    if (active.length)
      return {
        active: fresh,
        text: `${phase(active[0])} · ${active.length}`,
        tone: "active",
      };
    for (const r of relevant) {
      const attempt = [...r.decision.attempts]
        .reverse()
        .find((a) => a.provider.id === m.id);
      if (!attempt) continue;
      if (attempt.status === 429)
        return {
          active: false,
          tone: "limited",
          text:
            attempt.retryAt && attempt.retryAt > now && fresh
              ? t("routingLive.retryIn", {
                  seconds: Math.ceil((attempt.retryAt - now) / 1000),
                })
              : t("routingLive.rateLimited"),
        };
      if (attempt.result === "accepted" && r.currentProvider?.id === m.id)
        return {
          active: false,
          tone: r.phase === "completed" ? "done" : "muted",
          text: `${phase(r)} · ${APP_DISPLAY_NAME[r.decision.app as ProxyAppId] ?? r.decision.app}`,
        };
      return {
        active: false,
        tone: "muted",
        text: t(`modelHub.result.${attempt.result}`, {
          defaultValue: attempt.result,
        }),
      };
    }
    return { active: false, tone: "muted", text: t("routingLive.waiting") };
  };
  return (
    <section
      className="routing-live"
      data-testid="routing-live"
      aria-label={t("routingLive.title")}
    >
      <header className="routing-live-heading">
        <div>
          <div className="routing-live-eyebrow">
            <Activity size={14} />
            <span>{t("routingLive.title")}</span>
            <i data-live={fresh} />
            <span>
              {t(
                fresh
                  ? "routingLive.live"
                  : query.isLoading
                    ? "common.loading"
                    : "routingLive.stale",
              )}
            </span>
          </div>
          <h2>{group?.name ?? t("routingLive.allGroups")}</h2>
          <p>
            {group
              ? t(`routingGroups.hints.${group.strategy ?? "order"}`)
              : t("routingLive.description")}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {group && (
            <Button variant="outline" size="sm" onClick={onAll}>
              {t("routingLive.allGroups")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("routingLive.refresh")}
            onClick={() => {
              void query.refetch();
              void gateway.refetch();
            }}
            disabled={query.isFetching}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
      </header>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {t("routingLive.loadError")}
        </p>
      )}
      {!records.length && (
        <p className="routing-live-empty">{t("routingLive.empty")}</p>
      )}
      {!!(clients.length || rows.length) && (
        <div
          className="routing-live-scroll"
          tabIndex={0}
          aria-label={t("routingLive.graph")}
        >
          <div className="routing-live-map" ref={map}>
            <svg className="routing-live-wires" aria-hidden="true">
              {clients.map((id) => (
                <path
                  key={id}
                  data-node={`client-${id}`}
                  data-side="in"
                  className={
                    fresh &&
                    graphRecords.some(
                      (r) => r.decision.app === id && isRoutingActive(r),
                    )
                      ? "flow"
                      : ""
                  }
                  style={{ stroke: colors[id] }}
                />
              ))}
              {rows.map(([k, m], i) => (
                <path
                  key={k}
                  data-node={`member-${i}`}
                  data-side="out"
                  className={statusFor(m).active ? "flow" : ""}
                  style={{
                    stroke: statusFor(m).active ? colors[m.app] : undefined,
                  }}
                />
              ))}
            </svg>
            <div className="routing-live-clients">
              {clients.map((id) => {
                const rs = graphRecords.filter((r) => r.decision.app === id);
                const count = rs.filter(isRoutingActive).length;
                return (
                  <div
                    key={id}
                    className="routing-live-client"
                    data-route-node={`client-${id}`}
                  >
                    <AppGlyph app={id} size={26} />
                    <strong>
                      <i style={{ background: colors[id] }} />
                      {APP_DISPLAY_NAME[id]}
                    </strong>
                    <span>
                      {[
                        ...new Set(
                          rs.map((r) => r.decision.group?.name).filter(Boolean),
                        ),
                      ].join(" · ") || group?.name}
                    </span>
                    <small>
                      {fresh
                        ? t("routingLive.activeCount", { count })
                        : t("routingLive.phases.unknown")}
                    </small>
                  </div>
                );
              })}
            </div>
            <div className="routing-live-hub">
              <img src={logo} alt="" />
              <strong>Sivio</strong>
              <span>
                {gateway.error || !gateway.data
                  ? t("routingLive.phases.unknown")
                  : gateway.data?.running
                    ? `${gateway.data.address}:${gateway.data.port}`
                    : t("routingLive.stopped")}
              </span>
              <b>
                {group
                  ? t(`routingGroups.strategies.${group.strategy ?? "order"}`)
                  : t("routingLive.gateway")}
              </b>
            </div>
            <div className="routing-live-members">
              {rows.map(([k, m], i) => {
                const status = statusFor(m);
                return (
                  <div
                    key={k}
                    className="routing-live-member"
                    data-route-node={`member-${i}`}
                    data-tone={status.tone}
                    data-active={status.active}
                  >
                    <i className="routing-live-state" />
                    <ProviderIcon
                      name={m.name}
                      size={20}
                      icon={
                        (
                          {
                            kimi: "kimi",
                            minimax: "minimax",
                            deepseek: "deepseek",
                            openrouter: "openrouter",
                            anthropic: "claude",
                            chatgpt: "openai",
                            openai: "openai",
                            qwen: "qwen",
                            "zhipu glm": "zhipu",
                          } as Record<string, string>
                        )[m.name.trim().toLowerCase()]
                      }
                    />
                    <div className="routing-live-member-name">
                      <strong>{m.name}</strong>
                      <code>{m.model}</code>
                      <small>
                        {APP_DISPLAY_NAME[m.app as ProxyAppId] ?? m.app}
                      </small>
                    </div>
                    <span className="routing-live-member-status">
                      {status.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="routing-live-note">
        {t("routingLive.graphHint")}
        {rows.length >= 40 ? ` ${t("routingLive.graphLimit")}` : ""}
      </p>
      <div
        className="routing-live-stats"
        aria-label={t("routingLive.statistics")}
      >
        {(
          [
            "requests",
            "active",
            "rerouted",
            "completed",
            "failed",
            "interrupted",
          ] as const
        ).map((k) => (
          <div key={k}>
            <strong>{!fresh && k === "active" ? "—" : stats[k]}</strong>
            <span>{t(`routingLive.stats.${k}`)}</span>
          </div>
        ))}
      </div>
      <p className="routing-live-note">
        {t("routingLive.session", {
          time: query.data
            ? new Date(query.data.startedAt).toLocaleString()
            : "—",
        })}
        {!!query.data?.omitted &&
          ` · ${t("routingLive.omitted", { count: query.data.omitted })}`}
      </p>
      <div className="routing-live-last">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>{t("routingLive.latest")}</h3>
          {!!records.length && (
            <select
              aria-label={t("routingLive.request")}
              className={`${fieldClass} h-8 max-w-full text-xs`}
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value);
                setDetails(false);
              }}
            >
              <option value="">{t("routingLive.followLatest")}</option>
              {requestOptions.map((r) => (
                <option key={r.decision.id} value={r.decision.id}>
                  {new Date(r.decision.createdAt).toLocaleTimeString()} ·{" "}
                  {APP_DISPLAY_NAME[r.decision.app as ProxyAppId] ??
                    r.decision.app}{" "}
                  · {r.decision.group?.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {latest ? (
          <>
            <ol className="routing-live-timeline">
              <li>
                <i />
                <span>
                  {t("routingLive.requested", {
                    client:
                      APP_DISPLAY_NAME[latest.decision.app as ProxyAppId] ??
                      latest.decision.app,
                    group: latest.decision.group?.name,
                  })}
                  <code>{latest.decision.requestModel}</code>
                </span>
              </li>
              <li>
                <i />
                <span>
                  {t(
                    `routingGroups.reasons.${latest.decision.selection?.strategy ?? latest.decision.group?.strategy ?? "order"}`,
                  )}
                  {latest.decision.selection?.fallbackReason && (
                    <p>{t("routingGroups.quotaFallback")}</p>
                  )}
                  {latest.decision.selection?.ranking[0] && (
                    <p>
                      {t("routingLive.first", {
                        name:
                          latest.decision.candidates.find(
                            (p) =>
                              p.id ===
                              latest.decision.selection?.ranking[0].providerId,
                          )?.name ??
                          latest.decision.selection.ranking[0].providerId,
                      })}
                    </p>
                  )}
                </span>
              </li>
              {latest.decision.attempts.map((a, i) => (
                <li
                  key={i}
                  data-tone={a.result === "accepted" ? "done" : "limited"}
                >
                  <i />
                  <span>
                    <strong>{a.provider.name}</strong> ·{" "}
                    {a.outboundModel || "—"} ·{" "}
                    {t(`modelHub.result.${a.result}`, {
                      defaultValue: a.result,
                    })}
                    {a.status ? ` · HTTP ${a.status}` : ""} · {a.elapsedMs} ms
                    {a.retryAt && (
                      <p>
                        {t("routingLive.retryAt", {
                          time: new Date(a.retryAt).toLocaleTimeString(),
                        })}
                      </p>
                    )}
                  </span>
                </li>
              ))}
              <li data-tone={latest.phase === "completed" ? "done" : "active"}>
                <i />
                <span>
                  {phase(latest)}
                  {latest.currentProvider &&
                    ` · ${latest.currentProvider.name}`}{" "}
                  ·{" "}
                  {isRoutingActive(latest) && fresh
                    ? Math.max(0, now - latest.decision.createdAt)
                    : latest.decision.elapsedMs}{" "}
                  ms{latest.rerouted && ` · ${t("routingLive.rerouted")}`}
                  {latest.decision.responseModel && (
                    <p>
                      {t("modelHub.responseModel")}:{" "}
                      {latest.decision.responseModel}
                    </p>
                  )}
                </span>
              </li>
            </ol>
            {latest.decision.selection && (
              <>
                <button
                  className="text-xs text-primary underline underline-offset-4"
                  aria-expanded={details}
                  onClick={() => setDetails((v) => !v)}
                >
                  {t("routingLive.evidence")}
                </button>
                {details && (
                  <ol className="routing-live-evidence">
                    {latest.decision.selection.ranking.map((r, i) => (
                      <li key={r.providerId}>
                        <strong>
                          {i + 1}.{" "}
                          {latest.decision.candidates.find(
                            (p) => p.id === r.providerId,
                          )?.name ?? r.providerId}
                        </strong>{" "}
                        · {r.model} ·{" "}
                        {t("routingGroups.dispatchCount", {
                          count: r.dispatches,
                        })}
                        {r.quota && (
                          <p>
                            {t(`routingGroups.quotaStatus.${r.quota.status}`, {
                              defaultValue: r.quota.status,
                            })}{" "}
                            ·{" "}
                            {t(`routingGroups.quotaSources.${r.quota.source}`, {
                              defaultValue: r.quota.source,
                            })}
                            {r.quota.remainingPercent != null &&
                              ` · ${t("routingGroups.quotaRemaining", { value: r.quota.remainingPercent.toFixed(1) })}`}
                            {r.quota.pacePerHour != null &&
                              ` · ${t("routingGroups.quotaPace", { value: r.quota.pacePerHour.toFixed(2) })}`}
                            {r.quota.resetsAt &&
                              ` · ${t("routingGroups.quotaReset", { time: new Date(r.quota.resetsAt).toLocaleString() })}`}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </>
        ) : (
          <p className="routing-live-note">{t("routingLive.noRequest")}</p>
        )}
      </div>
    </section>
  );
}
