import { describe, expect, it } from "vitest";
import type { AgentMode } from "@getpaseo/protocol/agent-types";
import {
  resolveAgentControlsMode,
  resolveNextAgentModeId,
  resolveNextWorkflowModeId,
} from "./mode";

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        selectedWorkflowMode: "agent",
        onSelectWorkflowMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
        onApplyAgentProfile: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});

describe("resolveNextWorkflowModeId", () => {
  const WORKFLOW_MODES = [
    { id: "agent" },
    { id: "plan" },
    { id: "ask" },
    { id: "debug" },
    { id: "multitask" },
  ];

  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextWorkflowModeId({ modeOptions: WORKFLOW_MODES, selectedMode: "plan" })).toBe(
      "ask",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(
      resolveNextWorkflowModeId({ modeOptions: WORKFLOW_MODES, selectedMode: "multitask" }),
    ).toBe("agent");
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextWorkflowModeId({ modeOptions: WORKFLOW_MODES, selectedMode: "" })).toBe(
      "plan",
    );
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(
      resolveNextWorkflowModeId({ modeOptions: WORKFLOW_MODES, selectedMode: "deleted-mode" }),
    ).toBe("plan");
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextWorkflowModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(
      resolveNextWorkflowModeId({ modeOptions: [{ id: "agent" }], selectedMode: "agent" }),
    ).toBeNull();
  });
});
