"use client";

import type { WorkbenchPresentation } from "./workbench-header-projection";

import {
  memo,
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";

import type {
  NavigationControllerCapability,
} from "../application/workspace-controller-capabilities.js";
import {
  INITIAL_WORKBENCH_TABS_SNAPSHOT,
  type WorkbenchTab,
  type WorkbenchTabsSnapshot,
} from "../application/workbench-tabs-session.js";
import { WorkbenchTabBar } from "./WorkbenchChrome";

export const WorkbenchTabBarContainer = memo(function WorkbenchTabBarContainer({
  capability,
  presentation,
  onBeforeSelect,
  onOutcome,
}: {
  capability: NavigationControllerCapability;
  presentation: WorkbenchPresentation;
  onBeforeSelect(snapshot: WorkbenchTabsSnapshot): void;
  onOutcome(outcome: unknown, target?: WorkbenchTab): void;
}) {
  const navigation = useSyncExternalStore(
    capability.subscribe,
    capability.getSnapshot,
    capability.getSnapshot,
  );
  const tabs = navigation.tabs ?? INITIAL_WORKBENCH_TABS_SNAPSHOT;

  const selectTab = useCallback((tab: WorkbenchTab) => {
    onBeforeSelect(tabs);
    void capability.commands.activateTab(tab.tabId).then((outcome) => onOutcome(outcome, tab));
  }, [capability, onBeforeSelect, onOutcome, tabs]);

  const createStartTab = useCallback(() => {
    void capability.commands.createStartTab().then(onOutcome);
  }, [capability, onOutcome]);

  const closeTab = useCallback((tab: WorkbenchTab) => {
    void capability.commands.closeTab(tab.tabId).then((outcome) => {
      onOutcome(outcome);
      const current = capability.getSnapshot().tabs
        ?? INITIAL_WORKBENCH_TABS_SNAPSHOT;
      const active = current.tabs.find((item) => item.tabId === current.activeTabId);
      if (outcome.status === "succeeded" && active) {
        window.requestAnimationFrame(() => {
          document.getElementById(`workbench-tab-${active.tabId}`)?.focus();
        });
      }
    });
  }, [capability, onOutcome]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (!command || event.altKey) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        createStartTab();
        return;
      }
      if (event.key.toLowerCase() === "w") {
        const active = tabs.tabs.find((tab) => tab.tabId === tabs.activeTabId);
        if (!active) return;
        event.preventDefault();
        closeTab(active);
        return;
      }
      const numeric = Number(event.key);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) {
        const tab = tabs.tabs[numeric - 1];
        if (!tab) return;
        event.preventDefault();
        selectTab(tab);
        return;
      }
      if (event.key === "Tab" && tabs.tabs.length > 1) {
        event.preventDefault();
        const currentIndex = tabs.tabs.findIndex((tab) => tab.tabId === tabs.activeTabId);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + direction + tabs.tabs.length) % tabs.tabs.length;
        selectTab(tabs.tabs[nextIndex]);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeTab, createStartTab, selectTab, tabs]);

  return (
    <WorkbenchTabBar
      snapshot={tabs}
      presentation={presentation}
      onSelect={selectTab}
      onClose={closeTab}
      onNew={createStartTab}
    />
  );
});
