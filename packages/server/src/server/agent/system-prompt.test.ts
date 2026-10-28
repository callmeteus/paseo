import { describe, expect, it } from "vitest";
import {
  clampSystemPrompt,
  composeSystemPromptParts,
  MAX_COMPOSED_SYSTEM_PROMPT_CHARS,
} from "./system-prompt";

describe("clampSystemPrompt", () => {
  it("leaves a prompt under the cap untouched", () => {
    expect(clampSystemPrompt("Be terse.")).toBe("Be terse.");
  });

  it("keeps the instructions at the top and the newest context at the bottom", () => {
    const head = "HOUSE RULES ".repeat(1_000);
    const tail = "RECENT TURN ".repeat(1_000);
    const clamped = clampSystemPrompt(`${head}${tail}`, 5_000);
    expect(clamped.length).toBeLessThanOrEqual(5_000);
    expect(clamped.startsWith("HOUSE RULES")).toBe(true);
    expect(clamped.endsWith("RECENT TURN ")).toBe(true);
    expect(clamped).toContain("older context trimmed");
  });
});

describe("composeSystemPromptParts", () => {
  it("joins non-empty parts and drops blank ones", () => {
    expect(composeSystemPromptParts("a", null, "  ", "b")).toBe("a\n\nb");
  });

  it("returns undefined when nothing is left", () => {
    expect(composeSystemPromptParts(null, "   ")).toBeUndefined();
  });

  it("applies the cap to the composed prompt", () => {
    const composed = composeSystemPromptParts("rules ".repeat(20_000));
    expect(composed?.length).toBe(MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
  });
});
