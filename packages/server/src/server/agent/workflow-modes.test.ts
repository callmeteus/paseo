import { describe, expect, test } from "vitest";

import { composeWorkflowPrompt, isWorkflowModeId, WORKFLOW_MODES } from "./workflow-modes.js";

describe("workflow modes", () => {
  test("agent is the default and contributes no prompt", () => {
    expect(composeWorkflowPrompt(null, { agentId: "a", cwd: "/repo" })).toBe("");
    expect(composeWorkflowPrompt("unknown", { agentId: "a", cwd: "/repo" })).toBe("");
  });

  test("ask describes a read-only posture", () => {
    const prompt = composeWorkflowPrompt("ask", { agentId: "a", cwd: "/repo" });
    expect(prompt).toContain("read-only");
    expect(WORKFLOW_MODES.find((mode) => mode.id === "ask")?.readOnly).toBe(true);
  });

  test("debug receives the ingest endpoint, log path and session id", () => {
    const prompt = composeWorkflowPrompt("debug", {
      agentId: "agent-1",
      cwd: "/repo",
      debugEndpoint: "http://127.0.0.1:6768/debug-ingest/agent-1",
      debugLogPath: "/home/.paseo/debug/agent-1.log",
      debugSessionId: "agent-1",
    });

    expect(prompt).toContain("http://127.0.0.1:6768/debug-ingest/agent-1");
    expect(prompt).toContain("/home/.paseo/debug/agent-1.log");
    expect(prompt).toContain("X-Debug-Session-Id: agent-1");
    expect(prompt).toContain("#region paseo-debug");
  });

  test("only known ids validate", () => {
    expect(isWorkflowModeId("multitask")).toBe(true);
    expect(isWorkflowModeId("plan")).toBe(false);
    expect(isWorkflowModeId(null)).toBe(false);
  });
});
