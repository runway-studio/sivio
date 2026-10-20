import {
  useLayoutEffect,
  useState,
  type RefObject,
  type SetStateAction,
} from "react";

// UI-only, process-local state. Never use this for credentials or editor drafts.
const viewValues = new Map<string, unknown>();
export function useViewMemory<T>(key: string, fallback: T) {
  const read = () =>
    viewValues.has(key) ? (viewValues.get(key) as T) : fallback;
  const [entry, setEntry] = useState(() => ({ key, value: read() }));
  const value = entry.key === key ? entry.value : read();
  if (entry.key !== key) setEntry({ key, value });
  const update = (next: SetStateAction<T>) =>
    setEntry((previous) => {
      const before = previous.key === key ? previous.value : read();
      const resolved =
        typeof next === "function"
          ? (next as (previous: T) => T)(before)
          : next;
      viewValues.set(key, resolved);
      return { key, value: resolved };
    });
  return [value, update] as const;
}
const scrollValues = new Map<string, { top: number; left: number }>();
export function useViewScroll(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready: unknown = true,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready) return;
    const value = scrollValues.get(key) ?? { top: 0, left: 0 };
    {
      element.scrollTop = value.top;
      element.scrollLeft = value.left;
    }
    return () => {
      scrollValues.set(key, {
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    };
  }, [ref, key, !!ready]);
}

export function clearViewMemory() {
  viewValues.clear();
  scrollValues.clear();
}
