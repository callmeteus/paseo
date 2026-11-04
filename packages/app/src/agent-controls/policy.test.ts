import { describe, expect, it } from "vitest";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import {
  isPlanningAgentMode,
  resolveForcedAgentModeId,
  resolveForcedLiveModeId,
  resolveKnownAgentModeId,
  resolveNonPlanningModeId,
} from "./policy";

describe("isPlanningAgentMode", () => {
  it("prefers planning metadata and recognizes existing provider ids", () => {
    expect(isPlanningAgentMode({ id: "research", colorTier: "planning" })).toBe(true);
    expect(isPlanningAgentMode({ id: "plan" })).toBe(true);
    expect(
      isPlanningAgentMode({
        id: "https://agentclientprotocol.com/protocol/session-modes#plan",
      }),
    ).toBe(true);
    expect(isPlanningAgentMode({ id: "default", colorTier: "safe" })).toBe(false);
  });
});

describe("resolveNonPlanningModeId", () => {
  const modes = [
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "default", label: "Default", colorTier: "safe" },
    { id: "full", label: "Full", colorTier: "dangerous" },
  ] satisfies AgentMode[];

  it("uses a non-planning provider default", () => {
    expect(resolveNonPlanningModeId(modes, "full")).toBe("full");
  });

  it("does not use a planning or stale provider default", () => {
    expect(resolveNonPlanningModeId(modes, "plan")).toBe("default");
    expect(resolveNonPlanningModeId(modes, "deleted")).toBe("default");
  });

  it("returns null when no non-planning mode exists", () => {
    expect(resolveNonPlanningModeId([modes[0]], "plan")).toBeNull();
  });
});

describe("resolveForcedAgentModeId", () => {
  const cursorModes = [
    { id: "agent", label: "Agent", colorTier: "moderate" },
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "ask", label: "Ask", colorTier: "safe" },
  ] satisfies AgentMode[];
  const buildModes = [
    { id: "build", label: "Build", colorTier: "moderate" },
    { id: "plan", label: "Plan", colorTier: "planning" },
  ] satisfies AgentMode[];

  it("prefers build when the provider offers it", () => {
    expect(resolveForcedAgentModeId(buildModes, "plan")).toBe("build");
  });

  it("uses the provider default when build does not exist", () => {
    expect(resolveForcedAgentModeId(cursorModes, "agent")).toBe("agent");
  });

  it("avoids a planning provider default", () => {
    expect(resolveForcedAgentModeId(cursorModes, "plan")).toBe("agent");
  });

  it("returns null when the provider exposes no modes", () => {
    expect(resolveForcedAgentModeId([], null)).toBeNull();
  });
});

describe("resolveForcedLiveModeId", () => {
  const cursorModes = [
    { id: "agent", label: "Agent", colorTier: "moderate" },
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "ask", label: "Ask", colorTier: "safe" },
  ] satisfies AgentMode[];

  it("leaves a provider's own non-planning mode alone", () => {
    expect(resolveForcedLiveModeId(cursorModes, "agent")).toBeNull();
    expect(resolveForcedLiveModeId(cursorModes, "ask")).toBeNull();
  });

  it("moves a live agent out of a planning mode", () => {
    expect(resolveForcedLiveModeId(cursorModes, "plan")).toBe("agent");
  });

  it("forces build when the provider offers it", () => {
    expect(
      resolveForcedLiveModeId(
        [
          { id: "build", label: "Build", colorTier: "moderate" },
          { id: "plan", label: "Plan", colorTier: "planning" },
        ],
        "plan",
      ),
    ).toBe("build");
  });
});

describe("resolveKnownAgentModeId", () => {
  const modes = [
    { id: "agent", label: "Agent", colorTier: "moderate" },
    { id: "plan", label: "Plan", colorTier: "planning" },
    { id: "ask", label: "Ask", colorTier: "safe" },
  ] satisfies AgentMode[];

  it("keeps a mode the provider advertises", () => {
    expect(resolveKnownAgentModeId(modes, "ask")).toBe("ask");
  });

  it("drops a mode saved under another provider", () => {
    expect(resolveKnownAgentModeId(modes, "build")).toBeNull();
  });

  it("drops the mode when the provider mode list is unknown", () => {
    expect(resolveKnownAgentModeId([], "build")).toBeNull();
  });
});
