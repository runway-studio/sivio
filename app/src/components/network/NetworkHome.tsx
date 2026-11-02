import type { AppId } from "@/lib/api";
import { coreStatusLabel } from "@/lib/workspaceReadiness";
import { WorkspaceReadiness } from "@/components/overview/WorkspaceReadiness";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  ArrowUpRight,
  Check,
  CloudDownload,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Layers,
  Monitor,
  RefreshCw,
  Settings2,
  Shield,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePendingMutation } from "@/lib/unsavedChanges";
import type { NetworkTab } from "@/lib/navigation";
import type { NetworkSnapshot, Settings } from "./networkTypes";
import type { ProxyInfo } from "./proxyNodes";
import { networkApi as api } from "./networkApi";
import { NetworkRuntimeContext } from "./NetworkRuntime";
import { NetworkTrafficPanel } from "./NetworkTrafficPanel";

import "./network-layout.css";

const cards = [
  "profile",
  "proxy",
  "network",
  "mode",
  "traffic",
  "tests",
  "ip",
  "core",
  "system",
] as const;
type CardId = (typeof cards)[number];
const storageKey = "sivio.network.home.cards.v1";
export function subscriptionUsage(header?: string) {
  const fields: Record<string, number> = {};
  for (const part of header?.split(";") ?? []) {
    const [key, raw] = part.trim().split("=");
    const value = Number(raw);
    if (raw?.trim() && Number.isFinite(value) && value >= 0)
      fields[key] = value;
  }
  return {
    used:
      fields.upload !== undefined && fields.download !== undefined
        ? fields.upload + fields.download
        : undefined,
    total: fields.total,
    expire: fields.expire,
  };
}
function bytes(value?: number) {
  if (value === undefined) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function Card({
  title,
  icon: Icon,
  action,
  children,
  wide = false,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={`network-home-card min-w-0 ${wide ? "col-span-full" : ""}`}
    >
      <div className="flex min-h-14 items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2.5 text-sm font-semibold">
          <span className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon size={17} />
          </span>
          {title}
        </h2>
        {action}
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right tabular-nums">
        {children}
      </span>
    </div>
  );
}
const selectClass =
  "h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50";

type ProbeResult = {
  httpStatus: number;
  elapsedMs: number;
  successfulHttpResponse: boolean;
};
function Connectivity({
  running,
  generation,
  tests,
  onConfigure,
}: {
  running: boolean;
  generation: number;
  tests: Settings["customTests"];
  onConfigure: () => void;
}) {
  const { i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const targets = [
    ...["Apple", "GitHub", "Google", "YouTube"].map((name) => ({
      id: name.toLowerCase(),
      name,
      custom: false,
    })),
    ...(tests ?? []).map((test) => ({ ...test, custom: true })),
  ];
  const [results, setResults] = useState<Record<string, ProbeResult | string>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const lock = useRef(false);
  useEffect(() => {
    epoch.current++;
    lock.current = false;
    setResults({});
    setBusy(false);
    return () => {
      epoch.current++;
    };
  }, [generation, running]);
  async function test(selected: typeof targets) {
    if (lock.current || !running) return;
    lock.current = true;
    setBusy(true);
    const request = epoch.current;
    const queue = [...selected];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && request === epoch.current) {
          const item = queue.shift()!;
          const key = `${item.custom ? "custom" : "builtin"}:${item.id}`;
          setResults((old) => ({ ...old, [key]: tr("检测中…", "Testing…") }));
          let value: ProbeResult | string;
          try {
            value = await api<ProbeResult>(
              item.custom ? "probe.custom" : "home.probe",
              { id: item.id, generation },
            );
          } catch (error) {
            value = error instanceof Error ? error.message : String(error);
          }
          if (request === epoch.current)
            setResults((old) => ({ ...old, [key]: value }));
        }
      }),
    );
    if (request === epoch.current) {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Card
      title={tr("连通性检测", "Connectivity tests")}
      icon={Wifi}
      action={
        <Button
          size="sm"
          variant="ghost"
          disabled={!running || busy}
          onClick={() => void test(targets)}
        >
          {busy ? tr("检测中…", "Testing…") : tr("检测全部", "Test all")}
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {targets.map((item) => {
          const key = `${item.custom ? "custom" : "builtin"}:${item.id}`;
          const result = results[key];
          return (
            <button
              key={key}
              disabled={!running || busy}
              onClick={() => void test([item])}
              className="min-w-0 rounded-xl border bg-background p-3 text-left transition-colors hover:border-primary/50 disabled:opacity-60"
            >
              <span className="block truncate text-sm font-medium">
                {item.name}
              </span>
              <span
                className={`mt-1 block break-words text-xs ${typeof result === "object" ? (result.successfulHttpResponse ? "text-emerald-600" : "text-destructive") : "text-muted-foreground"}`}
              >
                {typeof result === "object"
                  ? `${result.elapsedMs} ms · HTTP ${result.httpStatus}`
                  : (result ?? tr("点击检测", "Click to test"))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {tr(
            "通过 Sivio 当前网络检测，不代表账号或模型可用。",
            "Tests use Sivio's network; results do not verify account or model access.",
          )}
        </p>
        <Button size="sm" variant="ghost" onClick={onConfigure}>
          {tr("自定义", "Customize")}
        </Button>
      </div>
    </Card>
  );
}

export function NetworkHome({
  onManageProviders,
  snapshot,
  onNavigate,
}: {
  onManageProviders?: (app: AppId) => void;
  snapshot: NetworkSnapshot;
  onNavigate: (tab: NetworkTab) => void;
}) {
  const { i18n } = useTranslation();
  const tr = (cn: string, en: string) =>
    i18n.language.startsWith("zh") ? cn : en;
  const titles: Record<CardId, string> = {
    profile: tr("当前订阅", "Current subscription"),
    proxy: tr("当前节点", "Current proxy"),
    network: tr("网络设置", "Network settings"),
    mode: tr("代理模式", "Proxy mode"),
    traffic: tr("实时流量", "Live traffic"),
    tests: tr("连通性检测", "Connectivity tests"),
    ip: tr("出口 IP 信息", "Outbound IP"),
    core: tr("内核信息", "Core information"),
    system: tr("系统信息", "System information"),
  };
  const [shown, setShown] = useState<CardId[]>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "null",
      );
      return Array.isArray(value)
        ? cards.filter((id) => value.includes(id))
        : [...cards];
    } catch {
      return [...cards];
    }
  });
  const [customize, setCustomize] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const [group, setGroup] = useState("");
  const client = useQueryClient();
  const running = snapshot.runtime.phase === "running";
  const generation = snapshot.runtime.generation;
  const settings = snapshot.catalog.settings;
  const active = snapshot.catalog.profiles.find(
    (p) => p.id === snapshot.catalog.active,
  );
  const usage = subscriptionUsage(active?.usage);
  const busyPhase = !["running", "stopped", "failed"].includes(
    snapshot.runtime.phase,
  );
  const mutation = useMutation({
    mutationFn: (work: () => Promise<unknown>) => work(),
    onSettled: () => client.invalidateQueries({ queryKey: ["network"] }),
  });
  usePendingMutation(mutation.isPending);
  const runtimeContext = useContext(NetworkRuntimeContext);
  const busy =
    mutation.isPending || busyPhase || !!runtimeContext?.lifecycle.isPending;
  const mutate = (work: () => Promise<unknown>) => {
    if (!busy) mutation.mutate(work);
  };
  const save = (patch: Partial<Settings>) =>
    mutate(() =>
      api("settings.save", {
        settings: { ...settings, ...patch },
        baseRevision: snapshot.settingsRevision,
      }),
    );
  const toggleNetwork = (key: "systemProxy" | "tun", enabled: boolean) => {
    if (
      key === "systemProxy" &&
      enabled &&
      running &&
      snapshot.runtime.managed &&
      settings.systemProxy &&
      snapshot.runtime.proxyGuardTripped
    ) {
      mutate(() => api("proxy.reapply", { expectedGeneration: generation }));
      return;
    }
    mutate(() =>
      api("settings.save", {
        settings: { ...settings, [key]: enabled },
        baseRevision: snapshot.settingsRevision,
        ...(enabled && (!running || settings[key])
          ? { startIfStopped: true }
          : {}),
        ...(key === "systemProxy" && enabled && !snapshot.runtime.managed
          ? { takeOverProxy: true }
          : {}),
      }),
    );
  };
  const control = <T,>(path: string) =>
    api<T>("controller", {
      method: "GET",
      path,
      expectedGeneration: generation,
    });
  const proxies = useQuery({
    queryKey: ["network", "home", "proxies", generation],
    queryFn: () => control<{ proxies: Record<string, ProxyInfo> }>("/proxies"),
    enabled: running && shown.includes("proxy"),
    retry: false,
    refetchInterval: running ? 10000 : false,
  });
  const version = useQuery({
    queryKey: ["network", "home", "version", generation],
    queryFn: () => control<{ version: string }>("/version"),
    enabled: running && shown.includes("core"),
    retry: false,
    staleTime: 60000,
  });
  const rules = useQuery({
    queryKey: ["network", "home", "rules", generation],
    queryFn: () => control<{ rules: unknown[] }>("/rules"),
    enabled: running && shown.includes("core"),
    retry: false,
    staleTime: 60000,
  });
  const system = useQuery({
    queryKey: ["network", "home", "system"],
    queryFn: () =>
      api<{ appVersion: string; arch: string; os: string }>("diagnostics"),
    enabled: shown.includes("system"),
    retry: false,
    staleTime: 60000,
  });
  const autoLaunch = useQuery({
    queryKey: ["auto-launch"],
    queryFn: () => invoke<boolean>("get_auto_launch_status"),
    enabled: shown.includes("system"),
    retry: false,
  });
  const ip = useQuery({
    queryKey: ["network", "home", "ip", generation],
    queryFn: () =>
      api<{
        ip: string;
        country?: string;
        city?: string;
        region?: string;
        asn?: number;
        organization?: string;
      }>("home.probe", { id: "ip", generation }),
    enabled: running && shown.includes("ip"),
    retry: false,
    staleTime: 60000,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const proxyMap =
    running && !proxies.isError ? (proxies.data?.proxies ?? {}) : {};
  const groups = Object.entries(proxyMap).filter(
    ([name, item]) =>
      item.all?.length &&
      (settings.mode === "global" ? name === "GLOBAL" : name !== "GLOBAL"),
  );
  const selectedGroup = groups.find(([name]) => name === group) ?? groups[0];
  const node = selectedGroup?.[1].now;
  const info = node ? proxyMap[node] : undefined;
  const canSelect = ["Selector", "URLTest", "Fallback"].includes(
    selectedGroup?.[1].type ?? "",
  );
  const date = (seconds?: number) =>
    seconds && Number.isFinite(new Date(seconds * 1000).getTime())
      ? new Date(seconds * 1000).toLocaleString(i18n.language)
      : "—";
  const link = (tab: NetworkTab, label = tr("管理", "Manage")) => (
    <Button size="sm" variant="ghost" onClick={() => onNavigate(tab)}>
      {label}
      <ArrowUpRight size={13} className="ml-1" />
    </Button>
  );
  function toggle(id: CardId) {
    const next = shown.includes(id)
      ? shown.filter((item) => item !== id)
      : [...shown, id];
    setShown(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  return (
    <div className="network-home space-y-5">
      <WorkspaceReadiness
        onManageProviders={onManageProviders}
        onManageNetwork={() => onNavigate("设置")}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {tr("网络一览", "Network at a glance")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {running
              ? tr(
                  "网络运行中 · 快捷设置保存后自动应用",
                  "Network running · quick settings apply automatically",
                )
              : tr(
                  "网络已停止 · 可管理配置，启动后显示实时数据",
                  "Network stopped · manage configuration; start to see live data",
                )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={customize}
          onClick={() => setCustomize(!customize)}
        >
          <Settings2 size={14} className="mr-2" />
          {tr("首页卡片", "Home cards")}
        </Button>
      </div>
      {customize && (
        <fieldset className="flex flex-wrap gap-3 rounded-xl border bg-card p-4">
          <legend className="px-2 text-xs text-muted-foreground">
            {tr("选择显示的模块", "Choose visible modules")}
          </legend>
          {cards.map((id) => (
            <label
              key={id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={shown.includes(id)}
                onChange={() => toggle(id)}
              />
              {titles[id]}
            </label>
          ))}
        </fieldset>
      )}
      {storageError && (
        <p role="alert" className="text-sm text-destructive">
          {tr(
            "显示偏好未能保存，当前会话仍然有效",
            "Could not save preferences; changes apply to this session",
          )}
        </p>
      )}
      {mutation.error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {mutation.error.message}
        </p>
      )}
      {mutation.isPending && (
        <p role="status" className="text-sm text-primary">
          {tr("正在保存并应用…", "Saving and applying…")}
        </p>
      )}
      {!shown.length && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {tr(
            "在“首页卡片”中选择要显示的模块。",
            "Choose modules in Home cards.",
          )}
        </p>
      )}
      <div className="network-home-grid">
        {shown.includes("profile") && (
          <Card
            title={titles.profile}
            icon={CloudDownload}
            action={link("订阅")}
          >
            <select
              aria-label={tr("当前订阅", "Current subscription")}
              className={selectClass}
              value={snapshot.catalog.active ?? ""}
              disabled={busy || !snapshot.catalog.profiles.length}
              onChange={(e) => {
                const id = e.target.value;
                mutate(() =>
                  api("profile.select", {
                    id,
                    managed: settings.tun || settings.systemProxy,
                  }),
                );
              }}
            >
              <option value="" disabled>
                {tr("请选择订阅", "Choose a subscription")}
              </option>
              {snapshot.catalog.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {running && (
              <p className="text-xs text-muted-foreground">
                {tr(
                  "切换或更新订阅时自动验证并应用，失败时恢复原配置。",
                  "Switching or updating validates and applies the profile; failures restore the previous configuration.",
                )}
              </p>
            )}
            {active ? (
              <>
                <Field label={tr("更新时间", "Updated")}>
                  {date(active.updated)}
                </Field>
                <Field label={tr("已用 / 总量", "Used / Total")}>
                  {bytes(usage.used)} / {bytes(usage.total)}
                </Field>
                {usage.used !== undefined && !!usage.total && (
                  <div
                    role="progressbar"
                    aria-label={tr("订阅流量使用率", "Subscription usage")}
                    aria-valuenow={Math.min(
                      100,
                      Math.round((usage.used / usage.total) * 100),
                    )}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-1.5 overflow-hidden rounded-full bg-primary/10"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, (usage.used / usage.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}
                <Field label={tr("到期时间", "Expires")}>
                  {date(usage.expire)}
                </Field>
                {active.lastError && (
                  <p
                    role="alert"
                    className="break-words text-xs text-destructive"
                  >
                    {active.lastError}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || active.kind !== "remote"}
                  onClick={() =>
                    mutate(() =>
                      api("profile.update", {
                        id: active.id,
                        managed: settings.tun || settings.systemProxy,
                      }),
                    )
                  }
                >
                  <RefreshCw size={13} className="mr-2" />
                  {tr("更新订阅", "Update subscription")}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {tr(
                  "还没有订阅，前往订阅页导入。",
                  "Import a profile from Subscriptions to get started.",
                )}
              </p>
            )}
          </Card>
        )}
        {shown.includes("proxy") && (
          <Card title={titles.proxy} icon={Globe} action={link("节点")}>
            {settings.mode === "direct" ? (
              <p className="text-sm">
                {tr(
                  "直连模式：流量不经过代理节点。",
                  "Direct mode: traffic bypasses proxy nodes.",
                )}
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
                  <p className="break-words font-medium">
                    {node ?? tr("暂无节点", "No node available")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {info?.type ?? "—"}
                    {info?.udp ? " · UDP" : ""}
                    {info?.history?.at(-1)?.delay
                      ? ` · ${info.history.at(-1)!.delay} ms`
                      : ""}
                  </p>
                </div>
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>{tr("代理组", "Proxy group")}</span>
                  <select
                    className={selectClass}
                    aria-label={tr("代理组", "Proxy group")}
                    disabled={!running || !groups.length || busy}
                    value={selectedGroup?.[0] ?? ""}
                    onChange={(e) => setGroup(e.target.value)}
                  >
                    {!groups.length && <option value="">—</option>}
                    {groups.map(([name]) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5 text-xs text-muted-foreground">
                  <span>{tr("节点", "Node")}</span>
                  <select
                    className={selectClass}
                    aria-label={tr("当前节点选择", "Current node selection")}
                    disabled={!running || !canSelect || busy}
                    value={node ?? ""}
                    onChange={(e) => {
                      const name = e.target.value;
                      mutate(() =>
                        api("controller", {
                          method: "PUT",
                          path: `/proxies/${encodeURIComponent(selectedGroup![0])}`,
                          body: { name },
                          expectedGeneration: generation,
                        }),
                      );
                    }}
                  >
                    {!node && <option value="">—</option>}
                    {selectedGroup?.[1].all?.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                {selectedGroup && !canSelect && (
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "此分组由内核自动分配节点",
                      "The core assigns nodes for this group automatically",
                    )}
                  </p>
                )}
              </>
            )}
            {proxies.isError && running && (
              <p role="alert" className="text-xs text-destructive">
                {proxies.error.message}
              </p>
            )}
          </Card>
        )}
        {shown.includes("network") && (
          <Card title={titles.network} icon={Shield} action={link("设置")}>
            {(["systemProxy", "tun"] as const).map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-xl bg-background p-3"
              >
                <label htmlFor={`home-${key}`} className="text-sm font-medium">
                  {key === "tun"
                    ? tr("虚拟网卡模式 (TUN)", "Virtual adapter (TUN)")
                    : tr("系统代理", "System proxy")}
                </label>
                <Switch
                  id={`home-${key}`}
                  checked={
                    running &&
                    (key === "tun"
                      ? (snapshot.runtime.tun ?? settings.tun)
                      : settings[key]) &&
                    (key !== "systemProxy" ||
                      !snapshot.runtime.proxyGuardTripped)
                  }
                  disabled={busy || snapshot.runtime.phase === "failed"}
                  onCheckedChange={(value) => toggleNetwork(key, value)}
                />
              </div>
            ))}
            <p className="text-xs leading-5 text-muted-foreground">
              {tr(
                "开启时自动启动并应用网络；开关显示当前生效状态，失败恢复旧配置和运行状态。",
                "Enabling starts and applies the network. Switches show active state; failures restore the previous settings and runtime.",
              )}
            </p>
            {!running && (settings.systemProxy || settings.tun) && (
              <p role="status" className="text-xs text-amber-600">
                {tr(
                  "网络未运行，已保存的代理设置尚未生效。打开开关即可启动。",
                  "Network is stopped. Saved proxy settings are inactive; turn on a switch to start.",
                )}
              </p>
            )}
            {running && snapshot.runtime.proxyGuardTripped && (
              <p role="status" className="text-xs text-amber-600">
                {tr(
                  "内核已就绪，系统代理尚未接管。打开开关即可使用。",
                  "Core is ready. Turn on system proxy to route system traffic through Sivio.",
                )}
              </p>
            )}
          </Card>
        )}
        {shown.includes("mode") && (
          <Card title={titles.mode} icon={Layers}>
            <div className="flex gap-2">
              {(
                [
                  ["rule", tr("规则", "Rule")],
                  ["global", tr("全局", "Global")],
                  ["direct", tr("直连", "Direct")],
                ] as const
              ).map(([mode, title]) => (
                <Button
                  key={mode}
                  className="min-w-0 flex-1"
                  variant={settings.mode === mode ? "default" : "outline"}
                  aria-pressed={settings.mode === mode}
                  disabled={busy}
                  onClick={() => save({ mode })}
                >
                  {settings.mode === mode && (
                    <Check size={13} className="mr-1" />
                  )}
                  {title}
                </Button>
              ))}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {settings.mode === "global"
                ? tr(
                    "所有流量通过 GLOBAL 分组所选节点。",
                    "All traffic uses the selected GLOBAL proxy.",
                  )
                : settings.mode === "direct"
                  ? tr(
                      "所有流量直接连接目标地址。",
                      "All traffic connects directly to its destination.",
                    )
                  : tr(
                      "按照配置规则智能选择直连或代理。",
                      "Configuration rules choose direct or proxy connections.",
                    )}
            </p>
          </Card>
        )}
        {shown.includes("traffic") && (
          <Card
            title={titles.traffic}
            icon={Activity}
            wide
            action={link("流量", tr("详情", "Details"))}
          >
            <NetworkTrafficPanel running={running} generation={generation} />
          </Card>
        )}
        {shown.includes("tests") && (
          <Connectivity
            running={running}
            generation={generation}
            tests={settings.customTests}
            onConfigure={() => onNavigate("设置")}
          />
        )}
        {shown.includes("ip") && (
          <Card
            title={titles.ip}
            icon={Globe}
            action={
              <Button
                size="sm"
                variant="ghost"
                disabled={!running || ip.isFetching}
                onClick={() => void ip.refetch()}
              >
                <RefreshCw
                  size={14}
                  className={ip.isFetching ? "animate-spin" : ""}
                />
                <span className="ml-2">{tr("刷新", "Refresh")}</span>
              </Button>
            }
          >
            {running && ip.data && !ip.isError ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 break-all font-mono text-lg">
                    {showIp ? ip.data.ip : "••••••••"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={
                      showIp
                        ? tr("隐藏 IP", "Hide IP")
                        : tr("显示 IP", "Show IP")
                    }
                    onClick={() => setShowIp(!showIp)}
                  >
                    {showIp ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
                <Field label={tr("地区", "Region")}>
                  {[ip.data.country, ip.data.region, ip.data.city]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Field>
                <Field label="ASN">
                  {ip.data.asn ? `AS${ip.data.asn}` : "—"}
                </Field>
                <Field label={tr("运营商", "Organization")}>
                  {ip.data.organization || "—"}
                </Field>
              </>
            ) : (
              <p
                role={ip.isError && running ? "alert" : "status"}
                className="text-sm text-muted-foreground"
              >
                {!running
                  ? tr(
                      "启动网络后显示出口信息",
                      "Start the network to see outbound information",
                    )
                  : ip.isError
                    ? ip.error.message
                    : tr(
                        "正在查询出口信息…",
                        "Looking up outbound information…",
                      )}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {tr(
                "来源 Cloudflare · 通过当前规则路由的出口，仅保留本次页面查询。",
                "Source: Cloudflare · egress under current routing rules; retained only for this view.",
              )}
            </p>
          </Card>
        )}
        {shown.includes("core") && (
          <Card title={titles.core} icon={Cpu} action={link("设置")}>
            <Field label={tr("内核版本", "Core version")}>
              {running && !version.isError
                ? (version.data?.version ?? "—")
                : "—"}
            </Field>
            <Field label={tr("内核运行", "Core status")}>
              {coreStatusLabel(
                snapshot.runtime.phase,
                i18n.language.startsWith("zh"),
              )}
            </Field>
            <Field label={tr("混合代理端口", "Mixed proxy port")}>
              {running ? snapshot.runtime.port : settings.mixedPort}
            </Field>
            <Field label={tr("代理地址", "Proxy address")}>
              {settings.proxyHost || "127.0.0.1"}:
              {running ? snapshot.runtime.port : settings.mixedPort}
            </Field>
            <Field label={tr("规则数量", "Rule count")}>
              {running && !rules.isError
                ? (rules.data?.rules?.length ?? "—")
                : "—"}
            </Field>
            {running && (version.error || rules.error) && (
              <p role="alert" className="text-xs text-destructive">
                {version.error?.message ?? rules.error?.message}
              </p>
            )}
          </Card>
        )}
        {shown.includes("system") && (
          <Card title={titles.system} icon={Monitor}>
            <Field label={tr("应用版本", "App version")}>
              Sivio {system.data?.appVersion ?? "—"}
            </Field>
            <Field label={tr("系统", "System")}>
              {system.data?.os
                ?.replace(
                  /ProductName:\s*|ProductVersion:\s*|BuildVersion:\s*/g,
                  "",
                )
                .trim() ?? "—"}
            </Field>
            <Field label={tr("架构", "Architecture")}>
              {system.data?.arch ?? "—"}
            </Field>
            <Field label={tr("服务状态", "Service status")}>
              {snapshot.helperCompatible && snapshot.helperAuthorized
                ? tr("已就绪", "Ready")
                : tr("按需启用", "Activated when needed")}
            </Field>
            <div className="flex items-center justify-between gap-4">
              <label
                htmlFor="home-autolaunch"
                className="text-sm text-muted-foreground"
              >
                {tr("开机启动", "Launch at login")}
              </label>
              <Switch
                id="home-autolaunch"
                checked={autoLaunch.data === true}
                disabled={busy || !autoLaunch.isSuccess}
                onCheckedChange={(enabled) =>
                  mutate(async () => {
                    await invoke("set_auto_launch", { enabled });
                    await client.invalidateQueries({
                      queryKey: ["auto-launch"],
                    });
                  })
                }
              />
            </div>
            {(system.error || autoLaunch.error) && (
              <p role="alert" className="text-xs text-destructive">
                {system.error?.message ?? autoLaunch.error?.message}
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
