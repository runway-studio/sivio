import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DatabaseUpgrade } from "@/components/DatabaseUpgrade";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));
const first = { candidateId: "first", availableVersion: "0.2.0" };
const later = { candidateId: "later", availableVersion: "0.3.0" };
beforeEach(() => vi.mocked(invoke).mockReset());

it("downloads the displayed recovery candidate without rechecking latest", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "check_app_update_info" ? first : undefined,
  );
  render(<DatabaseUpgrade payload={{ db_version: 2, supported_version: 1 }} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "dbUpgrade.upgradeNow" }),
  );
  await screen.findByRole("dialog");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "check_app_update_info"),
  ).toHaveLength(1);
  expect(invoke).toHaveBeenCalledWith("download_app_update", {
    candidateId: "first",
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([name]) => name === "install_update_and_restart"),
  ).toBe(false);
});

it("rechecks an expired candidate but requires another download choice", async () => {
  let checks = 0;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "check_app_update_info")
      return ++checks === 1 ? first : later;
    if (command === "download_app_update") throw new Error("UPDATE_STALE");
    return undefined;
  });
  render(<DatabaseUpgrade payload={{ db_version: 2, supported_version: 1 }} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "dbUpgrade.upgradeNow" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "dbUpgrade.retry" }),
  );
  await screen.findByRole("button", { name: "dbUpgrade.upgradeNow" });
  expect(checks).toBe(2);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === "download_app_update"),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "dbUpgrade.upgradeNow" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("download_app_update", {
      candidateId: "later",
    }),
  );
});
