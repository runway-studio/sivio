import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  appendTraffic,
  TRAFFIC_INTERVAL_MS,
  type MemorySample,
  type TrafficSample,
} from "./networkTraffic";

// One bounded history per application query client, shared by Home and Traffic.
// Navigation may dispose a view, but must not dispose the current core's data.
const histories = new WeakMap<QueryClient, TrafficSample[]>();

function useMetricQuery<T extends { generation: number }>(
  metric: "traffic" | "memory",
  generation: number,
  enabled: boolean,
  interval: number,
) {
  const client = useQueryClient();
  const duration = useRef(0);
  return useQuery({
    queryKey: ["network", "metrics", metric, generation],
    enabled,
    queryFn: async () => {
      const start = performance.now();
      try {
        const sample = await invoke<T>("network_command", {
          action: "metrics",
          args: { metric, generation },
        });
        if (sample.generation !== generation)
          throw new Error("Network core changed during sampling");
        if (metric === "traffic") {
          const previous = histories.get(client) ?? [];
          if ((previous.at(-1)?.generation ?? -1) <= generation)
            histories.set(
              client,
              appendTraffic(previous, sample as unknown as TrafficSample),
            );
        }
        return sample;
      } finally {
        duration.current = performance.now() - start;
      }
    },
    // Mihomo waits one second before its first traffic frame. Compensate for
    // the read duration instead of adding another second after every read.
    refetchInterval: () => Math.max(50, interval - duration.current),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 300_000,
    staleTime: interval,
    refetchOnMount: false,
  });
}

export function useNetworkTraffic({
  running,
  generation,
  memoryUsage,
  pauseTrafficOnBlur,
  active = true,
}: {
  running: boolean;
  generation: number;
  memoryUsage: boolean;
  pauseTrafficOnBlur: boolean;
  active?: boolean;
}) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  const enabled = active && running && (visible || !pauseTrafficOnBlur);
  const traffic = useMetricQuery<TrafficSample>(
    "traffic",
    generation,
    enabled,
    TRAFFIC_INTERVAL_MS,
  );
  const memory = useMetricQuery<MemorySample>(
    "memory",
    generation,
    enabled && memoryUsage,
    5_000,
  );
  const [history, setHistory] = useState<TrafficSample[]>(
    () => histories.get(client) ?? [],
  );
  useEffect(() => {
    if (!running) {
      histories.delete(client);
      setHistory([]);
    } else if (traffic.data?.generation === generation) {
      const sample = traffic.data;
      const next = appendTraffic(histories.get(client) ?? [], sample);
      histories.set(client, next);
      setHistory(next);
    }
  }, [client, running, generation, traffic.data]);
  return {
    traffic,
    memory,
    visible: visible && active,
    history:
      running && history.at(-1)?.generation === generation ? history : [],
  };
}
