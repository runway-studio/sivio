import { expect, it, vi } from "vitest";
import { providersApi } from "@/lib/api";
import { providersQueryOptions } from "@/lib/query/queries";
it("distinguishes unavailable provider data from a genuinely empty configuration", async () => {
  const all = vi
    .spyOn(providersApi, "getAll")
    .mockRejectedValueOnce(new Error("fixture read failed"))
    .mockResolvedValue({});
  const current = vi.spyOn(providersApi, "getCurrent").mockResolvedValue("");
  expect((await providersQueryOptions("claude").queryFn()).readError).toBe(
    true,
  );
  expect(
    (await providersQueryOptions("claude").queryFn()).readError,
  ).toBeUndefined();
  all.mockRestore();
  current.mockRestore();
});
