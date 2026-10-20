import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { LegacyMigrationSection } from "@/components/settings/LegacyMigrationSection";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "en" } }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
const preview = { kind: "cc-switch", filePath: "/tmp/original.sql", revision: "reviewed-revision", replace: false, counts: { providers: { added: 2, conflicts: 1, kept: 1 } }, warnings: ["Imported objects stay inactive"] };
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LegacyMigrationSection /></QueryClientProvider>); }
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, options: any) => {
    if (options.action === "migration.choose") return { kind: "cc-switch", filePath: "/tmp/original.sql" };
    if (options.action === "migration.preview") return { ...preview, replace: options.args.replace };
    return { imported: true };
  });
});
it("requires a separate confirmation and passes the reviewed revision into import", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Choose backup file" }));
  await screen.findByText("Imported objects stay inactive");
  expect(vi.mocked(invoke).mock.calls.some(([, options]: any) => options.action === "migration.apply")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm merge import" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("network_command", { action: "migration.apply", args: preview }));
});
it("invalidates the preview when the conflict policy or source changes", async () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Choose backup file" }));
  await screen.findByRole("button", { name: "Confirm merge import" });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.queryByRole("button", { name: "Confirm merge import" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose backup file" }));
  await screen.findByRole("button", { name: "Confirm merge import" });
  fireEvent.change(screen.getByLabelText("Migration source"), { target: { value: "clash-verge" } });
  expect(screen.queryByRole("button", { name: "Confirm merge import" })).not.toBeInTheDocument();
});
it("shows a failed source check without offering an import action", async () => {
  vi.mocked(invoke).mockRejectedValue({ message: "Source changed; review again" });
  mount(); fireEvent.click(screen.getByRole("button", { name: "Choose backup file" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Source changed; review again");
  expect(screen.queryByRole("button", { name: "Confirm merge import" })).not.toBeInTheDocument();
});
