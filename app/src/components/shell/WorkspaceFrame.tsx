import type { ReactNode, Ref } from "react";
import { useTranslation } from "react-i18next";
import { DRAG_REGION_ATTR, DRAG_REGION_STYLE } from "@/lib/platform";

/** Shared window chrome and the three navigation levels; each page owns its scrolling. */
export function WorkspaceFrame({
  rail,
  directory,
  location,
  contentRef,
  children,
}: {
  rail: ReactNode;
  directory: ReactNode;
  location: ReactNode;
  contentRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="sivio-shell flex h-screen flex-col overflow-hidden text-fg-1 selection:bg-action/25">
      <header
        {...DRAG_REGION_ATTR}
        style={DRAG_REGION_STYLE as React.CSSProperties}
        aria-label={
          i18n.language.startsWith("zh") ? "当前位置" : "Current location"
        }
        className="sivio-window-bar flex h-11 min-w-0 shrink-0 items-center gap-2 text-caption text-fg-3"
      >
        <span {...DRAG_REGION_ATTR} className="shrink-0 font-medium text-fg-2">
          {t("app.title")}
        </span>
        <span {...DRAG_REGION_ATTR} aria-hidden className="shrink-0 opacity-40">
          /
        </span>
        {location}
      </header>
      <div className="sivio-shell-body flex min-h-0 flex-1">
        {rail}
        <div className="sivio-workspace flex min-w-0 flex-1 overflow-hidden">
          {directory}
          <main
            ref={contentRef}
            id="content-area"
            tabIndex={-1}
            className="relative isolate flex min-w-0 flex-1 flex-col overflow-hidden bg-app"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
