import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ClientOnboarding } from "@/components/overview/ClientOnboarding";
import { useWorkspaceReadiness } from "@/lib/query/workspaceReadiness";
import { modelHubApi } from "@/lib/api/model-hub";
import { ONBOARDING_KEY } from "@/lib/clientOnboarding";
import { createTestQueryClient } from "../utils/testQueryClient";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("@/lib/query/workspaceReadiness", () => ({
  useWorkspaceReadiness: vi.fn(),
}));
vi.mock("@/lib/api/model-hub", () => ({
  modelHubApi: { catalog: vi.fn(), select: vi.fn() },
}));
vi.mock("@/components/overview/WorkspaceReadiness", () => ({
  WorkspaceReadiness: ({ fixedApp }: any) => <div>Readiness: {fixedApp}</div>,
}));
const callbacks = () => ({
  onClose: vi.fn(),
  onConfigure: vi.fn(),
  onInstall: vi.fn(),
  onVisibilitySaved: vi.fn(),
});
function mount() {
  const props = callbacks();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ClientOnboarding {...props} />
    </QueryClientProvider>,
  );
  return props;
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(useWorkspaceReadiness).mockReturnValue({
    data: { checks: [{ id: "configuration", state: "pass" }] },
    isError: false,
  } as any);
  vi.mocked(modelHubApi.catalog).mockResolvedValue({
    providers: [{ id: "p", name: "P", models: ["m", "draft-model"] }],
    providerId: "p",
    model: "m",
    mode: "direct",
    revision: "c",
  });
});
it("resumes saved setup from current facts without repeating imports", async () => {
  localStorage.setItem(
    ONBOARDING_KEY,
    JSON.stringify({
      version: 1,
      app: "claude",
      step: "configure",
      skipped: true,
    }),
  );
  const props = mount();
  await screen.findByText("Readiness: claude");
  expect(props.onConfigure).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!).skipped).toBe(true);
});
it("returns to configuration when saved objects no longer exist", async () => {
  localStorage.setItem(
    ONBOARDING_KEY,
    JSON.stringify({
      version: 1,
      app: "claude",
      step: "finish",
      skipped: true,
    }),
  );
  vi.mocked(useWorkspaceReadiness).mockReturnValue({
    data: { checks: [{ id: "configuration", state: "unknown" }] },
    isError: false,
  } as any);
  const props = mount();
  const add = await screen.findByRole("button", {
    name: "Add or import providers",
  });
  fireEvent.click(add);
  expect(props.onConfigure).toHaveBeenCalledWith("claude");
  expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!).step).toBe(
    "configure",
  );
});
it("configuration-only clients skip unsupported model steps", async () => {
  localStorage.setItem(
    ONBOARDING_KEY,
    JSON.stringify({
      version: 1,
      app: "opencode",
      step: "verify",
      skipped: false,
    }),
  );
  mount();
  await screen.findByText("Readiness: opencode");
  expect(
    screen.queryByRole("button", { name: "Choose model" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Finish configuration" }),
  ).toBeInTheDocument();
});
it("future progress is not overwritten and can be dismissed", () => {
  const future = JSON.stringify({ version: 9 });
  localStorage.setItem(ONBOARDING_KEY, future);
  const props = mount();
  expect(screen.getByRole("alert")).toHaveTextContent("unsupported");
  fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
  expect(props.onClose).toHaveBeenCalled();
  expect(localStorage.getItem(ONBOARDING_KEY)).toBe(future);
});
it("storage failure keeps setup open and the previous record intact", async () => {
  const props = mount();
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("disk full");
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot save"),
  );
  expect(props.onClose).not.toHaveBeenCalled();
  spy.mockRestore();
});

async function startModelDraft() {
  localStorage.setItem(
    ONBOARDING_KEY,
    JSON.stringify({
      version: 1,
      app: "claude",
      step: "verify",
      skipped: false,
    }),
  );
  const props = mount();
  await screen.findByText("Readiness: claude");
  fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
  fireEvent.click(await screen.findByRole("button", { name: "draft-model" }));
  return props;
}

it("keeps the draft after a failed write and advances only after applying it", async () => {
  const saved = {
    ...(await modelHubApi.catalog("claude")),
    model: "draft-model",
    revision: "next",
  };
  vi.mocked(modelHubApi.select)
    .mockRejectedValueOnce(new Error("write failed"))
    .mockImplementationOnce(async () => {
      vi.mocked(modelHubApi.catalog).mockResolvedValue(saved);
      return saved;
    });
  await startModelDraft();
  const apply = () =>
    screen.getByRole("button", { name: "Apply and continue to verification" });
  fireEvent.click(apply());
  await screen.findByText("write failed");
  expect(screen.getByRole("button", { name: "draft-model" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!).step).toBe("model");
  fireEvent.click(apply());
  await screen.findByText("Readiness: claude");
  expect(modelHubApi.select).toHaveBeenCalledWith(
    "claude",
    "p",
    "draft-model",
    "c",
  );
  expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY)!).step).toBe("verify");
});

it("guards step navigation and closing the wizard with a model draft", async () => {
  const props = await startModelDraft();
  fireEvent.click(screen.getByRole("button", { name: "Verify model" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("button", { name: "draft-model" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
  expect(props.onClose).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard and leave" }),
  );
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(modelHubApi.select).not.toHaveBeenCalled();
});
