import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { useSettingsQuery } from "@/lib/query";
import { settingsApi } from "@/lib/api";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("@/lib/query", () => ({ useSettingsQuery: vi.fn() }));
vi.mock("@/lib/api", () => ({ settingsApi: { save: vi.fn() } }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
function mount() {
  const onSetup = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <FirstRunNoticeDialog onSetup={onSetup} />
    </QueryClientProvider>,
  );
  return onSetup;
}
beforeEach(() => {
  vi.mocked(settingsApi.save).mockResolvedValue(true);
});
it("leaves an acknowledged existing installation unchanged", () => {
  vi.mocked(useSettingsQuery).mockReturnValue({
    data: { firstRunNoticeConfirmed: true, visibleApps: { claude: false } },
  } as any);
  const onSetup = mount();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(settingsApi.save).not.toHaveBeenCalled();
  expect(onSetup).not.toHaveBeenCalled();
});
it("starts setup only after saving first-run acknowledgement and retaining preferences", async () => {
  vi.mocked(useSettingsQuery).mockReturnValue({
    data: { firstRunNoticeConfirmed: false, visibleApps: { claude: false } },
  } as any);
  const onSetup = mount();
  fireEvent.click(screen.getByRole("button", { name: "开始接入" }));
  await waitFor(() => expect(onSetup).toHaveBeenCalledOnce());
  expect(settingsApi.save).toHaveBeenCalledWith(
    expect.objectContaining({
      firstRunNoticeConfirmed: true,
      visibleApps: { claude: false },
    }),
  );
});
