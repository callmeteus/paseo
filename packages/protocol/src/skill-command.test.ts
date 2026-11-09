import { describe, expect, test } from "vitest";

import {
  findInlineSkillCommandToken,
  findSkillCommandTokens,
  isSlashCommandBoundary,
} from "./skill-command.js";

const SKILLS = ["deploy", "create-skill", "taste"];

describe("isSlashCommandBoundary", () => {
  test("accepts the start of the text and whitespace", () => {
    expect(isSlashCommandBoundary(undefined)).toBe(true);
    expect(isSlashCommandBoundary("")).toBe(true);
    expect(isSlashCommandBoundary(" ")).toBe(true);
    expect(isSlashCommandBoundary("\n")).toBe(true);
  });

  test("accepts opening punctuation and quotes", () => {
    for (const character of ["(", "[", "{", "<", '"', "'", "!", "?", ",", ";", ":"]) {
      expect(isSlashCommandBoundary(character)).toBe(true);
    }
  });

  test("rejects word characters and path characters", () => {
    for (const character of ["a", "Z", "0", "_", "-", ".", "~", "/", "\\"]) {
      expect(isSlashCommandBoundary(character)).toBe(false);
    }
  });
});

describe("findSkillCommandTokens", () => {
  test("finds a skill at the start and after whitespace", () => {
    const text = "/deploy now, then /taste";
    expect(findSkillCommandTokens(text, SKILLS)).toEqual([
      { start: 0, end: "/deploy".length, name: "deploy", raw: "/deploy" },
      {
        start: text.lastIndexOf("/taste"),
        end: text.length,
        name: "taste",
        raw: "/taste",
      },
    ]);
  });

  test("finds a skill after opening punctuation", () => {
    const text = 'use (/deploy), "then" /taste';
    expect(findSkillCommandTokens(text, SKILLS).map((token) => token.name)).toEqual([
      "deploy",
      "taste",
    ]);
  });

  test("trims trailing punctuation before comparing", () => {
    const text = "run /deploy.";
    expect(findSkillCommandTokens(text, SKILLS)).toEqual([
      { start: 4, end: 4 + "/deploy".length, name: "deploy", raw: "/deploy" },
    ]);
  });

  test("matches without caring about case and preserves the typed casing in raw", () => {
    const text = "run /DePloy";
    expect(findSkillCommandTokens(text, SKILLS)).toEqual([
      { start: 4, end: text.length, name: "DePloy", raw: "/DePloy" },
    ]);
  });

  test("ignores a token that is not installed", () => {
    expect(findSkillCommandTokens("run /missing", SKILLS)).toEqual([]);
  });

  test("ignores prose and path slashes", () => {
    expect(findSkillCommandTokens("and/or ./taste", SKILLS)).toEqual([]);
    expect(findSkillCommandTokens("read /tmp/deploy now", SKILLS)).toEqual([]);
    expect(findSkillCommandTokens("see https://example.com/deploy", SKILLS)).toEqual([]);
  });

  test("ignores a name that continues into another path segment", () => {
    expect(findSkillCommandTokens("/deploy/sub", SKILLS)).toEqual([]);
  });

  test("returns nothing without installed skills", () => {
    expect(findSkillCommandTokens("/deploy", [])).toEqual([]);
  });
});

describe("findInlineSkillCommandToken", () => {
  test("returns the first skill that is not at the start", () => {
    const text = "/deploy then /taste";
    expect(findInlineSkillCommandToken(text, SKILLS)).toEqual({
      start: text.indexOf("/taste"),
      end: text.length,
      name: "taste",
      raw: "/taste",
    });
  });

  test("returns null when the skill is already at the start", () => {
    expect(findInlineSkillCommandToken("/deploy now", SKILLS)).toBeNull();
  });
});
