import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import {
  RoutingLivePanel,
  routingTotals,
} from "@/components/models/RoutingLivePanel";
import {
  routingLiveApi,
  type RoutingLiveRecord,
  type RoutingLiveSnapshot,
} from "@/lib/api/model-hub";
import { proxyApi } from "@/lib/api/proxy";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("@/lib/api/model-hub", () => ({
  routingLiveApi: { snapshot: vi.fn() },
}));
vi.mock("@/lib/api/proxy", () => ({ proxyApi: { getProxyStatus: vi.fn() } }));
const group = {
  id: "g",
  name: "Daily",
  strategy: "smart" as const,
  members: [
    { providerId: "a", model: "m-a" },
    { providerId: "b", model: "m-b" },
  ],
};
const record = (id: string, app = "claude"): RoutingLiveRecord => ({
  decision: {
    id,
    app,
    createdAt: Date.now(),
    requestModel: "group-g",
    mode: "group_smart",
    group,
    selection: {
      strategy: "smart",
      ranking: [{ providerId: "a", model: "m-a", dispatches: 0 }],
    },
    candidates: [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ],
    attempts: [
      {
        provider: { id: "a", name: "Alpha" },
        result: "upstream_error",
        status: 429,
        elapsedMs: 5,
        retryAt: Date.now() + 35000,
      },
    ],
    result: "pending",
    bodyState: "not_received",
    elapsedMs: 5,
  },
  phase: "connecting",
  currentProvider: { id: "b", name: "Beta" },
  rerouted: true,
  updatedAt: Date.now(),
});
const snapshot = (): RoutingLiveSnapshot => ({
  now: Date.now(),
  startedAt: Date.now(),
  records: [record("one"), record("two", "codex")],
  stats: ["claude", "codex"].map((app) => ({
    app,
    groupId: "g",
    requests: 1,
    active: 1,
    rerouted: 1,
    completed: 0,
    failed: 0,
    interrupted: 0,
  })),
  omitted: 0,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(routingLiveApi.snapshot).mockResolvedValue(snapshot());
  vi.mocked(proxyApi.getProxyStatus).mockResolvedValue({
    running: true,
    address: "127.0.0.1",
    port: 15721,
  } as Awaited<ReturnType<typeof proxyApi.getProxyStatus>>);
});
function mount(focused = false) {
  const client = createTestQueryClient();
  const onAll = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <RoutingLivePanel
        app="claude"
        group={focused ? group : undefined}
        providers={[]}
        onAll={onAll}
      />
    </QueryClientProvider>,
  );
  return { ...result, client, onAll };
}
it("renders concurrent active edges, real rate limit evidence, and scoped totals", async () => {
  const { container, client } = mount();
  await screen.findByText("127.0.0.1:15721");
  await waitFor(() =>
    expect(container.querySelectorAll("path.flow")).toHaveLength(4),
  );
  expect(container.querySelectorAll("[data-active='true']")).toHaveLength(2);
  expect(screen.getAllByText("routingLive.retryIn")).toHaveLength(2);
  expect(routingTotals(snapshot().stats)).toMatchObject({
    requests: 2,
    active: 2,
    rerouted: 2,
  });
  const done = snapshot();
  done.records.forEach((r) => {
    r.phase = "completed";
    r.decision.bodyState = "received";
  });
  client.setQueryData(["routing-live"], done);
  await waitFor(() =>
    expect(container.querySelectorAll("path.flow")).toHaveLength(0),
  );
});
it("filters identical group IDs by client and exposes ranked reasons", async () => {
  const { container, onAll } = mount(true);
  await waitFor(() =>
    expect(container.querySelectorAll(".routing-live-client")).toHaveLength(1),
  );
  expect(container.querySelectorAll(".routing-live-member")).toHaveLength(2);
  fireEvent.click(await screen.findByText("routingLive.evidence"));
  expect(container.querySelectorAll(".routing-live-evidence li")).toHaveLength(
    1,
  );
  expect(screen.getByText("routingGroups.reasons.smart")).toBeInTheDocument();
  fireEvent.click(screen.getByText("routingLive.allGroups"));
  expect(onAll).toHaveBeenCalledOnce();
});
it("stops animations and marks cached state unknown when refresh fails", async () => {
  const { container, client } = mount();
  await waitFor(() =>
    expect(container.querySelectorAll("path.flow")).toHaveLength(4),
  );
  vi.mocked(routingLiveApi.snapshot).mockRejectedValue(new Error("offline"));
  await client.refetchQueries({ queryKey: ["routing-live"] });
  await screen.findByRole("alert");
  expect(container.querySelectorAll("path.flow")).toHaveLength(0);
  expect(screen.getByText("routingLive.stale")).toBeInTheDocument();
});
it("shows empty state and does not invent activity", async () => {
  vi.mocked(routingLiveApi.snapshot).mockResolvedValue({
    ...snapshot(),
    records: [],
    stats: [],
  });
  const { container } = mount();
  await screen.findByText("routingLive.empty");
  expect(container.querySelectorAll("path.flow")).toHaveLength(0);
  expect(screen.getByText("routingLive.noRequest")).toBeInTheDocument();
});
