import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProxyNodeGrid } from "@/components/network/ProxyNodeGrid";
import { ProxyGroupNavigator } from "@/components/network/ProxyGroupNavigator";
import { orderedMenuPages, menuPages } from "@/lib/desktopPreferences";
afterEach(() => vi.useRealTimers());
it("keeps 1000 nodes accessible with 60 rows per page and locks every mutation while busy", () => {
  const onSelect = vi.fn();
  const onTest = vi.fn();
  const props = {
    nodes: Array.from({ length: 1000 }, (_, i) => `Node ${i}`),
    current: "Node 0",
    columns: 4,
    busy: false,
    onSelect,
    onTest,
  };
  const view = render(<ProxyNodeGrid {...props} />);
  expect(screen.getAllByRole("button", { name: /^Node / })).toHaveLength(60);
  expect(screen.getByRole("button", { name: "Node 0" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (let i = 0; i < 16; i++)
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  fireEvent.click(screen.getByRole("button", { name: "Node 999" }));
  expect(onSelect).toHaveBeenCalledWith("Node 999");
  view.rerender(<ProxyNodeGrid {...props} busy />);
  expect(screen.getByRole("button", { name: "Node 999" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "测速 Node 999" })).toBeDisabled();
  view.unmount();
});
it("cancels pending group hover on leave, preference change and destruction; click remains available", () => {
  vi.useFakeTimers();
  const onLocate = vi.fn();
  const names = ["A", "B"];
  const view = render(
    <ProxyGroupNavigator
      names={names}
      enabled
      delay={500}
      onLocate={onLocate}
    />,
  );
  fireEvent.pointerEnter(screen.getByRole("button", { name: "A" }));
  act(() => vi.advanceTimersByTime(499));
  expect(onLocate).not.toHaveBeenCalled();
  fireEvent.pointerLeave(screen.getByRole("button", { name: "A" }));
  act(() => vi.advanceTimersByTime(1000));
  expect(onLocate).not.toHaveBeenCalled();
  fireEvent.pointerEnter(screen.getByRole("button", { name: "B" }));
  act(() => vi.advanceTimersByTime(500));
  expect(onLocate).toHaveBeenCalledWith("B");
  onLocate.mockClear();
  fireEvent.pointerEnter(screen.getByRole("button", { name: "A" }));
  view.rerender(
    <ProxyGroupNavigator
      names={names}
      enabled={false}
      delay={500}
      onLocate={onLocate}
    />,
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(onLocate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "A" }));
  expect(onLocate).toHaveBeenCalledWith("A");
  view.rerender(
    <ProxyGroupNavigator
      names={names}
      enabled
      delay={500}
      onLocate={onLocate}
    />,
  );
  onLocate.mockClear();
  fireEvent.pointerEnter(screen.getByRole("button", { name: "B" }));
  view.unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect(onLocate).not.toHaveBeenCalled();
});
it("retains all navigation destinations across older custom orders", () => {
  expect(orderedMenuPages(["network", "network", "overview"])).toEqual([
    "network",
    "overview",
    ...menuPages.filter((page) => !["network", "overview"].includes(page)),
  ]);
});
