import { useViewMemory } from "@/hooks/useViewMemory";
import { useTranslation } from "react-i18next";
import { ListFilter, Route } from "lucide-react";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import type { AppId } from "@/lib/api";
import { ModelPickerContent } from "./ModelPickerDialog";
import { RouteDecisionsContent } from "./RouteDecisionsDialog";
import "./ModelHubPage.css";

export function ModelHubPage({
  view,
  activeApp,
  onBusyChange,
  onManageProviders,
  onVerify,
  commandSelection,
}: {
  onVerify?: (app: ProxyAppId) => void;
  commandSelection?: { app: AppId; providerId: string; model: string };
  view: "modelPicker" | "routeDecisions";
  activeApp: AppId;
  onBusyChange: (busy: boolean) => void;
  onManageProviders?: (app: ProxyAppId) => void;
}) {
  const { t } = useTranslation();
  const app = PROXY_APP_IDS.includes(activeApp as ProxyAppId)
    ? (activeApp as ProxyAppId)
    : "claude";
  const [pickerClient, setPickerClient] = useViewMemory<ProxyAppId>(
    "model-hub:picker-client",
    app,
  );
  const [recordClient, setRecordClient] = useViewMemory<ProxyAppId | undefined>(
    "model-hub:record-client",
    undefined,
  );
  const Icon = view === "modelPicker" ? ListFilter : Route;
  return (
    <>
      <AppPageHeader
        title={t(`nav.${view}`)}
        icon={<Icon className="h-5 w-5" />}
      />
      <div
        id="main-content"
        data-testid="model-hub-page"
        className="model-hub-page min-h-0 flex-1 overflow-y-auto scroll-stable"
      >
        <div className="mx-auto w-full max-w-6xl p-6 [overflow-wrap:anywhere]">
          {view === "modelPicker" ? (
            <ModelPickerContent
              key={
                commandSelection
                  ? `${commandSelection.app}:${commandSelection.providerId}:${commandSelection.model}`
                  : app
              }
              initialApp={commandSelection ? app : pickerClient}
              initialSelection={commandSelection}
              onClientChange={setPickerClient}
              onManageProviders={onManageProviders}
              onVerify={onVerify}
              page
              setBusy={onBusyChange}
            />
          ) : (
            <RouteDecisionsContent
              page
              initialApp={recordClient}
              onClientChange={setRecordClient}
            />
          )}
        </div>
      </div>
    </>
  );
}
