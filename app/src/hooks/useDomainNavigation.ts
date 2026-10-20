import { useState } from "react";
import {
  domainOfView,
  parseView,
  readStoredView,
  type Domain,
  type View,
  type NetworkTab,
  NETWORK_TABS,
} from "@/lib/navigation";

export interface DomainNavigation {
  view: View;
  domain: Domain;
  modelView: View;
  networkTab: NetworkTab;
  returnView: View;
}
const STORAGE_KEY = "si-assist-domain-navigation";
export function initialNavigation(view = readStoredView()): DomainNavigation {
  let stored: Partial<DomainNavigation> = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") ?? {};
  } catch {
    /* default for invalid/old preferences */
  }
  const model = parseView(stored.modelView);
  const back = parseView(stored.returnView);
  const returnView = back && back !== "settings" ? back : "overview";
  return {
    view,
    domain: domainOfView(view === "settings" ? returnView : view),
    modelView:
      view !== "settings" && domainOfView(view) === "model"
        ? view
        : model && model !== "settings" && domainOfView(model) === "model"
          ? model
          : "providers",
    networkTab: NETWORK_TABS.includes(stored.networkTab as NetworkTab)
      ? (stored.networkTab as NetworkTab)
      : "首页",
    returnView,
  };
}
export function navigateTo(
  state: DomainNavigation,
  view: View,
): DomainNavigation {
  if (view === "settings")
    return {
      ...state,
      view,
      returnView: state.view === "settings" ? state.returnView : state.view,
    };
  const domain = domainOfView(view);
  return {
    ...state,
    view,
    domain,
    modelView: domain === "model" ? view : state.modelView,
  };
}
export function viewForDomain(state: DomainNavigation, domain: Domain): View {
  return domain === "model" ? state.modelView : domain;
}
export function useDomainNavigation() {
  const [navigation, update] = useState(initialNavigation);
  const change = (fn: (previous: DomainNavigation) => DomainNavigation) =>
    update((previous) => {
      const next = fn(previous);
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            modelView: next.modelView,
            networkTab: next.networkTab,
            returnView: next.returnView,
          }),
        );
      } catch {
        /* navigation still works without storage */
      }
      return next;
    });
  return {
    navigation,
    setView: (view: View) => change((previous) => navigateTo(previous, view)),
    setNetworkTab: (networkTab: NetworkTab) =>
      change((previous) => ({ ...previous, networkTab })),
  };
}
