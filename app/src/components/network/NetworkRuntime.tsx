import { createContext, useContext, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { hasPendingMutation } from "@/lib/unsavedChanges";
import { useNetworkText } from "./networkText";
import type { NetworkSnapshot } from "./networkTypes";

function useRuntime(active: boolean, inShell: boolean) {
  const client = useQueryClient();
  const snapshot = useQuery({
    queryKey: ["network", "snapshot"],
    queryFn: () =>
      invoke<NetworkSnapshot>("network_command", {
        action: "snapshot",
        args: {},
      }),
    enabled: active,
    retry: false,
    refetchOnWindowFocus: false,
    // Do not repeatedly reopen an OS authorization dialog after a failed read.
    refetchInterval: (query) => (query.state.status === "error" ? false : 2000),
  });
  useTauriEvent("network-runtime-changed", () => {
    void client.invalidateQueries({ queryKey: ["network"] });
  });
  const reload = useMutation({
    mutationFn: () =>
      invoke("network_command", { action: "preferences.reload", args: {} }),
    onSuccess: () => snapshot.refetch(),
  });
  const lifecycle = useMutation({
    mutationKey: ["network", "lifecycle"],
    mutationFn: async () => {
      if (hasPendingMutation())
        throw new Error(
          "正在保存配置，请稍后再试 / Configuration save in progress",
        );
      const current = client.getQueryData<NetworkSnapshot>([
        "network",
        "snapshot",
      ]);
      if (!current)
        throw new Error("正在加载网络配置 / Loading network configuration");
      return invoke("network_command", {
        action: ["running", "failed"].includes(current.runtime.phase)
          ? "stop"
          : "start",
        args: {},
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["network"] }),
  });
  return { snapshot, lifecycle, reload, inShell };
}
export const NetworkRuntimeContext = createContext<ReturnType<
  typeof useRuntime
> | null>(null);
export function NetworkRuntimeProvider({
  children,
  active,
  inShell = false,
}: {
  children: ReactNode;
  active: boolean;
  inShell?: boolean;
}) {
  const runtime = useRuntime(active, inShell);
  return (
    <NetworkRuntimeContext.Provider value={runtime}>
      {children}
    </NetworkRuntimeContext.Provider>
  );
}
export function useNetworkRuntime() {
  const runtime = useContext(NetworkRuntimeContext);
  if (!runtime) throw new Error("NetworkRuntimeProvider is required");
  return runtime;
}
function message(error: unknown): string {
  if (typeof error === "object" && error && "message" in error)
    return String(error.message);
  return String(error);
}
export function NetworkControl({
  collapsed = false,
  inline = false,
}: {
  collapsed?: boolean;
  inline?: boolean;
}) {
  const tr = useNetworkText();
  const { snapshot, lifecycle, reload } = useNetworkRuntime();
  const data = snapshot.data;
  const running = data?.runtime.phase === "running";
  const failed = data?.runtime.phase === "failed";
  const label = running
    ? tr("停止")
    : failed
      ? tr("清理并停止")
      : tr("启动网络");
  const status = !data
    ? tr("正在加载网络配置")
    : running
      ? `${data.runtime.managed ? tr("受管") : tr("普通")}${tr("内核")} · :${data.runtime.port}`
      : failed
        ? tr("运行失败")
        : tr("已停止");
  const error = reload.error ?? lifecycle.error ?? snapshot.error;
  return (
    <div
      data-testid="network-control"
      className={
        inline
          ? "flex items-center gap-3"
          : "min-w-0 shrink-0 overflow-hidden border-t border-border p-3"
      }
    >
      {!collapsed && (
        <p
          role="status"
          className="mb-2 truncate text-xs text-muted-foreground"
          title={status}
        >
          {status}
        </p>
      )}
      <HoverTip
        content={collapsed ? `${label} · ${status}` : undefined}
        side="right"
      >
        <Button
          aria-label={label}
          title={collapsed ? `${label} · ${status}` : undefined}
          disabled={lifecycle.isPending || !data}
          size="sm"
          className={collapsed ? "h-9 w-full p-0" : inline ? "" : "w-full"}
          onClick={() => lifecycle.mutate()}
        >
          {lifecycle.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : running || failed ? (
            <Square size={14} />
          ) : (
            <Play size={14} />
          )}
          {!collapsed && label}
        </Button>
      </HoverTip>
      {snapshot.isError && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          aria-label={tr("重试读取配置")}
          disabled={reload.isPending}
          onClick={() => reload.mutate()}
        >
          {collapsed ? "↻" : tr("重试读取配置")}
        </Button>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 whitespace-normal break-words text-xs text-destructive"
          title={message(error)}
        >
          {collapsed ? "!" : message(error)}
        </p>
      )}
    </div>
  );
}
