import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appearanceSafeMode,
  cacheAppearance,
  setAppearanceSafeMode,
  defaultAppearance,
  readCachedAppearance,
  validateAppearance,
  applyAppearance,
  type Appearance,
  type AppearanceSnapshot,
} from "@/lib/appearance";

type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  appearance: Appearance;
  appearanceRevision: string | null;
  appearanceReady: boolean;
  appearanceError: string;
  appearanceSafeMode: boolean;
  setAppearance: (
    value: Appearance,
    expected: string | null,
  ) => Promise<AppearanceSnapshot>;
  resetAppearance: () => Promise<AppearanceSnapshot>;
}

const ThemeProviderContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

/**
 * 切换 html 上的 light / dark。切换期间暂停所有过渡（`.theme-switching`），
 * 否则各处的 transition-colors 会让颜色一块块慢慢变过去。
 */
function applyColorScheme(isDark: boolean) {
  const root = window.document.documentElement;
  if (
    root.classList.contains("dark") === isDark &&
    root.classList.contains("light") === !isDark
  ) {
    return;
  }
  root.classList.add("theme-switching");
  root.classList.toggle("dark", isDark);
  root.classList.toggle("light", !isDark);
  // 强制重排一次，让不带过渡的新颜色先落定，再在第二帧恢复过渡。
  void window.document.body?.offsetHeight;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "si-assist-theme",
}: ThemeProviderProps) {
  const client = useQueryClient();
  const [appearance, setAppearanceState] =
    useState<Appearance>(readCachedAppearance);
  const [safeMode, setSafeMode] = useState(appearanceSafeMode);
  const preferences = useQuery({
    queryKey: ["appearance"],
    queryFn: () =>
      invoke<AppearanceSnapshot>("network_command", {
        action: "appearance.get",
        args: {},
      }),
    retry: 1,
  });
  useEffect(() => {
    if (!preferences.data || safeMode) return;
    try {
      const value = validateAppearance(preferences.data.preferences);
      setAppearanceState(value);
      cacheAppearance(value);
    } catch {
      setAppearanceState({ ...defaultAppearance });
    }
  }, [preferences.data, safeMode]);
  useEffect(() => {
    applyAppearance(appearance);
    return () => {
      document.querySelector("#si-assist-appearance")?.remove();
    };
  }, [appearance]);
  const resetAppearance = React.useCallback(async () => {
    setAppearanceSafeMode(true);
    setSafeMode(true);
    setAppearanceState({ ...defaultAppearance });
    const saved = await invoke<AppearanceSnapshot>("network_command", {
      action: "appearance.reset",
      args: {},
    });
    client.setQueryData(["appearance"], saved);
    setAppearanceSafeMode(false);
    setSafeMode(false);
    return saved;
  }, [client]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let active = true;
    void listen("appearance-reset", () => {
      void resetAppearance().catch(() => {});
      void invoke("take_appearance_reset").catch(() => {});
    })
      .then((unlisten) => {
        if (active) dispose = unlisten;
        else unlisten();
      })
      .catch(() => {});
    void invoke<boolean>("take_appearance_reset")
      .then((reset) => {
        if (active && reset) void resetAppearance().catch(() => {});
      })
      .catch(() => {});
    const recover = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "Backspace"
      ) {
        event.preventDefault();
        void resetAppearance().catch(() => {});
      }
    };
    window.addEventListener("keydown", recover, true);
    return () => {
      active = false;
      dispose?.();
      window.removeEventListener("keydown", recover, true);
    };
  }, [resetAppearance]);
  const setAppearance = React.useCallback(
    async (value: Appearance, expected: string | null) => {
      value = validateAppearance(value);
      try {
        const saved = await invoke<AppearanceSnapshot>("network_command", {
          action: "appearance.save",
          args: { preferences: value, revision: expected },
        });
        setAppearanceSafeMode(false);
        cacheAppearance(saved.preferences);
        setSafeMode(false);
        setAppearanceState(saved.preferences);
        client.setQueryData(["appearance"], saved);
        return saved;
      } catch (error) {
        void client.invalidateQueries({ queryKey: ["appearance"] });
        throw error;
      }
    },
    [client],
  );
  const getInitialTheme = () => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }

    const stored = window.localStorage.getItem(storageKey) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }

    return defaultTheme;
  };

  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, theme);
    } catch {
      /* Cache failure must not break the application. */
    }
  }, [theme, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isDark =
      theme === "system"
        ? window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";
    applyColorScheme(isDark);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme !== "system") {
        return;
      }

      applyColorScheme(mediaQuery.matches);
    };

    if (theme === "system") {
      handleChange();
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Sync native window theme (Windows/macOS title bar)
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let isCancelled = false;

    const updateNativeTheme = async (nativeTheme: string) => {
      if (isCancelled) return;
      try {
        await invoke("set_window_theme", { theme: nativeTheme });
      } catch (e) {
        // Ignore errors (e.g., when not running in Tauri)
        console.debug("Failed to set native window theme:", e);
      }
    };

    // When "system", pass "system" so Tauri uses None (follows OS theme natively).
    // This keeps the WebView's prefers-color-scheme in sync with the real OS theme,
    // allowing effect #3's media query listener to fire on system theme changes.
    if (theme === "system") {
      updateNativeTheme("system");
    } else {
      updateNativeTheme(theme);
    }

    return () => {
      isCancelled = true;
    };
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      appearance,
      appearanceRevision: preferences.data?.revision ?? null,
      appearanceReady: !!preferences.data,
      appearanceError: preferences.error ? String(preferences.error) : "",
      appearanceSafeMode: safeMode,
      setAppearance,
      resetAppearance,
      setTheme: (nextTheme: Theme) => {
        if (nextTheme === theme) return;
        setThemeState(nextTheme);
      },
    }),
    [
      theme,
      appearance,
      preferences.data,
      preferences.error,
      safeMode,
      setAppearance,
      resetAppearance,
    ],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
