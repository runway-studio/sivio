import type { AppId } from "@/lib/api";
import { APP_IDS, isProxyAppId } from "@/config/appConfig";
export const ONBOARDING_KEY = "sivio.client-onboarding.v1";
export type OnboardingStep =
  | "choose"
  | "install"
  | "configure"
  | "model"
  | "verify"
  | "finish";
export interface OnboardingProgress {
  version: 1;
  app: AppId;
  step: OnboardingStep;
  skipped: boolean;
}
const steps: OnboardingStep[] = [
  "choose",
  "install",
  "configure",
  "model",
  "verify",
  "finish",
];
export function readOnboarding(raw: string | null): OnboardingProgress {
  if (!raw)
    return { version: 1, app: "claude", step: "choose", skipped: false };
  const value = JSON.parse(raw);
  if (value.version !== 1) throw new Error("Unsupported onboarding version");
  if (
    !APP_IDS.includes(value.app) ||
    !steps.includes(value.step) ||
    typeof value.skipped !== "boolean"
  )
    throw new Error("Invalid onboarding record");
  return {
    version: 1,
    app: value.app,
    step: value.step,
    skipped: value.skipped,
  };
}
export function saveOnboarding(progress: OnboardingProgress) {
  // Refuse to overwrite a future-version record during downgrade.
  readOnboarding(localStorage.getItem(ONBOARDING_KEY));
  localStorage.setItem(
    ONBOARDING_KEY,
    JSON.stringify({
      version: 1,
      app: progress.app,
      step: progress.step,
      skipped: progress.skipped,
    }),
  );
}
export function resumeStep(
  progress: OnboardingProgress,
  configured: boolean,
  modelSelected: boolean,
): OnboardingStep {
  if (progress.step === "choose" || progress.step === "install")
    return progress.step;
  if (!configured) return "configure";
  if (!isProxyAppId(progress.app)) return "finish";
  if (!modelSelected) return "model";
  return progress.step === "finish" ? "finish" : "verify";
}
export function clientCommand(app: AppId): string {
  return app === "grokbuild"
    ? "grok"
    : app === "claude-desktop"
      ? "Claude.app"
      : app;
}
