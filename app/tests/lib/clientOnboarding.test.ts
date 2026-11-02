import { beforeEach, expect, it } from "vitest";
import {
  APP_IDS,
  clientCapabilityLabel,
  isProxyAppId,
  visibleClientIds,
} from "@/config/appConfig";
import {
  ONBOARDING_KEY,
  readOnboarding,
  saveOnboarding,
  resumeStep,
} from "@/lib/clientOnboarding";
beforeEach(() => localStorage.clear());
it.each(APP_IDS)(
  "resumes %s using current facts, not saved completion",
  (app) => {
    const p = {
      version: 1 as const,
      app,
      step: "verify" as const,
      skipped: true,
    };
    saveOnboarding(p);
    const saved = readOnboarding(localStorage.getItem(ONBOARDING_KEY));
    expect(saved).toEqual(p);
    expect(resumeStep(saved, false, true)).toBe("configure");
    expect(resumeStep(saved, true, false)).toBe(
      isProxyAppId(app) ? "model" : "finish",
    );
  },
);
it("preserves a future record and excludes unexpected fields", () => {
  const future = JSON.stringify({
    version: 2,
    app: "claude",
    step: "choose",
    skipped: false,
  });
  localStorage.setItem(ONBOARDING_KEY, future);
  expect(() =>
    saveOnboarding({
      version: 1,
      app: "claude",
      step: "finish",
      skipped: true,
    }),
  ).toThrow();
  expect(localStorage.getItem(ONBOARDING_KEY)).toBe(future);
  expect(
    readOnboarding(
      JSON.stringify({
        version: 1,
        app: "claude",
        step: "choose",
        skipped: false,
        token: "secret",
      }),
    ),
  ).not.toHaveProperty("token");
});
it("maintains the ten/four/two matrix and leaves existing visibility unchanged", () => {
  expect(APP_IDS).toHaveLength(10);
  expect(
    APP_IDS.filter((a) => clientCapabilityLabel(a, false).includes("Gateway")),
  ).toHaveLength(4);
  expect(
    APP_IDS.filter((a) =>
      clientCapabilityLabel(a, false).includes("Aggregation"),
    ),
  ).toHaveLength(2);
  const visibility = { codex: false, claude: true };
  expect(visibleClientIds(visibility)).not.toContain("codex");
  expect(visibility).toEqual({ codex: false, claude: true });
});
