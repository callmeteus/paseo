import { describe, expect, test } from "vitest";
import {
  decodeMultitaskTaskTarget,
  encodeMultitaskTaskTarget,
  MULTITASK_TASK_TARGET_LABEL,
  readMultitaskTaskTarget,
  resolveMultitaskTaskTarget,
  type MultitaskCliCatalogEntry,
} from "./multitask-task-target.js";

const catalog: MultitaskCliCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude Code",
    enabled: true,
    status: "ready",
    models: [
      { id: "sonnet", label: "Sonnet", aliases: ["claude-sonnet-4"] },
      { id: "opus", label: "Opus" },
    ],
  },
  {
    id: "opencode",
    label: "OpenCode",
    enabled: true,
    status: "ready",
    models: [
      { id: "opencode/big-pickle", label: "Big Pickle" },
      { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      { id: "deepseek-v4.1-flash:free", label: "DeepSeek V4.1 Flash (free)" },
      { id: "qwen3-coder", label: "Qwen3 Coder" },
    ],
  },
];

describe("multitask task target labels", () => {
  test("round-trips a Paseo agent and a CLI model, including a slash in the model id", () => {
    expect(encodeMultitaskTaskTarget({ kind: "paseo" })).toBe("paseo");
    expect(decodeMultitaskTaskTarget("paseo")).toEqual({ kind: "paseo" });
    expect(decodeMultitaskTaskTarget(null)).toEqual({ kind: "paseo" });

    const cli = { kind: "cli" as const, provider: "opencode", model: "org/deepseek-v4.1-flash" };
    expect(decodeMultitaskTaskTarget(encodeMultitaskTaskTarget(cli))).toEqual(cli);
    expect(decodeMultitaskTaskTarget("cli:opencode")).toEqual({
      kind: "cli",
      provider: "opencode",
      model: null,
    });
    expect(
      readMultitaskTaskTarget({
        [MULTITASK_TASK_TARGET_LABEL]: "cli:claude/opus",
      }),
    ).toEqual({ kind: "cli", provider: "claude", model: "opus" });
  });
});

describe("resolveMultitaskTaskTarget", () => {
  test("a Paseo agent does not need a CLI, even when one is missing", () => {
    const resolved = resolveMultitaskTaskTarget({ kind: "paseo" }, [
      ...catalog,
      {
        id: "opencode",
        label: "OpenCode",
        enabled: true,
        status: "unavailable",
        error: "OpenCode binary not found",
        models: [],
      },
    ]);

    expect(resolved).toEqual({ ok: true, target: { kind: "paseo" } });
  });

  test("Claude Code resolves to the model the catalog lists", () => {
    const resolved = resolveMultitaskTaskTarget(
      { kind: "cli", provider: "claude", model: "claude-sonnet-4" },
      catalog,
    );

    expect(resolved).toEqual({
      ok: true,
      target: { kind: "cli", provider: "claude", model: "sonnet" },
    });
  });

  test("OpenCode resolves to a model the catalog lists", () => {
    const resolved = resolveMultitaskTaskTarget(
      { kind: "cli", provider: "OpenCode", model: "deepseek-v4.1-flash" },
      catalog,
    );

    expect(resolved).toEqual({
      ok: true,
      target: { kind: "cli", provider: "opencode", model: "deepseek-v4.1-flash" },
    });
  });

  test("an unknown model name fails and lists the closest real catalog names", () => {
    const resolved = resolveMultitaskTaskTarget(
      { kind: "cli", provider: "opencode", model: "Gepsiq" },
      catalog,
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.code).toBe("unknown-model");
    expect(resolved.closest[0]?.toLowerCase()).toContain("deepseek");
    expect(resolved.closest.join(" ").toLowerCase()).not.toContain("gepsiq");
    expect(Object.keys(resolved).sort()).toEqual(["closest", "code", "message", "ok"]);
  });

  test("a CLI that is not installed fails that task and names other CLIs", () => {
    const resolved = resolveMultitaskTaskTarget(
      { kind: "cli", provider: "opencode", model: "deepseek-v4.1-flash" },
      [
        catalog[0]!,
        {
          id: "opencode",
          label: "OpenCode",
          enabled: true,
          status: "unavailable",
          error: "OpenCode binary not found",
          models: catalog[1]!.models,
        },
      ],
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.code).toBe("missing");
    expect(resolved.message).toContain("not found");
    expect(resolved.closest).toContain("Claude Code");
    expect(resolved).not.toHaveProperty("workflowMode");
    expect(resolved).not.toHaveProperty("workflowModeId");
  });

  test("a CLI the catalog does not have fails without inventing an id", () => {
    const resolved = resolveMultitaskTaskTarget(
      { kind: "cli", provider: "gepsiq", model: "anything" },
      catalog,
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.code).toBe("unknown-cli");
    expect(resolved.closest.join(" ").toLowerCase()).not.toContain("gepsiq");
    expect(resolved.closest.length).toBeGreaterThan(0);
  });
});
