import { describe, expect, test } from "vitest";
import { WORKFLOW_MODES as WORKFLOW_MODE_CATALOG } from "@getpaseo/protocol/workflow-modes";

import {
  composeWorkflowPrompt,
  isWorkflowModeId,
  resolveDefaultWritableProviderMode,
  stripWorkflowInstruction,
  workflowChangeNotice,
  WORKFLOW_MODES,
} from "./workflow-modes.js";

describe("workflow modes", () => {
  test("changing workflow tells the model the previous mode ended", () => {
    const notice = workflowChangeNotice("plan", "agent");
    expect(notice).toContain("Agent mode");
    expect(notice).toContain("Plan mode has ended");
    expect(notice).toContain("no longer apply");
    expect(workflowChangeNotice("agent", "agent")).toBe("");
    expect(workflowChangeNotice(null, null)).toBe("");
  });

  test("agent is the default and contributes no prompt", () => {
    expect(composeWorkflowPrompt(null, { agentId: "a", cwd: "/repo" })).toBe("");
    expect(composeWorkflowPrompt("unknown", { agentId: "a", cwd: "/repo" })).toBe("");
  });

  test("strips the workflow preamble providers echo back as a user message", () => {
    expect(
      stripWorkflowInstruction(
        "<paseo-workflow>\nYou are in Ask mode.\n</paseo-workflow>\n\nMe lembre em 1h",
      ),
    ).toBe("Me lembre em 1h");
    expect(stripWorkflowInstruction("Me lembre em 1h")).toBe("Me lembre em 1h");
    expect(stripWorkflowInstruction("quote <paseo-workflow> mid-message")).toBe(
      "quote <paseo-workflow> mid-message",
    );
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

  test("plan produces an implementation plan without changes", () => {
    const prompt = composeWorkflowPrompt("plan", { agentId: "a", cwd: "/repo" });
    expect(prompt).toContain("Plan mode");
    expect(prompt).toContain("implementation plan");
    expect(prompt).toContain("Do NOT edit project files");
    expect(prompt).toContain("plan_build");
    expect(WORKFLOW_MODES.find((mode) => mode.id === "plan")?.readOnly).toBe(true);
  });

  test("ids and colors come from the shared catalog", () => {
    expect(WORKFLOW_MODES.map((mode) => [mode.id, mode.color])).toEqual(
      WORKFLOW_MODE_CATALOG.map((mode) => [mode.id, mode.color]),
    );
  });

  test("leaving a read-only workflow restores a writable provider mode", () => {
    expect(resolveDefaultWritableProviderMode("opencode")).toBe("build");
    expect(resolveDefaultWritableProviderMode("claude")).toBe("default");
    expect(resolveDefaultWritableProviderMode("cursor")).toBe("agent");
    expect(resolveDefaultWritableProviderMode("pi")).toBeNull();
  });

  test("multitask names the stored task target and does not invent a model", () => {
    const prompt = composeWorkflowPrompt("multitask", {
      agentId: "a",
      cwd: "/repo",
      taskTargetLabel: "cli:opencode/deepseek-v4.1-flash",
    });

    expect(prompt).toContain("create_agent");
    expect(prompt).toContain("opencode");
    expect(prompt).toContain("deepseek-v4.1-flash");
    expect(prompt).toContain("taskAgent");
    expect(prompt).not.toContain("Gepsiq");
    expect(composeWorkflowPrompt("multitask", { agentId: "a", cwd: "/repo" })).toContain(
      "Paseo agent",
    );
  });

  test("only known ids validate", () => {
    expect(isWorkflowModeId("multitask")).toBe(true);
    expect(isWorkflowModeId("plan")).toBe(true);
    expect(isWorkflowModeId("unknown")).toBe(false);
    expect(isWorkflowModeId(null)).toBe(false);
  });
});
