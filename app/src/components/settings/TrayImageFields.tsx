import { useState } from "react";
import type { DesktopPreferences } from "@/lib/desktopPreferencesModel";
import { normalizeIconFile, CUSTOM_ICON_ACCEPT } from "@/utils/customIcon";
import { Button } from "@/components/ui/button";
export function TrayImageFields({
  draft,
  patch,
  zh,
  onBusy,
}: {
  draft: DesktopPreferences;
  patch: (value: Partial<DesktopPreferences>) => void;
  zh: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const copy = (cn: string, en: string) => (zh ? cn : en);
  return (
    <div className="space-y-3 md:col-span-2">
      <p className="text-xs">
        {copy(
          "自定义托盘图片（TUN 优先于系统代理，留空使用常规图标）",
          "Custom tray images (TUN takes priority over system proxy; empty slots use the normal icon)",
        )}
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {(
        [
          [
            "trayNormalImage",
            "trayNormalImageEnabled",
            copy("常规图标", "Normal icon"),
          ],
          [
            "trayProxyImage",
            "trayProxyImageEnabled",
            copy("系统代理图标", "System proxy icon"),
          ],
          ["trayTunImage", "trayTunImageEnabled", copy("TUN 图标", "TUN icon")],
        ] as const
      ).map(([key, enabled, label]) => (
        <div
          key={key}
          className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
        >
          {draft[key] && (
            <img src={draft[key]!} alt="" className="h-6 w-6 object-contain" />
          )}
          <label className="min-w-0 flex-1 text-xs">
            {label}
            <input
              className="mt-2 block max-w-full text-xs"
              aria-label={label}
              type="file"
              accept={CUSTOM_ICON_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setError("");
                onBusy(true);
                void normalizeIconFile(file)
                  .then((data) => patch({ [key]: data, [enabled]: true }))
                  .catch((error) => setError(String(error)))
                  .finally(() => onBusy(false));
              }}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft[enabled]}
              disabled={!draft[key]}
              aria-label={`${label} ${copy("启用", "enabled")}`}
              onChange={(event) => patch({ [enabled]: event.target.checked })}
            />
            {copy("启用", "Enable")}
          </label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!draft[key]}
            onClick={() => patch({ [key]: null, [enabled]: false })}
          >
            {copy("清除此图片", "Clear image")}
          </Button>
        </div>
      ))}
    </div>
  );
}
