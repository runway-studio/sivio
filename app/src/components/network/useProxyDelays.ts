import { useEffect, useMemo, useRef, useState } from "react";
import { networkApi } from "./networkApi";
import type { ProxyDelay } from "./proxyNodes";
// Shared by all groups and generations in this mounted page. Cancelled work is
// skipped before entering IPC; already-issued bounded native reads may finish.
class DelayQueue {
  private active = 0;
  private jobs: (() => void)[] = [];
  run(work: () => Promise<void>) {
    return new Promise<void>((resolve) => {
      const start = () => {
        this.active++;
        void work().finally(() => {
          this.active--;
          resolve();
          this.jobs.shift()?.();
        });
      };
      if (this.active < 4) start();
      else this.jobs.push(start);
    });
  }
}
export function validProbeUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      value.length <= 4096 &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function useProxyDelays(
  generation: number,
  url: string,
  timeout: number,
) {
  const queue = useRef(new DelayQueue());
  const scope = useMemo(
    () => ({
      cancelled: false,
      results: {} as Record<string, ProxyDelay>,
      groups: new Set<string>(),
      pending: new Map<string, Promise<void>>(),
    }),
    [generation, url, timeout],
  );
  useEffect(() => {
    scope.cancelled = false;
    return () => {
      scope.cancelled = true;
    };
  }, [scope]);
  const [view, setView] = useState({
    scope,
    results: scope.results,
    sorted: scope.results,
    groups: [] as string[],
    error: "",
  });
  const publish = (settled = false, error = "") => {
    if (!scope.cancelled)
      setView((previous) => ({
        scope,
        results: { ...scope.results },
        sorted: settled
          ? { ...scope.results }
          : previous.scope === scope
            ? previous.sorted
            : {},
        groups: [...scope.groups],
        error,
      }));
  };
  const test = async (group: string, members: string[]) => {
    if (scope.cancelled || scope.groups.has(group)) return;
    if (!validProbeUrl(url)) {
      publish(false, "测速地址必须是无凭据的 HTTP(S) URL");
      return;
    }
    const nodes = [...new Set(members)];
    if (nodes.length > 10000) {
      publish(false, "分组过大，请分批测速");
      return;
    }
    scope.groups.add(group);
    nodes.forEach((node) => {
      scope.results[node] = { state: "testing" };
    });
    publish();
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, nodes.length) }, async () => {
        while (!scope.cancelled && index < nodes.length) {
          const node = nodes[index++];
          const existing = scope.pending.get(node);
          if (existing) {
            await existing;
            continue;
          }
          const pending = queue.current.run(async () => {
            if (scope.cancelled) return;
            try {
              const result = await networkApi<{
                generation: number;
                delay: number;
              }>("delay", { node, url, timeout, generation });
              if (scope.cancelled) return;
              if (
                result.generation !== generation ||
                !Number.isFinite(result.delay) ||
                result.delay < 0
              )
                throw new Error("测速结果已过期 / Stale delay result");
              scope.results[node] = { state: "success", delay: result.delay };
            } catch (error) {
              if (scope.cancelled) return;
              scope.results[node] = {
                state: "error",
                message: error instanceof Error ? error.message : String(error),
              };
            }
            publish();
          });
          scope.pending.set(node, pending);
          await pending;
          scope.pending.delete(node);
        }
      }),
    );
    if (scope.cancelled) return;
    scope.groups.delete(group);
    publish(scope.groups.size === 0);
  };
  return {
    results: view.scope === scope ? view.results : {},
    sorted: view.scope === scope ? view.sorted : {},
    testing: view.scope === scope ? view.groups : [],
    error: view.scope === scope ? view.error : "",
    test,
  };
}
