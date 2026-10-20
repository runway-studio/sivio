import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
export function ProxyGroupNavigator({
  names,
  enabled,
  delay,
  onLocate,
}: {
  names: string[];
  enabled: boolean;
  delay: number;
  onLocate: (name: string) => void;
}) {
  const { i18n } = useTranslation();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = () => clearTimeout(timer.current);
  const namesKey = JSON.stringify(names);
  useEffect(() => cancel, [enabled, delay, namesKey]);
  return (
    <nav
      aria-label={
        i18n.language.startsWith("zh")
          ? "代理分组导航"
          : "Proxy group navigator"
      }
      className="proxy-group-nav flex flex-wrap gap-1"
    >
      {names.map((name) => (
        <button
          key={name}
          title={name}
          className="max-w-full truncate rounded-md px-2 py-1.5 text-xs font-medium transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerEnter={(event) => {
            cancel();
            if (enabled && event.pointerType !== "touch")
              timer.current = setTimeout(() => onLocate(name), delay);
          }}
          onPointerLeave={cancel}
          onPointerDown={cancel}
          onClick={() => {
            cancel();
            onLocate(name);
          }}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}
