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
import {
  WorkspaceReadiness,
  WorkspaceReadinessDetails,
} from "@/components/overview/WorkspaceReadiness";
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

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function mountDetails() {
  const client = createTestQueryClient();
  render(
    <QueryClientProvider client={client}>
      <WorkspaceReadinessDetails />
    </QueryClientProvider>,
  );
  return {
    client,
    toggle: async () => {
      fireEvent.click(
        screen.getByText("Client diagnostics and detailed status"),
      );
      await advance(10);
    },
  };
}

it("makes zero readiness reads in a collapsed minute and resumes the selected client on reopen", async () => {
  vi.useFakeTimers();
  const { client, toggle } = mountDetails();
  await advance(60_000);
  expect(invoke).not.toHaveBeenCalled();
  await toggle();
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole("combobox", { name: "Client" }), {
    target: { value: "codex" },
  });
  await advance(10);
  await advance(60_000);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([, args]: any) => args.appType === "codex"),
  ).toHaveLength(13);
  await toggle();
  vi.mocked(invoke).mockClear();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["providers"] });
  });
  await advance(60_000);
  expect(invoke).not.toHaveBeenCalled();
  await toggle();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("get_workspace_readiness", {
    appType: "codex",
  });
});

it("finishes observing a pending diagnostic while collapsed and then stops polling", async () => {
  vi.useFakeTimers();
  const pending = {
    providerId: "p",
    model: "m",
    state: "pending",
    reasonCode: "diagnostic_pending",
  };
  vi.mocked(invoke).mockResolvedValue({ ...snapshot, diagnostic: pending });
  const { toggle } = mountDetails();
  await toggle();
  await toggle();
  vi.mocked(invoke)
    .mockClear()
    .mockResolvedValueOnce({ ...snapshot, diagnostic: pending })
    .mockResolvedValue({
      ...snapshot,
      diagnostic: { ...pending, state: "pass", reasonCode: "model_verified" },
    });
  await advance(2100);
  expect(invoke).toHaveBeenCalledTimes(2);
  await advance(60_000);
  expect(invoke).toHaveBeenCalledTimes(2);
  await toggle();
  expect(screen.getByText(/p · m/)).toHaveTextContent(
    "Model response verified",
  );
});

it("observes the accepted run even if the panel closes before Start returns", async () => {
  vi.useFakeTimers();
  let finishStart!: () => void;
  const accepted = new Promise<void>((resolve) => {
    finishStart = resolve;
  });
  const pending = {
    providerId: "p",
    model: "m",
    state: "pending",
    reasonCode: "diagnostic_pending",
  };
  let run: typeof pending | undefined;
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    if (cmd === "get_model_picker_catalog")
      return { providers: [{ id: "p", name: "Provider", models: ["m"] }] };
    if (cmd === "start_client_diagnostic") {
      await accepted;
      run = pending;
      return run;
    }
    return { ...snapshot, diagnostic: run };
  });
  const { toggle, client } = mountDetails();
  await toggle();
  await advance(10);
  fireEvent.click(
    screen.getByRole("button", { name: "Verify model response" }),
  );
  await advance(10);
  fireEvent.change(screen.getByLabelText("Diagnostic provider"), {
    target: { value: "p" },
  });
  fireEvent.change(screen.getByLabelText("Diagnostic model ID"), {
    target: { value: "m" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Start diagnostic" }));
  await toggle();
  await act(async () => finishStart());
  await advance(10);
  const key = ["providers", "claude", "readiness"];
  expect(client.getQueryData<ReadinessSnapshot>(key)?.diagnostic?.state).toBe(
    "pending",
  );
  run = { ...pending, state: "pass", reasonCode: "model_verified" };
  await advance(1010);
  expect(client.getQueryData<ReadinessSnapshot>(key)?.diagnostic?.state).toBe(
    "pass",
  );
  vi.mocked(invoke).mockClear();
  await advance(60_000);
  expect(invoke).not.toHaveBeenCalled();
});
