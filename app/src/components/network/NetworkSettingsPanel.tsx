import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import JsonEditor from "@/components/JsonEditor";
import { useUnsavedValue } from "@/lib/unsavedChanges";
import { toast } from "@/lib/toast";
import type { Settings, NetworkSnapshot } from "./networkTypes";
import { networkApi as api } from "./networkApi";
import { useNetworkText } from "./networkText";

const groups = [
  ["ports", "端口设置"],
  ["tun", "虚拟网卡模式"],
  ["proxy", "系统代理"],
  ["lan", "局域网连接"],
  ["dns", "DNS 覆写"],
  ["ipv6", "IPv6"],
  ["delay", "统一延迟"],
  ["logging", "日志等级"],
  ["core", "Clash 内核与运行模式"],
  ["controller", "外部控制器与面板"],
  ["latency", "测速与连接"],
  ["connectivity", "自定义连通检测"],
  ["enhancement", "配置增强"],
] as const;
type Group = (typeof groups)[number][0];
export function NetworkSettingsPanel({
  settings: saved,
  data,
  busy,
  running,
  openRules = false,
  onSave,
  onReload,
  run,
}: {
  openRules?: boolean;
  settings: Settings;
  data: NetworkSnapshot;
  busy: boolean;
  running: boolean;
  onSave: (settings: Settings) => Promise<void>;
  onReload: () => void;
  run: (work: () => Promise<unknown>, success?: string) => Promise<unknown>;
}) {
  const tr = useNetworkText();
  const [group, setGroup] = useState<Group | null>(
    openRules ? "enhancement" : null,
  );
  const [settings, setSettings] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [settingTab, setSettingTab] = useState<
    "merge" | "script" | "rules" | "proxies" | "groups" | "dns"
  >(openRules ? "rules" : "merge");
  const dirty = !!group && JSON.stringify(saved) !== JSON.stringify(settings);
  useUnsavedValue(dirty);
  const patch = (value: Partial<Settings>) =>
    setSettings({ ...settings, ...value });
  function close() {
    if (busy || saving) return;
    if (!dirty || window.confirm(tr("有尚未保存的网络配置，确定放弃修改吗？")))
      setGroup(null);
  }
  function toggle(key: keyof Settings, label: string) {
    return (
      <div className="flex items-center justify-between gap-4 py-3">
        <label htmlFor={`network-${key}`} className="text-sm">
          {tr(label)}
        </label>
        <Switch
          id={`network-${key}`}
          checked={!!settings[key]}
          onCheckedChange={(value) => patch({ [key]: value })}
        />
      </div>
    );
  }
  function summary(key: Group) {
    if (key === "ports") return String(saved.mixedPort);
    if (key === "logging") return saved.logLevel ?? "info";
    if (key === "core")
      return saved.core === "alpha" ? "Alpha · 94b13ae" : "Stable · v1.19.32";
    const fields: Partial<Record<Group, keyof Settings>> = {
      tun: "tun",
      proxy: "systemProxy",
      lan: "allowLan",
      dns: "dnsOverride",
      ipv6: "ipv6",
      delay: "unifiedDelay",
    };
    const field = fields[key];
    return field
      ? tr(saved[field as keyof Settings] ? "已开启" : "已关闭")
      : tr("配置");
  }
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">{tr("Clash 网络设置")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {tr(
            "各项独立保存；运行中保存将自动重新应用，失败恢复旧设置和运行状态。模型路由设置位于模型工作区。",
          )}
        </p>
      </div>
      <Button variant="outline" disabled={busy} onClick={onReload}>
        {tr("重新载入")}
      </Button>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-xl border bg-card">
          <h3 className="border-b px-5 py-4 text-sm font-semibold">
            {tr("代理与内核")}
          </h3>
          {groups.slice(0, 9).map(([key, label]) => (
            <button
              key={key}
              disabled={busy}
              onClick={() => {
                setSettings(saved);
                setError("");
                setGroup(key);
              }}
              className="flex w-full items-center gap-3 border-b last:border-0 px-5 py-4 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
            >
              <span className="flex-1">{tr(label)}</span>
              <span className="text-xs text-muted-foreground">
                {summary(key)}
              </span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          ))}
        </section>
        <div className="space-y-5">
          <section className="overflow-hidden rounded-xl border bg-card">
            <h3 className="border-b px-5 py-4 text-sm font-semibold">
              {tr("高级网络功能")}
            </h3>
            {groups.slice(9).map(([key, label]) => (
              <button
                key={key}
                disabled={busy}
                onClick={() => {
                  setSettings(saved);
                  setError("");
                  setGroup(key);
                }}
                className="flex w-full items-center gap-3 border-b last:border-0 px-5 py-4 text-left text-sm hover:bg-muted/50"
              >
                <span className="flex-1">{tr(label)}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h3 className="text-sm font-semibold">{tr("内核与权限")}</h3>{" "}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-xs text-muted-foreground">
                {tr("独立服务")}{" "}
                {data?.helper
                  ? `v${data.helper.build_version}${data.appRestartRequired ? tr(" · 需要重新打开 App") : data.helperCompatible ? (data.helperAuthorized ? "" : tr(" · 需要登记当前 App")) : tr(" · 需要更新 / 修复")}`
                  : tr("按需启用")}{" "}
                {tr("· 5 秒续约 / 30 秒失联恢复")}
              </p>
              <div className="flex gap-2">
                {!data.appRestartRequired && (!data.helperCompatible || !data.helperAuthorized) && (
                  <Button
                    size="sm"
                    variant="outline"
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
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || running || data.appRestartRequired}
                  onClick={() => {
                    if (window.confirm(tr("恢复网络并移除 Sivio 独立服务？")))
                      void run(() => api("helper.uninstall"), tr("服务已移除"));
                  }}
                >
                  {tr("卸载服务")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
      {group && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <DialogContent
            className="w-[calc(100%_-_32px)] max-w-[620px] overflow-hidden"
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              close();
            }}
          >
            <DialogHeader className="border-b pr-14">
              <DialogTitle>
                {tr(groups.find(([key]) => key === group)![1])}
              </DialogTitle>
              <DialogDescription>
                {tr("仅保存当前功能的修改，其他功能与模型配置保持独立。")}
              </DialogDescription>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4"
                disabled={busy || saving}
                aria-label={tr("关闭")}
                onClick={close}
              >
                <X size={16} />
              </Button>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto p-6">
              <fieldset disabled={busy || saving} className="space-y-4">
                {group === "ports" && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "混合端口同时支持 HTTP 和 SOCKS；关闭的独立端口不监听。端口占用时请修改或退出占用程序。",
                      )}
                    </p>
                    {(
                      [
                        ["mixedPort", "混合代理端口", 7890],
                        ["socksPort", "SOCKS 代理端口", 7898],
                        ["httpPort", "HTTP(S) 代理端口", 7899],
                        ["redirPort", "Redir 透明代理端口", 7895],
                      ] as const
                    ).map(([key, label, fallback]) => (
                      <div key={key} className="flex items-center gap-3">
                        <label htmlFor={key} className="flex-1 text-sm">
                          {tr(label)}
                        </label>
                        <Input
                          id={key}
                          aria-label={tr(label)}
                          className="w-28"
                          type="number"
                          min={1025}
                          max={65535}
                          disabled={key !== "mixedPort" && !settings[key]}
                          value={settings[key] || fallback}
                          onChange={(e) =>
                            patch({ [key]: Number(e.target.value) })
                          }
                        />
                        {key === "mixedPort" ? (
                          <Switch
                            aria-label={tr("混合端口必须开启")}
                            checked
                            disabled
                          />
                        ) : (
                          <Switch
                            aria-label={`${tr(label)} ${tr("启用")}`}
                            checked={settings[key] > 0}
                            onCheckedChange={(enabled) =>
                              patch({ [key]: enabled ? fallback : 0 })
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {group === "tun" && (
                  <>
                    {toggle("tun", "TUN 模式")}
                    <label className="block space-y-2 text-sm">
                      {tr("协议栈")}
                      <select
                        aria-label={tr("协议栈")}
                        className="w-full rounded border bg-background p-2"
                        value={settings.tunStack ?? "system"}
                        onChange={(e) => patch({ tunStack: e.target.value })}
                      >
                        {["system", "gvisor", "mixed"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-2 text-sm">
                      MTU
                      <Input
                        aria-label="MTU"
                        type="number"
                        min={1280}
                        max={9000}
                        value={settings.tunMtu ?? 1500}
                        onChange={(e) =>
                          patch({ tunMtu: Number(e.target.value) })
                        }
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "启用 TUN 需要 Sivio 自有服务授权；保存后手动启动网络。",
                      )}
                    </p>
                  </>
                )}
                {group === "proxy" && (
                  <>
                    {toggle("systemProxy", "系统代理")}{" "}
                    <label className="block space-y-2 text-xs">
                      {tr("系统代理主机")}
                      <Input
                        maxLength={253}
                        value={settings.proxyHost ?? "127.0.0.1"}
                        onChange={(e) => patch({ proxyHost: e.target.value })}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "默认使用本机 127.0.0.1。自定义主机仅影响系统代理与复制的终端命令，可能把系统流量发往另一台机器；需要 helper revision 9。内核控制器仍保持本机私有。",
                      )}
                    </p>
                    <h3 className="text-sm font-medium">
                      {tr("兼容增强与系统代理守卫")}
                    </h3>
                    {(
                      [
                        ["builtinEnhanced", "内置兼容增强"],
                        ["bypassCheck", "检查系统代理绕过语法"],
                        ["useDefaultBypass", "使用默认绕过列表"],
                        ["proxyGuard", "监视系统代理所有权"],
                      ] as const
                    ).map(([key, label]) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={settings[key] ?? key !== "useDefaultBypass"}
                          onChange={(e) => patch({ [key]: e.target.checked })}
                        />
                        {tr(label)}
                      </label>
                    ))}
                    <label className="block space-y-2 text-xs">
                      {tr("系统代理守卫间隔（秒）")}
                      <Input
                        type="number"
                        min={1}
                        max={3600}
                        value={settings.proxyGuardSeconds ?? 30}
                        onChange={(e) =>
                          patch({ proxyGuardSeconds: Number(e.target.value) })
                        }
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "默认绕过：localhost,127.*,::1。守卫只协调本 App 的系统代理；发现其他 App 接管或所有权冲突后停止本轮重试，需手动重启网络。不会争抢外部设置。",
                      )}
                    </p>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("系统代理方式")}
                      <select
                        className="block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                        value={settings.proxyMode}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            proxyMode: e.target.value,
                          })
                        }
                      >
                        <option value="global">{tr("全局系统代理")}</option>
                        <option value="pac">{tr("PAC 自动配置")}</option>
                      </select>
                    </label>
                    {settings.proxyMode === "pac" && (
                      <div className="mb-5 space-y-3">
                        <label className="block space-y-2 text-xs text-muted-foreground">
                          {tr("本机 PAC 服务端口")}
                          <Input
                            aria-label={tr("PAC 端口")}
                            type="number"
                            min={1025}
                            max={65535}
                            value={settings.pacPort}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                pacPort: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {tr(
                            "定义 FindProxyForURL；__MIXED_PORT__ 在启动时替换为当前端口。默认脚本仅对本机地址直连。",
                          )}
                        </p>
                        <JsonEditor
                          value={settings.pacScript}
                          onChange={(value) =>
                            setSettings({ ...settings, pacScript: value })
                          }
                          language="javascript"
                          height="200px"
                          ariaLabel={tr("PAC 脚本")}
                          readOnly={busy}
                        />
                      </div>
                    )}
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("系统代理绕过列表")}
                      <Input
                        disabled={settings.useDefaultBypass}
                        value={
                          settings.useDefaultBypass
                            ? "localhost,127.*,::1"
                            : settings.bypass
                        }
                        onChange={(e) =>
                          setSettings({ ...settings, bypass: e.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                {group === "lan" && (
                  <>
                    {" "}
                    <label className="mb-4 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.allowLan}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            allowLan: e.target.checked,
                          })
                        }
                      />
                      {tr("允许局域网设备连接")}
                    </label>
                    {settings.allowLan && (
                      <div className="mb-5 space-y-3 rounded-xl border border-primary/30 p-4">
                        <p className="text-xs text-muted-foreground">
                          {tr(
                            "代理端口将监听局域网；访问需要下方认证。回环流量免认证，控制接口始终私有。",
                          )}
                        </p>
                        <Input
                          aria-label={tr("局域网用户名")}
                          placeholder={tr("访问用户名")}
                          value={settings.lanUsername}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              lanUsername: e.target.value,
                            })
                          }
                        />
                        <Input
                          aria-label={tr("局域网访问密码")}
                          type="password"
                          autoComplete="new-password"
                          placeholder={tr("至少 16 字节访问密码")}
                          value={settings.lanPassword}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              lanPassword: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </>
                )}
                {group === "dns" && (
                  <>
                    {toggle("dnsOverride", "DNS 覆写")}
                    <JsonEditor
                      ariaLabel={tr("DNS 配置")}
                      value={settings.dns}
                      onChange={(dns) => patch({ dns })}
                      language="yaml"
                      height="280px"
                      readOnly={
                        busy || saving || settings.dnsOverride === false
                      }
                    />
                  </>
                )}
                {group === "ipv6" && toggle("ipv6", "IPv6")}
                {group === "delay" && toggle("unifiedDelay", "统一延迟")}
                {group === "logging" && (
                  <label className="block space-y-2 text-sm">
                    {tr("日志等级")}
                    <select
                      aria-label={tr("日志等级")}
                      className="w-full rounded border bg-background p-2"
                      value={settings.logLevel ?? "info"}
                      onChange={(e) => patch({ logLevel: e.target.value })}
                    >
                      {["silent", "error", "warning", "info", "debug"].map(
                        (value) => (
                          <option key={value}>{value}</option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {group === "core" && (
                  <>
                    {" "}
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("运行模式")}
                      <select
                        className="block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                        value={settings.mode}
                        onChange={(e) =>
                          setSettings({ ...settings, mode: e.target.value })
                        }
                      >
                        <option value="rule">{tr("规则")}</option>
                        <option value="global">{tr("全局")}</option>
                        <option value="direct">{tr("直连")}</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("固定内核")}
                      <select
                        className="block h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground"
                        value={settings.core}
                        onChange={(e) =>
                          setSettings({ ...settings, core: e.target.value })
                        }
                      >
                        <option value="stable">Stable · v1.19.32</option>
                        <option value="alpha">Alpha · 94b13ae</option>
                      </select>
                    </label>
                  </>
                )}
                {group === "controller" && (
                  <>
                    {" "}
                    <h2 className="font-medium">{tr("外部控制器与面板")}</h2>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.controllerEnabled ?? false}
                        onChange={(e) =>
                          patch({ controllerEnabled: e.target.checked })
                        }
                      />
                      {tr("启用本机外部控制器")}
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "仅监听 127.0.0.1，使用独立连接密钥。面板仅可执行已允许的节点、模式、连接与查询操作；安装、TUN 和任意配置加载仍在应用内管理。",
                      )}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="space-y-2 text-xs">
                        {tr("控制器端口")}
                        <Input
                          type="number"
                          min={1025}
                          max={65535}
                          value={settings.controllerPort ?? 15724}
                          onChange={(e) =>
                            patch({ controllerPort: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label className="space-y-2 text-xs">
                        {tr("连接密钥（至少 32 字符）")}
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={settings.controllerSecret ?? ""}
                          onChange={(e) =>
                            patch({ controllerSecret: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        patch({
                          controllerSecret:
                            crypto.randomUUID().replace(/-/g, "") +
                            crypto.randomUUID().replace(/-/g, ""),
                        })
                      }
                    >
                      {tr("生成连接密钥")}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {tr("连接参数（保存并启动后生效）")}: http://127.0.0.1:
                      {settings.controllerPort ?? 15724}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!settings.controllerSecret}
                      onClick={() =>
                        void invoke("copy_text_to_clipboard", {
                          text: settings.controllerSecret,
                        })
                          .then(() => toast.success(tr("连接密钥已复制")))
                          .catch((error) => toast.error(String(error)))
                      }
                    >
                      {tr("复制连接密钥")}
                    </Button>
                    <h3 className="text-sm font-medium">
                      {tr("可信面板链接")}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {tr(
                        "只添加可信的 HTTPS 或本机 HTTP 面板。打开链接不会自动传递连接密钥；请在面板中手动配置。该列表同时限制浏览器访问控制器的来源。",
                      )}
                    </p>
                    {(settings.webUiList ?? []).map((url, index) => (
                      <div key={index} className="flex gap-2">
                        <Input
                          aria-label={`${tr("面板地址")} ${index + 1}`}
                          value={url}
                          onChange={(e) =>
                            patch({
                              webUiList: settings.webUiList.map((old, i) =>
                                i === index ? e.target.value : old,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            patch({
                              webUiList: settings.webUiList.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          {tr("移除")}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={(settings.webUiList?.length ?? 0) >= 20}
                      onClick={() =>
                        patch({
                          webUiList: [...(settings.webUiList ?? []), ""],
                        })
                      }
                    >
                      {tr("添加面板")}
                    </Button>
                  </>
                )}
                {group === "connectivity" && (
                  <>
                    {" "}
                    <h3 className="text-sm font-medium">
                      {tr("自定义连通检测")}
                    </h3>
                    {(settings.customTests ?? []).map((test, index) => (
                      <div
                        key={test.id}
                        className="grid gap-2 rounded-lg bg-muted p-3 sm:grid-cols-[1fr_2fr_auto]"
                      >
                        <Input
                          aria-label={`${tr("检测名称")} ${index + 1}`}
                          value={test.name}
                          onChange={(e) =>
                            patch({
                              customTests: settings.customTests.map((old, i) =>
                                i === index
                                  ? { ...old, name: e.target.value }
                                  : old,
                              ),
                            })
                          }
                        />
                        <Input
                          aria-label={`${tr("检测地址")} ${index + 1}`}
                          value={test.url}
                          placeholder="https://example.com"
                          onChange={(e) =>
                            patch({
                              customTests: settings.customTests.map((old, i) =>
                                i === index
                                  ? { ...old, url: e.target.value }
                                  : old,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            patch({
                              customTests: settings.customTests.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          {tr("移除")}
                        </Button>
                        <Input
                          aria-label={`${tr("检测图标")} ${index + 1}`}
                          value={test.icon ?? ""}
                          placeholder={tr("表情或 HTTPS 图片地址")}
                          onChange={(e) =>
                            patch({
                              customTests: settings.customTests.map((old, i) =>
                                i === index
                                  ? { ...old, icon: e.target.value }
                                  : old,
                              ),
                            })
                          }
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={(settings.customTests?.length ?? 0) >= 30}
                      onClick={() =>
                        patch({
                          customTests: [
                            ...(settings.customTests ?? []),
                            {
                              id: crypto.randomUUID(),
                              name: "",
                              url: "",
                              icon: "",
                            },
                          ],
                        })
                      }
                    >
                      {tr("添加检测")}
                    </Button>
                  </>
                )}
                {group === "latency" && (
                  <>
                    {" "}
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("默认测速地址")}
                      <Input
                        aria-label={tr("默认测速地址")}
                        value={settings.latencyUrl}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            latencyUrl: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("测速超时（100–5000 毫秒）")}
                      <Input
                        aria-label={tr("默认测速超时")}
                        type="number"
                        min={100}
                        max={5000}
                        value={settings.latencyTimeout}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            latencyTimeout: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="space-y-2 text-xs text-muted-foreground">
                      {tr("自动分组测速间隔（分钟，0 关闭）")}
                      <Input
                        aria-label={tr("自动测速间隔")}
                        type="number"
                        min={0}
                        max={1440}
                        value={settings.autoDelayMinutes}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            autoDelayMinutes: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="mb-4 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={settings.closeConnectionsOnSwitch}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            closeConnectionsOnSwitch: e.target.checked,
                          })
                        }
                      />
                      {tr("切换节点后关闭现有连接")}
                    </label>
                  </>
                )}
                {group === "enhancement" && (
                  <>
                    {" "}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr(
                        "全局合并 → 规则/节点/分组增强 → 沙箱脚本 → 本应用控制字段。脚本无文件、进程和网络权限。",
                      )}
                    </p>
                    <div className="my-4 flex gap-2">
                      {(
                        [
                          ["merge", tr("合并")],
                          ["script", tr("脚本")],
                          ["rules", "规则"],
                          ["proxies", "节点"],
                          ["groups", tr("分组")],
                        ] as const
                      ).map(([key, label]) => (
                        <Button
                          key={key}
                          size="sm"
                          variant={settingTab === key ? "default" : "ghost"}
                          onClick={() => setSettingTab(key)}
                        >
                          {tr(label)}
                        </Button>
                      ))}
                    </div>
                    <JsonEditor
                      key={settingTab}
                      ariaLabel={tr("配置增强编辑器")}
                      readOnly={busy}
                      value={settings[settingTab]}
                      onChange={(value) =>
                        setSettings({ ...settings, [settingTab]: value })
                      }
                      language={settingTab === "script" ? "javascript" : "yaml"}
                      height="300px"
                    />
                  </>
                )}
              </fieldset>
            </div>
            {error ? (
              <p role="alert" className="px-6 pb-2 text-sm text-destructive">
                {error}
              </p>
            ) : running ? (
              <p
                role="status"
                className="px-6 pb-2 text-xs text-muted-foreground"
              >
                {tr(
                  "保存后将自动重新应用网络，连接可能短暂中断；失败时恢复旧配置和运行状态。",
                )}
              </p>
            ) : null}
            <DialogFooter className="border-t">
              <Button
                variant="outline"
                disabled={busy || saving}
                onClick={close}
              >
                {tr("取消")}
              </Button>
              <Button
                disabled={busy || saving || !dirty}
                onClick={async () => {
                  setSaving(true);
                  setError("");
                  try {
                    await onSave(settings);
                    setGroup(null);
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : String(error),
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {tr(saving ? "正在应用…" : running ? "保存并应用" : "保存设置")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
