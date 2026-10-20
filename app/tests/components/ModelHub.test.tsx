import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ModelPickerDialog } from "@/components/models/ModelPickerDialog";
import { RouteDecisionsDialog } from "@/components/models/RouteDecisionsDialog";
import { modelHubApi, type ModelCatalog } from "@/lib/api/model-hub";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("@/lib/api/model-hub", () => ({
  modelHubApi: { catalog: vi.fn(), select: vi.fn(), decisions: vi.fn() },
}));
const catalog: ModelCatalog = {
  providers: [
    { id: "a", name: "Alpha", models: ["same-model", "alpha-only"] },
    { id: "b", name: "Beta", models: ["same-model", "beta-only"] },
    {
      id: "official",
      name: "Official",
      models: ["blocked-model"],
      disabled: "Route unavailable",
    },
  ],
  providerId: "a",
  model: "same-model",
  mode: "route",
  revision: "revision-1",
};
const mount = (element: React.ReactNode) =>
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      {element}
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(modelHubApi.catalog).mockResolvedValue(catalog);
  vi.mocked(modelHubApi.select).mockResolvedValue(catalog);
  vi.mocked(modelHubApi.decisions).mockResolvedValue([]);
});
it("searches models and submits the selected provider, client, model and revision", async () => {
  const close = vi.fn();
  mount(<ModelPickerDialog app="claude" open onOpenChange={close} />);
  await screen.findByRole("heading", { name: "Alpha" });
  fireEvent.change(screen.getByLabelText("modelHub.search"), {
    target: { value: "beta-only" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "beta-only" }));
  fireEvent.click(screen.getByRole("button", { name: "modelHub.apply" }));
  await waitFor(() =>
    expect(modelHubApi.select).toHaveBeenCalledWith(
      "claude",
      "b",
      "beta-only",
      "revision-1",
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
});
it("keeps errors and custom model selection visible until explicitly retried", async () => {
  vi.mocked(modelHubApi.select).mockRejectedValueOnce(
    new Error("Configuration changed"),
  );
  const close = vi.fn();
  mount(<ModelPickerDialog app="codex" open onOpenChange={close} />);
  await screen.findByRole("heading", { name: "Alpha" });
  fireEvent.change(screen.getByLabelText("modelHub.provider"), {
    target: { value: "b" },
  });
  fireEvent.change(screen.getByLabelText("modelHub.modelId"), {
    target: { value: "custom-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "modelHub.apply" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Configuration changed",
  );
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("modelHub.modelId")).toHaveValue("custom-model");
  expect(screen.getByRole("option", { name: "Official" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "blocked-model" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("modelHub.client"), {
    target: { value: "gemini" },
  });
  await waitFor(() =>
    expect(modelHubApi.catalog).toHaveBeenCalledWith("gemini"),
  );
});
it("prevents dismissal while a model write is pending", async () => {
  let resolve!: (v: ModelCatalog) => void;
  vi.mocked(modelHubApi.select).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const close = vi.fn();
  mount(<ModelPickerDialog app="claude" open onOpenChange={close} />);
  await screen.findByRole("heading", { name: "Alpha" });
  fireEvent.click(screen.getByRole("button", { name: "modelHub.apply" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "common.cancel" }),
    ).toBeDisabled(),
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  resolve(catalog);
  await waitFor(() => expect(close).toHaveBeenCalledWith(false));
});
it("shows actual attempts in order, reported model and body outcome, and filters clients", async () => {
  vi.mocked(modelHubApi.decisions).mockResolvedValue([
    {
      id: "trace-1",
      app: "claude",
      createdAt: Date.now(),
      requestModel: "sonnet",
      mode: "failover",
      candidates: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
      attempts: [
        {
          provider: { id: "a", name: "Alpha" },
          outboundModel: "model-a",
          status: 429,
          result: "upstream_error",
          elapsedMs: 5,
        },
        {
          provider: { id: "b", name: "Beta" },
          outboundModel: "model-b",
          status: 200,
          result: "accepted",
          elapsedMs: 10,
        },
      ],
      responseModel: "reported-b",
      result: "accepted",
      elapsedMs: 15,
      bodyState: "received",
    },
  ]);
  mount(<RouteDecisionsDialog open onOpenChange={vi.fn()} />);
  await screen.findByText("reported-b");
  const attempts = screen.getAllByRole("listitem");
  expect(within(attempts[0]).getByText("1. Alpha")).toBeInTheDocument();
  expect(attempts[0]).toHaveTextContent("HTTP 429");
  expect(attempts[1]).toHaveTextContent("sonnet → model-b");
  fireEvent.change(screen.getByLabelText("modelHub.client"), {
    target: { value: "codex" },
  });
  await waitFor(() =>
    expect(modelHubApi.decisions).toHaveBeenCalledWith("codex"),
  );
});
it("explains empty records without inventing direct traffic", async () => {
  mount(<RouteDecisionsDialog open onOpenChange={vi.fn()} />);
  expect(await screen.findByText("modelHub.noRecords")).toBeInTheDocument();
});

it("selects group aliases from the provider dropdown and restores editable models when leaving a group", async () => {
  const grouped = {
    ...catalog,
    providers: [
      ...catalog.providers,
      { id: "@group:g", name: "Daily group", models: ["sivio-claude-group-g"] },
    ],
  };
  vi.mocked(modelHubApi.catalog).mockResolvedValue(grouped);
  mount(<ModelPickerDialog app="claude" open onOpenChange={vi.fn()} />);
  await screen.findByRole("heading", { name: "Daily group" });
  fireEvent.change(screen.getByLabelText("modelHub.provider"), {
    target: { value: "@group:g" },
  });
  expect(screen.getByLabelText("modelHub.modelId")).toHaveValue(
    "sivio-claude-group-g",
  );
  expect(screen.getByLabelText("modelHub.modelId")).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("modelHub.provider"), {
    target: { value: "b" },
  });
  expect(screen.getByLabelText("modelHub.modelId")).toHaveValue("same-model");
  expect(screen.getByLabelText("modelHub.modelId")).not.toHaveAttribute(
    "readonly",
  );
});

it("explains usage ranking while keeping legacy group records readable", async () => {
  const base = {
    app: "claude",
    createdAt: 1,
    requestModel: "sivio-claude-group-g1",
    candidates: [
      { id: "b", name: "Beta" },
      { id: "a", name: "Alpha" },
    ],
    attempts: [],
    result: "accepted",
    elapsedMs: 10,
    bodyState: "received",
  };
  vi.mocked(modelHubApi.decisions).mockResolvedValue([
    {
      ...base,
      id: "new",
      mode: "group_usage",
      group: {
        id: "g1",
        name: "Balanced",
        strategy: "usage",
        members: [
          { providerId: "a", model: "model-a" },
          { providerId: "b", model: "model-b" },
        ],
      },
      selection: {
        strategy: "usage",
        ranking: [
          { providerId: "b", model: "model-b", dispatches: 1 },
          { providerId: "a", model: "model-a", dispatches: 9 },
        ],
      },
    },
    {
      ...base,
      id: "old",
      mode: "group_order",
      group: {
        id: "g2",
        name: "Legacy",
        members: [{ providerId: "a", model: "model-a" }],
      },
    },
  ]);
  mount(<RouteDecisionsDialog open onOpenChange={() => {}} />);
  expect(
    await screen.findByText("routingGroups.reasons.usage"),
  ).toBeInTheDocument();
  expect(screen.getByText(/Legacy/)).toHaveTextContent(
    "routingGroups.strategies.order",
  );
  expect(screen.getByText(/1\. Beta/)).toHaveTextContent("model-b");
  expect(screen.getByText(/2\. Alpha/)).toHaveTextContent("model-a");
  expect(screen.getByText("routingGroups.counterNote")).toBeInTheDocument();
});

it.each(["smart", "pace"] as const)(
  "shows %s quota evidence and explicit fallback",
  async (strategy) => {
    vi.mocked(modelHubApi.decisions).mockResolvedValue([
      {
        id: "quota",
        app: "claude",
        createdAt: 1,
        requestModel: "group",
        mode: `group_${strategy}`,
        candidates: [{ id: "a", name: "Alpha" }],
        attempts: [],
        result: "accepted",
        elapsedMs: 1,
        bodyState: "received",
        selection: {
          strategy,
          fallbackReason: "no_usable_quota",
          ranking: [
            {
              providerId: "a",
              model: "model-a",
              dispatches: 1,
              quota: {
                source: "codex_oauth",
                status: "missing_weekly",
                queriedAt: 1,
                remainingPercent: 50,
                resetsAt: 3600001,
                pacePerHour: 50,
                window: "seven_day",
              },
            },
          ],
        },
      },
    ]);
    mount(<RouteDecisionsDialog open onOpenChange={vi.fn()} />);
    expect(
      await screen.findByText(`routingGroups.reasons.${strategy}`),
    ).toBeInTheDocument();
    expect(screen.getByText("routingGroups.quotaFallback")).toBeInTheDocument();
    expect(
      screen.getByText(/missing_weekly/),
    ).toBeInTheDocument();
    expect(screen.getByText(/routingGroups.quotaRemaining/)).toHaveTextContent(
      "routingGroups.quotaPace",
    );
    expect(screen.getByText(/routingGroups.quotaReset/)).toBeInTheDocument();
    expect(screen.getByText(/routingGroups.quotaQueried/)).toBeInTheDocument();
    expect(
      screen.queryByText("routingGroups.counterNote"),
    ).not.toBeInTheDocument();
  },
);
