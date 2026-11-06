import type { TFunction } from "i18next";

/**
 * Cursor renders a reasoning block as `Thought 2s`, or as the block's own title when
 * the model opens with a bold line or a heading. Both helpers feed the same badge, so
 * they live together.
 */

const BOLD_TITLE_PATTERN = /^\*\*(.+?)\*\*$/;
const HEADING_TITLE_PATTERN = /^#{1,6}\s+(.+)$/;

export interface ThoughtHeader {
  /** Title text without the markdown decoration, empty when the block has no title line. */
  title: string;
  /** True when anything other than title lines follows. */
  hasBody: boolean;
  headerCount: number;
}

function readTitleLine(line: string): string | null {
  const bold = BOLD_TITLE_PATTERN.exec(line);
  if (bold) {
    return bold[1]?.trim() ?? null;
  }
  const heading = HEADING_TITLE_PATTERN.exec(line);
  return heading ? (heading[1]?.trim() ?? null) : null;
}

/** Splits a reasoning block into its optional title and its body. */
export function parseThoughtHeader(text: string): ThoughtHeader {
  const trimmed = text.trim();
  if (!trimmed) {
    return { title: "", hasBody: false, headerCount: 0 };
  }

  let title = "";
  let hasBody = false;
  let headerCount = 0;
  for (const line of trimmed.split("\n")) {
    const candidate = line.trim();
    if (!candidate) {
      continue;
    }
    const titleLine = readTitleLine(candidate);
    if (titleLine !== null) {
      title = titleLine;
      headerCount += 1;
    } else {
      hasBody = true;
    }
  }

  return { title, hasBody, headerCount };
}

/** Drops the leading title line so the body does not repeat the badge label. */
export function stripThoughtHeader(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && !(lines[start] ?? "").trim()) {
    start += 1;
  }
  if (start >= lines.length) {
    return text;
  }
  return readTitleLine((lines[start] ?? "").trim()) !== null
    ? lines
        .slice(start + 1)
        .join("\n")
        .trimStart()
    : text;
}

/**
 * Collapses a duration the way the badge shows it. Under half a second there is no
 * whole second to show, so the label comes from `toolCallGroup.briefly` in the active
 * language. Otherwise it is whole seconds, or one decimal when the rounded second
 * would be zero.
 */
export function formatThoughtDuration(
  durationMs: number | undefined,
  t: TFunction,
): string | undefined {
  if (durationMs === undefined || durationMs <= 0) {
    return undefined;
  }
  if (durationMs < 500) {
    return t("toolCallGroup.briefly");
  }
  const seconds = Math.round(durationMs / 1000);
  return seconds > 0 ? `${seconds}s` : `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * A finished block carries its own duration; a streaming one is measured from its
 * first chunk, because `timestamp` moves with every chunk.
 */
export function resolveThoughtDuration(thought: {
  timestamp: Date;
  startedAt?: Date;
  thinkingDurationMs?: number;
}): number | undefined {
  if (thought.thinkingDurationMs !== undefined) {
    return thought.thinkingDurationMs;
  }
  if (!thought.startedAt) {
    return undefined;
  }
  const elapsed = thought.timestamp.getTime() - thought.startedAt.getTime();
  return elapsed > 0 ? elapsed : undefined;
}
