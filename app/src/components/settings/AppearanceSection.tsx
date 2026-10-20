import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
import {
  defaultAppearance,
  noticePositions,
  type Appearance,
} from "@/lib/appearance";
import { usePendingMutation, useUnsavedValue } from "@/lib/unsavedChanges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
const message = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : String(error);
export function AppearanceSection() {
  const { i18n } = useTranslation();
  const zh = i18n?.language?.startsWith("zh") ?? true;
  const theme = useTheme();
  const current = theme.appearance ?? defaultAppearance;
  const [draft, setDraft] = useState<Appearance>(current);
  const [original, setOriginal] = useState(current);
  const [revision, setRevision] = useState(theme.appearanceRevision ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(original);
  useUnsavedValue(dirty);
  usePendingMutation(busy);
  useEffect(() => {
    if (!dirty) {
      setDraft(current);
      setOriginal(current);
      setRevision(theme.appearanceRevision ?? null);
    }
  }, [current, theme.appearanceRevision, dirty]);
  function patch(value: Partial<Appearance>) {
    setDraft((previous) => ({ ...previous, ...value }));
    setError("");
  }
  function reload() {
    setDraft(current);
    setOriginal(current);
    setRevision(theme.appearanceRevision ?? null);
    setError("");
  }
  async function apply(reset = false) {
    setBusy(true);
    setError("");
    try {
      const saved = reset
        ? await theme.resetAppearance()
        : await theme.setAppearance(draft, revision);
      setDraft(saved.preferences);
      setOriginal(saved.preferences);
      setRevision(saved.revision);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="my-5 space-y-3 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">
        {zh ? "颜色、字体与自定义样式" : "Color, fonts and custom styles"}
      </h3>
      <p className="text-xs leading-6 text-muted-foreground">
        {zh
          ? "默认沿用 Sivio 配色。自定义 CSS 仅支持本地样式；不支持外部资源、导入或转义语法。如样式遮住页面，可从托盘选择「恢复默认外观」，或按 ⌘⇧⌫。"
          : "The default uses the Sivio palette. Custom CSS supports local styles without external resources, imports or escapes. If CSS hides the interface, use Reset appearance in the native tray menu or press ⌘⇧⌫."}
      </p>
      <fieldset
        disabled={busy || !theme.appearanceReady}
        className="grid gap-3 md:grid-cols-2"
      >
        <label className="space-y-1 text-xs">
          {zh
            ? "界面字体（留空使用默认）"
            : "Interface font (blank uses default)"}
          <Input
            aria-label={zh ? "界面字体" : "Interface font"}
            value={draft.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value })}
            placeholder="Helvetica Neue / PingFang SC"
          />
        </label>
        <label className="space-y-1 text-xs">
          {zh
            ? "界面字号（0 使用默认）"
            : "Interface font size (0 uses default)"}
          <Input
            aria-label={zh ? "界面字号" : "Interface font size"}
            type="number"
            min={0}
            max={24}
            value={draft.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="space-y-1 text-xs">
          {zh ? "编辑器字体" : "Editor font"}
          <Input
            aria-label={zh ? "编辑器字体" : "Editor font"}
            value={draft.editorFontFamily}
            onChange={(e) => patch({ editorFontFamily: e.target.value })}
            placeholder="Menlo"
          />
        </label>
        <label className="space-y-1 text-xs">
          {zh
            ? "编辑器字号（0 使用默认）"
            : "Editor font size (0 uses default)"}
          <Input
            aria-label={zh ? "编辑器字号" : "Editor font size"}
            type="number"
            min={0}
            max={32}
            value={draft.editorFontSize}
            onChange={(e) => patch({ editorFontSize: Number(e.target.value) })}
          />
        </label>
        <label className="space-y-1 text-xs">
          {zh ? "主题色" : "Accent color"}
          <div className="flex items-center gap-2">
            <input
              aria-label={zh ? "自定义主题色" : "Custom accent color"}
              type="color"
              value={draft.accent || "#7055d8"}
              onChange={(e) => patch({ accent: e.target.value })}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patch({ accent: "" })}
            >
              {zh ? "默认配色" : "Default palette"}
            </Button>
          </div>
        </label>
        <label className="space-y-1 text-xs">
          {zh ? "通知位置" : "Notification position"}
          <select
            aria-label={zh ? "通知位置" : "Notification position"}
            className="block w-full rounded border bg-background p-2"
            value={draft.noticePosition}
            onChange={(e) =>
              patch({
                noticePosition: e.target.value as Appearance["noticePosition"],
              })
            }
          >
            {noticePositions.map((position) => (
              <option key={position} value={position}>
                {zh
                  ? {
                      "top-left": "左上",
                      "top-center": "顶部居中",
                      "top-right": "右上",
                      "bottom-left": "左下",
                      "bottom-center": "底部居中",
                      "bottom-right": "右下",
                    }[position]
                  : position}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs md:col-span-2">
          CSS
          <textarea
            aria-label="Custom CSS"
            className="block min-h-32 w-full rounded border bg-background p-3 font-mono text-xs"
            value={draft.css}
            onChange={(e) => patch({ css: e.target.value })}
            spellCheck={false}
          />
        </label>
      </fieldset>
      {(error || theme.appearanceError) && (
        <p role="alert" className="text-xs text-destructive">
          {error || theme.appearanceError}
        </p>
      )}
      {theme.appearanceSafeMode && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? "正在使用安全默认外观；保存成功后重新启用自定义外观。"
            : "Using safe defaults; a successful save re-enables custom appearance."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy || !dirty || !theme.appearanceReady}
          onClick={() => void apply()}
        >
          {zh ? "应用外观" : "Apply appearance"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !theme.resetAppearance}
          onClick={() => void apply(true)}
        >
          {zh ? "恢复默认外观" : "Reset appearance"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !dirty}
          onClick={reload}
        >
          {zh ? "放弃修改并重载" : "Discard and reload"}
        </Button>
      </div>
    </section>
  );
}
