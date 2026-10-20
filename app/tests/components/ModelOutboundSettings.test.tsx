import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ModelOutboundSettings } from "@/components/settings/ModelOutboundSettings";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
it("persists model egress without writing Clash settings", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args: any) =>
    args.action === "snapshot" ? { catalog: { outbound: "direct" } } : {},
  );
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ModelOutboundSettings />
    </QueryClientProvider>,
  );
  const select = await screen.findByLabelText("AI 出站策略");
  await waitFor(() => expect(select).not.toBeDisabled());
  fireEvent.change(select, { target: { value: "managed-network" } });
  fireEvent.click(screen.getByRole("button", { name: "应用策略" }));
  await screen.findByText("AI 出站策略已保存");
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "outbound.set",
    args: { mode: "managed-network", url: "" },
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "settings.save"),
  ).toBe(false);
  view.unmount();
});
