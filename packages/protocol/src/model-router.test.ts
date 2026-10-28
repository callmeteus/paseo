import { describe, expect, it } from "vitest";
import {
  isProviderCrashFailure,
  isRetryableRouterFailure,
  normalizeRouterTargets,
  selectDistributionTarget,
  selectFallbackTarget,
  type ModelRouter,
} from "./model-router";

const installed = new Set(["codex", "cline", "opencode"]);

function router(overrides: Partial<ModelRouter> = {}): ModelRouter {
  return {
    id: "r1",
    name: "Fallback",
    mode: "fallback",
    targets: [
      { provider: "opencode", model: "qwen3" },
      { provider: "cline", model: null },
      { provider: "codex", model: "gpt-5" },
    ],
    ...overrides,
  };
}

describe("selectDistributionTarget", () => {
  it("rotates through every target and wraps around", () => {
    const selections = [0, 1, 2, 3].map((cursor) =>
      selectDistributionTarget({ router: router(), cursor, installedProviders: installed }),
    );
    expect(selections.map((entry) => entry?.target.provider)).toEqual([
      "opencode",
      "cline",
      "codex",
      "opencode",
    ]);
    expect(selections.map((entry) => entry?.cursor)).toEqual([1, 2, 3, 4]);
  });

  it("expands weights into slots", () => {
    const weighted = router({
      targets: [
        { provider: "opencode", model: "a", weight: 2 },
        { provider: "cline", model: null, weight: 1 },
      ],
    });
    const providers = [0, 1, 2, 3].map(
      (cursor) =>
        selectDistributionTarget({ router: weighted, cursor, installedProviders: installed })
          ?.target.provider,
    );
    expect(providers).toEqual(["opencode", "opencode", "cline", "opencode"]);
  });

  it("skips providers that are not installed", () => {
    const selection = selectDistributionTarget({
      router: router(),
      cursor: 0,
      installedProviders: new Set(["cline"]),
    });
    expect(selection?.target.provider).toBe("cline");
  });
});

describe("selectFallbackTarget", () => {
  it("returns the next target in order", () => {
    expect(
      selectFallbackTarget({
        router: router(),
        current: { provider: "opencode", model: "qwen3" },
        installedProviders: installed,
      }),
    ).toEqual({ provider: "cline", model: null });
  });

  it("returns null at the end of the chain", () => {
    expect(
      selectFallbackTarget({
        router: router(),
        current: { provider: "codex", model: "gpt-5" },
        installedProviders: installed,
      }),
    ).toBeNull();
  });

  it("starts from the top when the chat is outside the router", () => {
    expect(
      selectFallbackTarget({
        router: router(),
        current: { provider: "claude", model: null },
        installedProviders: installed,
      }),
    ).toEqual({ provider: "opencode", model: "qwen3" });
  });

  it("skips a failing provider when another one is still available", () => {
    const mixed = router({
      targets: [
        { provider: "opencode", model: "qwen3" },
        { provider: "opencode", model: "glm" },
        { provider: "cline", model: null },
      ],
    });
    expect(
      selectFallbackTarget({
        router: mixed,
        current: { provider: "opencode", model: "qwen3" },
        installedProviders: installed,
        skipProviders: new Set(["opencode"]),
      }),
    ).toEqual({ provider: "cline", model: null });
  });

  it("keeps the stored order when every remaining target is skipped", () => {
    const sameProvider = router({
      targets: [
        { provider: "opencode", model: "qwen3" },
        { provider: "opencode", model: "glm" },
      ],
    });
    expect(
      selectFallbackTarget({
        router: sameProvider,
        current: { provider: "opencode", model: "qwen3" },
        installedProviders: installed,
        skipProviders: new Set(["opencode"]),
      }),
    ).toEqual({ provider: "opencode", model: "glm" });
  });
});

describe("normalizeRouterTargets", () => {
  it("drops duplicates while preserving order", () => {
    expect(
      normalizeRouterTargets([
        { provider: "codex", model: "gpt-5" },
        { provider: "codex", model: "gpt-5" },
        { provider: "cline", model: null },
      ]),
    ).toEqual([
      { provider: "codex", model: "gpt-5" },
      { provider: "cline", model: null },
    ]);
  });
});

describe("isRetryableRouterFailure", () => {
  it.each([
    "You are out of credits",
    "quota exceeded for this model",
    "429 Too Many Requests",
    "insufficient_quota",
    "usage limit reached",
    "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.",
    "daily limit reached for this model",
  ])("treats %s as retryable", (error) => {
    expect(isRetryableRouterFailure({ error })).toBe(true);
  });

  it.each([
    "model not found",
    "invalid api key",
    "process exited with code 1",
    "OpenCode helper server exited (4294967295)",
    "",
  ])("does not fall back on %s", (error) => {
    expect(isRetryableRouterFailure({ error })).toBe(false);
  });

  it("reads the provider code and diagnostic", () => {
    expect(isRetryableRouterFailure({ error: "failed", code: "402" })).toBe(true);
    expect(
      isRetryableRouterFailure({ error: "failed", diagnostic: "credit balance is too low" }),
    ).toBe(true);
  });
});

describe("isProviderCrashFailure", () => {
  it.each([
    "OpenCode helper server exited (4294967295)",
    "process exited with code 1",
    "socket hang up",
    "Transport: connection reset",
  ])("treats %s as a crash to retry on the same provider", (error) => {
    expect(isProviderCrashFailure({ error })).toBe(true);
  });

  it.each(["Free usage limit reached", "model not found", ""])(
    "does not treat %s as a crash",
    (error) => {
      expect(isProviderCrashFailure({ error })).toBe(false);
    },
  );
});
