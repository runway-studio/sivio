import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTauriEvent } from "@/hooks/useTauriEvent";
export * from "./desktopPreferencesModel";
import {
  defaultDesktopPreferences,
  type DesktopPreferences,
  type DesktopSnapshot,
} from "./desktopPreferencesModel";
export function useDesktopPreferences() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["desktop-preferences"],
    queryFn: () =>
      invoke<DesktopSnapshot>("network_command", {
        action: "desktop.get",
        args: {},
      }),
    retry: false,
    staleTime: Infinity,
  });
  useTauriEvent("desktop-preferences-changed", () => {
    void client.invalidateQueries({ queryKey: ["desktop-preferences"] });
  });
  useTauriEvent("desktop-backup-result", () => {
    void client.invalidateQueries({ queryKey: ["desktop-preferences"] });
  });
  return query;
}

export function useWorkspacePreferences(): DesktopPreferences {
  const { data } = useDesktopPreferences();
  return { ...defaultDesktopPreferences, ...data?.preferences };
}
