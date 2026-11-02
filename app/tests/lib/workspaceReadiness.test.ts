import { describe, expect, it } from "vitest";
import {
  coreStatusLabel,
  verificationState,
  VERIFICATION_TTL_MS,
  type ReadinessIdentity,
  type ModelVerification,
} from "@/lib/workspaceReadiness";
import { visibleClientIds } from "@/config/appConfig";
const identity: ReadinessIdentity = {
  app: "claude",
  configurationRevision: "config-1",
  credentialEpoch: "auth-1",
  networkGeneration: 1,
  outboundRevision: "egress-1",
};
const evidence: ModelVerification = {
  identity,
  observedAt: 1000,
  state: "pass",
  reasonCode: "verified",
};
describe("readiness evidence", () => {
  it("does not infer model success from a running core", () => {
    expect(coreStatusLabel("running", true)).toBe("运行中");
    expect(verificationState(undefined, identity, 1000)).toBe("unknown");
    expect(
      verificationState(
        { ...evidence, state: "fail", reasonCode: "unauthorized" },
        identity,
        1000,
      ),
    ).toBe("fail");
  });
  it("expires exactly at ten minutes and rejects future/invalid evidence", () => {
    expect(
      verificationState(evidence, identity, 1000 + VERIFICATION_TTL_MS - 1),
    ).toBe("pass");
    expect(
      verificationState(evidence, identity, 1000 + VERIFICATION_TTL_MS),
    ).toBe("stale");
    expect(verificationState(evidence, identity, 999)).toBe("stale");
    expect(
      verificationState({ ...evidence, observedAt: NaN }, identity, 1000),
    ).toBe("stale");
  });
  it.each(Object.keys(identity) as (keyof ReadinessIdentity)[])(
    "invalidates late evidence when %s changes",
    (key) => {
      const changed = {
        ...identity,
        [key]: key === "networkGeneration" ? 2 : "changed",
      };
      expect(verificationState(evidence, changed, 1001)).toBe("stale");
    },
  );
  it("preserves distinct lifecycle and unavailable states", () => {
    expect(coreStatusLabel("failed", true)).toBe("运行失败");
    expect(coreStatusLabel("starting", false)).toBe("Starting");
    expect(coreStatusLabel("stopping", false)).toBe("Stopping");
    expect(coreStatusLabel("future-state", false)).toBe("Status unknown");
    expect(coreStatusLabel("running", false, true)).toBe("Status unavailable");
  });
  it("preserves saved visibility including an entirely hidden selection", () => {
    expect(visibleClientIds({ codex: false })).not.toContain("codex");
    const hidden = Object.fromEntries(
      visibleClientIds().map((id) => [id, false]),
    );
    expect(visibleClientIds(hidden)).toEqual([]);
    expect(visibleClientIds()).toHaveLength(10);
  });
});
