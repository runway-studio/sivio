import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  initialNavigation,
  navigateTo,
  useDomainNavigation,
  viewForDomain,
} from "@/hooks/useDomainNavigation";
import { clearViewMemory, useViewMemory } from "@/hooks/useViewMemory";

beforeEach(() => {
  localStorage.clear();
  clearViewMemory();
});
describe("domain navigation", () => {
  it("restores dedicated model pages from saved navigation", () => {
    for (const view of [
      "routingGroups",
      "modelConnections",
      "modelPicker",
      "routeDecisions",
    ] as const) {
      localStorage.setItem("si-assist-last-view", view);
      expect(initialNavigation()).toMatchObject({
        view,
        domain: "model",
        modelView: view,
      });
      expect(
        viewForDomain(navigateTo(initialNavigation(view), "overview"), "model"),
      ).toBe(view);
    }
  });
  it("restores each domain and preserves the model's dedicated page", () => {
    let state = initialNavigation("providers");
    state = navigateTo(state, "hermesMemory");
    state = navigateTo(state, "network");
    expect(state.domain).toBe("network");
    expect(viewForDomain(state, "model")).toBe("hermesMemory");
    state = navigateTo(state, "settings");
    expect(state.domain).toBe("network");
    expect(state.returnView).toBe("network");
    state = navigateTo(state, "settings");
    expect(state.returnView).toBe("network");
    state = navigateTo(state, viewForDomain(state, "model"));
    expect(state.domain).toBe("model");
    expect(state.view).toBe("hermesMemory");
  });
  it("routes legacy deep-linked views to their domain and rejects malformed memory", () => {
    localStorage.setItem("si-assist-last-view", "openclawEnv");
    localStorage.setItem(
      "si-assist-domain-navigation",
      '{"modelView":"network","networkTab":"bad"}',
    );
    expect(initialNavigation()).toMatchObject({
      domain: "model",
      view: "openclawConfig",
      modelView: "openclawConfig",
      networkTab: "首页",
    });
    localStorage.setItem("si-assist-domain-navigation", "broken");
    expect(initialNavigation("settings")).toMatchObject({
      domain: "overview",
      returnView: "overview",
    });
  });
  it("persists non-secret network position and global-settings return page", () => {
    const { result, unmount } = renderHook(() => useDomainNavigation());
    act(() => result.current.setView("usage"));
    act(() => result.current.setView("network"));
    act(() => result.current.setNetworkTab("日志"));
    act(() => result.current.setView("settings"));
    unmount();
    expect(initialNavigation("settings")).toMatchObject({
      domain: "network",
      networkTab: "日志",
      modelView: "usage",
      returnView: "network",
    });
  });
  it("isolates UI filters by tool and restores them after page unmount", () => {
    const view = renderHook(({ key }) => useViewMemory(key, ""), {
      initialProps: { key: "claude" },
    });
    act(() => view.result.current[1]("Anthropic"));
    view.rerender({ key: "codex" });
    expect(view.result.current[0]).toBe("");
    act(() => view.result.current[1]("OpenAI"));
    view.rerender({ key: "claude" });
    expect(view.result.current[0]).toBe("Anthropic");
    view.unmount();
    const restored = renderHook(() => useViewMemory("codex", ""));
    expect(restored.result.current[0]).toBe("OpenAI");
  });
});
