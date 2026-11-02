import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { APP_IDS, PROXY_APP_IDS, getAppLabel } from "@/config/appConfig";
import type { AppId } from "@/lib/api";
import { providersQueryOptions } from "@/lib/query";
import { modelHubApi } from "@/lib/api/model-hub";
import { sessionsApi } from "@/lib/api/sessions";
import { networkApi } from "@/components/network/networkApi";
import type { GlobalPage } from "@/lib/navigation";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type CommandTarget =
  | { kind: "app"; app: AppId }
  | { kind: "page"; page: GlobalPage | "settings" }
  | { kind: "model"; app: AppId; providerId: string; model: string }
  | { kind: "node"; name: string }
  | { kind: "session"; providerId: string; sessionId: string };
export interface CommandEntry {
  id: string;
  group: string;
  label: string;
  keywords: string;
  target: CommandTarget;
}
export function searchCommands(
  entries: CommandEntry[],
  query: string,
  limit: number,
) {
  const q = query.trim().toLowerCase();
  return entries
    .filter((e) => `${e.label} ${e.keywords}`.toLowerCase().includes(q))
    .slice(0, limit);
}
export function CommandPalette({
  onSelect,
  isBusy,
}: {
  onSelect: (target: CommandTarget) => void;
  isBusy: () => boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [blocked, setBlocked] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const composing = useRef(false);
  const show = () => {
    previousFocus.current = document.activeElement as HTMLElement;
    setQuery("");
    setLimit(30);
    setBlocked(isBusy());
    setOpen(true);
  };
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        showRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const providers = useQueries({
    queries: APP_IDS.map((app) => ({
      ...providersQueryOptions(app),
      enabled: open,
    })),
  });
  const catalogs = useQueries({
    queries: PROXY_APP_IDS.map((app) => ({
      queryKey: ["model-picker", app],
      queryFn: () => modelHubApi.catalog(app),
      enabled: open,
    })),
  });
  const sessions = useQuery({
    queryKey: ["command-session-titles"],
    queryFn: () => sessionsApi.list(),
    enabled: open,
    staleTime: 30000,
  });
  const nodes = useQuery({
    queryKey: ["command-node-names"],
    queryFn: () =>
      networkApi<{ proxies: Record<string, unknown> }>("controller", {
        method: "GET",
        path: "/proxies",
      }),
    enabled: open,
    retry: false,
    staleTime: 5000,
  });
  // Explicit projection: never serialize provider settings, session summaries, source paths or transcripts into the index.
  const entries = useMemo(() => {
    const list: CommandEntry[] = APP_IDS.map((app) => ({
      id: `app:${app}`,
      group: tr("客户端", "Clients"),
      label: getAppLabel(app),
      keywords: `${app} 客户端 client`,
      target: { kind: "app", app },
    }));
    for (const [page, cn, en] of [
      ["overview", "概览", "Overview"],
      ["modelPicker", "模型选择", "Models"],
      ["apps", "安装与管理", "Install and manage"],
      ["network", "网络", "Network"],
      ["sessions", "会话", "Sessions"],
      ["auth", "授权中心", "Authorization"],
      ["settings", "设置", "Settings"],
    ] as const)
      list.push({
        id: `page:${page}`,
        group: tr("导航", "Navigation"),
        label: tr(cn, en),
        keywords: `${cn} ${en}`,
        target: { kind: "page", page },
      });
    providers.forEach((q, i) =>
      Object.values(q.data?.providers ?? {}).forEach((p) =>
        list.push({
          id: `provider:${APP_IDS[i]}:${p.id}`,
          group: tr("供应商", "Providers"),
          label: `${getAppLabel(APP_IDS[i])} · ${p.name.slice(0, 160)}`,
          keywords: "供应商 provider",
          target: { kind: "app", app: APP_IDS[i] },
        }),
      ),
    );
    catalogs.forEach((q, i) =>
      q.data?.providers.forEach((p) =>
        p.models.forEach((model) =>
          list.push({
            id: `model:${PROXY_APP_IDS[i]}:${p.id}:${model}`,
            group: tr("模型", "Models"),
            label: `${p.name.slice(0, 80)} · ${model.slice(0, 160)}`,
            keywords: `${PROXY_APP_IDS[i]} 模型 model`,
            target: {
              kind: "model",
              app: PROXY_APP_IDS[i],
              providerId: p.id,
              model,
            },
          }),
        ),
      ),
    );
    Object.keys(nodes.data?.proxies ?? {}).forEach((name) =>
      list.push({
        id: `node:${name}`,
        group: tr("节点", "Nodes"),
        label: name.slice(0, 160),
        keywords: "节点 node",
        target: { kind: "node", name },
      }),
    );
    [...(sessions.data ?? [])]
      .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))
      .slice(0, 100)
      .forEach((s) => {
        if (s.title)
          list.push({
            id: `session:${s.providerId}:${s.sessionId}`,
            group: tr("最近会话", "Recent sessions"),
            label: s.title.slice(0, 160),
            keywords: `${s.providerId} 会话 session`,
            target: {
              kind: "session",
              providerId: s.providerId,
              sessionId: s.sessionId,
            },
          });
      });
    return list;
  }, [providers, catalogs, sessions.data, nodes.data, zh]);
  const matches = searchCommands(entries, query, Number.MAX_SAFE_INTEGER);
  const groups = [...new Set(matches.map((e) => e.group))];
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={show}
        aria-label={tr("搜索命令 ⌘K", "Search commands ⌘K")}
      >
        ⌘K
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl"
          zIndex="top"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            previousFocus.current?.isConnected && previousFocus.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{tr("搜索与导航", "Search and navigate")}</DialogTitle>
            <DialogDescription>
              {tr(
                "选择结果打开原管理入口，配置切换仍需确认。",
                "Results open existing management flows; configuration changes still require confirmation.",
              )}
            </DialogDescription>
          </DialogHeader>
          <Command
            label={tr("搜索命令", "Search commands")}
            shouldFilter={false}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDownCapture={(e) => {
              if (
                (composing.current ||
                  e.nativeEvent.isComposing ||
                  e.keyCode === 229) &&
                ["Enter", "Escape", "ArrowUp", "ArrowDown"].includes(e.key)
              ) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <CommandInput
              aria-label={tr("搜索命令", "Search commands")}
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                setLimit(30);
                setBlocked(isBusy());
              }}
            />
            {blocked && (
              <p role="status" className="px-3 text-sm">
                {tr(
                  "配置写入中，请完成后再导航。",
                  "Configuration is being saved; finish before navigating.",
                )}
              </p>
            )}
            {(providers.some((p) => p.isError || p.data?.readError) ||
              catalogs.some((p) => p.isError) ||
              nodes.isError ||
              sessions.isError) && (
              <p className="px-3 text-xs text-muted-foreground">
                {tr(
                  "部分目录暂不可用；已加载结果仍可使用。",
                  "Some catalogs are unavailable; loaded results remain available.",
                )}
              </p>
            )}
            <CommandList className="max-h-[55vh]">
              <CommandEmpty>
                {tr("没有匹配结果", "No matching results")}
              </CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group} heading={group}>
                  {matches
                    .filter((e) => e.group === group)
                    .slice(0, limit)
                    .map((entry) => (
                      <CommandItem
                        key={entry.id}
                        value={entry.id}
                        disabled={blocked}
                        onSelect={() => {
                          if (composing.current) return;
                          if (isBusy()) {
                            setBlocked(true);
                            return;
                          }
                          setOpen(false);
                          onSelect(entry.target);
                        }}
                      >
                        {entry.label}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
              {groups.some(
                (group) =>
                  matches.filter((e) => e.group === group).length > limit,
              ) && (
                <CommandItem
                  value="load-more"
                  onSelect={() => setLimit((n) => n + 30)}
                >
                  {tr("显示更多结果", "Show more results")}
                </CommandItem>
              )}
            </CommandList>
          </Command>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tr("关闭", "Close")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
