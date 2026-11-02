import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "@/lib/api/types";
import type { ReadinessSnapshot } from "@/lib/workspaceReadiness";

export function useWorkspaceReadiness(app: AppId) {
  return useQuery({
    // Provider writes already invalidate this prefix; polling covers runtime changes.
    queryKey: ["providers", app, "readiness"],
    queryFn: () =>
      invoke<ReadinessSnapshot>("get_workspace_readiness", { appType: app }),
    refetchInterval: (query) =>
      query.state.data?.diagnostic?.state === "pending" ? 1000 : 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
}
