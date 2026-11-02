import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { WorkspaceReadiness } from "@/components/overview/WorkspaceReadiness";
import type { ReadinessSnapshot } from "@/lib/workspaceReadiness";
import { createTestQueryClient } from "../utils/testQueryClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
const snapshot: ReadinessSnapshot = {
  app: "claude",
  configurationRevision: "c",
  credentialEpoch: "e",
  outboundRevision: "o",
  networkGeneration: 1,
  observedAt: 123,
  checks: [
    {
      id: "configuration",
      state: "pass",
      reasonCode: "configuration_saved",
      actionId: "manage_providers",
    },
    {
      id: "client_read",
      state: "unknown",
      reasonCode: "client_reload_unobserved",
      actionId: null,
    },
    {
      id: "gateway",
      state: "pass",
      reasonCode: "listener_running",
      actionId: "manage_providers",
    },
    {
      id: "outbound",
      state: "fail",
      reasonCode: "managed_outbound_unavailable",
      actionId: "manage_network",
    },
    {
      id: "model",
      state: "unknown",
      reasonCode: "model_unverified",
      actionId: null,
    },
  ],
};
beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(snapshot);
  focusManager.setFocused(true);
});
afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});
function mount(props: React.ComponentProps<typeof WorkspaceReadiness> = {}) {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <WorkspaceReadiness {...props} />
    </QueryClientProvider>,
  );
  return client;
}
it("shows separate observations without treating the listener as model verification", async () => {
  mount();
  await screen.findByText("Listener running");
  expect(screen.getByText("Managed outbound unavailable")).toBeInTheDocument();
  expect(screen.getByText("Model response not verified")).toBeInTheDocument();
  expect(screen.getByText("Client reload not observed")).toBeInTheDocument();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "get_workspace_readiness",
  ]);
});
it("clears another client's observations while loading and routes actions with the selected client", async () => {
  const manage = vi.fn();
  const network = vi.fn();
  mount({ onManageProviders: manage, onManageNetwork: network });
  await screen.findByText("Listener running");
  vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
  fireEvent.change(screen.getByRole("combobox", { name: "Client" }), {
    target: { value: "codex" },
  });
  expect(screen.queryByText("Listener running")).not.toBeInTheDocument();
  expect(screen.getByText("Reading local state…")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Manage client configuration" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check outbound settings" }),
  );
  expect(manage).toHaveBeenCalledWith("codex");
  expect(network).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith("get_workspace_readiness", {
      appType: "codex",
    }),
  );
});
it("hides cached successes after a failed refresh and allows retry", async () => {
  const client = mount();
  await screen.findByText("Listener running");
  vi.mocked(invoke).mockRejectedValue(new Error("configuration unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["providers", "claude"] });
  });
  await screen.findByText("Readiness unavailable");
  expect(screen.queryByText("Listener running")).not.toBeInTheDocument();
  vi.mocked(invoke).mockResolvedValue(snapshot);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Listener running");
});
it("does not poll while the application is unfocused", async () => {
  vi.useFakeTimers();
  mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText("Listener running")).toBeInTheDocument();
  focusManager.setFocused(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
