import { useTranslation } from "react-i18next";
import { useWorkspacePreferences } from "@/lib/desktopPreferences";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowRight, Box, Check, Globe, Layers, Server } from "lucide-react";
import { AppGlyph } from "@/components/shell/AppGlyph";
import logo from "@/assets/icons/logo.svg";
import { APP_IDS, getAppLabel } from "@/config/appConfig";
import { providersQueryOptions } from "@/lib/query";
import { useUsageSummary } from "@/lib/query/usage";
import { useProxyStatusQuery } from "@/lib/query/proxy";
import type { AppId } from "@/lib/api";
import type { GlobalPage } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import {
  networkApi,
  type NetworkSnapshot,
} from "@/components/network/NetworkWorkspace";
export function Overview({
  onOpen,
  onApp,
}: {
  onOpen: (page: GlobalPage) => void;
  onApp: (app: AppId) => void;
}) {
  const { t, i18n } = useTranslation();
  const preferences = useWorkspacePreferences();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const usage = useUsageSummary({ preset: "today" });
  const proxy = useProxyStatusQuery();
  const network = useQuery({
    queryKey: ["network", "snapshot"],
    queryFn: () => networkApi<NetworkSnapshot>("snapshot"),
    refetchInterval: 5000,
  });
  const providers = useQueries({
    queries: APP_IDS.map((app) => providersQueryOptions(app)),
  });
  const totalProviders = providers.reduce(
    (sum, item) => sum + Object.keys(item.data?.providers ?? {}).length,
    0,
  );
  const running = network.data?.runtime.phase === "running";
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-7 pb-10 pt-6">
      <header className="mb-7 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">
            {tr("你的 AI 工作台", "Your AI workspace")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("app.title")}
          </h1>
          <p className="mt-1 text-lg font-medium text-primary">
            {t("app.description")}
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {tr(
              "在 Sivio 统一管理模型配置、工具扩展与网络连接，让 AI 工作更顺手。",
              "Manage model configurations, tool extensions and network connections in Sivio to keep your AI workflow within reach.",
            )}
          </p>
        </div>
        <div className="shrink-0 rounded-2xl bg-primary/10 p-3">
          <img
            src={logo}
            alt={t("app.title")}
            draggable={false}
            className="h-12 w-12"
          />
        </div>
      </header>
      <div className="mb-7 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          {
            id: "usage" as const,
            label: tr("今日 Token 用量", "Tokens today"),
            value: usage.data
              ? usage.data.realTotalTokens.toLocaleString()
              : "—",
            note: usage.data
              ? `${usage.data.totalRequests.toLocaleString()} ${tr("次请求", "requests")}`
              : tr("等待本地统计", "Waiting for local statistics"),
            icon: Layers,
          },
          {
            id: "router" as const,
            label: tr("AI 路由服务", "AI router"),
            value: proxy.data
              ? proxy.data.running
                ? tr("运行中", "Running")
                : tr("已停止", "Stopped")
              : "—",
            note: proxy.data?.running
              ? `127.0.0.1:${proxy.data.port}`
              : tr(
                  "在工具页选择路由模式",
                  "Select routing mode on an app page",
                ),
            icon: Server,
          },
          {
            id: "network" as const,
            label: tr("网络出口", "Network routing"),
            value: network.data
              ? running
                ? tr("已连接", "Connected")
                : tr("已停止", "Stopped")
              : "—",
            note: running
              ? `${network.data?.runtime.managed ? tr("受管", "Managed") : tr("普通", "Ordinary")} Mihomo · :${network.data?.runtime.port}`
              : tr(
                  "选择配置后启动网络",
                  "Select a profile, then start the network",
                ),
            icon: Globe,
          },
          {
            id: "providers" as const,
            label: tr("供应商配置", "Provider configurations"),
            value: String(totalProviders),
            note: `${APP_IDS.length} ${tr("种 AI 客户端", "AI clients")}`,
            icon: Box,
          },
        ]
          .filter((card) => preferences.homeCards.includes(card.id))
          .map((card) => (
            <article key={card.label} className="rounded-2xl bg-muted p-5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{card.label}</span>
                <card.icon size={15} />
              </div>
              <p className="my-3 text-2xl font-semibold tracking-tight">
                {card.value}
              </p>
              <p className="text-xs text-muted-foreground">{card.note}</p>
            </article>
          ))}
      </div>
      <section className="mb-7 rounded-2xl border p-5">
        <div className="flex justify-between">
          <div>
            <h2 className="font-medium">
              {tr("网络工作区", "Network workspace")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {network.data?.catalog.profiles.length ?? 0}{" "}
              {tr("份配置 · AI 出站", "profiles · AI outbound")}{" "}
              {network.data?.catalog.outbound ?? "direct"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpen("network")}>
            {tr("管理网络", "Manage network")}
            <ArrowRight size={14} />
          </Button>
        </div>
        <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          {[
            tr("订阅与节点", "Profiles and proxies"),
            tr("规则、连接与日志", "Rules, connections and logs"),
            tr("TUN 与系统代理恢复", "TUN and system proxy recovery"),
          ].map((label) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-lg bg-muted px-3 py-3"
            >
              <Check size={14} className="text-primary" />
              {label}
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">{tr("AI 工具", "AI tools")}</h2>
          <Button variant="ghost" size="sm" onClick={() => onOpen("apps")}>
            {tr("安装与管理", "Install and manage")}
            <ArrowRight size={14} />
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {APP_IDS.map((app, index) => {
            const query = providers[index];
            const count = Object.keys(query.data?.providers ?? {}).length;
            return (
              <button
                key={app}
                className="group flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                onClick={() => onApp(app)}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-primary">
                  <AppGlyph app={app} size={25} badgeClassName="bg-muted" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">
                    {getAppLabel(app)}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {query.isError
                      ? tr("配置不可用", "Configuration unavailable")
                      : `${count} ${tr("个供应商配置", "provider configurations")}`}
                  </span>
                </span>
                <ArrowRight
                  size={14}
                  className="text-muted-foreground group-hover:text-primary"
                />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
