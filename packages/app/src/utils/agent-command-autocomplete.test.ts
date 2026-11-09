import { describe, expect, it } from "vitest";

import {
  applySlashCommandReplacement,
  filterAndRankCommandAutocompleteEntries,
  filterInlineSkillCommandEntries,
  findActiveSlashCommand,
  findSkillHighlightRanges,
  skillCommandNames,
} from "./agent-command-autocomplete";

describe("filterAndRankCommandAutocompleteEntries", () => {
  const entries = [
    { source: "provider" as const, command: { name: "paseo-committee" } },
    { source: "provider" as const, command: { name: "commit" } },
    { source: "provider" as const, command: { name: "paseo-advisor" } },
  ];

  it("ranks command-name prefixes above later word-boundary partial matches", () => {
    const result = filterAndRankCommandAutocompleteEntries(entries, "comm");

    expect(result.map((entry) => entry.command.name)).toEqual(["commit", "paseo-committee"]);
  });

  it("matches client command aliases", () => {
    const result = filterAndRankCommandAutocompleteEntries(
      [
        { source: "client" as const, command: { name: "exit", aliases: ["quit", "q"] } },
        { source: "client" as const, command: { name: "clear", aliases: ["new"] } },
      ],
      "q",
    );

    expect(result.map((entry) => entry.command.name)).toEqual(["exit"]);
  });
});

describe("findActiveSlashCommand", () => {
  it("detects a slash command token in the middle of the prompt", () => {
    const text = "use /tas before implementation";

    expect(
      findActiveSlashCommand({
        text,
        cursorIndex: "use /tas".length,
      }),
    ).toEqual({
      start: 4,
      end: "use /tas".length,
      query: "tas",
      position: "inline",
    });
  });

  it("classifies a slash command token at the prompt start", () => {
    expect(
      findActiveSlashCommand({
        text: "/rew",
        cursorIndex: "/rew".length,
      }),
    ).toEqual({
      start: 0,
      end: "/rew".length,
      query: "rew",
      position: "start",
    });
  });

  it("returns null when the cursor is outside the slash token", () => {
    expect(
      findActiveSlashCommand({
        text: "use /taste now",
        cursorIndex: "use /taste now".length,
      }),
    ).toBeNull();
  });

  it("returns null for slash-delimited paths", () => {
    expect(
      findActiveSlashCommand({
        text: "read /tmp/project",
        cursorIndex: "read /tmp/project".length,
      }),
    ).toBeNull();
  });

  it("opens after opening punctuation and quotes", () => {
    for (const prefix of ["(", '"', ",", ":"]) {
      const text = `use ${prefix}/tas`;
      expect(findActiveSlashCommand({ text, cursorIndex: text.length })).toEqual({
        start: text.indexOf("/"),
        end: text.length,
        query: "tas",
        position: "inline",
      });
    }
  });
});

describe("applySlashCommandReplacement", () => {
  it("replaces only the active slash token and keeps the caret after the name", () => {
    const text = "use /tas before implementation";

    expect(
      applySlashCommandReplacement({
        text,
        command: { start: 4, end: "use /tas".length, query: "tas", position: "inline" },
        commandName: "taste",
      }),
    ).toEqual({
      text: "use /taste before implementation",
      selection: { start: "use /taste".length, end: "use /taste".length },
    });
  });

  it("commits an inline slash token at the prompt tail with the caret after the space", () => {
    const text = "use /tas";

    expect(
      applySlashCommandReplacement({
        text,
        command: { start: 4, end: text.length, query: "tas", position: "inline" },
        commandName: "taste",
      }),
    ).toEqual({
      text: "use /taste ",
      selection: { start: "use /taste ".length, end: "use /taste ".length },
    });
  });

  it("commits a start slash token at the prompt tail", () => {
    const text = "/tas";

    expect(
      applySlashCommandReplacement({
        text,
        command: { start: 0, end: text.length, query: "tas", position: "start" },
        commandName: "taste",
      }),
    ).toEqual({
      text: "/taste ",
      selection: { start: "/taste ".length, end: "/taste ".length },
    });
  });
});

describe("findSkillHighlightRanges", () => {
  const skills = ["create-skill", "deploy"];

  it("colors a skill token and leaves the surrounding sentence plain", () => {
    const text =
      "/create-skill para permitir que\nEssa skill não pode ser listada\n\nPrecisa ser tipo /deploy";

    expect(findSkillHighlightRanges(text, skills)).toEqual([
      { start: 0, end: "/create-skill".length },
      { start: text.lastIndexOf("/deploy"), end: text.length },
    ]);
  });

  it("ignores a skill that is not installed and a token still being typed", () => {
    expect(findSkillHighlightRanges("use /missing and /dep", skills)).toEqual([]);
  });

  it("ignores a slash inside a path", () => {
    expect(findSkillHighlightRanges("read /tmp/deploy now", skills)).toEqual([]);
  });

  it("matches the typed letters without caring about case", () => {
    const text = "run /Deploy";
    expect(findSkillHighlightRanges(text, skills)).toEqual([
      { start: text.indexOf("/Deploy"), end: text.length },
    ]);
  });

  it("colors a skill right after opening punctuation or a comma", () => {
    for (const prefix of ["(", '"', ","]) {
      const text = `use ${prefix}/deploy now`;
      expect(findSkillHighlightRanges(text, skills)).toEqual([
        { start: text.indexOf("/deploy"), end: text.indexOf("/deploy") + "/deploy".length },
      ]);
    }
  });
});

describe("skillCommandNames", () => {
  it("keeps installed skills and drops executable commands", () => {
    expect(
      skillCommandNames([
        { name: "clear", kind: "command" },
        { name: "/deploy", kind: "skill" },
        { name: "   ", kind: "skill" },
        { name: "create-skill", kind: "skill" },
      ]),
    ).toEqual(["deploy", "create-skill"]);
  });
});

describe("filterInlineSkillCommandEntries", () => {
  it("keeps provider skills, the daemon-level /goal, and drops executable commands", () => {
    const entries = [
      { source: "client" as const, command: { name: "clear", kind: "command" } },
      { source: "provider" as const, command: { name: "compact", kind: "command" } },
      { source: "provider" as const, command: { name: "taste", kind: "skill" } },
      { source: "provider" as const, command: { name: "goal", kind: "command" } },
    ];

    expect(filterInlineSkillCommandEntries(entries).map((entry) => entry.command.name)).toEqual([
      "taste",
      "goal",
    ]);
  });
});
