import { OPEN_AGENT_TAB_LABEL } from "@getpaseo/protocol/agent-labels";
import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { buildCloseAgentTabLabels, getAgentTabsNeedingOpenLabel } from "./open-tab-labels";

const clientLabel = "paseo.open-agent-tab.client-1";
const labels = [OPEN_AGENT_TAB_LABEL, clientLabel];

function tab(agentId: string, createdAt: number): WorkspaceTab {
  return { tabId: `agent_${agentId}`, target: { kind: "agent", agentId }, createdAt };
}

function agent(input: {
  id: string;
  parentAgentId?: string | null;
  open?: boolean;
  labels?: Record<string, string>;
  updatedAt?: number;
}): Agent {
  return {
    id: input.id,
    parentAgentId: input.parentAgentId ?? null,
    updatedAt: new Date(input.updatedAt ?? 0),
    labels: input.labels ?? (input.open ? { [OPEN_AGENT_TAB_LABEL]: "true" } : {}),
  } as Agent;
}

describe("getAgentTabsNeedingOpenLabel", () => {
  it("marks every present agent tab, including root agents", () => {
    const agents = new Map([
      ["background-child", agent({ id: "background-child", parentAgentId: "parent" })],
      ["focused-child", agent({ id: "focused-child", parentAgentId: "parent" })],
      ["root", agent({ id: "root" })],
    ]);

    expect(
      getAgentTabsNeedingOpenLabel({
        tabs: [tab("background-child", 1), tab("root", 2), tab("focused-child", 3)],
        getAgent: (agentId) => agents.get(agentId),
        labels,
        pendingAgentIds: new Set(),
      }),
    ).toEqual(["background-child", "root", "focused-child"]);
  });

  it("skips tabs already marked for every client or currently being marked", () => {
    const agents = new Map([
      [
        "marked",
        agent({
          id: "marked",
          parentAgentId: "parent",
          labels: { [OPEN_AGENT_TAB_LABEL]: "true", [clientLabel]: "true" },
        }),
      ],
      ["pending", agent({ id: "pending", parentAgentId: "parent" })],
    ]);

    expect(
      getAgentTabsNeedingOpenLabel({
        tabs: [tab("marked", 1), tab("pending", 2)],
        getAgent: (agentId) => agents.get(agentId),
        labels,
        pendingAgentIds: new Set(["pending"]),
      }),
    ).toEqual([]);
  });

  it("does not reopen a restored tab older than the close marker", () => {
    const agents = new Map([
      [
        "closed",
        agent({
          id: "closed",
          labels: { [OPEN_AGENT_TAB_LABEL]: "false" },
          updatedAt: 10,
        }),
      ],
      [
        "reopened",
        agent({
          id: "reopened",
          labels: { [OPEN_AGENT_TAB_LABEL]: "false" },
          updatedAt: 5,
        }),
      ],
    ]);

    expect(
      getAgentTabsNeedingOpenLabel({
        tabs: [tab("closed", 4), tab("reopened", 6)],
        getAgent: (agentId) => agents.get(agentId),
        labels,
        pendingAgentIds: new Set(),
      }),
    ).toEqual(["reopened"]);
  });

  it("marks an agent again when only the client-scoped label is missing", () => {
    const agents = new Map([
      ["global-only", agent({ id: "global-only", labels: { [OPEN_AGENT_TAB_LABEL]: "true" } })],
    ]);

    expect(
      getAgentTabsNeedingOpenLabel({
        tabs: [tab("global-only", 1)],
        getAgent: (agentId) => agents.get(agentId),
        labels,
        pendingAgentIds: new Set(),
      }),
    ).toEqual(["global-only"]);
  });
});

describe("buildCloseAgentTabLabels", () => {
  it("closes the global marker and every client-scoped marker", () => {
    expect(
      buildCloseAgentTabLabels({
        [OPEN_AGENT_TAB_LABEL]: "true",
        [clientLabel]: "true",
        "paseo.open-agent-tab.client-2": "true",
        "custom.label": "value",
      }),
    ).toEqual({
      [OPEN_AGENT_TAB_LABEL]: "false",
      [clientLabel]: "false",
      "paseo.open-agent-tab.client-2": "false",
    });
  });

  it("still writes the global marker when no labels exist", () => {
    expect(buildCloseAgentTabLabels(null)).toEqual({ [OPEN_AGENT_TAB_LABEL]: "false" });
  });
});
