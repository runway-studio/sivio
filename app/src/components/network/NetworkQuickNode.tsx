import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { V7Dialog } from "@/components/mcp/formBits";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { hasPendingMutation, usePendingMutation } from "@/lib/unsavedChanges";
import { extractErrorMessage } from "@/utils/errorUtils";
import { nodeListKey, refreshNodeSelection } from "./nodeSelectionQueries";
import { networkApi } from "./networkApi";
import type { NetworkSnapshot } from "./networkTypes";
import type { ProxyInfo } from "./proxyNodes";

export function NetworkQuickNode({
  snapshot,
  disabled = false,
}: {
  snapshot: NetworkSnapshot;
  disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const cache = useQueryClient();
  const running = snapshot.runtime.phase === "running";
  const generation = snapshot.runtime.generation;
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const lock = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const currentGeneration = useRef(generation);
  currentGeneration.current = generation;
  const query = useQuery({
    queryKey: nodeListKey(generation),
    queryFn: () =>
      networkApi<{ proxies: Record<string, ProxyInfo> }>("controller", {
        method: "GET",
        path: "/proxies",
        expectedGeneration: generation,
      }),
    enabled: running,
    retry: false,
    refetchInterval: running ? 10_000 : false,
  });
  const proxies = running && !query.isError ? (query.data?.proxies ?? {}) : {};
  const groups = Object.entries(proxies).filter(
    ([name, value]) =>
      value.all?.length &&
      (snapshot.catalog.settings.mode === "global"
        ? name === "GLOBAL"
        : name !== "GLOBAL"),
  );
  const selectedGroup = groups.find(([name]) => name === group) ?? groups[0];
  const node = selectedGroup?.[1].now;
  const info = node ? proxies[node] : undefined;
  const delay = info?.history?.at(-1)?.delay;
  const canSelect =
    !!selectedGroup &&
    ["Selector", "URLTest", "Fallback"].includes(selectedGroup[1].type ?? "");
  const direct = snapshot.catalog.settings.mode === "direct";
  const cleanup = useMutation({
    mutationFn: (expectedGeneration: number) =>
      networkApi("controller", {
        method: "DELETE",
        path: "/connections",
        expectedGeneration,
      }),
    onSuccess: () => setOpen(false),
    onSettled: () => {
      lock.current = false;
    },
  });
  const save = useMutation({
    mutationKey: ["network", "quick-node"],
    mutationFn: ({
      groupName,
      name,
      expectedGeneration,
    }: {
      groupName: string;
      name: string;
      expectedGeneration: number;
    }) =>
      networkApi("controller", {
        method: "PUT",
        path: `/proxies/${encodeURIComponent(groupName)}`,
        body: { name },
        expectedGeneration,
      }),
    onSuccess: async (result, variables) => {
      const refreshed = await refreshNodeSelection(
        cache,
        variables.expectedGeneration,
      );
      if (variables.expectedGeneration !== currentGeneration.current) return;
      setRefreshFailed(!refreshed);
      if (refreshed && result?.connectionCleanup !== "failed") setOpen(false);
    },
    onSettled: () => {
      lock.current = false;
    },
  });
  const writing = save.isPending || cleanup.isPending;
  usePendingMutation(writing);
  const busy = disabled || writing;
  const choose = (name: string) => {
    if (
      lock.current ||
      busy ||
      hasPendingMutation() ||
      !running ||
      !canSelect ||
      query.isError ||
      !selectedGroup
    )
      return;
    lock.current = true;
    cleanup.reset();
    setRefreshFailed(false);
    save.mutate({
      groupName: selectedGroup[0],
      name,
      expectedGeneration: generation,
    });
  };
  return (
    <>
      <div className="workspace-node-summary">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold">
            {direct
              ? tr("直连模式", "Direct mode")
              : (node ??
                (query.isError
                  ? tr("节点状态不可用", "Node status unavailable")
                  : running && query.isLoading
                    ? tr("正在读取节点…", "Loading nodes…")
                    : tr("暂无节点", "No node available")))}
          </p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {direct
              ? tr("流量不经过代理节点", "Traffic bypasses proxy nodes")
              : (selectedGroup?.[0] ?? "—")}
            {info?.type ? ` · ${info.type}` : ""}
          </p>
        </div>
        {!direct && (
          <div className="shrink-0 text-right">
            <p className="text-lg font-medium">
              {delay === undefined
                ? "—"
                : delay > 0
                  ? `${delay} ms`
                  : tr("超时", "Timed out")}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {tr("内核上次测速", "Last core latency test")}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {canSelect
            ? tr("当前分组选择", "Current group selection")
            : tr("分组由内核分配", "Assigned by the core")}
        </span>
        <Button
          ref={trigger}
          size="sm"
          variant="outline"
          disabled={
            busy || !running || direct || query.isError || !groups.length
          }
          onClick={() => {
            save.reset();
            cleanup.reset();
            setSearch("");
            setRefreshFailed(false);
            setOpen(true);
          }}
        >
          {tr("切换节点", "Switch node")}
          <ChevronDown size={14} className="ml-1" />
        </Button>
      </div>
      {query.isError && running && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          <p>{extractErrorMessage(query.error)}</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={query.isFetching || busy}
            onClick={() => void query.refetch()}
          >
            {tr("重试读取节点", "Reload nodes")}
          </Button>
        </div>
      )}
      <V7Dialog
        open={open}
        onOpenChange={(next) => {
          if (!writing) setOpen(next);
        }}
        width={520}
      >
        <DialogTitle>{tr("切换节点", "Switch node")}</DialogTitle>
        <DialogDescription>
          {tr(
            "在当前分组中选择节点；切换可能影响已有连接。",
            "Select a node in the current group; existing connections may be affected.",
          )}
        </DialogDescription>
        <label className="mt-3 block text-xs">
          {tr("代理组", "Proxy group")}
          <select
            aria-label={tr("代理组", "Proxy group")}
            className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={selectedGroup?.[0] ?? ""}
            disabled={busy || !running}
            onChange={(event) => {
              setGroup(event.target.value);
              setSearch("");
              save.reset();
            }}
          >
            {!groups.length && <option value="">—</option>}
            {groups.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <SearchField
          className="mt-3"
          value={search}
          onValueChange={setSearch}
          aria-label={tr("搜索节点", "Search nodes")}
          placeholder={tr("搜索节点名称…", "Search node names…")}
          clearLabel={tr("清空搜索", "Clear search")}
          disabled={busy}
        />
        <div
          className="mt-3 max-h-[40vh] space-y-1 overflow-y-auto"
          aria-label={tr("当前节点选择", "Current node selection")}
        >
          {(selectedGroup?.[1].all ?? [])
            .filter((name) =>
              name.toLowerCase().includes(search.trim().toLowerCase()),
            )
            .map((name) => (
              <button
                type="button"
                key={name}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-primary/5 aria-pressed:border-primary/40 aria-pressed:bg-primary/5"
                aria-pressed={name === node}
                disabled={
                  busy ||
                  !running ||
                  !canSelect ||
                  query.isError ||
                  name === node
                }
                onClick={() => choose(name)}
              >
                <span className="min-w-0 flex-1 break-words">{name}</span>
                {name === node && <Check size={15} />}
              </button>
            ))}
          {!selectedGroup?.[1].all?.some((name) =>
            name.toLowerCase().includes(search.trim().toLowerCase()),
          ) && (
            <p className="p-3 text-sm text-muted-foreground">
              {tr("没有匹配的节点", "No matching nodes")}
            </p>
          )}
        </div>
        {!canSelect && (
          <p className="text-xs text-muted-foreground">
            {tr(
              "此分组由内核自动分配节点",
              "The core assigns nodes for this group automatically",
            )}
          </p>
        )}
        {save.isPending && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Loader2 size={14} className="animate-spin" />
            {tr("正在应用并刷新…", "Applying and refreshing…")}
          </p>
        )}
        {save.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {extractErrorMessage(save.error)}
          </p>
        )}
        {save.data?.connectionCleanup === "failed" && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              {tr(
                `已切换到 ${save.variables?.name}，但关闭旧连接失败。`,
                `Switched to ${save.variables?.name}, but closing existing connections failed.`,
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={
                busy ||
                !running ||
                save.variables?.expectedGeneration !== generation
              }
              onClick={() => {
                if (
                  lock.current ||
                  hasPendingMutation() ||
                  save.variables?.expectedGeneration !== generation
                )
                  return;
                lock.current = true;
                cleanup.mutate(generation);
              }}
            >
              {tr(
                "重试关闭当前所有连接",
                "Retry closing all current connections",
              )}
            </Button>
            {cleanup.error && (
              <p role="alert">{extractErrorMessage(cleanup.error)}</p>
            )}
          </div>
        )}
        {refreshFailed && query.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {tr(
              "节点已应用，但读取状态失败。请重试读取，勿重复提交。",
              "Node applied, but refresh failed. Reload the state instead of applying again.",
            )}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {query.isError && (
            <Button
              variant="outline"
              disabled={query.isFetching || busy}
              onClick={() => void query.refetch()}
            >
              {tr("重试读取节点", "Reload nodes")}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={writing}
            onClick={() => setOpen(false)}
          >
            {tr("关闭", "Close")}
          </Button>
        </div>
      </V7Dialog>
    </>
  );
}
