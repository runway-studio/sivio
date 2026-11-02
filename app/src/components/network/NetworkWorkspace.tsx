import type { AppId } from "@/lib/api";
import { NETWORK_TABS, type NetworkTab } from "@/lib/navigation";
import { useViewMemory, useViewScroll } from "@/hooks/useViewMemory";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  NetworkRuntimeProvider,
  NetworkControl,
  useNetworkRuntime,
  NetworkRuntimeContext,
} from "./NetworkRuntime";
import { useContext } from "react";
import type {
  Settings,
  Profile,
  NetworkSnapshot as Snapshot,
} from "./networkTypes";
export type { Settings, NetworkSnapshot } from "./networkTypes";
import { AppPageHeader } from "@/components/shell/AppPageHeader";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FileCode2,
  Globe,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import JsonEditor from "@/components/JsonEditor";
import { toast } from "@/lib/toast";
import { NetworkNodesPanel } from "./NetworkNodesPanel";
import { networkApi as api } from "./networkApi";
import { APP_RESTART_MESSAGE, useNetworkText } from "./networkText";
import { DashboardLinks } from "./NetworkAdvancedSettings";
import { NetworkSettingsPanel } from "./NetworkSettingsPanel";
import { ProfileTools } from "./ProfileTools";
import { NetworkHome } from "./NetworkHome";
import { NetworkTrafficPanel } from "./NetworkTrafficPanel";
import {
  hasUnsavedChanges,
  usePendingMutation,
  useUnsavedValue,
} from "@/lib/unsavedChanges";

type Enhancement = Pick<
  Settings,
  "merge" | "script" | "rules" | "proxies" | "groups" | "dns"
> & { enabled: boolean; dnsMode: "inherit" | "profile" | "subscription" };
const emptyEnhancement: Enhancement = {
  enabled: false,
  dnsMode: "inherit",
  merge: "{}",
  script: "",
  rules: "prepend: []\nappend: []\ndelete: []",
  proxies: "prepend: []\nappend: []\ndelete: []",
  groups: "prepend: []\nappend: []\ndelete: []",
  dns: "{}",
};
type RequestOptions = {
  userAgent: string;
  timeoutSeconds: number;
  via: "direct" | "system-proxy" | "managed-network";
  acceptInvalidCerts: boolean;
};
const defaultRequestOptions: RequestOptions = {
  userAgent: "Sivio/0.1 Mihomo",
  timeoutSeconds: 60,
  via: "direct",
  acceptInvalidCerts: false,
};
type Payload = Record<string, any>;
const tabs = NETWORK_TABS;
type Tab = NetworkTab;
const emptyYaml = "proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n";
function JsonView({ value }: { value: unknown }) {
  return (
    <pre className="whitespace-pre-wrap break-all rounded-xl bg-muted p-4 text-xs leading-6">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
function NetworkWorkspaceContent({
  onManageProviders,
  selectedTab,
  commandSearch,
  onTabChange,
  navigationRef,
  requestLeave,
}: {
  selectedTab?: Tab;
  commandSearch?: string;
  onManageProviders?: (app: AppId) => void;
  onTabChange?: (tab: Tab) => void;
  navigationRef?: MutableRefObject<((tab: Tab) => void) | null>;
  requestLeave?: (proceed: () => void) => void;
} = {}) {
  const tr = useNetworkText();
  const client = useQueryClient();
  const [localTab, setLocalTab] = useState<Tab>("首页");
  const tab = selectedTab ?? localTab;
  const setTab = (next: Tab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  // Only persistence locks cross-domain navigation; slow read/probe operations may be left.
  usePendingMutation(persisting);
  const originalEditor = useRef<string | null>(null);
  const originalSettings = useRef<string | null>(null);
  const [search, setSearch] = useViewMemory("network-search", "");
  useEffect(() => {
    if (commandSearch !== undefined) setSearch(commandSearch);
  }, [commandSearch]);
  const [editor, setEditor] = useState<{
    id?: string;
    baseRevision?: string;
    name: string;
    kind: string;
    url: string;
    yaml: string;
    interval?: number;
    enhancement?: Enhancement;
    requestOptions?: RequestOptions;
  } | null>(null);
  const [profileTab, setProfileTab] =
    useState<
      keyof Pick<
        Enhancement,
        "merge" | "script" | "rules" | "proxies" | "groups" | "dns"
      >
    >("merge");
  function changeEnhancement(patch: Partial<Enhancement>) {
    if (editor)
      setEditor({
        ...editor,
        enhancement: { ...emptyEnhancement, ...editor.enhancement, ...patch },
      });
  }
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState("");
  const [showSubscriptionUrl, setShowSubscriptionUrl] = useState(false);
  const fetchedRequest = useRef<string | null>(null);
  const requestKey = (value: NonNullable<typeof editor>) =>
    JSON.stringify([
      value.url.trim(),
      value.requestOptions ?? defaultRequestOptions,
    ]);
  function closeEditor() {
    if (!busy && discardDraft()) setEditor(null);
  }
  function validateEditor() {
    if (!editor) return false;
    let error = "";
    if (!editor.name.trim()) error = tr("请填写配置名称");
    else if (new TextEncoder().encode(editor.name.trim()).length > 256)
      error = tr("配置名称不能超过 256 字节");
    else if (editor.kind === "remote") {
      try {
        const url = new URL(editor.url.trim());
        if (!["https:", "http:"].includes(url.protocol) || !url.hostname)
          throw new Error();
      } catch {
        error = tr("请填写有效的 HTTP 或 HTTPS 订阅地址");
      }
      const interval = editor.interval ?? 0;
      if (
        !error &&
        (!Number.isInteger(interval) ||
          (interval !== 0 && (interval < 5 || interval > 43200)))
      )
        error = tr("更新间隔须为 5–43200 分钟，或关闭自动更新");
      const timeout = (editor.requestOptions ?? defaultRequestOptions)
        .timeoutSeconds;
      if (
        !error &&
        (!Number.isInteger(timeout) || timeout < 1 || timeout > 300)
      )
        error = tr("请求超时须为 1–300 秒");
    }
    setEditorError(error || null);
    return !error;
  }
  async function fetchEditor(value: NonNullable<typeof editor>) {
    setEditorStatus(tr("正在下载并检查订阅…"));
    const next = await api("subscription.fetch", {
      url: value.url.trim(),
      requestOptions: value.requestOptions ?? defaultRequestOptions,
    });
    if (typeof next.yaml !== "string" || !next.yaml.trim())
      throw new Error(tr("订阅未返回有效配置，请检查地址后重试"));
    const updated = { ...value, url: value.url.trim(), yaml: next.yaml };
    fetchedRequest.current = requestKey(updated);
    setEditor(updated);
    return updated;
  }
  async function submitEditor(save: boolean) {
    if (!editor || busy || !validateEditor()) return;
    setBusy(true);
    setPersisting(true);
    try {
      let value = {
        ...editor,
        name: editor.name.trim(),
        url: editor.url.trim(),
      };
      if (
        value.kind === "remote" &&
        (!save || fetchedRequest.current !== requestKey(value))
      )
        value = await fetchEditor(value);
      if (save) {
        setEditorStatus(tr("正在验证并保存…"));
        await api("profile.save", value);
        setEditor(null);
        toast.success(tr("配置已验证并保存"));
        await client.invalidateQueries({ queryKey: ["network"] });
      } else setEditorStatus(tr("订阅已获取，请检查后保存"));
    } catch (error) {
      // Keep the draft and show the failure next to the action; redact the subscription URL.
      const message = error instanceof Error ? error.message : String(error);
      const redacted = editor.url
        ? message.split(editor.url).join(tr("订阅地址"))
        : message;
      setEditorError(
        redacted.replace(/https?:\/\/[^\s<>"']+/g, tr("订阅地址")),
      );
      setEditorStatus("");
    } finally {
      setBusy(false);
      setPersisting(false);
    }
  }
  const [preview, setPreview] = useState<string | null>(null);
  const [rulesEditor, setRulesEditor] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsRevision, setSettingsRevision] = useState("");
  const editorDirty =
    !!editor && JSON.stringify(editor) !== originalEditor.current;
  const settingsDirty =
    !!settings && JSON.stringify(settings) !== originalSettings.current;
  useUnsavedValue(editorDirty || settingsDirty);
  const discardDraft = () =>
    !hasUnsavedChanges() ||
    window.confirm(tr("有尚未保存的网络配置，确定放弃修改吗？"));
  function beginEdit(value: NonNullable<typeof editor>, imported = false) {
    originalEditor.current = imported ? null : JSON.stringify(value);
    setEditor(value);
    setEditorError(null);
    setEditorStatus("");
    setShowSubscriptionUrl(false);
    setPreview(null);
    fetchedRequest.current =
      value.id && value.kind === "remote" ? requestKey(value) : null;
  }
  const [probe, setProbe] = useState("https://www.gstatic.com/generate_204");
  const [dnsName, setDnsName] = useState("example.com");
  const [result, setResult] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);
  const { snapshot, inShell, lifecycle } = useNetworkRuntime();
  const running = snapshot.data?.runtime.phase === "running";
  useEffect(() => {
    if (snapshot.data?.catalog.settings.latencyUrl)
      setProbe(snapshot.data.catalog.settings.latencyUrl);
  }, [snapshot.data?.catalog.settings.latencyUrl]);
  const detail = useQuery({
    queryKey: ["network", "detail", tab, snapshot.data?.runtime.generation],
    enabled: !!running && ["节点", "规则", "连接", "日志"].includes(tab),
    queryFn: () =>
      tab === "日志"
        ? api("logs")
        : api("controller", {
            method: "GET",
            path:
              tab === "节点"
                ? "/proxies"
                : tab === "规则"
                  ? "/rules"
                  : "/connections",
          }),
    refetchInterval: tab === "连接" || tab === "日志" ? 2000 : 10000,
  });
  const providers = useQuery({
    queryKey: ["network", "providers", snapshot.data?.runtime.generation],
    enabled: !!running && tab === "节点",
    queryFn: () =>
      api("controller", { method: "GET", path: "/providers/proxies" }),
  });
  async function run(work: () => Promise<unknown>, success?: string) {
    if (lifecycle.isError) lifecycle.reset();
    setBusy(true);
    setOperationError(null);
    try {
      const value = await work();
      if (success) toast.success(success);
      await client.invalidateQueries({ queryKey: ["network"] });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOperationError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  async function loadSettings() {
    const latest = await api<Snapshot>("snapshot");
    originalSettings.current = JSON.stringify(latest.catalog.settings);
    setSettings({ ...latest.catalog.settings });
    setSettingsRevision(latest.settingsRevision);
  }
  useEffect(() => {
    if (tab === "设置" && !settings) {
      void run(loadSettings);
    }
  }, [tab, snapshot.data]);
  async function edit(profile: Profile) {
    if (!discardDraft()) return;
    await run(async () => {
      const value = await api("profile.read", { id: profile.id });
      beginEdit({
        id: profile.id,
        baseRevision: profile.revision,
        name: profile.name,
        kind: profile.kind,
        url: value.url,
        yaml: value.yaml,
        interval: profile.interval,
        enhancement: value.enhancement ?? { ...emptyEnhancement },
        requestOptions: { ...defaultRequestOptions, ...value.requestOptions },
      });
      setPreview(null);
    });
  }
  function navigateTab(next: Tab) {
    if (busy || next === tab) return;
    const proceed = () => {
      setEditor(null);
      setRulesEditor(false);
      setSettings(null);
      setTab(next);
      setResult(null);
    };
    if (requestLeave) requestLeave(proceed);
    else if (discardDraft()) proceed();
  }
  useEffect(() => {
    if (navigationRef) navigationRef.current = navigateTab;
    return () => {
      if (navigationRef) navigationRef.current = null;
    };
  });
  useViewScroll(scrollRef, `network:${tab}`, snapshot.data);
  const data = snapshot.data;
  const profiles = data?.catalog.profiles ?? [];
  const matches = (text: string) =>
    text.toLowerCase().includes(search.toLowerCase());
  const action = (method: string, path: string, body?: unknown) =>
    run(() =>
      api("controller", {
        method,
        path,
        expectedGeneration: data?.runtime.generation,
        ...(body === undefined ? {} : { body }),
      }),
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppPageHeader
        icon={<Globe size={20} />}
        title={
          selectedTab ? tr(tab === "设置" ? "网络设置" : tab) : tr("网络工作区")
        }
        actions={!inShell ? <NetworkControl inline /> : undefined}
      />
      {!onTabChange && (
        <nav aria-label={tr("网络导航")} className="flex gap-6 border-b px-6">
          {tabs.map((item) => (
            <button
              key={item}
              aria-current={tab === item ? "page" : undefined}
              className={`border-b-2 py-3 text-sm ${tab === item ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"}`}
              onClick={() => navigateTab(item)}
            >
              {tr(item)}
            </button>
          ))}
        </nav>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div className={tab === "节点" ? "px-4 py-3" : "p-6"}>
          {operationError && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {operationError}
            </p>
          )}
          {data?.appRestartRequired && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
            >
              {tr(APP_RESTART_MESSAGE)}
            </p>
          )}
          {data &&
            !data.appRestartRequired &&
            /服务|helper|signature/i.test(
              operationError || data.runtime.error || "",
            ) &&
            (data.catalog.settings.systemProxy || data.catalog.settings.tun) &&
            (!data.helperAuthorized || !data.helperCompatible) && (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
              >
                <p>
                  {tr(
                    data.helperCompatible
                      ? "当前 App 尚未登记到 Sivio 服务，请先完成系统授权。"
                      : "系统代理与 TUN 需要兼容的 Sivio 服务，请先安装或修复。",
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api("helper.install"),
                      tr("服务已安装并登记当前应用"),
                    )
                  }
                >
                  {tr("安装 / 修复服务")}
                </Button>
              </div>
            )}
          {running &&
            data?.catalog.settings.systemProxy &&
            data?.runtime.proxyGuardTripped && (
              <div role="status" className="mb-4 rounded-xl border p-4 text-sm">
                <p>{tr("Sivio 内核已就绪，当前没有接管系统代理。")}</p>
                <p className="mt-1 text-muted-foreground">
                  {tr("开启系统代理后，浏览器等应用会使用 Sivio 网络。")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        data.runtime.managed
                          ? api("proxy.reapply", {
                              expectedGeneration: data.runtime.generation,
                            })
                          : api("settings.save", {
                              settings: data.catalog.settings,
                              baseRevision: data.settingsRevision,
                              startIfStopped: true,
                              takeOverProxy: true,
                            }),
                      tr("系统代理已应用到 Sivio"),
                    )
                  }
                >
                  {tr("重新应用系统代理")}
                </Button>
              </div>
            )}
          {(snapshot.error ||
            data?.runtime.error ||
            (running && detail.error)) && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {snapshot.error?.message ||
                data?.runtime.error ||
                (running && detail.error?.message)}
            </div>
          )}
          {!data && (
            <p
              role="status"
              className="rounded-xl border p-5 text-sm text-muted-foreground"
            >
              {tr("正在加载网络配置；其他工作区仍可使用")}
            </p>
          )}
          {data && (
            <>
              {tab === "首页" && (
                <NetworkHome
                  snapshot={data}
                  onNavigate={navigateTab}
                  onManageProviders={onManageProviders}
                />
              )}
              <div hidden={tab !== "流量"}>
                <NetworkTrafficPanel
                  active={tab === "流量"}
                  running={!!running}
                  generation={data?.runtime.generation ?? 0}
                />
              </div>
              {tab === "订阅" && (
                <div className="space-y-5">
                  <div className="flex justify-between gap-4">
                    <div>
                      <h2 className="font-medium">{tr("我的配置")}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {tr("配置正文和订阅地址保存在本机私有配置中")}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (discardDraft()) file.current?.click();
                        }}
                      >
                        <Upload size={14} />
                        {tr("导入 YAML")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          if (!discardDraft()) return;
                          beginEdit({
                            name: "",
                            kind: "remote",
                            interval: 1440,
                            url: "",
                            yaml: emptyYaml,
                          });
                          setPreview(null);
                        }}
                      >
                        <Plus size={14} />
                        {tr("添加订阅")}
                      </Button>
                    </div>
                  </div>
                  <input
                    ref={file}
                    type="file"
                    accept=".yaml,.yml,.txt"
                    hidden
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      if (selected) {
                        if (selected.size > 16 * 1024 * 1024) {
                          toast.error(tr("文件超过 16 MiB"));
                          return;
                        }
                        void run(async () => {
                          const yaml = await selected.text();
                          beginEdit(
                            {
                              name: selected.name,
                              kind: "local",
                              url: "",
                              yaml,
                            },
                            true,
                          );
                        });
                      }
                      event.target.value = "";
                    }}
                  />
                  {!profiles.length && !editor && (
                    <Empty>
                      {tr("添加订阅地址，或导入本地 Mihomo YAML 配置开始使用")}
                    </Empty>
                  )}
                  <div className="grid gap-3 xl:grid-cols-2">
                    {profiles.map((profile) => (
                      <article
                        key={profile.id}
                        className={`rounded-xl border p-4 ${data?.catalog.active === profile.id ? "border-primary/40 bg-primary/5" : "bg-card"}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <FileCode2 className="text-primary" size={20} />
                            <div>
                              <h3 className="text-sm font-medium">
                                {profile.name}
                              </h3>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {profile.kind === "remote"
                                  ? tr("远程订阅")
                                  : tr("本地配置")}{" "}
                                ·{" "}
                                {new Date(
                                  profile.updated * 1000,
                                ).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {data?.catalog.active === profile.id && (
                              <Check size={16} className="text-primary" />
                            )}
                            <ProfileTools
                              profile={profile}
                              snapshot={data}
                              disabled={busy}
                              onEditInfo={() => void edit(profile)}
                              onDelete={() => {
                                if (
                                  window.confirm(
                                    tr("删除配置“{name}”？").replace(
                                      "{name}",
                                      profile.name,
                                    ),
                                  )
                                )
                                  void run(
                                    () =>
                                      api("profile.delete", {
                                        id: profile.id,
                                        baseRevision: profile.revision,
                                      }),
                                    tr("已删除"),
                                  );
                              }}
                            />
                          </div>
                        </div>
                        {profile.interval > 0 && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {tr("每")}
                            {profile.interval} {tr("分钟自动更新")}
                          </p>
                        )}
                        {profile.usage && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {profile.usage}
                          </p>
                        )}
                        {profile.lastError && (
                          <p
                            role="alert"
                            className="mt-2 text-xs text-destructive"
                          >
                            {profile.lastError}
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              busy || data?.catalog.active === profile.id
                            }
                            onClick={() =>
                              void run(
                                () => api("profile.select", { id: profile.id }),
                                tr("已选择配置"),
                              )
                            }
                          >
                            {tr("使用")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void edit(profile)}
                          >
                            {tr("编辑")}
                          </Button>
                          {profile.kind === "remote" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api("profile.update", { id: profile.id }),
                                  tr("订阅已更新"),
                                )
                              }
                            >
                              <RefreshCw size={13} />
                              {tr("更新")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || profiles[0]?.id === profile.id}
                            onClick={() =>
                              void run(() => {
                                const ids = profiles.map((p) => p.id);
                                const i = ids.indexOf(profile.id);
                                [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                                return api("profile.reorder", { ids });
                              })
                            }
                          >
                            {tr("上移")}
                          </Button>
                          <Button
                            aria-label={`${tr("删除")} ${profile.name}`}
                            size="sm"
                            variant="ghost"
                            disabled={
                              busy || data?.runtime.active === profile.id
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  tr("删除配置“{name}”？").replace(
                                    "{name}",
                                    profile.name,
                                  ),
                                )
                              )
                                void run(
                                  () =>
                                    api("profile.delete", {
                                      id: profile.id,
                                      baseRevision: profile.revision,
                                    }),
                                  tr("已删除"),
                                );
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                  <ProfileTools snapshot={data} disabled={busy} />
                  {editor && (
                    <Dialog
                      open
                      onOpenChange={(open) => {
                        if (!open) closeEditor();
                      }}
                    >
                      <DialogContent
                        className="max-w-[620px] w-[calc(100%_-_32px)] overflow-hidden"
                        onEscapeKeyDown={(event) => {
                          event.preventDefault();
                          closeEditor();
                        }}
                      >
                        <DialogHeader className="border-b pr-14">
                          <DialogTitle>
                            {editor.id ? tr("编辑配置") : tr("添加订阅")}
                          </DialogTitle>
                          <DialogDescription>
                            {tr(
                              "填写订阅地址即可下载并保存，也可切换为本地配置。",
                            )}
                          </DialogDescription>
                          <Button
                            className="absolute right-4 top-4"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={tr("关闭编辑器")}
                            onClick={closeEditor}
                          >
                            <X size={16} />
                          </Button>
                        </DialogHeader>
                        <div className="min-h-0 overflow-y-auto px-6 py-5">
                          <fieldset disabled={busy} className="space-y-5">
                            <label className="block space-y-2 text-sm font-medium">
                              {tr("配置来源")}
                              <select
                                aria-label={tr("配置来源")}
                                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                                value={editor.kind}
                                onChange={(e) => {
                                  setEditor({
                                    ...editor,
                                    kind: e.target.value,
                                  });
                                  setEditorError(null);
                                  setEditorStatus("");
                                }}
                              >
                                <option value="remote">{tr("远程订阅")}</option>
                                <option value="local">{tr("本地配置")}</option>
                              </select>
                            </label>
                            <label className="block space-y-2 text-sm font-medium">
                              {tr("配置名称")}
                              <Input
                                aria-label={tr("配置名称")}
                                placeholder={tr("例如：日常网络")}
                                autoComplete="off"
                                value={editor.name}
                                onChange={(e) =>
                                  setEditor({ ...editor, name: e.target.value })
                                }
                              />
                            </label>
                            {editor.kind === "remote" && (
                              <>
                                <div className="space-y-2">
                                  <label
                                    htmlFor="subscription-url"
                                    className="text-sm font-medium"
                                  >
                                    {tr("订阅地址")}
                                  </label>
                                  <div className="relative">
                                    <Input
                                      id="subscription-url"
                                      aria-label={tr("订阅地址")}
                                      className="pr-10"
                                      type={
                                        showSubscriptionUrl
                                          ? "text"
                                          : "password"
                                      }
                                      autoComplete="off"
                                      spellCheck={false}
                                      placeholder="https://…"
                                      value={editor.url}
                                      onChange={(e) => {
                                        setEditor({
                                          ...editor,
                                          url: e.target.value,
                                        });
                                        setEditorStatus("");
                                      }}
                                    />
                                    <Button
                                      className="absolute right-0 top-0"
                                      variant="ghost"
                                      size="icon"
                                      aria-label={tr(
                                        showSubscriptionUrl
                                          ? "隐藏订阅地址"
                                          : "显示订阅地址",
                                      )}
                                      onClick={() =>
                                        setShowSubscriptionUrl(
                                          !showSubscriptionUrl,
                                        )
                                      }
                                    >
                                      {showSubscriptionUrl ? (
                                        <EyeOff size={16} />
                                      ) : (
                                        <Eye size={16} />
                                      )}
                                    </Button>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {tr(
                                      "订阅地址可能包含凭据，默认隐藏并保存在本机私有配置中。",
                                    )}
                                  </p>
                                </div>
                                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <label
                                      htmlFor="subscription-auto-update"
                                      className="text-sm font-medium"
                                    >
                                      {tr("允许自动更新")}
                                    </label>
                                    <Switch
                                      id="subscription-auto-update"
                                      checked={(editor.interval ?? 0) > 0}
                                      onCheckedChange={(enabled) =>
                                        setEditor({
                                          ...editor,
                                          interval: enabled ? 1440 : 0,
                                        })
                                      }
                                    />
                                  </div>
                                  {(editor.interval ?? 0) > 0 && (
                                    <label className="flex items-center justify-between gap-3 text-sm">
                                      {tr("更新间隔")}
                                      <span className="flex items-center gap-2">
                                        <Input
                                          className="w-28"
                                          aria-label={tr("自动更新间隔")}
                                          type="number"
                                          min={5}
                                          max={43200}
                                          value={editor.interval}
                                          onChange={(e) =>
                                            setEditor({
                                              ...editor,
                                              interval: Number(e.target.value),
                                            })
                                          }
                                        />
                                        <span className="text-muted-foreground">
                                          {tr("分钟")}
                                        </span>
                                      </span>
                                    </label>
                                  )}
                                </div>
                              </>
                            )}
                            {editor.kind === "remote" && (
                              <details className="rounded-lg border p-3 text-sm">
                                <summary className="cursor-pointer">
                                  {tr("订阅下载选项")}
                                </summary>
                                <div className="mt-3 grid gap-3 md:grid-cols-2">
                                  <label className="space-y-1 text-xs">
                                    User-Agent
                                    <Input
                                      aria-label={tr("订阅 User-Agent")}
                                      value={
                                        (
                                          editor.requestOptions ??
                                          defaultRequestOptions
                                        ).userAgent
                                      }
                                      onChange={(e) =>
                                        setEditor({
                                          ...editor,
                                          requestOptions: {
                                            ...defaultRequestOptions,
                                            ...editor.requestOptions,
                                            userAgent: e.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="space-y-1 text-xs">
                                    {tr("请求超时（秒）")}
                                    <Input
                                      aria-label={tr("订阅请求超时")}
                                      type="number"
                                      min={1}
                                      max={300}
                                      value={
                                        (
                                          editor.requestOptions ??
                                          defaultRequestOptions
                                        ).timeoutSeconds
                                      }
                                      onChange={(e) =>
                                        setEditor({
                                          ...editor,
                                          requestOptions: {
                                            ...defaultRequestOptions,
                                            ...editor.requestOptions,
                                            timeoutSeconds: Number(
                                              e.target.value,
                                            ),
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                  <label className="space-y-1 text-xs">
                                    {tr("下载出口")}
                                    <select
                                      aria-label={tr("订阅下载出口")}
                                      className="block w-full rounded border bg-background p-2"
                                      value={
                                        (
                                          editor.requestOptions ??
                                          defaultRequestOptions
                                        ).via
                                      }
                                      onChange={(e) =>
                                        setEditor({
                                          ...editor,
                                          requestOptions: {
                                            ...defaultRequestOptions,
                                            ...editor.requestOptions,
                                            via: e.target
                                              .value as RequestOptions["via"],
                                          },
                                        })
                                      }
                                    >
                                      <option value="direct">
                                        {tr("直连")}
                                      </option>
                                      <option value="system-proxy">
                                        {tr("当前系统代理")}
                                      </option>
                                      <option value="managed-network">
                                        {tr("Sivio 网络（需启动）")}
                                      </option>
                                    </select>
                                  </label>
                                  <label className="flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={
                                        (
                                          editor.requestOptions ??
                                          defaultRequestOptions
                                        ).acceptInvalidCerts
                                      }
                                      onChange={(e) =>
                                        setEditor({
                                          ...editor,
                                          requestOptions: {
                                            ...defaultRequestOptions,
                                            ...editor.requestOptions,
                                            acceptInvalidCerts:
                                              e.target.checked,
                                          },
                                        })
                                      }
                                    />
                                    {tr(
                                      "允许无效 TLS 证书（仅此订阅，降低连接安全性）",
                                    )}
                                  </label>
                                </div>
                              </details>
                            )}
                            <details
                              open={editor.kind === "local" || undefined}
                              className="rounded-lg border p-3 text-sm"
                            >
                              <summary className="cursor-pointer">
                                {tr("配置正文与预览")}
                              </summary>
                              <div className="mt-3 space-y-3">
                                {editor.kind === "remote" && (
                                  <Button
                                    variant="outline"
                                    disabled={busy || !editor.url.trim()}
                                    onClick={() => void submitEditor(false)}
                                  >
                                    {tr("获取")}
                                  </Button>
                                )}
                                <JsonEditor
                                  ariaLabel={tr("Mihomo YAML 配置")}
                                  value={editor.yaml}
                                  onChange={(yaml) =>
                                    setEditor({ ...editor, yaml })
                                  }
                                  language="yaml"
                                  readOnly={busy}
                                  height="340px"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    disabled={
                                      busy ||
                                      (editor.kind === "remote" &&
                                        fetchedRequest.current !==
                                          requestKey(editor))
                                    }
                                    onClick={() =>
                                      void run(async () => {
                                        const value = await api("preview", {
                                          yaml: editor.yaml,
                                          enhancement: editor.enhancement,
                                          name: editor.name,
                                        });
                                        setPreview(value.yaml);
                                      })
                                    }
                                  >
                                    {tr("预览生效配置")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={
                                      busy ||
                                      (editor.kind === "remote" &&
                                        fetchedRequest.current !==
                                          requestKey(editor))
                                    }
                                    onClick={() =>
                                      void run(() =>
                                        api("profile.export", {
                                          yaml: editor.yaml,
                                        }),
                                      )
                                    }
                                  >
                                    {tr("导出 YAML（含敏感信息）")}
                                  </Button>
                                </div>
                              </div>
                            </details>
                            <details className="rounded-lg border p-3 text-sm">
                              <summary className="cursor-pointer">
                                {tr("此订阅的增强配置与 DNS")}
                              </summary>
                              <div className="mt-4 space-y-3">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={
                                      editor.enhancement?.enabled ?? false
                                    }
                                    onChange={(e) =>
                                      changeEnhancement({
                                        enabled: e.target.checked,
                                      })
                                    }
                                  />
                                  {tr(
                                    "在全局增强之后应用此订阅的合并、规则、节点、分组与脚本",
                                  )}
                                </label>
                                <label className="flex items-center gap-3 text-xs">
                                  {tr("DNS 来源")}
                                  <select
                                    aria-label={tr("此订阅的 DNS 来源")}
                                    className="rounded-md border bg-background p-2"
                                    value={
                                      editor.enhancement?.dnsMode ?? "inherit"
                                    }
                                    onChange={(e) =>
                                      changeEnhancement({
                                        dnsMode: e.target
                                          .value as Enhancement["dnsMode"],
                                      })
                                    }
                                  >
                                    <option value="inherit">
                                      {tr("继承全局 DNS 设置")}
                                    </option>
                                    <option value="subscription">
                                      {tr("保留订阅原始 DNS")}
                                    </option>
                                    <option value="profile">
                                      {tr("使用此订阅自定义 DNS")}
                                    </option>
                                  </select>
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  {(
                                    [
                                      ["merge", tr("合并")],
                                      ["script", tr("脚本")],
                                      ["rules", "规则"],
                                      ["proxies", "节点"],
                                      ["groups", tr("分组")],
                                      ["dns", "DNS"],
                                    ] as const
                                  ).map(([key, label]) => (
                                    <Button
                                      key={key}
                                      variant={
                                        profileTab === key
                                          ? "default"
                                          : "outline"
                                      }
                                      size="sm"
                                      onClick={() => setProfileTab(key)}
                                    >
                                      {tr(label)}
                                    </Button>
                                  ))}
                                </div>
                                <JsonEditor
                                  ariaLabel={`${tr("此订阅增强")} ${profileTab}`}
                                  readOnly={busy}
                                  language={
                                    profileTab === "script"
                                      ? "javascript"
                                      : "yaml"
                                  }
                                  value={
                                    (editor.enhancement ?? emptyEnhancement)[
                                      profileTab
                                    ]
                                  }
                                  onChange={(value) =>
                                    changeEnhancement({ [profileTab]: value })
                                  }
                                  height="220px"
                                />
                                <p className="text-xs leading-6 text-muted-foreground">
                                  {tr(
                                    "增强开关与 DNS 来源分别保存。脚本在受限环境中运行；预览后可检查最终配置。订阅更新会保留这些设置。",
                                  )}
                                </p>
                              </div>
                            </details>
                            {preview && (
                              <JsonEditor
                                ariaLabel={tr("生效配置预览")}
                                value={preview}
                                onChange={() => {}}
                                language="yaml"
                                readOnly
                                height="300px"
                              />
                            )}
                          </fieldset>
                        </div>
                        <div className="border-t px-6 pt-3">
                          {editorError && (
                            <p
                              role="alert"
                              className="mb-2 break-words rounded-lg bg-destructive/5 p-3 text-sm text-destructive"
                            >
                              {editorError}
                            </p>
                          )}
                          {editorStatus && (
                            <p
                              role="status"
                              className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              {busy && (
                                <Loader2 size={14} className="animate-spin" />
                              )}
                              {editorStatus}
                            </p>
                          )}
                          {data?.runtime.active === editor.id && editor.id && (
                            <p className="mb-2 text-xs text-muted-foreground">
                              {tr(
                                "保存后验证并应用当前配置，应用失败会恢复原配置。",
                              )}
                            </p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={closeEditor}
                          >
                            {tr("取消")}
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() => void submitEditor(true)}
                          >
                            {busy && (
                              <Loader2 size={14} className="animate-spin" />
                            )}
                            {tr(
                              busy
                                ? "处理中…"
                                : editor.id
                                  ? "保存修改"
                                  : editor.kind === "remote"
                                    ? "导入订阅"
                                    : "验证并保存",
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              )}
              {tab !== "首页" &&
                tab !== "订阅" &&
                tab !== "设置" &&
                tab !== "检测" &&
                tab !== "流量" &&
                !running && (
                  <Empty>
                    {tr("启动网络后查看")}
                    {tr(tab)}
                  </Empty>
                )}
              {running && tab === "节点" && (
                <NetworkNodesPanel
                  proxies={detail.data?.proxies ?? {}}
                  generation={data?.runtime.generation ?? 0}
                  profile={data?.catalog.active ?? "default"}
                  probe={probe}
                  onProbeChange={setProbe}
                  search={search}
                  onSearchChange={setSearch}
                  timeout={data?.catalog.settings.latencyTimeout ?? 5000}
                  busy={busy}
                  onSelect={(group, node) =>
                    void action(
                      "PUT",
                      `/proxies/${encodeURIComponent(group)}`,
                      {
                        name: node,
                      },
                    )
                  }
                >
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await api("terminal.env");
                        await invoke("copy_text_to_clipboard", {
                          text: value.text,
                        });
                      }, tr("终端代理命令已复制"))
                    }
                  >
                    {tr("复制终端代理命令")}
                  </Button>
                  <h3 className="pt-4 text-sm font-medium">
                    {tr("代理提供者")}
                  </h3>
                  {Object.entries(providers.data?.providers ?? {}).map(
                    ([name, raw]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded-xl border p-4"
                      >
                        <span className="text-sm">
                          {name} · {(raw as Payload).proxies?.length ?? 0}{" "}
                          {tr("节点")}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              "PUT",
                              `/providers/proxies/${encodeURIComponent(name)}`,
                            )
                          }
                        >
                          {tr("更新")}
                        </Button>
                      </div>
                    ),
                  )}
                </NetworkNodesPanel>
              )}
              {running && tab === "规则" && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      aria-label={tr("搜索规则")}
                      placeholder={tr("搜索规则")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTab("设置");
                        setRulesEditor(true);
                      }}
                    >
                      {tr("编辑规则增强")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          setResult(
                            await api("controller", {
                              method: "GET",
                              path: "/providers/rules",
                            }),
                          ),
                        )
                      }
                    >
                      {tr("规则提供者")}
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-xl border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="p-3">{tr("类型")}</th>
                          <th>{tr("匹配项")}</th>
                          <th>{tr("策略")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.data?.rules ?? [])
                          .filter((rule: Payload) =>
                            matches(
                              `${rule.type} ${rule.payload} ${rule.proxy}`,
                            ),
                          )
                          .map((rule: Payload, i: number) => (
                            <tr key={i} className="border-t">
                              <td className="p-3 text-muted-foreground">
                                {rule.type}
                              </td>
                              <td>{rule.payload || "—"}</td>
                              <td>{rule.proxy}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  {result !== null && <JsonView value={result} />}
                </div>
              )}
              {running && tab === "连接" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {tr("上传")}
                      {((detail.data?.uploadTotal ?? 0) / 1048576).toFixed(
                        1,
                      )}{" "}
                      {tr("MB · 下载")}{" "}
                      {((detail.data?.downloadTotal ?? 0) / 1048576).toFixed(1)}{" "}
                      MB
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action("DELETE", "/connections")}
                    >
                      {tr("关闭全部连接")}
                    </Button>
                  </div>
                  <Input
                    aria-label={tr("搜索连接")}
                    placeholder={tr("搜索域名、IP 或进程")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {(detail.data?.connections ?? [])
                    .filter((connection: Payload) =>
                      matches(JSON.stringify(connection.metadata)),
                    )
                    .map((connection: Payload) => (
                      <article
                        key={connection.id}
                        className="flex items-center justify-between gap-4 rounded-xl border p-4"
                      >
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-medium">
                            {connection.metadata.host ||
                              connection.metadata.destinationIP}
                            :{connection.metadata.destinationPort}
                          </h3>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {connection.metadata.process ||
                              connection.metadata.sourceIP}{" "}
                            · {connection.chains?.join(" → ")} ·{" "}
                            {connection.rule}
                          </p>
                        </div>
                        <Button
                          aria-label={tr("关闭连接")}
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              "DELETE",
                              `/connections/${encodeURIComponent(connection.id)}`,
                            )
                          }
                        >
                          <X size={14} />
                        </Button>
                      </article>
                    ))}
                </div>
              )}
              {running && tab === "日志" && (
                <div className="space-y-4">
                  <Input
                    aria-label={tr("过滤日志")}
                    placeholder={tr("过滤日志")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <pre className="min-h-[320px] whitespace-pre-wrap break-all rounded-xl bg-muted p-4 font-mono text-xs leading-6">
                    {(detail.data?.lines ?? []).filter(matches).join("\n") ||
                      tr("暂无匹配日志")}
                  </pre>
                </div>
              )}
              {tab === "检测" && (
                <div className="space-y-5">
                  <DashboardLinks
                    urls={data.catalog.settings.webUiList ?? []}
                    onError={(error) => toast.error(String(error))}
                  />
                  {!!data.catalog.settings.customTests?.length && (
                    <section className="space-y-3 rounded-xl border p-5">
                      <h2 className="font-medium">{tr("自定义连通检测")}</h2>
                      <p className="text-xs text-muted-foreground">
                        {tr(
                          "通过 Sivio 当前网络发送 HTTP 请求；成功响应不代表账号授权或 AI 模型调用成功。",
                        )}
                      </p>
                      {data.catalog.settings.customTests.map((test) => (
                        <div
                          key={test.id}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            {test.icon &&
                              (test.icon.startsWith("https://") ? (
                                <img
                                  src={test.icon}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  className="h-5 w-5"
                                />
                              ) : (
                                <span>{test.icon.slice(0, 8)}</span>
                              ))}
                            {test.name}
                          </span>
                          <Button
                            disabled={busy || !running}
                            onClick={() =>
                              void run(async () =>
                                setResult(
                                  await api("probe.custom", { id: test.id }),
                                ),
                              )
                            }
                          >
                            {tr("检测")}
                          </Button>
                        </div>
                      ))}
                    </section>
                  )}
                  <section className="space-y-4 rounded-xl border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <h2 className="font-medium">
                        {tr("媒体与 AI 服务可用性")}
                      </h2>
                      <div className="flex gap-2">
                        <Button
                          disabled={
                            busy ||
                            !running ||
                            !!(
                              data?.runtime.media &&
                              !data.runtime.media.finished
                            )
                          }
                          onClick={() => void run(() => api("media.start"))}
                        >
                          {tr("检测全部")}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={
                            !data?.runtime.media || data.runtime.media.finished
                          }
                          onClick={() => void run(() => api("media.cancel"))}
                        >
                          {tr("取消检测")}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "通过本应用内核检测 12 个服务的区域可用性，不使用登录账号。拒绝、超时或无法判定时不会标为可用；检测结果不代表账号授权或模型调用成功。",
                      )}
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {data?.runtime.media?.items.map((item) => (
                        <div
                          key={item.name}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3"
                        >
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.status}
                              {item.region ? ` · ${item.region}` : ""}
                              {item.check_time ? ` · ${item.check_time}` : ""}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={
                              busy || !running || !data.runtime.media?.finished
                            }
                            onClick={() =>
                              void run(() =>
                                api("media.start", { name: item.name }),
                              )
                            }
                          >
                            {tr("重试")}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </section>
                  <div className="flex items-center justify-between">
                    <h2 className="font-medium">{tr("网络诊断")}</h2>
                    <Button
                      variant="outline"
                      disabled={busy || !running}
                      onClick={() => void action("POST", "/configs/geo")}
                    >
                      {tr("更新 Geo 数据")}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {tr("检测通过本应用内核执行，内核停止时会明确失败。")}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      aria-label={tr("检测域名")}
                      value={dnsName}
                      onChange={(e) => setDnsName(e.target.value)}
                    />
                    <Button
                      disabled={busy || !running}
                      onClick={() =>
                        void run(async () =>
                          setResult(
                            await api("controller", {
                              method: "GET",
                              path: `/dns/query?name=${encodeURIComponent(dnsName)}&type=A`,
                            }),
                          ),
                        )
                      }
                    >
                      {tr("DNS 查询")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          setResult(await api("diagnostics")),
                        )
                      }
                    >
                      {tr("应用诊断")}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={busy || !running}
                      onClick={() => void action("POST", "/cache/dns/flush")}
                    >
                      {tr("清除 DNS 缓存")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !running}
                      onClick={() => void action("POST", "/cache/fakeip/flush")}
                    >
                      {tr("清除 Fake IP")}
                    </Button>
                  </div>
                  {result !== null && <JsonView value={result} />}
                </div>
              )}
              {tab === "设置" && settings && data && (
                <NetworkSettingsPanel
                  settings={settings}
                  openRules={rulesEditor}
                  onReload={() => void run(loadSettings)}
                  data={data}
                  busy={busy}
                  running={!!running}
                  run={run}
                  onSave={async (next) => {
                    if (
                      next.systemProxy &&
                      next.proxyHost !== "127.0.0.1" &&
                      !window.confirm(
                        tr(
                          "自定义系统代理主机会把系统代理流量发往该地址。确认这是你信任的代理主机？",
                        ),
                      )
                    )
                      throw new Error(tr("已取消"));
                    setPersisting(true);
                    setBusy(true);
                    try {
                      const result = await api<{
                        saved: boolean;
                        restarted: boolean;
                      }>("settings.save", {
                        settings: next,
                        baseRevision: settingsRevision,
                      });
                      await loadSettings();
                      await client.invalidateQueries({ queryKey: ["network"] });
                      toast.success(
                        tr(
                          result.restarted
                            ? "网络设置已保存并应用"
                            : "网络设置已保存",
                        ),
                      );
                    } catch (error) {
                      // Recovery can change the runtime generation. Refresh its
                      // authoritative state without replacing the dialog draft.
                      try {
                        const latest = await api<Snapshot>("snapshot");
                        client.setQueryData(["network", "snapshot"], latest);
                        if (
                          JSON.stringify(latest.catalog.settings) ===
                          originalSettings.current
                        )
                          setSettingsRevision(latest.settingsRevision);
                      } catch {
                        void client.invalidateQueries({
                          queryKey: ["network"],
                        });
                      }
                      throw error;
                    } finally {
                      setPersisting(false);
                      setBusy(false);
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export { networkApi } from "./networkApi";

export function NetworkWorkspace(
  props: Parameters<typeof NetworkWorkspaceContent>[0] = {},
) {
  const runtime = useContext(NetworkRuntimeContext);
  return runtime ? (
    <NetworkWorkspaceContent {...props} />
  ) : (
    <NetworkRuntimeProvider active>
      <NetworkWorkspaceContent {...props} />
    </NetworkRuntimeProvider>
  );
}
