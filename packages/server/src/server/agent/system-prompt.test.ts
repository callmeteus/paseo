import { describe, expect, it } from "vitest";
import {
  clampSystemPrompt,
  composeSystemPromptParts,
  healOversizedStoredSystemPrompt,
  MAX_COMPOSED_SYSTEM_PROMPT_CHARS,
  PORTED_CONTEXT_MARKER,
  preserveSuffixSystemPrompt,
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

describe("preserveSuffixSystemPrompt", () => {
  it("keeps the suffix verbatim when base+suffix exceed max by trimming base only", () => {
    const keyword = "pindamonhangaba";
    const suffix = `The following conversation was ported from opencode. Continue it as if you had been the assistant.\n\nUser: remember ${keyword}`;
    const base = "DEFAULT RULES ".repeat(5_000);
    const out = preserveSuffixSystemPrompt(base, suffix, MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(out.length).toBeLessThanOrEqual(MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(out).toContain(keyword);
    expect(out.endsWith(suffix)).toBe(true);
    expect(out).toContain("older context trimmed");
  });

  it("returns only clamped suffix when base is empty", () => {
    expect(preserveSuffixSystemPrompt("", "short")).toBe("short");
  });
});

describe("healOversizedStoredSystemPrompt", () => {
  it("preserves the ported block when splitting would drop it", () => {
    const keyword = "pindamonhangaba";
    const ported = `${PORTED_CONTEXT_MARKER} opencode. Continue it as if you had been the assistant.\n\nUser: remember ${keyword}`;
    const base = "DEFAULT ".repeat(6_000);
    const prompt = `${base}\n\n${ported}`;
    expect(prompt.length).toBeGreaterThan(MAX_COMPOSED_SYSTEM_PROMPT_CHARS);

    const healed = healOversizedStoredSystemPrompt(prompt, MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(healed.length).toBeLessThanOrEqual(MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(healed).toContain(keyword);
    expect(healed).toContain(PORTED_CONTEXT_MARKER);
    expect(healed.endsWith(ported)).toBe(true);
  });

  it("falls back to plain clamp when there is no ported marker", () => {
    const prompt = "RULES ".repeat(20_000);
    const healed = healOversizedStoredSystemPrompt(prompt, MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(healed.length).toBe(MAX_COMPOSED_SYSTEM_PROMPT_CHARS);
    expect(healed).toContain("older context trimmed");
  });
});
