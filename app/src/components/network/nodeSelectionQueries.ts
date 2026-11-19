import type { QueryClient } from "@tanstack/react-query";

import type { NetworkSnapshot } from "./networkTypes";

export function nodeListKey(generation?: number) {
  return generation === undefined
    ? (["network", "proxies"] as const)
    : (["network", "proxies", generation] as const);
}

/** The selection is committed. Only its controller readback gates the selector. */
export async function refreshNodeSelection(
  cache: QueryClient,
  generation?: number,
) {
  void cache.invalidateQueries({
    queryKey: ["network", "snapshot"],
    exact: true,
  });
  const prefixes = [["network", "home", "ip"]];
  if (
    cache.getQueryData<NetworkSnapshot>(["network", "snapshot"])?.catalog
      .settings.closeConnectionsOnSwitch
  ) {
    prefixes.push(["network", "detail", "连接"]);
  }
  for (const prefix of prefixes) {
    void cache.invalidateQueries({
      queryKey: generation === undefined ? prefix : [...prefix, generation],
    });
  }
  void cache.invalidateQueries({
    queryKey: ["providers"],
    predicate: ({ queryKey }) => queryKey[2] === "readiness",
  });
  try {
    await cache.invalidateQueries(
      { queryKey: nodeListKey(generation) },
      { throwOnError: true },
    );
    return true;
  } catch {
    return false;
  }
}
