import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  Cable,
  KeyRound,
  Layers3,
  Monitor,
  Plus,
  Radio,
  ShieldCheck,
} from "lucide-react";
import { AppGlyph, APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { ProviderIcon } from "@/components/ProviderIcon";
import { APP_IDS, getAppLabel, isProxyAppId } from "@/config/appConfig";
import { isOAuthProviderType } from "@/config/constants";
import { resolveCodexOfficialIdentity } from "@/utils/providerCapabilities";
import type { AppId } from "@/lib/api";
import type { Provider } from "@/types";
import type { AppModeView, ProxyStatus } from "@/types/proxy";
import type { ProvidersQueryData } from "@/lib/query/queries";
import logo from "@/assets/icons/logo.svg";
import "./GatewayOverview.css";

type SourceKind = "api" | "subscription" | "local";
export function providerSource(app: AppId, provider: Provider): SourceKind {
  if (provider.category === "local") return "local";
  const identity = resolveCodexOfficialIdentity(app, provider);
  if (
    provider.meta?.authBinding?.source === "managed_account" ||
    isOAuthProviderType(provider.meta?.providerType) ||
    identity === "native_login" ||
    identity === "managed_account"
  )
    return "subscription";
  return "api";
}

export interface GatewayClient {
  app: AppId;
  data?: ProvidersQueryData;
  mode?: AppModeView;
  error?: boolean;
}

export function GatewayOverview({
  clients,
  status,
  onApp,
  onRouting,
  onApps,
  onTools,
}: {
  clients: GatewayClient[];
  status?: ProxyStatus;
  onApp: (app: AppId) => void;
  onRouting: () => void;
  onApps: () => void;
  onTools: () => void;
}) {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Measure real card centers: translations, provider names and sidebar changes
    // can all change the layout without changing the window size.
    const updateConnections = () => {
      const bounds = map.getBoundingClientRect();
      const core = map.querySelector<HTMLElement>(".gateway-core")!;
      const hub = core.getBoundingClientRect();
      for (const path of map.querySelectorAll<SVGPathElement>(
        "path[data-node]",
      )) {
        const node = map.querySelector<HTMLElement>(
          `[data-gateway-node="${path.dataset.node}"]`,
        );
        if (!node) continue;
        const card = node.getBoundingClientRect();
        const incoming = path.closest(".gateway-wires-in");
        const x1 = (incoming ? card.right : hub.right) - bounds.left;
        const y1 =
          (incoming ? card.top + card.height / 2 : hub.top + hub.height / 2) -
          bounds.top;
        const x2 = (incoming ? hub.left : card.left) - bounds.left;
        const y2 =
          (incoming ? hub.top + hub.height / 2 : card.top + card.height / 2) -
          bounds.top;
        const mid = (x1 + x2) / 2;
        path.setAttribute(
          "d",
          `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
        );
      }
    };
    updateConnections();
    const observer = new ResizeObserver(updateConnections);
    for (const node of [
      map,
      ...map.querySelectorAll<HTMLElement>(
        ".gateway-side, .gateway-core, [data-gateway-node]",
      ),
    ]) {
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);
  const featured: AppId[] = ["claude", "codex", "gemini", "opencode"];
  const rows = featured.map(
    (app) => clients.find((c) => c.app === app) ?? { app },
  );
  const active = (client: GatewayClient) =>
    Boolean(
      !client.error &&
        status?.running &&
        client.mode?.attached &&
        client.mode.mode !== "direct",
    );
  const entries = clients.flatMap((client) =>
    Object.values(client.data?.providers ?? {}).map((provider) => ({
      client,
      provider,
    })),
  );
  const groups = (["api", "subscription", "local"] as const).map((kind) => ({
    kind,
    entries: entries.filter(
      ({ client, provider }) => providerSource(client.app, provider) === kind,
    ),
  }));
  const groupActive = (kind: SourceKind) =>
    groups
      .find((g) => g.kind === kind)
      ?.entries.some(
        ({ client, provider }) =>
          active(client) && client.mode?.routeProviderId === provider.id,
      );
  const count = clients.filter(active).length;
  const address = status
    ? `${status.address.includes(":") ? `[${status.address}]` : status.address}:${status.port}`
    : "—";
  const modeLabel = (client: GatewayClient) => {
    if (client.error) return t("gatewayOverview.unavailable");
    if (!client.data || (isProxyAppId(client.app) && !client.mode))
      return t("gatewayOverview.loading");
    if (!isProxyAppId(client.app)) return t("gatewayOverview.configOnly");
    if (client.mode?.mode === "direct") return t("gatewayOverview.direct");
    if (!active(client)) return t("gatewayOverview.disconnected");
    return t(
      client.mode?.mode === "stack"
        ? "gatewayOverview.stack"
        : "gatewayOverview.route",
    );
  };
  return (
    <section
      className="gateway-overview mb-7"
      aria-label={t("gatewayOverview.title")}
    >
      <div className="gateway-heading">
        <div>
          <span className="gateway-eyebrow">
            {t("gatewayOverview.eyebrow")}
          </span>
          <h2>{t("gatewayOverview.title")}</h2>
        </div>
        <span className="gateway-legend">
          <i />
          {t("gatewayOverview.legend")}
        </span>
      </div>
      <div className="gateway-map-scroll" tabIndex={0}>
        <div className="gateway-map" ref={mapRef}>
          <div className="gateway-side gateway-clients">
            <h3>{t("gatewayOverview.clients")}</h3>
            {rows.map((client) => {
              const id =
                client.mode && client.mode.mode !== "direct"
                  ? client.mode.routeProviderId
                  : client.data?.currentProviderId;
              const target = id ? client.data?.providers[id] : undefined;
              return (
                <button
                  key={client.app}
                  className="gateway-client"
                  data-gateway-node={client.app}
                  data-connected={active(client)}
                  onClick={() => onApp(client.app)}
                >
                  <AppGlyph app={client.app} size={24} />
                  <span className="gateway-client-copy">
                    <strong>{APP_DISPLAY_NAME[client.app]}</strong>
                    <span title={client.mode?.selectedModel || target?.name}>
                      {client.mode?.selectedModel ||
                        target?.name ||
                        t("gatewayOverview.configure")}
                    </span>
                  </span>
                  <span className="gateway-mode">{modeLabel(client)}</span>
                </button>
              );
            })}
            <button className="gateway-more" onClick={onApps}>
              <Plus size={14} />
              {t("gatewayOverview.more", {
                count: APP_IDS.length - featured.length,
              })}
              <ArrowUpRight size={13} />
            </button>
          </div>
          <svg className="gateway-wires gateway-wires-in" aria-hidden="true">
            {rows.map(
              (client) =>
                isProxyAppId(client.app) && (
                  <path
                    key={client.app}
                    data-active={active(client)}
                    data-node={client.app}
                  />
                ),
            )}
          </svg>
          <div className="gateway-core">
            <div className="gateway-brand">
              <img src={logo} alt="" />
              <strong>Sivio</strong>
              <span className="gateway-running" data-running={status?.running}>
                {status
                  ? t(
                      status.running
                        ? "gatewayOverview.running"
                        : "gatewayOverview.stopped",
                    )
                  : t("gatewayOverview.unknown")}
              </span>
            </div>
            <button
              className="gateway-address"
              onClick={onRouting}
              title={t("gatewayOverview.manage")}
            >
              <Radio size={12} />
              <code>{address}</code>
              <ArrowUpRight size={12} />
            </button>
            <div className="gateway-stages">
              <button onClick={onRouting} className="gateway-stage">
                <Cable size={16} />
                <span>
                  <strong>{t("gatewayOverview.gateway")}</strong>
                  <span className="gateway-protocols">
                    <i>Chat</i>
                    <i>Responses</i>
                    <i>Messages</i>
                    <i>Gemini</i>
                  </span>
                </span>
                <ArrowUpRight size={13} />
              </button>
              <button onClick={onRouting} className="gateway-stage">
                <Layers3 size={16} />
                <span>
                  <strong>{t("gatewayOverview.routing")}</strong>
                  <small>{t("gatewayOverview.routingHint")}</small>
                </span>
                <ArrowUpRight size={13} />
              </button>
              <button onClick={onTools} className="gateway-stage">
                <ShieldCheck size={16} />
                <span>
                  <strong>{t("gatewayOverview.tools")}</strong>
                  <small>{t("gatewayOverview.toolsHint")}</small>
                </span>
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="gateway-foot">
              <span className="gateway-dot" data-running={status?.running} />
              {t("gatewayOverview.connected", { count })}
            </div>
          </div>
          <svg className="gateway-wires gateway-wires-out" aria-hidden="true">
            {groups.map((group) => (
              <path
                key={group.kind}
                data-active={Boolean(groupActive(group.kind))}
                data-node={group.kind}
              />
            ))}
          </svg>
          <div className="gateway-side gateway-sources">
            <h3>{t("gatewayOverview.providers")}</h3>
            {groups.map(({ kind, entries: items }) => {
              const Icon =
                kind === "api"
                  ? KeyRound
                  : kind === "subscription"
                    ? ShieldCheck
                    : Monitor;
              return (
                <div
                  key={kind}
                  className="gateway-source"
                  data-gateway-node={kind}
                  data-connected={Boolean(groupActive(kind))}
                >
                  <div className="gateway-source-title">
                    <Icon size={15} />
                    <h4>{t(`gatewayOverview.${kind}`)}</h4>
                    <span>{items.length}</span>
                  </div>
                  <div className="gateway-provider-chips">
                    {items.slice(0, 4).map(({ client, provider }) => (
                      <button
                        key={`${client.app}:${provider.id}`}
                        title={`${provider.name} · ${getAppLabel(client.app)}`}
                        onClick={() => onApp(client.app)}
                      >
                        <ProviderIcon
                          icon={provider.icon}
                          name={provider.name}
                          size={14}
                          color={provider.iconColor}
                        />
                        <span>{provider.name}</span>
                      </button>
                    ))}
                    {items.length > 4 && (
                      <button
                        onClick={onApps}
                        aria-label={t("gatewayOverview.allProviders")}
                      >
                        +{items.length - 4}
                      </button>
                    )}
                    {items.length === 0 && (
                      <button
                        className="gateway-empty"
                        onClick={() => onApp("claude")}
                      >
                        <Plus size={12} />
                        {t("gatewayOverview.add")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="gateway-caption">{t("gatewayOverview.caption")}</p>
    </section>
  );
}
