import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  NetworkAdvancedSettings,
  DashboardLinks,
} from "@/components/network/NetworkAdvancedSettings";
import type { Settings } from "@/components/network/NetworkWorkspace";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
function Harness() {
  const [settings, set] = useState({
    controllerEnabled: false,
    controllerPort: 15724,
    controllerSecret: "",
    webUiList: [],
    customTests: [],
    proxyHost: "127.0.0.1",
    proxyGuard: true,
    proxyGuardSeconds: 30,
    bypassCheck: true,
    useDefaultBypass: false,
    builtinEnhanced: true,
  } as unknown as Settings);
  return (
    <>
      <NetworkAdvancedSettings
        settings={settings}
        patch={(patch) => set((old) => ({ ...old, ...patch }))}
      />
      <output data-testid="draft">{JSON.stringify(settings)}</output>
    </>
  );
}
it("edits dashboard and connectivity rows locally, removes them, and never sends a secret to a dashboard URL", async () => {
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "添加面板" }));
  fireEvent.change(screen.getByLabelText("面板地址 1"), {
    target: { value: "https://trusted.invalid/panel" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加检测" }));
  fireEvent.change(screen.getByLabelText("检测名称 1"), {
    target: { value: "Fixture" },
  });
  fireEvent.change(screen.getByLabelText("检测地址 1"), {
    target: { value: "https://probe.invalid/204" },
  });
  expect(screen.getByTestId("draft")).toHaveTextContent('"name":"Fixture"');
  expect(invoke).not.toHaveBeenCalled();
  const onError = vi.fn();
  const links = render(
    <DashboardLinks
      urls={["https://trusted.invalid/panel"]}
      onError={onError}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /打开面板/ }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("open_external", {
      url: "https://trusted.invalid/panel",
    }),
  );
  expect(onError).not.toHaveBeenCalled();
  links.unmount();
  fireEvent.click(screen.getAllByRole("button", { name: "移除" })[1]);
  expect(screen.queryByLabelText("检测名称 1")).not.toBeInTheDocument();
  view.unmount();
});
