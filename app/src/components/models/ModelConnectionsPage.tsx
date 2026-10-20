import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { Cable } from "lucide-react";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { GatewayOverview } from "@/components/overview/GatewayOverview";
import { APP_IDS, PROXY_APP_IDS } from "@/config/appConfig";
import { proxyApi } from "@/lib/api/proxy";
import { providersQueryOptions } from "@/lib/query";
import { useProxyStatusQuery } from "@/lib/query/proxy";
import type { AppId } from "@/lib/api";
import type { GlobalPage } from "@/lib/navigation";

export function ModelConnectionsPage({
  onOpen,
  onApp,
  onRouting,
}: {
  onOpen: (page: GlobalPage) => void;
  onApp: (app: AppId) => void;
  onRouting: () => void;
}) {
  const { t } = useTranslation();
  const proxy = useProxyStatusQuery();
  const providers = useQueries({
    queries: APP_IDS.map((app) => providersQueryOptions(app)),
  });
  const modes = useQueries({
    queries: PROXY_APP_IDS.map((app) => ({
      queryKey: ["providers", app, "mode"],
      queryFn: () => proxyApi.getAppMode(app),
      refetchInterval: 3000,
    })),
  });
  const clients = APP_IDS.map((app, index) => ({
    app,
    data: providers[index].data,
    mode: modes[PROXY_APP_IDS.indexOf(app as (typeof PROXY_APP_IDS)[number])]
      ?.data,
    error:
      providers[index].isError ||
      modes[PROXY_APP_IDS.indexOf(app as (typeof PROXY_APP_IDS)[number])]
        ?.isError,
  }));
  return (
    <>
      <AppPageHeader
        title={t("nav.modelConnections")}
        icon={<Cable className="h-5 w-5" />}
      />
      <div
        id="main-content"
        data-testid="model-connections-page"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-stable"
      >
        <div className="mx-auto w-full max-w-screen-2xl p-6">
          <GatewayOverview
            clients={clients}
            status={proxy.isError ? undefined : proxy.data}
            onApp={onApp}
            onRouting={onRouting}
            onApps={() => onOpen("apps")}
            onTools={() => onOpen("mcp")}
          />
        </div>
      </div>
    </>
  );
}
