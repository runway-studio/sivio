import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { CredentialMigrationNotice } from "@/components/settings/CredentialMigrationNotice";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
const pending = { pending: 3, running: false, error: null, backupPath: null };
beforeEach(() => {
  vi.mocked(invoke).mockReset();
});
it("only inspects at startup and requires an explicit migration click", async () => {
  vi.mocked(invoke).mockResolvedValue(pending);
  render(<CredentialMigrationNotice onImport={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  await screen.findByRole("button", { name: "Start / resume migration" });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(
        ([command]) => command === "credential_migration_status",
      ),
  ).toBe(true);
  vi.mocked(invoke).mockResolvedValue({
    ...pending,
    pending: 0,
    backupPath: "/fixture/backup",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Start / resume migration" }),
  );
  expect(
    await screen.findByRole("button", { name: "Restart app" }),
  ).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("migrate_legacy_credentials");
});
it("shows denial and does not retry migration automatically", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "migrate_legacy_credentials"
      ? {
          ...pending,
          pending: 2,
          error: "Denied; completed documents preserved",
        }
      : pending,
  );
  render(<CredentialMigrationNotice onImport={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Start / resume migration" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(
        ([command]) => command === "migrate_legacy_credentials",
      ),
  ).toHaveLength(1);
  expect(screen.getByText("2 documents remaining")).toBeInTheDocument();
});
it("can pause a pending OS operation and disables import until it returns", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((command) =>
    command === "migrate_legacy_credentials"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(pending),
  );
  render(<CredentialMigrationNotice onImport={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Start / resume migration" }),
  );
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Pause (deny the current system prompt)",
    }),
  );
  expect(invoke).toHaveBeenCalledWith("cancel_credential_migration");
  expect(
    screen.getByRole("button", { name: "Import configuration" }),
  ).toBeDisabled();
  finish({ ...pending, error: "Paused" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Import configuration" }),
    ).toBeEnabled(),
  );
});
it("offers import when inspection fails without attempting authorization", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("unavailable"));
  const onImport = vi.fn();
  render(<CredentialMigrationNotice onImport={onImport} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Import configuration" }));
  expect(onImport).toHaveBeenCalledOnce();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.every(
        ([command]) => command === "credential_migration_status",
      ),
  ).toBe(true);
});
