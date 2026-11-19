import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ModelActivationStatus } from "@/components/models/ModelActivationStatus";
import { createTestQueryClient } from "../utils/testQueryClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const snapshot = {
  checks: [
    { id: "configuration", state: "pass", reasonCode: "configuration_saved" },
    {
      id: "client_read",
      state: "unknown",
      reasonCode: "client_reload_unobserved",
    },
    { id: "model", state: "unknown", reasonCode: "model_unverified" },
  ],
};
beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue(snapshot));
function mount() {
  const client = createTestQueryClient();
  const onVerify = vi.fn();
  const ui = (disabled: boolean) => (
    <QueryClientProvider client={client}>
      <ModelActivationStatus
        app="claude"
        disabled={disabled}
        onVerify={onVerify}
      />
    </QueryClientProvider>
  );
  const view = render(ui(false));
  return { onVerify, ...view, disable: () => view.rerender(ui(true)) };
}
it("separates saving, client reads and model evidence, and only opens the guide on request", async () => {
  const view = mount();
  expect(await screen.findByText("配置已保存")).toBeInTheDocument();
  expect(screen.getByText("尚未观测到客户端读取")).toBeInTheDocument();
  expect(screen.getByText("尚未验证模型响应")).toBeInTheDocument();
  expect(view.onVerify).not.toHaveBeenCalled();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(([command]) => command === "get_workspace_readiness"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "验证与打开客户端" }));
  expect(view.onVerify).toHaveBeenCalledOnce();
  view.disable();
  expect(
    screen.getByRole("button", { name: "验证与打开客户端" }),
  ).toBeDisabled();
});
it("removes previous success when a refresh fails, then permits an explicit retry", async () => {
  vi.mocked(invoke).mockResolvedValueOnce({
    checks: snapshot.checks.map((check) =>
      check.id === "model"
        ? { ...check, state: "pass", reasonCode: "model_verified" }
        : check,
    ),
  });
  mount();
  await screen.findByText("模型响应已验证");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("Unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "刷新生效状态" }));
  await waitFor(() =>
    expect(screen.queryByText("模型响应已验证")).not.toBeInTheDocument(),
  );
  expect(screen.getAllByText("状态暂不可用")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "刷新生效状态" }));
  await screen.findByText("尚未验证模型响应");
});
