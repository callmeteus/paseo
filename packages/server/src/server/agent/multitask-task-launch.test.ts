import { describe, expect, test } from "vitest";
import {
  resolveCreateAgentTaskLaunch,
  resolveMultitaskChildMode,
  type MultitaskLaunchProvider,
} from "./multitask-task-launch.js";

const providers: MultitaskLaunchProvider[] = [
  {
    id: "claude",
    label: "Claude Code",
    enabled: true,
    status: "ready",
    models: [{ id: "opus", label: "Opus" }],
    modeIds: ["default", "plan"],
    defaultModeId: "default",
  },
  {
    id: "opencode",
    label: "OpenCode",
    enabled: true,
    status: "ready",
    models: [
      { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      { id: "opencode/big-pickle", label: "Big Pickle" },
      { id: "qwen3-coder", label: "Qwen3 Coder" },
    ],
    modeIds: ["build", "plan"],
    defaultModeId: "build",
  },
];

const claudeParent = {
  workflowModeId: "multitask",
  provider: "claude",
  model: "opus",
  taskTargetLabel: "cli:opencode/deepseek-v4.1-flash",
};

describe("resolveCreateAgentTaskLaunch", () => {
  test("a Paseo task uses the parent CLI and model", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: { ...claudeParent, taskTargetLabel: "paseo" },
      provider: "opencode/deepseek-v4.1-flash",
      providers,
    });

    expect(resolved).toEqual({
      ok: true,
      kind: "paseo",
      provider: "claude",
      model: "opus",
      providerArgument: "claude/opus",
    });
  });

  test("Claude Code launches with a model the catalog lists", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: { workflowModeId: "agent", provider: "opencode", model: "qwen3-coder" },
      provider: "claude/opus",
      providers,
    });

    expect(resolved).toMatchObject({
      ok: true,
      kind: "cli",
      provider: "claude",
      model: "opus",
      providerArgument: "claude/opus",
      modeId: "default",
    });
  });

  test("a normal create still launches a model the catalog does not list", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: { workflowModeId: "agent", provider: "claude", model: "opus" },
      provider: "claude/some-new-model",
      providers: [],
    });

    expect(resolved).toMatchObject({
      ok: true,
      kind: "cli",
      provider: "claude",
      model: "some-new-model",
      providerArgument: "claude/some-new-model",
    });
  });

  test("OpenCode launches the DeepSeek id this machine's opencode models lists", () => {
    const modelId = "opencode/deepseek-v4.1-flash-free";
    const resolved = resolveCreateAgentTaskLaunch({
      parent: {
        ...claudeParent,
        taskTargetLabel: `cli:opencode/${modelId}`,
      },
      provider: "claude/opus",
      providers: [
        providers[0]!,
        {
          ...providers[1]!,
          models: [
            { id: modelId, label: "DeepSeek V4.1 Flash" },
            { id: "opencode/big-pickle", label: "Big Pickle" },
          ],
        },
      ],
    });

    expect(resolved).toMatchObject({
      ok: true,
      kind: "cli",
      provider: "opencode",
      model: modelId,
      modeId: "build",
    });
    if (!resolved.ok) return;
    const slash = resolved.providerArgument.indexOf("/");
    expect(resolved.providerArgument.slice(slash + 1)).toBe(modelId);
    expect(resolved.providerArgument.toLowerCase()).not.toContain("gepsiq");
    expect(resolved.model?.toLowerCase()).not.toContain("gepsiq");
  });

  test("OpenCode launches with a model the catalog lists", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: claudeParent,
      provider: "claude/opus",
      providers,
    });

    expect(resolved).toMatchObject({
      ok: true,
      kind: "cli",
      provider: "opencode",
      model: "deepseek-v4.1-flash",
      providerArgument: "opencode/deepseek-v4.1-flash",
      modeId: "build",
    });
  });

  test("the reverse also works: an OpenCode parent can start a Claude Code task", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: {
        workflowModeId: "multitask",
        provider: "opencode",
        model: "deepseek-v4.1-flash",
        taskTargetLabel: "cli:claude/opus",
      },
      providers,
    });

    expect(resolved).toMatchObject({
      ok: true,
      provider: "claude",
      model: "opus",
      modeId: "default",
    });
  });

  test("taskAgent overrides the control, including a Paseo child under an OpenCode parent", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: {
        workflowModeId: "multitask",
        provider: "opencode",
        model: "qwen3-coder",
        taskTargetLabel: "cli:claude/opus",
      },
      taskAgent: { kind: "paseo" },
      providers,
    });

    expect(resolved).toMatchObject({
      ok: true,
      kind: "paseo",
      provider: "opencode",
      model: "qwen3-coder",
    });
    expect(resolved).not.toHaveProperty("modeId");
  });

  test("an unknown model fails that task and does not change the workflow mode", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: claudeParent,
      taskAgent: { kind: "cli", provider: "opencode", model: "Gepsiq" },
      providers,
    });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.code).toBe("unknown-model");
    expect(resolved.closest[0]?.toLowerCase()).toContain("deepseek");
    expect(resolved.closest.join(" ").toLowerCase()).not.toContain("gepsiq");
    expect(resolved).not.toHaveProperty("workflowMode");
    expect(resolved).not.toHaveProperty("workflowModeId");
  });

  test("a missing CLI fails that task and names a CLI that is ready", () => {
    const resolved = resolveCreateAgentTaskLaunch({
      parent: { ...claudeParent, taskTargetLabel: "cli:opencode/deepseek-v4.1-flash" },
      providers: [
        providers[0]!,
        {
          id: "opencode",
          label: "OpenCode",
          enabled: true,
          status: "unavailable",
          error: "OpenCode binary not found",
          models: providers[1]!.models,
        },
      ],
    });

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.code).toBe("missing");
    expect(resolved.closest).toContain("Claude Code");
    expect(resolved).not.toHaveProperty("workflowModeId");
  });
});

describe("resolveMultitaskChildMode", () => {
  test("the same CLI inherits, and a requested mode wins across CLIs", () => {
    expect(
      resolveMultitaskChildMode({
        parentProvider: "claude",
        targetProvider: "claude",
        availableModeIds: ["default", "plan"],
      }),
    ).toBeUndefined();
    expect(
      resolveMultitaskChildMode({
        parentProvider: "claude",
        targetProvider: "opencode",
        requestedMode: "plan",
        availableModeIds: ["build", "plan"],
      }),
    ).toBe("plan");
    expect(
      resolveMultitaskChildMode({
        parentProvider: "claude",
        targetProvider: "opencode",
        requestedMode: "plan",
        availableModeIds: ["build"],
        defaultModeId: "build",
      }),
    ).toBe("build");
  });
});
