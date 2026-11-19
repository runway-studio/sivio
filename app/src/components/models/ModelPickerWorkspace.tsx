import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layers, RefreshCw, Route } from "lucide-react";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { WorkspaceCard } from "@/components/overview/WorkspaceCard";
import { ModelActivationStatus } from "./ModelActivationStatus";
import { networkApi } from "@/components/network/networkApi";
import type { NetworkSnapshot } from "@/components/network/networkTypes";
import type { ModelCatalog } from "@/lib/api/model-hub";
import "@/components/overview/workspace.css";

/** Page presentation only: catalog, draft and writes remain owned by ModelPickerContent. */
export function ModelPickerWorkspace({
  app,
  catalog,
  provider,
  model,
  busy,
  loading,
  fetching,
  error,
  saved,
  dirty,
  fixedClient,
  onClient,
  onProvider,
  onModel,
  onRefresh,
  onApply,
  canApply,
  onManage,
  onVerify,
  onNetwork,
  children,
}: {
  app: ProxyAppId;
  catalog?: ModelCatalog;
  provider: string;
  model: string;
  busy: boolean;
  loading: boolean;
  fetching: boolean;
  error?: string;
  saved: boolean;
  dirty: boolean;
  fixedClient: boolean;
  onClient: (app: ProxyAppId) => void;
  onProvider: (provider: string) => void;
  onModel: (model: string) => void;
  onRefresh: () => void;
  onApply: () => void;
  canApply: boolean;
  onManage?: () => void;
  onVerify?: () => void;
  onNetwork?: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const network = useQuery({
    queryKey: ["network", "snapshot"],
    queryFn: () => networkApi<NetworkSnapshot>("snapshot"),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.status === "error" ? false : 5000),
  });
  const selected = catalog?.providers.find((item) => item.id === provider);
  const models = selected?.models ?? [];
  const currentProvider = catalog?.providers.find(
    (item) => item.id === catalog.providerId,
  );
  const outbound = network.isError ? undefined : network.data?.catalog.outbound;
  const outboundLabel = outbound
    ? ({
        direct: tr("直连", "Direct"),
        "managed-network": tr("使用 Sivio 网络", "Use Sivio network"),
        "custom-proxy": tr("自定义代理", "Custom proxy"),
      }[outbound] ?? outbound)
    : tr("状态待确认", "Status unknown");
  const routed = catalog?.mode && catalog.mode !== "direct";
  return (
    <div className="workspace-page space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {tr("为客户端选择模型", "Choose a model for your client")}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "供应商、模型和出站放在同一处，应用前看清影响。",
              "Review provider, model and outbound before applying.",
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={fetching || busy}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className="mr-1" />
          {t("modelHub.refresh")}
        </Button>
      </header>
      <div className="flex flex-wrap gap-2" aria-label={t("modelHub.client")}>
        {PROXY_APP_IDS.map((id) => (
          <Button
            key={id}
            variant={app === id ? "default" : "outline"}
            size="sm"
            aria-pressed={app === id}
            disabled={busy || fixedClient}
            onClick={() => onClient(id)}
          >
            {APP_DISPLAY_NAME[id]}
          </Button>
        ))}
      </div>
      <section className="workspace-health">
        <span className="workspace-health-icon">
          <Layers size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">
            {loading
              ? tr("正在读取当前配置…", "Loading configuration…")
              : catalog
                ? `${currentProvider?.name ?? "—"} · ${catalog.model ?? "—"}`
                : tr("配置暂不可用", "Configuration unavailable")}
          </p>
        </div>
        {catalog && (
          <span className="rounded-md bg-primary/10 px-2 py-1 text-xs text-primary">
            {t(`modelHub.mode.${catalog.mode}`)}
          </span>
        )}
      </section>
      <ModelActivationStatus
        app={app}
        disabled={busy || dirty || !!error || !catalog}
        onVerify={onVerify}
      />
      <div className="model-picker-workspace-grid">
        <section className="workspace-card">
          <header className="workspace-card-header">
            <h2>
              <span className="workspace-card-icon">
                <Layers size={16} />
              </span>
              {APP_DISPLAY_NAME[app]} ·{" "}
              {tr("连接配置", "Connection configuration")}
            </h2>
          </header>
          <div className="space-y-4 p-5">
            {!loading && !error && catalog?.providers.length === 0 && (
              <div className="rounded-lg border border-dashed p-4">
                <p className="text-sm">{t("modelHub.noProviders")}</p>
                {onManage && (
                  <Button
                    className="mt-2"
                    variant="outline"
                    size="sm"
                    onClick={onManage}
                  >
                    {tr("添加或导入供应商", "Add or import providers")}
                  </Button>
                )}
              </div>
            )}
            <fieldset
              disabled={busy || fetching || !catalog}
              className="space-y-4"
            >
              <label className="block text-xs font-medium">
                {t("modelHub.provider")}
                <select
                  aria-label={t("modelHub.provider")}
                  className={`${fieldClass} mt-2 h-10 w-full`}
                  value={provider}
                  onChange={(event) => onProvider(event.target.value)}
                >
                  <option value="">{t("modelHub.chooseProvider")}</option>
                  {catalog?.providers.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={!!item.disabled}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium">
                {tr("模型", "Model")}
                <select
                  aria-label={tr("模型", "Model")}
                  className={`${fieldClass} mt-2 h-10 w-full`}
                  value={model}
                  onChange={(event) => onModel(event.target.value)}
                >
                  <option value="" disabled>
                    {tr("请选择模型", "Choose a model")}
                  </option>
                  {model && !models.includes(model) && (
                    <option value={model}>{model}</option>
                  )}
                  {models.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              {selected?.disabled && (
                <p className="text-xs text-destructive">{selected.disabled}</p>
              )}
              <details
                open={
                  !models.length ||
                  (!!model && !models.includes(model)) ||
                  undefined
                }
              >
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {tr("自定义模型 ID", "Custom model ID")}
                </summary>
                <label className="mt-3 block text-xs">
                  {t("modelHub.modelId")}
                  <Input
                    className="mt-2"
                    value={model}
                    maxLength={256}
                    onChange={(event) => onModel(event.target.value)}
                    readOnly={provider.startsWith("@group:")}
                    placeholder="provider-model-id"
                  />
                </label>
              </details>
            </fieldset>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium">
                {tr("AI 网关出站", "AI gateway outbound")}
              </p>
              <p className="mt-1 text-sm">
                {routed
                  ? outboundLabel
                  : tr(
                      "客户端自行连接，网关不接管",
                      "Client connects independently of the gateway",
                    )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tr(
                  "这是现有网关的全局设置；不在本次模型保存中修改。",
                  "This is the existing global gateway setting; saving a model does not change it.",
                )}
              </p>
              {onNetwork && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  disabled={busy}
                  onClick={onNetwork}
                >
                  {tr("管理网络出口", "Manage network outbound")}
                </Button>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("modelHub.applyHint")}
            </p>
            {error && (
              <p role="alert" className="break-words text-sm text-destructive">
                {error}
              </p>
            )}
            {saved && (
              <div role="status" className="text-sm">
                <p>
                  {t("modelHub.applied")} ·{" "}
                  {tr(
                    "配置已保存；客户端读取未观测，请在新会话中验证。",
                    "Configuration saved; client reload is unobserved. Verify in a new session.",
                  )}
                </p>
              </div>
            )}
          </div>
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {busy
                ? tr("正在保存并刷新…", "Saving and refreshing…")
                : dirty
                  ? tr("有未应用的更改", "Unapplied changes")
                  : tr("当前选择尚未更改", "Selection unchanged")}
            </p>
            <Button disabled={!canApply} onClick={onApply}>
              {t("modelHub.apply")}
            </Button>
          </footer>
        </section>
        <aside className="space-y-4">
          <WorkspaceCard
            title={tr("本次配置路径", "Selected configuration path")}
            icon={Route}
          >
            <ol className="space-y-5">
              {[
                [
                  APP_DISPLAY_NAME[app],
                  tr(
                    "仅修改当前客户端配置",
                    "Only this client's configuration changes",
                  ),
                ],
                [
                  catalog ? t(`modelHub.mode.${catalog.mode}`) : "—",
                  routed
                    ? tr("通过本地网关", "Via the local gateway")
                    : tr("客户端直接连接", "Client connects directly"),
                ],
                [
                  selected?.name ?? "—",
                  model || tr("尚未选择模型", "No model selected"),
                ],
                [
                  routed ? outboundLabel : tr("客户端出站", "Client outbound"),
                  tr(
                    "配置路径不代表请求已经成功",
                    "Configuration does not prove request success",
                  ),
                ],
              ].map(([title, detail], index) => (
                <li key={index} className="flex gap-3">
                  <span className="workspace-card-icon shrink-0 text-xs">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm">{title}</p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </WorkspaceCard>
          <p className="rounded-lg border border-primary/15 bg-primary/5 p-4 text-xs leading-5 text-muted-foreground">
            {tr(
              "保存失败会保留当前草稿；刷新目录不会覆盖未保存的选择。",
              "Failed saves retain your draft. Refreshing the catalog preserves unsaved selections.",
            )}
          </p>
        </aside>
      </div>
      <details className="workspace-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          {tr("浏览完整模型目录", "Browse the full model catalog")}
        </summary>
        <div className="p-4 pt-0">{children}</div>
      </details>
    </div>
  );
}
