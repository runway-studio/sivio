import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./networkTypes";
import { useNetworkText } from "./networkText";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
export function NetworkAdvancedSettings({
  settings,
  patch,
}: {
  settings: Settings;
  patch: (value: Partial<Settings>) => void;
}) {
  const tr = useNetworkText();
  return (
    <section className="space-y-4 rounded-xl border p-5">
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
      <h3 className="text-sm font-medium">{tr("兼容增强与系统代理守卫")}</h3>
      {(
        [
          ["builtinEnhanced", "内置兼容增强"],
          ["bypassCheck", "检查系统代理绕过语法"],
          ["useDefaultBypass", "使用默认绕过列表"],
          ["proxyGuard", "监视系统代理所有权"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
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
          onChange={(e) => patch({ proxyGuardSeconds: Number(e.target.value) })}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {tr(
          "默认绕过：localhost,127.*,::1。守卫只协调本 App 的系统代理；发现其他 App 接管或所有权冲突后停止本轮重试，需手动重启网络。不会争抢外部设置。",
        )}
      </p>
      <h2 className="font-medium">{tr("外部控制器与面板")}</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.controllerEnabled ?? false}
          onChange={(e) => patch({ controllerEnabled: e.target.checked })}
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
            onChange={(e) => patch({ controllerPort: Number(e.target.value) })}
          />
        </label>
        <label className="space-y-2 text-xs">
          {tr("连接密钥（至少 32 字符）")}
          <Input
            type="password"
            autoComplete="new-password"
            value={settings.controllerSecret ?? ""}
            onChange={(e) => patch({ controllerSecret: e.target.value })}
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
      <h3 className="text-sm font-medium">{tr("可信面板链接")}</h3>
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
                webUiList: settings.webUiList.filter((_, i) => i !== index),
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
          patch({ webUiList: [...(settings.webUiList ?? []), ""] })
        }
      >
        {tr("添加面板")}
      </Button>
      <h3 className="text-sm font-medium">{tr("自定义连通检测")}</h3>
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
                  i === index ? { ...old, name: e.target.value } : old,
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
                  i === index ? { ...old, url: e.target.value } : old,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              patch({
                customTests: settings.customTests.filter((_, i) => i !== index),
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
                  i === index ? { ...old, icon: e.target.value } : old,
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
              { id: crypto.randomUUID(), name: "", url: "", icon: "" },
            ],
          })
        }
      >
        {tr("添加检测")}
      </Button>
    </section>
  );
}
export function DashboardLinks({
  urls,
  onError,
}: {
  urls: string[];
  onError: (error: unknown) => void;
}) {
  const tr = useNetworkText();
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url) => (
        <Button
          key={url}
          variant="outline"
          onClick={() => void invoke("open_external", { url }).catch(onError)}
        >
          {tr("打开面板")} · {url}
        </Button>
      ))}
    </div>
  );
}
