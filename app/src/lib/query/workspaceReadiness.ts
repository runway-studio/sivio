import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "@/lib/api/types";
import type { ReadinessSnapshot } from "@/lib/workspaceReadiness";

export function diagnosticStartKey(app: AppId) {
  return ["client-diagnostic", app, "start"] as const;
}

export function useWorkspaceReadiness(app: AppId, visible = true) {
  return useQuery({
    // Provider writes already invalidate this prefix; polling covers runtime changes.
    queryKey: ["providers", app, "readiness"],
    queryFn: () =>
      invoke<ReadinessSnapshot>("get_workspace_readiness", { appType: app }),
    enabled: (query) =>
      visible || query.state.data?.diagnostic?.state === "pending",
    refetchInterval: (query) =>
      query.state.data?.diagnostic?.state === "pending" ? 1000 : 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  });
}
