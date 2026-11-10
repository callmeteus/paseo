import { findSkillCommandTokens, isSlashCommandBoundary } from "@getpaseo/protocol/skill-command";
import {
  compareMatchScores,
  type MatchScore,
  scoreTextFields,
} from "@getpaseo/protocol/search/text-match";
import { collapsedSelection, type TextReplacement } from "./text-replacement";

interface CommandAutocompleteEntry {
  command: {
    name: string;
    aliases?: readonly string[];
    kind?: string;
  };
}

interface InlineSkillCommandEntry extends CommandAutocompleteEntry {
  source: "provider" | "client";
}

export type SlashCommandPosition = "start" | "inline";

export interface SlashCommandRange {
  start: number;
  end: number;
  query: string;
  position: SlashCommandPosition;
}

interface FindActiveSlashCommandInput {
  text: string;
  cursorIndex: number;
}

interface ApplySlashCommandReplacementInput {
  text: string;
  command: SlashCommandRange;
  commandName: string;
}

interface ScoredCommandAutocompleteEntry<TEntry> {
  entry: TEntry;
  score: MatchScore;
}

function scoreCommandAutocompleteEntry(
  entry: CommandAutocompleteEntry,
  query: string,
): MatchScore | null {
  return scoreTextFields(query, [entry.command.name, ...(entry.command.aliases ?? [])]);
}

export function filterAndRankCommandAutocompleteEntries<TEntry extends CommandAutocompleteEntry>(
  entries: readonly TEntry[],
  query: string,
): TEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [...entries];
  }

  const scoredEntries: ScoredCommandAutocompleteEntry<TEntry>[] = [];
  for (const entry of entries) {
    const score = scoreCommandAutocompleteEntry(entry, normalizedQuery);
    if (score) {
      scoredEntries.push({ entry, score });
    }
  }

  scoredEntries.sort((a, b) => {
    const scoreComparison = compareMatchScores(a.score, b.score);
    if (scoreComparison !== 0) {
      return scoreComparison;
    }
    return a.entry.command.name.localeCompare(b.entry.command.name);
  });

  return scoredEntries.map((scored) => scored.entry);
}

/**
 * Daemon-level commands that also work mid-sentence, so the inline picker offers
 * them next to skills. `/goal` already accepts any position; everything else is
 * a provider command that must stay at the start of the prompt.
 */
export const INLINE_DAEMON_COMMAND_NAMES = ["goal"] as const;
const INLINE_DAEMON_COMMAND_NAME_SET = new Set<string>(INLINE_DAEMON_COMMAND_NAMES);

export function filterInlineSkillCommandEntries<TEntry extends InlineSkillCommandEntry>(
  entries: readonly TEntry[],
): TEntry[] {
  return entries.filter((entry) => {
    if (entry.source !== "provider") return false;
    if (entry.command.kind === "skill") return true;
    return INLINE_DAEMON_COMMAND_NAME_SET.has(
      entry.command.name.trim().replace(/^\//, "").toLowerCase(),
    );
  });
}

/**
 * Names the composer paints like a skill: installed skills plus daemon commands
 * that are legal mid-sentence (`/goal`). Kept separate from `skillCommandNames`
 * because the daemon only hoists real skills.
 */
export function highlightedCommandNames(
  commands: readonly { name: string; kind?: string }[],
): string[] {
  const names = skillCommandNames(commands);
  const inlineDaemonNames = new Set<string>(INLINE_DAEMON_COMMAND_NAMES);
  const seen = new Set(names.map((name) => name.toLowerCase()));
  for (const command of commands) {
    const name = command.name.trim().replace(/^\//, "");
    const normalized = name.toLowerCase();
    if (!inlineDaemonNames.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(name);
  }
  return names;
}

export function skillCommandNames(commands: readonly { name: string; kind?: string }[]): string[] {
  const names: string[] = [];
  for (const command of commands) {
    if (command.kind !== "skill") continue;
    const name = command.name.trim().replace(/^\//, "");
    if (name.length === 0) continue;
    names.push(name);
  }
  return names;
}

export interface SkillHighlightRange {
  start: number;
  end: number;
}

/** `/name` tokens whose name is an installed skill. A prefix still being typed is left plain. */
export function findSkillHighlightRanges(
  text: string,
  skillNames: readonly string[],
): SkillHighlightRange[] {
  return findSkillCommandTokens(text, skillNames).map((token) => ({
    start: token.start,
    end: token.end,
  }));
}

const INVALID_SLASH_COMMAND_QUERY_CHARS = /[/\s\n\r\t"']/;

export function findActiveSlashCommand(
  input: FindActiveSlashCommandInput,
): SlashCommandRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let slashIndex = beforeCursor.lastIndexOf("/");
    slashIndex >= 0;
    slashIndex = slashIndex === 0 ? -1 : beforeCursor.lastIndexOf("/", slashIndex - 1)
  ) {
    const previousCharacter = slashIndex > 0 ? input.text[slashIndex - 1] : "";
    if (!isSlashCommandBoundary(previousCharacter)) {
      continue;
    }

    const query = beforeCursor.slice(slashIndex + 1);
    if (INVALID_SLASH_COMMAND_QUERY_CHARS.test(query)) {
      continue;
    }

    return {
      start: slashIndex,
      end: clampedCursor,
      query,
      position: slashIndex === 0 ? "start" : "inline",
    };
  }

  return null;
}

export function applySlashCommandReplacement(
  input: ApplySlashCommandReplacementInput,
): TextReplacement {
  const before = input.text.slice(0, input.command.start);
  const after = input.text.slice(input.command.end);
  const inserted = `/${input.commandName}`;
  const appendSpace = input.command.end === input.text.length;
  const text = `${before}${inserted}${after}${appendSpace ? " " : ""}`;
  // The caret lands right after the name the user picked, not at the end of the
  // sentence, so a mid-sentence insertion keeps the rest of the draft editable.
  return {
    text,
    selection: collapsedSelection(input.command.start + inserted.length + (appendSpace ? 1 : 0)),
  };
}
