import { useTranslation } from "react-i18next";
import { Globe, Layers, LayoutGrid } from "lucide-react";
import type { Domain } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import logo from "@/assets/icons/logo.svg";
import { HoverTip } from "@/components/ui/hover-tip";

export function DomainRail({
  domain,
  onSelect,
}: {
  domain: Domain;
  onSelect: (domain: Domain) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const items = [
    { id: "overview", label: zh ? "概览" : "Overview", Icon: LayoutGrid },
    { id: "network", label: zh ? "网络" : "Network", Icon: Globe },
    { id: "model", label: zh ? "模型" : "Models", Icon: Layers },
  ] as const;
  return (
    <nav
      aria-label={zh ? "一级导航" : "Primary navigation"}
      className="sivio-domain-rail z-10 flex h-full w-16 shrink-0 flex-col items-center px-2"
    >
      <img
        src={logo}
        alt="Sivio"
        title="Sivio — Your Shortcut to AI"
        draggable={false}
        className="mb-6 mt-4 h-8 w-8"
      />
      <div className="flex w-full flex-col gap-2">
        {items.map(({ id, label, Icon }) => (
          <HoverTip key={id} content={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-current={domain === id ? "page" : undefined}
              onClick={() => onSelect(id)}
              className={cn(
                "relative flex h-12 w-full items-center justify-center rounded-xl border border-transparent text-fg-2 transition-colors hover:bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                domain === id &&
                  "border-primary/20 bg-selected font-medium text-primary hover:bg-selected",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="sr-only">{label}</span>
            </button>
          </HoverTip>
        ))}
      </div>
      <span className="mb-4 mt-auto flex flex-col items-center gap-2 text-caption text-fg-3">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {zh ? "本地" : "Local"}
      </span>
    </nav>
  );
}
