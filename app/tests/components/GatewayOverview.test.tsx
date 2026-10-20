import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  GatewayOverview,
  providerSource,
  type GatewayClient,
} from "@/components/overview/GatewayOverview";
import type { ProxyStatus } from "@/types/proxy";
import type { Provider } from "@/types";

const provider: Provider = {
  id: "a",
  name: "Example API",
  settingsConfig: {},
  category: "custom",
};
const clients: GatewayClient[] = [
  {
    app: "claude",
    data: { providers: { a: provider }, currentProviderId: "a" },
    mode: {
      mode: "route",
      attached: true,
      routeProviderId: "a",
      directProviderId: "a",
      selectedModel: "saved-model-b",
    },
  },
];
const status = { running: true, address: "::1", port: 16721 } as ProxyStatus;
const actions = () => ({
  onApp: vi.fn(),
  onRouting: vi.fn(),
  onApps: vi.fn(),
  onTools: vi.fn(),
});

describe("Gateway overview", () => {
  it("classifies credentials instead of treating every official provider as a subscription", () => {
    expect(
      providerSource("claude", { ...provider, category: "official" }),
    ).toBe("api");
    expect(providerSource("claude", { ...provider, category: "local" })).toBe(
      "local",
    );
    expect(
      providerSource("claude", {
        ...provider,
        meta: { providerType: "github_copilot" },
      }),
    ).toBe("subscription");
    expect(
      providerSource("codex", {
        ...provider,
        id: "codex-official",
        category: "official",
      }),
    ).toBe("subscription");
  });

  it("shows the saved choice and navigates through actual management callbacks", () => {
    const callbacks = actions();
    const { container } = render(
      <GatewayOverview clients={clients} status={status} {...callbacks} />,
    );
    expect(screen.getByText("saved-model-b")).toBeInTheDocument();
    expect(screen.getByText("[::1]:16721")).toBeInTheDocument();
    expect(container.querySelectorAll('path[data-active="true"]')).toHaveLength(
      2,
    );
    fireEvent.click(screen.getByRole("button", { name: /Claude Code/ }));
    expect(callbacks.onApp).toHaveBeenCalledWith("claude");
    fireEvent.click(screen.getByText("[::1]:16721"));
    expect(callbacks.onRouting).toHaveBeenCalledOnce();
    fireEvent.click(container.querySelectorAll(".gateway-stage")[2]);
    expect(callbacks.onTools).toHaveBeenCalledOnce();
    fireEvent.click(container.querySelector(".gateway-more")!);
    expect(callbacks.onApps).toHaveBeenCalledOnce();
  });

  it("never draws an active connection when stopped, unavailable, detached, or direct", () => {
    const { container, rerender } = render(
      <GatewayOverview
        clients={clients}
        status={{ ...status, running: false }}
        {...actions()}
      />,
    );
    expect(container.querySelectorAll('path[data-active="true"]')).toHaveLength(
      0,
    );
    rerender(<GatewayOverview clients={clients} {...actions()} />);
    expect(container.querySelectorAll('path[data-active="true"]')).toHaveLength(
      0,
    );
    for (const mode of [
      { ...clients[0].mode!, attached: false },
      { ...clients[0].mode!, mode: "direct" as const },
    ]) {
      rerender(
        <GatewayOverview
          clients={[{ ...clients[0], mode }]}
          status={status}
          {...actions()}
        />,
      );
      expect(
        container.querySelectorAll('path[data-active="true"]'),
      ).toHaveLength(0);
    }
  });
});
