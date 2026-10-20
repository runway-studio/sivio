import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { RoutingGroupsPage } from "@/components/models/RoutingGroupsPage";
import { routingGroupsApi, modelHubApi } from "@/lib/api/model-hub";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("@/components/models/RoutingLivePanel", () => ({
  RoutingLivePanel: () => null,
}));
vi.mock("@/lib/api/model-hub", () => ({
  routingGroupsApi: { list: vi.fn(), update: vi.fn() },
  modelHubApi: { catalog: vi.fn() },
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(routingGroupsApi.list).mockResolvedValue({
    groups: [],
    revision: "r1",
  });
  vi.mocked(modelHubApi.catalog).mockResolvedValue({
    providers: [
      { id: "a", name: "A", models: ["model-a"] },
      { id: "b", name: "B", models: ["model-b"] },
    ],
    mode: "route",
    revision: "c1",
  });
});
function mount() {
  const busy = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RoutingGroupsPage onBusyChange={busy} />
    </QueryClientProvider>,
  );
  return busy;
}
it("creates ordered members, protects edits, and retains stale-save errors", async () => {
  const busy = mount();
  await screen.findByText("routingGroups.empty");
  fireEvent.click(screen.getByText("routingGroups.create"));
  fireEvent.change(screen.getByLabelText("routingGroups.name"), {
    target: { value: "Daily" },
  });
  fireEvent.change(screen.getByLabelText("modelHub.provider"), {
    target: { value: "a" },
  });
  fireEvent.change(screen.getByLabelText("modelHub.modelId"), {
    target: { value: "model-a" },
  });
  fireEvent.click(screen.getByText("routingGroups.addMember"));
  fireEvent.change(screen.getAllByLabelText("modelHub.provider")[1], {
    target: { value: "b" },
  });
  fireEvent.change(screen.getAllByLabelText("modelHub.modelId")[1], {
    target: { value: "model-b" },
  });
  fireEvent.click(screen.getAllByLabelText("routingGroups.up")[1]);
  expect(screen.getAllByLabelText("modelHub.provider")[0]).toHaveValue("b");
  expect(busy).toHaveBeenLastCalledWith(true);
  expect(screen.getByLabelText("modelHub.client")).toBeDisabled();
  vi.mocked(routingGroupsApi.update).mockRejectedValueOnce(
    new Error("stale revision"),
  );
  fireEvent.click(screen.getByText("common.save"));
  expect(await screen.findByRole("alert")).toHaveTextContent("stale revision");
  expect(screen.getByLabelText("routingGroups.name")).toHaveValue("Daily");
  expect(routingGroupsApi.update).toHaveBeenCalledWith(
    "claude",
    {
      id: "",
      name: "Daily",
      strategy: "order",
      members: [
        { providerId: "b", model: "model-b" },
        { providerId: "a", model: "model-a" },
      ],
    },
    "r1",
    false,
  );
  vi.mocked(routingGroupsApi.update).mockResolvedValue({
    groups: [
      {
        id: "g1",
        name: "Daily",
        strategy: "order",
        members: [{ providerId: "b", model: "model-b" }],
      },
    ],
    revision: "r2",
  });
  fireEvent.click(screen.getByText("common.save"));
  await screen.findByRole("status");
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("requires explicit deletion and preserves the group when deletion fails", async () => {
  vi.mocked(routingGroupsApi.list).mockResolvedValue({
    groups: [
      { id: "g1", name: "Daily", members: [{ providerId: "a", model: "m" }] },
    ],
    revision: "r1",
  });
  mount();
  await screen.findByText("Daily");
  fireEvent.click(screen.getByText("common.edit"));
  fireEvent.click(screen.getByText("common.delete"));
  expect(routingGroupsApi.update).not.toHaveBeenCalled();
  vi.mocked(routingGroupsApi.update).mockRejectedValue(
    new Error("active group"),
  );
  fireEvent.click(screen.getByText("routingGroups.confirmDelete"));
  await waitFor(() =>
    expect(screen.getByText("active group")).toBeInTheDocument(),
  );
  expect(screen.getByLabelText("routingGroups.name")).toHaveValue("Daily");
});

it.each(["rotate", "usage", "smart", "pace"] as const)(
  "saves %s and protects the strategy draft",
  async (strategy) => {
    vi.mocked(routingGroupsApi.list).mockResolvedValue({
      groups: [
        {
          id: "g1",
          name: "Daily",
          members: [{ providerId: "a", model: "model-a" }],
        },
      ],
      revision: "r1",
    });
    const busy = mount();
    await screen.findByText("Daily");
    fireEvent.click(screen.getByText("common.edit"));
    expect(screen.getByLabelText("routingGroups.strategy")).toHaveValue(
      "order",
    );
    fireEvent.change(screen.getByLabelText("routingGroups.strategy"), {
      target: { value: strategy },
    });
    expect(
      screen.getByText(`routingGroups.hints.${strategy}`),
    ).toBeInTheDocument();
    expect(busy).toHaveBeenLastCalledWith(true);
    vi.mocked(routingGroupsApi.update).mockResolvedValue({
      groups: [
        {
          id: "g1",
          name: "Daily",
          strategy,
          members: [{ providerId: "a", model: "model-a" }],
        },
      ],
      revision: "r2",
    });
    fireEvent.click(screen.getByText("common.save"));
    await waitFor(() =>
      expect(routingGroupsApi.update).toHaveBeenCalledWith(
        "claude",
        expect.objectContaining({ strategy }),
        "r1",
        false,
      ),
    );
    await screen.findByRole("status");
    fireEvent.click(screen.getByText("common.edit"));
    expect(screen.getByLabelText("routingGroups.strategy")).toHaveValue(
      strategy,
    );
  },
);
