import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ClientDiagnostic } from "@/components/overview/ClientDiagnostic";
import { modelHubApi } from "@/lib/api/model-hub";
import type { ReadinessSnapshot } from "@/lib/workspaceReadiness";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/api/model-hub", () => ({ modelHubApi: { catalog: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
const snapshot: ReadinessSnapshot = {
  app: "claude",
  configurationRevision: "c",
  credentialEpoch: "k",
  networkGeneration: 1,
  outboundRevision: "o",
  observedAt: 0,
  checks: [],
};
function mount(value = snapshot, app: "claude" | "opencode" = "claude") {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ClientDiagnostic app={app} snapshot={value} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(modelHubApi.catalog).mockResolvedValue({
    providers: [{ id: "p", name: "Provider", models: ["m"] }],
    mode: "direct",
    revision: "c",
  });
});
it("requires target selection and cost confirmation, then sends one bounded diagnostic command", async () => {
  mount();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Verify model response" }),
  );
  await screen.findByRole("option", { name: "Provider" });
  fireEvent.change(screen.getByLabelText("Diagnostic provider"), {
    target: { value: "p" },
  });
  fireEvent.change(screen.getByLabelText("Diagnostic model ID"), {
    target: { value: "m" },
  });
  expect(
    screen.getByRole("button", { name: "Start diagnostic" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Start diagnostic" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("start_client_diagnostic", {
      appType: "claude",
      providerId: "p",
      model: "m",
      activeProbe: true,
      expected: {
        app: "claude",
        configurationRevision: "c",
        credentialEpoch: "k",
        networkGeneration: 1,
        outboundRevision: "o",
      },
    }),
  );
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("cancels the displayed run without starting another", async () => {
  mount({
    ...snapshot,
    diagnostic: {
      runId: "r",
      app: "claude",
      providerId: "p",
      model: "m",
      identity: snapshot,
      observedAt: 0,
      state: "pending",
      reasonCode: "diagnostic_pending",
      purpose: "diagnostic",
      budgetEnforcement: "not_enabled",
      costStatus: "unknown",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel diagnostic" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("cancel_client_diagnostic", {
      runId: "r",
    }),
  );
  expect(modelHubApi.catalog).not.toHaveBeenCalled();
});
it("non-gateway clients expose manual verification only", () => {
  mount(snapshot, "opencode");
  expect(screen.getByText(/Send a test message/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Verify model response" }),
  ).not.toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalled();
});
it("changing a target revokes fee confirmation", async () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Verify model response" }),
  );
  await screen.findByRole("option", { name: "Provider" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Diagnostic model ID"), {
    target: { value: "changed" },
  });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
});
