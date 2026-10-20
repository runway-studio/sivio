import { RoutingLivePanel } from "./RoutingLivePanel";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Route, Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { PROXY_APP_IDS, type ProxyAppId } from "@/config/appConfig";
import {
  modelHubApi,
  routingGroupsApi,
  type RoutingGroup,
  type RoutingStrategy,
} from "@/lib/api/model-hub";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { extractErrorMessage } from "@/utils/errorUtils";
const empty = (): RoutingGroup => ({
  id: "",
  name: "",
  strategy: "order",
  members: [{ providerId: "", model: "" }],
});
export function RoutingGroupsPage({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [app, setApp] = useState<ProxyAppId>("claude");
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoutingGroup | null>(null);
  const [revision, setRevision] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const groups = useQuery({
    queryKey: ["routing-groups", app],
    queryFn: () => routingGroupsApi.list(app),
    refetchOnWindowFocus: false,
  });
  const catalog = useQuery({
    queryKey: ["model-picker", app],
    queryFn: () => modelHubApi.catalog(app),
    refetchOnWindowFocus: false,
  });
  const providers =
    catalog.data?.providers.filter((p) => !p.id.startsWith("@group:")) ?? [];
  const save = useMutation({
    mutationFn: (remove: boolean) =>
      routingGroupsApi.update(app, draft!, revision, remove),
    onSuccess: async (data) => {
      cache.setQueryData(["routing-groups", app], data);
      setDraft(null);
      setDirty(false);
      setConfirmDelete(false);
      await cache.invalidateQueries({ queryKey: ["model-picker"] });
    },
  });
  useEffect(() => {
    onBusyChange(dirty || save.isPending);
    return () => onBusyChange(false);
  }, [dirty, save.isPending, onBusyChange]);
  const edit = (value: RoutingGroup) => {
    setFocusGroup(value.id || null);
    setDraft(structuredClone(value));
    setRevision(groups.data!.revision);
    setDirty(false);
    setConfirmDelete(false);
    save.reset();
  };
  const change = (value: RoutingGroup) => {
    setDraft(value);
    setDirty(true);
    setConfirmDelete(false);
    save.reset();
  };
  const move = (i: number, d: number) => {
    const members = [...draft!.members];
    [members[i], members[i + d]] = [members[i + d], members[i]];
    change({ ...draft!, members });
  };
  return (
    <>
      <AppPageHeader
        title={t("nav.routingGroups")}
        icon={<Route className="h-5 w-5" />}
      />
      <div
        id="main-content"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-stable"
        data-testid="routing-groups-page"
      >
        <div className="mx-auto max-w-6xl space-y-5 p-6">
          <RoutingLivePanel
            app={app}
            group={groups.data?.groups.find((g) => g.id === focusGroup)}
            providers={providers}
            onAll={() => setFocusGroup(null)}
          />
          <h2 className="text-sm font-semibold">{t("nav.routingGroups")}</h2>
          <p className="text-sm text-fg-3">{t("routingGroups.description")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 whitespace-nowrap text-sm">
              {t("modelHub.client")}
              <select
                className={`${fieldClass} h-9 min-w-36`}
                value={app}
                disabled={dirty || save.isPending}
                onChange={(e) => {
                  setApp(e.target.value as ProxyAppId);
                  setFocusGroup(null);
                  setDraft(null);
                  save.reset();
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
              disabled={dirty || save.isPending || groups.isFetching}
              onClick={() => void groups.refetch()}
            >
              {t("modelHub.refresh")}
            </Button>
            <Button
              disabled={!groups.data || dirty || save.isPending}
              onClick={() => edit(empty())}
            >
              <Plus size={14} />
              {t("routingGroups.create")}
            </Button>
          </div>
          {(groups.error || catalog.error) && (
            <p role="alert" className="text-destructive">
              {extractErrorMessage(groups.error || catalog.error)}
            </p>
          )}
          {groups.isLoading && <p role="status">{t("common.loading")}</p>}
          {!groups.isLoading &&
            !groups.error &&
            !groups.data?.groups.length && (
              <p className="rounded-xl border p-5 text-sm text-fg-3">
                {t("routingGroups.empty")}
              </p>
            )}
          {!!groups.data?.groups.length && (
            <div className="routing-group-list">
              {groups.data?.groups.map((g) => (
                <div
                  className="routing-group-row"
                  key={g.id}
                  data-selected={focusGroup === g.id}
                >
                  <button
                    disabled={dirty || save.isPending}
                    aria-label={t("routingLive.viewGroup", { name: g.name })}
                    onClick={() => setFocusGroup(g.id)}
                  >
                    <strong>{g.name}</strong>
                    <code>
                      {app === "claude"
                        ? "sivio-claude-group-"
                        : "sivio-group-"}
                      {g.id}
                    </code>
                    <p>
                      {g.members
                        .map(
                          (m) =>
                            `${providers.find((p) => p.id === m.providerId)?.name ?? m.providerId} / ${m.model}`,
                        )
                        .join(" → ")}
                    </p>
                  </button>
                  <span>
                    {t(`routingGroups.strategies.${g.strategy ?? "order"}`)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={dirty || save.isPending}
                    onClick={() => edit(g)}
                    aria-label={t("routingLive.editGroup", { name: g.name })}
                  >
                    {t("common.edit")}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {draft && (
            <section
              className="space-y-4 rounded-xl border p-5"
              aria-label={t("routingGroups.editor")}
            >
              <fieldset disabled={save.isPending} className="min-w-0 space-y-4">
                <label className="block space-y-2 text-sm">
                  {t("routingGroups.name")}
                  <Input
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => change({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="block space-y-2 text-sm">
                  {t("routingGroups.strategy")}
                  <select
                    aria-label={t("routingGroups.strategy")}
                    className={`${fieldClass} h-9 w-full`}
                    value={draft.strategy ?? "order"}
                    onChange={(e) =>
                      change({
                        ...draft,
                        strategy: e.target.value as RoutingStrategy,
                      })
                    }
                  >
                    {(
                      ["order", "rotate", "usage", "smart", "pace"] as const
                    ).map((strategy) => (
                      <option key={strategy} value={strategy}>
                        {t(`routingGroups.strategies.${strategy}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm text-fg-3">
                  {t(`routingGroups.hints.${draft.strategy ?? "order"}`)}
                </p>
                {(draft.strategy === "smart" || draft.strategy === "pace") && (
                  <p className="text-sm text-fg-3">
                    {t("routingGroups.quotaHint")}
                  </p>
                )}
                <p className="text-xs text-fg-3">
                  {t("routingGroups.memberHint")}
                </p>
                {draft.members.map((m, i) => (
                  <div
                    key={i}
                    className="flex min-w-0 flex-wrap items-end gap-2 rounded-lg bg-subtle p-3"
                  >
                    <span className="self-center text-sm text-fg-3">
                      {i + 1}
                    </span>
                    <label className="min-w-40 flex-1 space-y-1 text-xs">
                      {t("modelHub.provider")}
                      <select
                        className={`${fieldClass} h-9 w-full`}
                        aria-label={t("modelHub.provider")}
                        value={m.providerId}
                        onChange={(e) =>
                          change({
                            ...draft,
                            members: draft.members.map((v, j) =>
                              j === i
                                ? { ...v, providerId: e.target.value }
                                : v,
                            ),
                          })
                        }
                      >
                        <option value="">
                          {t("routingGroups.chooseProvider")}
                        </option>
                        {m.providerId &&
                          !providers.some((p) => p.id === m.providerId) && (
                            <option
                              aria-label={t("modelHub.provider")}
                              value={m.providerId}
                            >
                              {m.providerId} ({t("routingGroups.missing")})
                            </option>
                          )}
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-40 flex-1 space-y-1 text-xs">
                      {t("modelHub.modelId")}
                      <Input
                        value={m.model}
                        maxLength={256}
                        list={`group-models-${i}`}
                        onChange={(e) =>
                          change({
                            ...draft,
                            members: draft.members.map((v, j) =>
                              j === i ? { ...v, model: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <datalist id={`group-models-${i}`}>
                        {providers
                          .find((p) => p.id === m.providerId)
                          ?.models.map((model) => (
                            <option key={model} value={model} />
                          ))}
                      </datalist>
                    </label>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("routingGroups.up")}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("routingGroups.down")}
                      disabled={i === draft.members.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={t("routingGroups.removeMember")}
                      disabled={draft.members.length === 1}
                      onClick={() =>
                        change({
                          ...draft,
                          members: draft.members.filter((_, j) => i !== j),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  disabled={draft.members.length >= 10}
                  onClick={() =>
                    change({
                      ...draft,
                      members: [
                        ...draft.members,
                        { providerId: "", model: "" },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  {t("routingGroups.addMember")}
                </Button>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    save.isPending ||
                    !draft.name.trim() ||
                    draft.members.some((m) => !m.providerId || !m.model.trim())
                  }
                  onClick={() => save.mutate(false)}
                >
                  {t("common.save")}
                </Button>
                <Button
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft(null);
                    setDirty(false);
                    save.reset();
                  }}
                >
                  {t("routingGroups.cancel")}
                </Button>
                {draft.id && (
                  <Button
                    variant="outline"
                    disabled={save.isPending}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {t("common.delete")}
                  </Button>
                )}
              </div>
              {confirmDelete && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
                >
                  {t("routingGroups.deleteHint")}
                  <Button
                    variant="destructive"
                    disabled={save.isPending}
                    onClick={() => save.mutate(true)}
                  >
                    {t("routingGroups.confirmDelete")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              )}
              {save.error && (
                <p
                  role="alert"
                  className="break-words text-sm text-destructive"
                >
                  {extractErrorMessage(save.error)}
                </p>
              )}
            </section>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm text-success">
              {t("routingGroups.saved")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
