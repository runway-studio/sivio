import { useRef, useState } from "react";
import {
  Activity,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ChevronDown,
  ChevronUp,
  Globe,
  LocateFixed,
  Pin,
  PinOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspacePreferences } from "@/lib/desktopPreferences";
import { useNetworkText } from "./networkText";
import { ProxyNodeGrid } from "./ProxyNodeGrid";
import { ProxyGroupNavigator } from "./ProxyGroupNavigator";
import { useProxyDelays } from "./useProxyDelays";

import type { ProxyInfo } from "./proxyNodes";
type GroupPreference = {
  pinned?: boolean;
  collapsed?: boolean;
  sort?: "default" | "name" | "delay";
};
function readPreferences(key: string): Record<string, GroupPreference> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}
export function NetworkNodesPanel({
  proxies,
  generation,
  profile,
  probe,
  onProbeChange,
  search,
  onSearchChange,
  timeout,
  busy,
  onSelect,
  children,
}: {
  proxies: Record<string, ProxyInfo>;
  generation: number;
  profile: string;
  probe: string;
  onProbeChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  timeout: number;
  busy: boolean;
  onSelect: (group: string, node: string) => void;
  children?: React.ReactNode;
}) {
  const tr = useNetworkText();
  const preferences = useWorkspacePreferences();
  const key = `sivio-proxy-group-ui:${profile}`;
  const [saved, setSaved] = useState(() => ({
    key,
    groups: readPreferences(key),
  }));
  const [storageError, setStorageError] = useState("");
  const groups = saved.key === key ? saved.groups : readPreferences(key);
  const patch = (name: string, value: GroupPreference) => {
    const next = { ...groups, [name]: { ...groups[name], ...value } };
    setSaved({ key, groups: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(tr("显示偏好未能保存，当前会话仍然有效"));
    }
  };
  const [locating, setLocating] = useState<Record<string, number>>({});
  const refs = useRef(new Map<string, HTMLElement>());
  const delays = useProxyDelays(generation, probe, timeout);
  const matches = (value: string) =>
    value.toLowerCase().includes(search.toLowerCase());
  const allGroups = Object.entries(proxies).filter(
    (entry): entry is [string, ProxyInfo & { all: string[] }] =>
      Array.isArray(entry[1]?.all),
  );
  const visible = allGroups
    .filter(([name, group]) => matches(name) || group.all.some(matches))
    .sort(
      ([a], [b]) => Number(!!groups[b]?.pinned) - Number(!!groups[a]?.pinned),
    );
  const locate = (name: string) =>
    refs.current
      .get(name)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  return (
    <div className="network-nodes space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          className="h-8 min-w-0 flex-1 basis-40"
          aria-label={tr("搜索节点")}
          placeholder={tr("搜索节点或分组")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <Input
          className="h-8 min-w-0 flex-1 basis-48"
          aria-label={tr("测速地址")}
          value={probe}
          onChange={(e) => onProbeChange(e.target.value)}
        />
      </div>
      <ProxyGroupNavigator
        names={visible.map(([name]) => name)}
        enabled={preferences.hoverGroupNavigation}
        delay={preferences.hoverGroupDelay}
        onLocate={locate}
      />
      {(delays.error || storageError) && (
        <p role="alert" className="text-sm text-destructive">
          {tr(delays.error || storageError)}
        </p>
      )}
      {visible.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
          {tr("没有匹配的代理分组")}
        </p>
      )}
      {visible.map(([name, group]) => {
        const ui = groups[name] ?? {};
        const members = [...new Set(group.all)].filter(
          (node) =>
            typeof node === "string" && (matches(name) || matches(node)),
        );
        if (ui.sort === "name") members.sort((a, b) => a.localeCompare(b));
        if (ui.sort === "delay")
          members.sort(
            (a, b) =>
              (delays.sorted[a]?.state === "success"
                ? delays.sorted[a].delay!
                : Infinity) -
              (delays.sorted[b]?.state === "success"
                ? delays.sorted[b].delay!
                : Infinity),
          );
        const testing = delays.testing.includes(name);
        const icon =
          typeof group.icon === "string" &&
          /^https:\/\/[^/@]+(?:\/|$)/.test(group.icon)
            ? group.icon
            : null;
        const selectable = ["Selector", "URLTest", "Fallback"].includes(
          group.type ?? "Selector",
        );
        return (
          <article
            key={name}
            data-proxy-group={name}
            ref={(element) => {
              if (element) refs.current.set(name, element);
              else refs.current.delete(name);
            }}
            className="proxy-group relative"
          >
            <header
              className="proxy-group-header sticky top-0 z-10 flex flex-wrap items-center gap-2 px-2.5 py-2"
              data-testid="proxy-group-header"
            >
              <div className="flex min-w-0 basis-40 flex-1 items-center gap-2">
                {preferences.groupIcons &&
                  (icon ? (
                    <img
                      src={icon}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-5 w-5"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Globe size={18} className="shrink-0 text-primary" />
                  ))}
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{name}</h3>
                  <p className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="proxy-group-count">
                      {group.all.length} {tr("节点")}
                    </span>
                    <span className="min-w-0 truncate" title={group.now}>
                      {group.now || group.type}
                    </span>
                  </p>
                </div>
              </div>
              <div
                className={`flex shrink-0 items-center gap-1 ${preferences.groupToolsPosition === "left" ? "order-first" : ""}`}
              >
                <Button
                  variant="ghost"
                  size="icon-compact"
                  aria-label={`${tr("定位当前节点")} ${name}`}
                  title={tr("定位当前节点")}
                  onClick={() => {
                    patch(name, { collapsed: false });
                    setLocating((previous) => ({
                      ...previous,
                      [name]: (previous[name] ?? 0) + 1,
                    }));
                    locate(name);
                    refs.current
                      .get(name)
                      ?.querySelector('[aria-pressed="true"]')
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  <LocateFixed size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={testing || busy}
                  aria-label={`${tr("分组测速")} ${name}`}
                  onClick={() => void delays.test(name, group.all)}
                >
                  <Activity
                    size={15}
                    className={testing ? "animate-pulse" : ""}
                  />
                  {testing ? tr("测速中") : tr("分组测速")}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  aria-label={`${tr("排序")} ${name}`}
                  title={`${tr("排序")} · ${tr(ui.sort === "delay" ? "延迟" : ui.sort === "name" ? "名称" : "默认")}`}
                  onClick={() =>
                    patch(name, {
                      sort:
                        ui.sort === "delay"
                          ? "name"
                          : ui.sort === "name"
                            ? "default"
                            : "delay",
                    })
                  }
                >
                  {ui.sort === "name" ? (
                    <ArrowDownAZ size={15} />
                  ) : (
                    <ArrowDownWideNarrow size={15} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className={ui.pinned ? "text-primary" : ""}
                  aria-pressed={!!ui.pinned}
                  aria-label={`${tr(ui.pinned ? "取消置顶" : "置顶分组")} ${name}`}
                  onClick={() => patch(name, { pinned: !ui.pinned })}
                >
                  {ui.pinned ? <PinOff size={15} /> : <Pin size={15} />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  aria-expanded={!ui.collapsed}
                  aria-label={`${tr(ui.collapsed ? "展开分组" : "收起分组")} ${name}`}
                  onClick={() => patch(name, { collapsed: !ui.collapsed })}
                >
                  {ui.collapsed ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronUp size={15} />
                  )}
                </Button>
              </div>
            </header>
            {!ui.collapsed && (
              <div className="px-2 pb-2">
                <ProxyNodeGrid
                  nodes={members}
                  current={group.now ?? ""}
                  columns={preferences.proxyColumns}
                  busy={busy}
                  resetKey={`${ui.sort ?? "default"}:${search}`}
                  locateToken={locating[name] ?? 0}
                  selectable={selectable}
                  metadata={proxies}
                  delays={delays.results}
                  onSelect={(node) => onSelect(name, node)}
                  onTest={(node) => void delays.test(`node:${node}`, [node])}
                />
                {!selectable && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tr("此分组由内核自动分配节点")}
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}
      {children}
    </div>
  );
}
