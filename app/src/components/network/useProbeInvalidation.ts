import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NetworkSnapshot } from "./networkTypes";

export function probeIdentity(snapshot: NetworkSnapshot) {
  const active = snapshot.catalog.profiles.find(
    (profile) => profile.id === snapshot.catalog.active,
  );
  return JSON.stringify([
    snapshot.runtime.generation,
    snapshot.runtime.phase,
    snapshot.runtime.selectionEpoch,
    snapshot.runtime.proxyGuardInspectionUnavailable,
    snapshot.runtime.active,
    snapshot.runtime.proxyGuardTripped,
    snapshot.runtime.proxyGuardWaitingForNetwork,
    snapshot.runtime.recoveryRequired,
    snapshot.runtime.recoveryStatus,
    snapshot.appRestartRequired,
    snapshot.settingsRevision,
    active?.id,
    active?.revision,
    snapshot.catalog.outbound,
  ]);
}

export function useProbeInvalidation(invalidate: () => void) {
  const cache = useQueryClient();
  useEffect(() => {
    // Existing network writes and runtime events invalidate this query prefix.
    const unsubscribe = cache.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.action.type === "invalidate" &&
        event.query.queryKey[0] === "network"
      )
        invalidate();
    });
    const unsubscribeWrites = cache.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "pending")
        invalidate();
    });
    const events = ["focus", "blur", "online", "offline"] as const;
    events.forEach((name) => window.addEventListener(name, invalidate));
    document.addEventListener("visibilitychange", invalidate);
    return () => {
      unsubscribe();
      unsubscribeWrites();
      events.forEach((name) => window.removeEventListener(name, invalidate));
      document.removeEventListener("visibilitychange", invalidate);
    };
  }, [cache, invalidate]);
}
