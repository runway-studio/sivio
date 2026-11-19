import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Globe,
  History,
  LayoutGrid,
  Plug,
} from "lucide-react";
import type { VisibleApps } from "@/types";
import type { AppId } from "@/lib/api";
import type { GlobalPage } from "@/lib/navigation";
import {
  getAppLabel,
  isProxyAppId,
  visibleClientIds,
} from "@/config/appConfig";
import { useWorkspacePreferences } from "@/lib/desktopPreferences";
import { providersQueryOptions } from "@/lib/query";
import { useUsageSummary } from "@/lib/query/usage";
import { modelHubApi } from "@/lib/api/model-hub";
import { AppGlyph } from "@/components/shell/AppGlyph";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { Button } from "@/components/ui/button";
import { NetworkHealth } from "@/components/network/NetworkHealth";
import { NetworkQuickNode } from "@/components/network/NetworkQuickNode";
import { networkApi } from "@/components/network/networkApi";
import type { NetworkSnapshot } from "@/components/network/networkTypes";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceStats } from "./WorkspaceStats";
import { WorkspaceReadinessDetails } from "./WorkspaceReadiness";
import { ClientReadinessSummary } from "./ClientReadinessSummary";
import "./workspace.css";

function ClientRow({
  app,
  onApp,
  onModel,
}: {
  app: AppId;
  onApp: (app: AppId) => void;
  onModel?: (app: AppId) => void;
}) {
  const { i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const providers = useQuery(providersQueryOptions(app));
  const catalog = useQuery({
    queryKey: ["model-picker", app],
    queryFn: () => {
      if (!isProxyAppId(app)) throw new Error("Unsupported client");
      return modelHubApi.catalog(app);
    },
    enabled: isProxyAppId(app),
    retry: false,
  });
  const unavailable =
    providers.isError ||
    providers.data?.readError ||
    (isProxyAppId(app) && catalog.isError);
  const current = providers.data?.providers[providers.data.currentProviderId];
  const provider =
    catalog.data?.providers.find((item) => item.id === catalog.data.providerId)
      ?.name ?? current?.name;
  return (
    <div className="workspace-client">
      <div className="flex min-w-0 items-center gap-3">
        <AppGlyph app={app} size={30} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{getAppLabel(app)}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {unavailable
              ? tr("配置暂不可用", "Configuration unavailable")
              : provider
                ? `${provider}${catalog.data?.model ? ` · ${catalog.data.model}` : ""}`
                : providers.isLoading
                  ? tr("正在读取配置…", "Loading configuration…")
                  : tr("尚未选择供应商", "No provider selected")}
          </p>
        </div>
      </div>
      <div className="workspace-client-state">
        <ClientReadinessSummary app={app} />
      </div>
      <Button
        className="workspace-client-action"
        variant="outline"
        size="sm"
        onClick={() =>
          isProxyAppId(app) && onModel ? onModel(app) : onApp(app)
        }
      >
        {isProxyAppId(app) && onModel
          ? tr("切换模型", "Switch model")
          : tr("管理连接", "Manage connection")}
      </Button>
    </div>
  );
}

export function Overview({
  onOpen,
  onApp,
  onModel,
  visibleApps,
  onSetup,
  onNetworkSettings,
}: {
  onSetup?: () => void;
  onNetworkSettings?: () => void;
  onModel?: (app: AppId) => void;
  onOpen: (page: GlobalPage) => void;
  onApp: (app: AppId) => void;
  visibleApps?: Partial<VisibleApps>;
}) {
  const { i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const preferences = useWorkspacePreferences();
  const usage = useUsageSummary({ preset: "today" });
  const network = useQuery({
    queryKey: ["network", "snapshot"],
    queryFn: () => networkApi<NetworkSnapshot>("snapshot"),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 5000),
  });
  const visibleClients = visibleClientIds(visibleApps);
  const [showAllClients, setShowAllClients] = useState(false);
  const clientsOnPage = showAllClients
    ? visibleClients
    : visibleClients.slice(0, 4);
  const snapshot = network.isError ? undefined : network.data;
  const running = snapshot?.runtime.phase === "running";
  const settings = snapshot?.catalog.settings;
  const profile = snapshot?.catalog.profiles.find(
    (item) => item.id === snapshot.catalog.active,
  );
  const link = (label: string, page: GlobalPage) => (
    <Button variant="ghost" size="sm" onClick={() => onOpen(page)}>
      {label}
      <ArrowRight size={13} className="ml-1" />
    </Button>
  );
  return (
    <>
      <AppPageHeader
        title={tr("工作台", "Workspace")}
        icon={<LayoutGrid className="h-5 w-5" />}
      />
      <div className="workspace-page min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {tr("你的工作台", "Your workspace")}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr(
                  "当前连接、常用工具，都在这里。",
                  "Your connections and everyday tools, together.",
                )}
              </p>
            </div>
            {onSetup && (
              <Button variant="outline" size="sm" onClick={onSetup}>
                {tr("接入引导", "Client setup")}
              </Button>
            )}
          </header>
          {snapshot ? (
            <NetworkHealth
              snapshot={snapshot}
              onManage={() => onOpen("network")}
              onSettings={onNetworkSettings}
            />
          ) : (
            <section className="workspace-health">
              <p role="status" className="flex-1 text-sm">
                {network.isError
                  ? tr("网络状态暂不可用", "Network status unavailable")
                  : tr("正在读取网络状态…", "Reading network state…")}
              </p>
              {network.isError && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={network.isFetching}
                  onClick={() => void network.refetch()}
                >
                  {tr("重试读取", "Retry")}
                </Button>
              )}
            </section>
          )}
          <div className="workspace-grid">
            <WorkspaceCard
              title={tr("当前网络", "Current network")}
              icon={Globe}
              action={link(tr("管理网络", "Manage network"), "network")}
            >
              {snapshot ? (
                <NetworkQuickNode snapshot={snapshot} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {tr("等待网络状态", "Waiting for network state")}
                </p>
              )}
            </WorkspaceCard>
            <WorkspaceCard
              title={tr("连接方式", "Connection settings")}
              icon={Plug}
            >
              <dl className="space-y-4 text-sm">
                {[
                  [
                    tr("系统代理", "System proxy"),
                    !snapshot
                      ? "—"
                      : !running
                        ? tr("未生效", "Inactive")
                        : snapshot.runtime.proxyGuardTripped
                          ? tr(
                              "未接管 / 已被外部修改",
                              "Not owned / changed externally",
                            )
                          : snapshot.runtime.proxyGuardInspectionUnavailable
                            ? tr("暂时无法核对", "Status unavailable")
                            : snapshot.runtime.proxyGuardWaitingForNetwork
                              ? tr("等待网络确认", "Waiting for network")
                              : settings?.systemProxy
                                ? tr("由 Sivio 管理", "Managed by Sivio")
                                : tr("未开启", "Off"),
                  ],
                  [
                    tr("代理模式", "Proxy mode"),
                    settings
                      ? ({
                          rule: tr("规则分流", "Rule routing"),
                          global: tr("全局代理", "Global proxy"),
                          direct: tr("直连", "Direct"),
                        }[settings.mode] ?? settings.mode)
                      : "—",
                  ],
                  [
                    tr("虚拟网卡 · TUN", "Virtual adapter · TUN"),
                    !snapshot
                      ? "—"
                      : running && (snapshot.runtime.tun ?? settings?.tun)
                        ? tr("已开启", "On")
                        : tr("未开启", "Off"),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                {tr(
                  "系统代理、TUN 与 AI 工具出站分别生效。",
                  "System proxy, TUN and AI outbound settings apply separately.",
                )}
              </p>
            </WorkspaceCard>
          </div>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {tr("常用 AI 工具", "Everyday AI tools")}
              </h2>
              {link(tr("安装与管理", "Install and manage"), "apps")}
            </div>
            <div className="workspace-card">
              {!visibleClients.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  {tr(
                    "尚未选择常用工具，请通过安装与管理添加。",
                    "Choose your tools in Install and manage.",
                  )}
                </p>
              )}
              {clientsOnPage.map((app) => (
                <ClientRow
                  key={app}
                  app={app}
                  onApp={onApp}
                  onModel={onModel}
                />
              ))}
            </div>
            {visibleClients.length > 4 && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setShowAllClients(!showAllClients)}
              >
                {showAllClients
                  ? tr("收起工具列表", "Show fewer tools")
                  : tr(
                      `展开其余 ${visibleClients.length - 4} 个工具`,
                      `Show ${visibleClients.length - 4} more tools`,
                    )}
              </Button>
            )}
          </section>
          <div className="workspace-grid">
            <WorkspaceCard
              title={tr("配置与运行信息", "Configuration and runtime")}
              icon={History}
              action={link(tr("查看网络", "View network"), "network")}
            >
              <p className="text-sm">
                {profile?.name ??
                  tr("尚未选择网络配置", "No network profile selected")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {profile?.updated
                  ? `${tr("上次更新", "Last updated")} · ${new Date(profile.updated * 1000).toLocaleString(i18n.language)}`
                  : tr("暂无更新时间", "No update recorded")}
              </p>
              {profile?.lastError && (
                <p className="mt-3 break-words text-xs text-destructive">
                  {tr("上次订阅更新失败", "Last subscription update failed")} ·{" "}
                  {profile.lastError}
                </p>
              )}
              {snapshot?.runtime.error && (
                <p className="mt-3 break-words text-xs text-destructive">
                  {snapshot.runtime.error}
                </p>
              )}
            </WorkspaceCard>
            {preferences.homeCards.includes("usage") && (
              <WorkspaceCard
                title={tr("今日用量", "Usage today")}
                icon={Activity}
                action={link(tr("查看统计", "View usage"), "usage")}
              >
                <div className="flex flex-wrap gap-8">
                  {[
                    [
                      tr("已观测请求", "Observed requests"),
                      usage.data?.totalRequests,
                    ],
                    [tr("Token 用量", "Tokens"), usage.data?.realTotalTokens],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-xl font-semibold">
                        {usage.isError || value === undefined
                          ? "—"
                          : Number(value).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {usage.isError
                    ? tr("统计暂不可用", "Statistics unavailable")
                    : tr(
                        "仅统计本地可观测的请求。",
                        "Only locally observed requests are included.",
                      )}
                </p>
              </WorkspaceCard>
            )}
          </div>
          <WorkspaceReadinessDetails
            onManageProviders={onApp}
            onManageNetwork={() => onOpen("network")}
          />
          <WorkspaceStats snapshot={snapshot} onOpen={onOpen} />
        </div>
      </div>
    </>
  );
}
