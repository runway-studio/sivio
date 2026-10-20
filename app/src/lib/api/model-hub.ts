import { invoke } from "@tauri-apps/api/core";
import type { ProxyAppId } from "@/config/appConfig";
export interface ModelProvider {
  id: string;
  name: string;
  models: string[];
  disabled?: string | null;
}
export interface ModelCatalog {
  providers: ModelProvider[];
  providerId?: string | null;
  model?: string | null;
  mode: string;
  revision: string;
}
export interface RouteDecision {
  group?: RoutingGroup | null;
  selection?: {
    strategy: RoutingStrategy;
    fallbackReason?: string | null;
    ranking: {
      providerId: string;
      model: string;
      dispatches: number;
      quota?: {
        source: string;
        status: string;
        window?: string | null;
        queriedAt?: number | null;
        remainingPercent?: number | null;
        resetsAt?: number | null;
        pacePerHour?: number | null;
      } | null;
    }[];
  } | null;
  id: string;
  app: string;
  createdAt: number;
  requestModel: string;
  mode: string;
  candidates: { id: string; name: string }[];
  attempts: {
    provider: { id: string; name: string };
    outboundModel?: string | null;
    result: string;
    status?: number | null;
    elapsedMs: number;
    retryAt?: number | null;
  }[];
  result: string;
  elapsedMs: number;
  responseModel?: string | null;
  bodyState: string;
}
export const modelHubApi = {
  catalog: (appType: ProxyAppId) =>
    invoke<ModelCatalog>("get_model_picker_catalog", { appType }),
  select: (
    appType: ProxyAppId,
    providerId: string,
    model: string,
    revision: string,
  ) =>
    invoke<ModelCatalog>("select_client_model", {
      appType,
      providerId,
      model,
      revision,
    }),
  decisions: (appType?: ProxyAppId) =>
    invoke<RouteDecision[]>("get_route_decisions", {
      appType: appType ?? null,
    }),
};
export type RoutingStrategy = "order" | "rotate" | "usage" | "smart" | "pace";
export interface RoutingGroup {
  id: string;
  name: string;
  strategy?: RoutingStrategy;
  members: { providerId: string; model: string }[];
}
export interface RoutingGroupsSnapshot {
  groups: RoutingGroup[];
  revision: string;
}
export const routingGroupsApi = {
  list: (appType: ProxyAppId) =>
    invoke<RoutingGroupsSnapshot>("get_routing_groups", { appType }),
  update: (
    appType: ProxyAppId,
    group: RoutingGroup,
    revision: string,
    remove = false,
  ) =>
    invoke<RoutingGroupsSnapshot>("update_routing_group", {
      appType,
      group,
      revision,
      delete: remove,
    }),
};

export type RoutingPhase =
  | "selecting"
  | "connecting"
  | "streaming"
  | "completed"
  | "failed"
  | "interrupted";
export interface RoutingLiveRecord {
  decision: RouteDecision;
  phase: RoutingPhase;
  currentProvider?: { id: string; name: string } | null;
  updatedAt: number;
  rerouted: boolean;
}
export interface RoutingLiveStats {
  app: string;
  groupId: string;
  requests: number;
  active: number;
  rerouted: number;
  completed: number;
  failed: number;
  interrupted: number;
}
export interface RoutingLiveSnapshot {
  startedAt: number;
  now: number;
  records: RoutingLiveRecord[];
  stats: RoutingLiveStats[];
  omitted: number;
}
export const routingLiveApi = {
  snapshot: () => invoke<RoutingLiveSnapshot>("get_routing_live"),
};
