import type { DesktopPreferences } from "@/lib/desktopPreferences";
import { orderedMenuPages } from "@/lib/desktopPreferences";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
/** Edits the parent's CAS-protected draft; it never writes preferences independently. */
export function WorkspacePresentationFields({
  draft,
  patch,
  zh,
}: {
  draft: DesktopPreferences;
  patch: (value: Partial<DesktopPreferences>) => void;
  zh: boolean;
}) {
  const copy = (cn: string, en: string) => (zh ? cn : en);
  const pageNames: Record<string, string> = {
    overview: copy("概览", "Overview"),
    network: copy("网络", "Network"),
    mcp: "MCP",
    skills: "Skills",
    prompts: copy("提示词", "Prompts"),
    sessions: copy("会话", "Sessions"),
    auth: copy("授权中心", "Authorization"),
    usage: copy("用量", "Usage"),
  };
  const order = orderedMenuPages(draft.menuOrder).filter(
    (page) => page !== "overview" && page !== "network",
  );
  return (
    <>
      {(
        [
          [
            "autoBackupOnChange",
            "配置变更后自动备份本机数据库",
            "Back up local database after configuration changes",
          ],
          [
            "traySpeed",
            "菜单栏显示网络速度",
            "Show network rates in the menu bar",
          ],
          [
            "trayInlineModes",
            "托盘中平铺出站模式",
            "Inline outbound modes in the tray",
          ],
          ["trafficGraph", "流量曲线", "Traffic graph"],
          ["memoryUsage", "内核内存用量", "Core memory usage"],
          ["groupIcons", "代理分组图标", "Proxy group icons"],
          [
            "pauseTrafficOnBlur",
            "失焦时暂停流量界面采样",
            "Pause traffic view sampling while unfocused",
          ],
          [
            "hoverGroupNavigation",
            "悬停分组导航时跳转",
            "Jump to proxy groups on hover",
          ],
          [
            "autoCheckUpdate",
            "启动时检查 Sivio 更新",
            "Check for Sivio updates on startup",
          ],
        ] as const
      ).map(([key, cn, en]) => (
        <label key={key} className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft[key]}
            onChange={(event) => patch({ [key]: event.target.checked })}
          />
          {copy(cn, en)}
        </label>
      ))}
      <label className="space-y-2 text-xs">
        {copy("托盘代理组展示", "Tray proxy groups")}
        <select
          className="block h-9 w-full rounded-md border bg-background px-3"
          value={draft.trayGroupsMode}
          onChange={(e) =>
            patch({
              trayGroupsMode: e.target
                .value as DesktopPreferences["trayGroupsMode"],
            })
          }
        >
          <option value="default">{copy("子菜单", "Submenu")}</option>
          <option value="inline">{copy("平铺", "Inline")}</option>
          <option value="disable">{copy("隐藏", "Hidden")}</option>
        </select>
      </label>
      <label className="space-y-2 text-xs">
        {copy("节点布局列数（1–6）", "Proxy layout columns (1–6)")}
        <Input
          type="number"
          min={1}
          max={6}
          value={draft.proxyColumns}
          onChange={(e) => patch({ proxyColumns: Number(e.target.value) })}
        />
      </label>
      <label className="space-y-2 text-xs">
        {copy("分组悬停跳转延迟（毫秒）", "Group hover delay (milliseconds)")}
        <Input
          type="number"
          min={0}
          max={5000}
          disabled={!draft.hoverGroupNavigation}
          value={draft.hoverGroupDelay}
          onChange={(e) => patch({ hoverGroupDelay: Number(e.target.value) })}
        />
      </label>
      <label className="space-y-2 text-xs">
        {copy("分组工具位置", "Group tools position")}
        <select
          className="block h-9 w-full rounded-md border bg-background px-3"
          value={draft.groupToolsPosition}
          onChange={(e) =>
            patch({ groupToolsPosition: e.target.value as "left" | "right" })
          }
        >
          <option value="left">{copy("左侧", "Left")}</option>
          <option value="right">{copy("右侧", "Right")}</option>
        </select>
      </label>
      <label className="space-y-2 text-xs">
        {copy("导航图标", "Navigation icons")}
        <select
          className="block h-9 w-full rounded-md border bg-background px-3"
          value={draft.menuIcon}
          onChange={(e) =>
            patch({
              menuIcon: e.target.value as DesktopPreferences["menuIcon"],
            })
          }
        >
          <option value="monochrome">{copy("单色", "Monochrome")}</option>
          <option value="colorful">{copy("主题色", "Theme color")}</option>
          <option value="disable">
            {copy("隐藏（收起时保留）", "Hide (keep when collapsed)")}
          </option>
        </select>
      </label>
      <label className="space-y-2 text-xs">
        {copy("复制终端代理命令格式", "Terminal proxy command format")}
        <select
          className="block h-9 w-full rounded-md border bg-background px-3"
          value={draft.envType}
          onChange={(e) =>
            patch({ envType: e.target.value as DesktopPreferences["envType"] })
          }
        >
          {["bash", "fish", "cmd", "powershell", "nushell"].map((shell) => (
            <option key={shell}>{shell}</option>
          ))}
        </select>
      </label>
      <label className="space-y-2 text-xs">
        {copy(
          "单个应用日志上限（MiB，重启生效）",
          "App log size (MiB; restart required)",
        )}
        <Input
          type="number"
          min={1}
          max={20}
          value={draft.logMaxSizeMib}
          onChange={(e) => patch({ logMaxSizeMib: Number(e.target.value) })}
        />
      </label>
      <label className="space-y-2 text-xs">
        {copy(
          "应用日志归档份数（重启生效）",
          "App log archives (restart required)",
        )}
        <Input
          type="number"
          min={1}
          max={8}
          value={draft.logArchiveCount}
          onChange={(e) => patch({ logArchiveCount: Number(e.target.value) })}
        />
      </label>
      <label className="space-y-2 text-xs">
        {copy("应用日志自动清理", "Automatic app log cleanup")}
        <select
          className="block h-9 w-full rounded-md border bg-background px-3"
          value={draft.logCleanDays}
          onChange={(e) => patch({ logCleanDays: Number(e.target.value) })}
        >
          {[0, 1, 7, 30, 90].map((days) => (
            <option key={days} value={days}>
              {days
                ? `${days} ${copy("天", "days")}`
                : copy("关闭年龄清理", "Keep until size rotation")}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        {copy(
          "应用日志及归档合计最多 80 MiB；活动日志在下次启动时按年龄清理。helper 与内核另有独立大小上限。",
          "App logs and archives are capped at 80 MiB in total. Age cleanup of active logs runs at next startup. Helper and core logs have separate size limits.",
        )}
      </p>
      <div className="space-y-2 text-xs md:col-span-2">
        <p>{copy("概览卡片", "Overview cards")}</p>
        <div className="flex flex-wrap gap-4">
          {(
            [
              ["usage", copy("用量", "Usage")],
              ["router", copy("AI 路由", "AI router")],
              ["network", copy("网络", "Network")],
              ["providers", copy("供应商", "Providers")],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.homeCards.includes(key)}
                onChange={(e) =>
                  patch({
                    homeCards: e.target.checked
                      ? [...draft.homeCards, key]
                      : draft.homeCards.filter((v) => v !== key),
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2 text-xs md:col-span-2">
        <p>{copy("模型资源菜单顺序", "Model resource menu order")}</p>
        {order.map((page, index) => (
          <div key={page} className="flex items-center justify-between gap-4">
            <span>{pageNames[page]}</span>
            <div className="flex gap-2">
              {([-1, 1] as const).map((direction) => (
                <Button
                  key={direction}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={
                    index + direction < 0 || index + direction >= order.length
                  }
                  aria-label={`${pageNames[page]} ${direction < 0 ? copy("上移", "move up") : copy("下移", "move down")}`}
                  onClick={() => {
                    const next = [...order];
                    [next[index], next[index + direction]] = [
                      next[index + direction],
                      next[index],
                    ];
                    patch({ menuOrder: ["overview", "network", ...next] });
                  }}
                >
                  {direction < 0 ? "↑" : "↓"}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
