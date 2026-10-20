import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkspacePresentationFields } from "@/components/settings/WorkspacePresentationFields";
import { defaultDesktopPreferences } from "@/lib/desktopPreferences";
it("reorders only model resources while retaining the complete legacy preference schema", () => {
  const patch = vi.fn();
  render(
    <WorkspacePresentationFields
      draft={defaultDesktopPreferences}
      patch={patch}
      zh
    />,
  );
  expect(screen.getByText("模型资源菜单顺序")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "概览 下移" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "网络 上移" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "MCP 下移" }));
  expect(patch).toHaveBeenCalledWith({
    menuOrder: [
      "overview",
      "network",
      "skills",
      "mcp",
      "prompts",
      "sessions",
      "auth",
      "usage",
    ],
  });
});
