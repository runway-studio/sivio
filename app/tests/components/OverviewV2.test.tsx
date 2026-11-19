import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Overview } from "@/components/overview/Overview";
import { defaultDesktopPreferences } from "@/lib/desktopPreferencesModel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, payload: any) => {
      if (command === "network_command") {
        if (payload.action === "desktop.get")
          return { preferences: defaultDesktopPreferences };
        if (payload.action === "snapshot")
          return {
            settingsRevision: "r1",
            runtime: { phase: "stopped", generation: 1, error: null },
            catalog: {
              active: null,
              profiles: [],
              settings: { mode: "rule" },
              outbound: "direct",
            },
          };
      }
      if (command === "get_providers")
        return { a: { id: "a", name: "Provider", settingsConfig: {} } };
      if (command === "get_current_provider") return "a";
      if (command === "get_model_picker_catalog")
        return {
          providers: [{ id: "a", name: "Provider", models: ["m1"] }],
          providerId: "a",
          model: "m1",
          mode: "route",
          revision: "r1",
        };
      if (command === "get_workspace_readiness")
        return {
          checks: [
            { id: "model", state: "unknown", reasonCode: "model_unverified" },
            {
              id: "client_read",
              state: "unknown",
              reasonCode: "client_reload_unobserved",
            },
          ],
        };
      if (command === "get_usage_summary")
        return { totalRequests: 0, realTotalTokens: 0 };
      if (command === "get_proxy_status") return { running: false };
      return {};
    });
});
function mount() {
  const onModel = vi.fn();
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Overview onOpen={vi.fn()} onApp={vi.fn()} onModel={onModel} />
    </QueryClientProvider>,
  );
  return { ...view, onModel };
}
it("retains all configured tools behind expansion and routes the selected client to model selection", async () => {
  const view = mount();
  await screen.findAllByText("Provider · m1");
  expect(view.container.querySelectorAll(".workspace-client")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "展开其余 6 个工具" }));
  expect(view.container.querySelectorAll(".workspace-client")).toHaveLength(10);
  const row = Array.from(
    view.container.querySelectorAll(".workspace-client"),
  ).find((item) =>
    within(item as HTMLElement).queryByText("Codex", { exact: true }),
  ) as HTMLElement;
  fireEvent.click(within(row).getByRole("button", { name: "切换模型" }));
  expect(view.onModel).toHaveBeenCalledWith("codex");
  fireEvent.click(screen.getByRole("button", { name: "收起工具列表" }));
  expect(view.container.querySelectorAll(".workspace-client")).toHaveLength(4);
});
it("shows an unavailable network instead of inventing active connection state", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((command, payload: any) =>
    command === "network_command" && payload.action === "snapshot"
      ? Promise.reject(new Error("Unavailable"))
      : original(command, payload),
  );
  mount();
  expect(await screen.findByText("网络状态暂不可用")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重试读取" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "切换节点" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("由 Sivio 管理")).not.toBeInTheDocument();
});
