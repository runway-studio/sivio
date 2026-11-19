import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { APP_IDS } from "@/config/appConfig";
import { providersQueryOptions } from "@/lib/query";
import { useProxyStatusQuery } from "@/lib/query/proxy";
import { useWorkspacePreferences } from "@/lib/desktopPreferences";
import { coreStatusLabel } from "@/lib/workspaceReadiness";
import type { GlobalPage } from "@/lib/navigation";
import type { NetworkSnapshot } from "@/components/network/networkTypes";

/** Preserve the existing home-card preferences in a secondary, compact summary. */
export function WorkspaceStats({
  snapshot,
  onOpen,
}: {
  snapshot?: NetworkSnapshot;
  onOpen: (page: GlobalPage) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const preferences = useWorkspacePreferences();
  const proxy = useProxyStatusQuery();
  const providers = useQueries({
    queries: APP_IDS.map((app) => ({
      ...providersQueryOptions(app),
      enabled: preferences.homeCards.includes("providers"),
    })),
  });
  const providerCount = providers.some(
    (query) => query.isError || !query.data || query.data.readError,
  )
    ? "—"
    : String(
        providers.reduce(
          (sum, query) => sum + Object.keys(query.data?.providers ?? {}).length,
          0,
        ),
      );
  const cards = [
    {
      id: "router",
      label: zh ? "AI 路由服务" : "AI router",
      value:
        proxy.isError || !proxy.data
          ? "—"
          : coreStatusLabel(proxy.data.running ? "running" : "stopped", zh),
      target: "modelConnections" as const,
    },
    {
      id: "network",
      label: zh ? "网络内核" : "Network core",
      value: coreStatusLabel(snapshot?.runtime.phase, zh, !snapshot),
      target: "network" as const,
    },
    {
      id: "providers",
      label: zh ? "供应商配置" : "Provider configurations",
      value: providerCount,
      target: "apps" as const,
    },
  ].filter((card) =>
    preferences.homeCards.includes(
      card.id as "router" | "network" | "providers",
    ),
  );
  if (!cards.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {cards.map((card) => (
        <button
          key={card.id}
          className="min-w-0 flex-1 rounded-lg border bg-muted/20 px-4 py-3 text-left hover:bg-muted/50"
          onClick={() => onOpen(card.target)}
        >
          <span className="text-xs text-muted-foreground">{card.label}</span>
          <span className="mt-1 block text-sm font-medium">{card.value}</span>
        </button>
      ))}
    </div>
  );
}
