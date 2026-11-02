import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { V7Dialog } from "@/components/mcp/formBits";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { proxyKeys } from "@/lib/query/proxy";
import { modelHubApi } from "@/lib/api/model-hub";
import { useUnsavedValue } from "@/lib/unsavedChanges";
import { extractErrorMessage } from "@/utils/errorUtils";

export function ModelPickerDialog({
  app: initialApp,
  open,
  onOpenChange,
}: {
  app: ProxyAppId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <V7Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      width={660}
      className="gap-2 overflow-y-auto"
    >
      {open && (
        <ModelPickerContent
          key={initialApp}
          initialApp={initialApp}
          setBusy={setBusy}
          close={() => onOpenChange(false)}
        />
      )}
    </V7Dialog>
  );
}
export function ModelPickerContent({
  initialApp,
  close,
  setBusy,
  page = false,
  onClientChange,
  onManageProviders,
  onVerify,
  initialSelection,
  fixedClient = false,
}: {
  onVerify?: (app: ProxyAppId) => void;
  fixedClient?: boolean;
  initialSelection?: { providerId: string; model: string };
  initialApp: ProxyAppId;
  close?: () => void;
  page?: boolean;
  onClientChange?: (app: ProxyAppId) => void;
  onManageProviders?: (app: ProxyAppId) => void;
  setBusy: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const cache = useQueryClient();
  const [app, setApp] = useState(initialApp);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const query = useQuery({
    queryKey: ["model-picker", app],
    queryFn: () => modelHubApi.catalog(app),
    refetchOnWindowFocus: false,
  });
  const commandApplied = useRef<typeof initialSelection>();
  const baseline = useRef<{
    app: ProxyAppId;
    provider: string;
    model: string;
  }>();
  const draft = useRef({ provider, model });
  draft.current = { provider, model };
  useEffect(() => {
    if (!query.data) return;
    const previous = baseline.current;
    const dirty =
      previous?.app === app &&
      (draft.current.provider !== previous.provider ||
        draft.current.model !== previous.model);
    const newCommand =
      initialSelection && commandApplied.current !== initialSelection;
    if (dirty && !newCommand) return; // Refreshing a changed revision must not discard a user's draft.
    baseline.current = {
      app,
      provider: query.data.providerId ?? "",
      model: query.data.model ?? "",
    };
    if (initialSelection && newCommand) {
      setProvider(initialSelection.providerId);
      setModel(initialSelection.model);
      commandApplied.current = initialSelection;
    } else {
      setProvider(query.data.providerId ?? "");
      setModel(query.data.model ?? "");
    }
  }, [query.data, app, initialSelection]);
  useUnsavedValue(
    page &&
      baseline.current?.app === app &&
      (provider !== baseline.current.provider ||
        model !== baseline.current.model),
  );
  const save = useMutation({
    mutationFn: () =>
      modelHubApi.select(app, provider, model.trim(), query.data!.revision),
    onMutate: () => setBusy(true),
    onSettled: () => setBusy(false),
    onSuccess: async (saved) => {
      baseline.current = {
        app,
        provider: saved.providerId ?? "",
        model: saved.model ?? "",
      };
      setProvider(saved.providerId ?? "");
      setModel(saved.model ?? "");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["providers"] }),
        cache.invalidateQueries({ queryKey: proxyKeys.status }),
        cache.invalidateQueries({ queryKey: proxyKeys.takeoverStatus }),
        cache.invalidateQueries({ queryKey: ["model-picker"] }),
      ]);
      close?.();
    },
  });
  useEffect(() => () => setBusy(false), [setBusy]);
  const selected = query.data?.providers.find((p) => p.id === provider);
  const q = search.trim().toLowerCase();
  return (
    <>
      {page ? (
        <p className="text-sm text-fg-3">{t("modelHub.description")}</p>
      ) : (
        <>
          <DialogTitle>{t("modelHub.title")}</DialogTitle>
          <DialogDescription>{t("modelHub.description")}</DialogDescription>
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="shrink-0">{t("modelHub.client")}</span>
          <select
            className={`${fieldClass} h-9 min-w-0 flex-1`}
            value={app}
            disabled={save.isPending || fixedClient}
            onChange={(e) => {
              setProvider("");
              setModel("");
              setSearch("");
              save.reset();
              setApp(e.target.value as ProxyAppId);
              onClientChange?.(e.target.value as ProxyAppId);
            }}
          >
            {PROXY_APP_IDS.map((id) => (
              <option key={id} value={id}>
                {APP_DISPLAY_NAME[id]}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={query.isFetching || save.isPending}
          onClick={() => {
            save.reset();
            void query.refetch();
          }}
        >
          <RefreshCw size={14} />
          {t("modelHub.refresh")}
        </Button>
      </div>
      {query.data && (
        <p className="my-3 break-words text-xs text-muted-foreground">
          {t("modelHub.current", {
            mode: t(`modelHub.mode.${query.data.mode}`),
            provider:
              query.data.providers.find((p) => p.id === query.data?.providerId)
                ?.name ?? "—",
            model: query.data.model ?? "—",
          })}
        </p>
      )}
      <SearchField
        className="mt-3"
        value={search}
        onValueChange={setSearch}
        aria-label={t("modelHub.search")}
        placeholder={t("modelHub.search")}
        clearLabel={t("common.clear")}
        disabled={save.isPending}
      />
      <div className={page ? "model-picker-body" : undefined}>
        <div
          className={
            page
              ? "model-picker-catalog min-w-0 overflow-y-auto rounded-xl border bg-surface p-3"
              : "mt-3 max-h-[32vh] overflow-y-auto rounded-xl border p-2"
          }
          aria-label={t("modelHub.models")}
        >
          {query.isLoading && (
            <p className="p-4">
              <Loader2 className="animate-spin" size={18} />
            </p>
          )}
          {q &&
            query.data &&
            !query.isLoading &&
            !query.error &&
            !query.data.providers.some(
              (p) =>
                `${p.name} ${p.id}`.toLowerCase().includes(q) ||
                p.models.some((m) =>
                  `${p.name} ${p.id} ${m}`.toLowerCase().includes(q),
                ),
            ) && (
              <div className="p-3 text-sm" role="status">
                <p>
                  {tr(
                    "没有匹配的供应商或模型。",
                    "No matching providers or models.",
                  )}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => setSearch("")}
                >
                  {tr("清空搜索", "Clear search")}
                </Button>
              </div>
            )}
          {query.data?.providers.map((p) => {
            const visible = p.models.filter(
              (m) => !q || `${p.name} ${p.id} ${m}`.toLowerCase().includes(q),
            );
            if (
              q &&
              !visible.length &&
              !`${p.name} ${p.id}`.toLowerCase().includes(q)
            )
              return null;
            return (
              <section key={p.id} className="mb-3">
                <h3 className="break-all px-2 py-1 text-xs font-semibold">
                  {p.name}
                </h3>
                {p.disabled ? (
                  <p className="px-2 text-xs text-muted-foreground">
                    {p.disabled}
                  </p>
                ) : (
                  <>
                    {visible.map((id) => (
                      <button
                        key={id}
                        type="button"
                        disabled={save.isPending}
                        aria-pressed={provider === p.id && model === id}
                        onClick={() => {
                          setProvider(p.id);
                          setModel(id);
                          save.reset();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted aria-pressed:bg-primary/10"
                      >
                        <span className="min-w-0 flex-1 break-all">{id}</span>
                        {provider === p.id && model === id && (
                          <Check size={16} className="shrink-0" />
                        )}
                      </button>
                    ))}
                    {!p.models.length && (
                      <button
                        type="button"
                        disabled={save.isPending}
                        className="px-2 py-2 text-xs text-primary"
                        onClick={() => {
                          setProvider(p.id);
                          setModel("");
                        }}
                      >
                        {t("modelHub.noModels")}
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
          {!query.isLoading &&
            !query.error &&
            !query.data?.providers.length && (
              <div className="p-3 text-sm text-muted-foreground">
                <p>{t("modelHub.noProviders")}</p>
                {onManageProviders && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={save.isPending}
                    onClick={() => onManageProviders(app)}
                  >
                    {tr("添加或导入供应商", "Add or import providers")}
                  </Button>
                )}
              </div>
            )}
        </div>
        <div
          className={
            page ? "min-w-0 rounded-xl border bg-surface p-5" : undefined
          }
        >
          <fieldset
            disabled={save.isPending || query.isFetching}
            className="mt-4 space-y-2"
          >
            <legend className="mb-2 text-xs font-semibold">
              {t("modelHub.custom")}
            </legend>
            <label className="block text-xs">
              {t("modelHub.provider")}
              <select
                className={`${fieldClass} mt-1 h-9 w-full`}
                value={provider}
                onChange={(e) => {
                  const next = query.data?.providers.find(
                    (p) => p.id === e.target.value,
                  );
                  setProvider(e.target.value);
                  if (
                    e.target.value.startsWith("@group:") ||
                    provider.startsWith("@group:")
                  ) {
                    setModel(next?.models[0] ?? "");
                  }
                  save.reset();
                }}
              >
                <option value="">{t("modelHub.chooseProvider")}</option>
                {query.data?.providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!!p.disabled}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              {t("modelHub.modelId")}
              <Input
                className="mt-1"
                value={model}
                maxLength={256}
                onChange={(e) => {
                  setModel(e.target.value);
                  save.reset();
                }}
                placeholder="provider-model-id"
                readOnly={provider.startsWith("@group:")}
              />
            </label>
          </fieldset>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            {t("modelHub.applyHint")}
          </p>
          {(query.error || save.error) && (
            <p
              role="alert"
              className="mt-2 break-words text-sm text-destructive"
            >
              {extractErrorMessage(save.error ?? query.error)}
            </p>
          )}
          {page && save.isSuccess && (
            <p role="status" className="mt-3 text-sm text-route-text">
              {t("modelHub.applied")} ·{" "}
              {tr(
                "配置已保存；客户端读取未观测，请在新会话中验证。",
                "Configuration saved; client reload is unobserved. Verify in a new session.",
              )}
            </p>
          )}
          {page && save.isSuccess && onVerify && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => onVerify(app)}
            >
              {tr("验证并打开客户端", "Verify and open client")}
            </Button>
          )}
          <div className="mt-4 flex justify-end gap-2">
            {!page && (
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={close}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              disabled={
                !query.data ||
                query.isFetching ||
                !selected ||
                !!selected.disabled ||
                !model.trim() ||
                save.isPending
              }
              onClick={() => save.mutate()}
            >
              {save.isPending && (
                <Loader2 className="mr-2 animate-spin" size={14} />
              )}{" "}
              {t("modelHub.apply")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
