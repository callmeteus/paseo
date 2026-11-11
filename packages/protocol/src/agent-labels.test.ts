import { describe, expect, test } from "vitest";
import {
  getParentAgentIdFromLabels,
  getOpenAgentTabLabel,
  hasOpenAgentTab,
  isDelegatedAgent,
  isOpenAgentTabClosed,
  isOpenAgentTabLabel,
  OPEN_AGENT_TAB_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "./agent-labels.js";

describe("agent label policy", () => {
  test("treats a non-empty parent agent label as delegation", () => {
    const labels = { [PARENT_AGENT_ID_LABEL]: " parent-agent \n" };

    expect(getParentAgentIdFromLabels(labels)).toBe("parent-agent");
    expect(isDelegatedAgent({ labels })).toBe(true);
  });

  test("ignores missing, empty, and non-string parent agent labels", () => {
    expect(isDelegatedAgent({ labels: {} })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: "   " } })).toBe(false);
    expect(isDelegatedAgent({ labels: { [PARENT_AGENT_ID_LABEL]: 42 } })).toBe(false);
  });

  test("treats any true client-scoped open-tab label as open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "true" })).toBe(true);
    expect(hasOpenAgentTab({ [desktopLabel]: "false", [mobileLabel]: "false" })).toBe(false);
    expect(hasOpenAgentTab({})).toBe(false);
  });

  test("recognizes the global and client-scoped open-tab labels", () => {
    expect(isOpenAgentTabLabel(getOpenAgentTabLabel("client-a"))).toBe(true);
    expect(isOpenAgentTabLabel(OPEN_AGENT_TAB_LABEL)).toBe(true);
    expect(isOpenAgentTabLabel("custom.open-agent-tab.client-a")).toBe(false);
  });

  test("treats the global false label as closed unless a client still has it open", () => {
    const desktopLabel = getOpenAgentTabLabel("desktop-client");
    const mobileLabel = getOpenAgentTabLabel("mobile-client");

    expect(isOpenAgentTabClosed({ [OPEN_AGENT_TAB_LABEL]: "false" })).toBe(true);
    expect(isOpenAgentTabClosed({ [OPEN_AGENT_TAB_LABEL]: "false", [desktopLabel]: "false" })).toBe(
      true,
    );
    expect(isOpenAgentTabClosed({ [OPEN_AGENT_TAB_LABEL]: "false", [mobileLabel]: "true" })).toBe(
      false,
    );
    expect(isOpenAgentTabClosed({ [OPEN_AGENT_TAB_LABEL]: "true" })).toBe(false);
    expect(isOpenAgentTabClosed({ [desktopLabel]: "false" })).toBe(false);
    expect(isOpenAgentTabClosed({})).toBe(false);
  });
});
