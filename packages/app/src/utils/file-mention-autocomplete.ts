import { collapsedSelection, type TextReplacement } from "./text-replacement";

export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
  /**
   * Word cap for the query. Compact layouts use it so the picker stops covering the
   * conversation after a few words instead of waiting for Escape.
   */
  maxWords?: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

// Spaces are legal inside the query: chat search is often multi-word ("@add chat
// search"), so the picker stays open until Escape instead of closing on the first
// space. Line breaks, quotes and angle brackets still end the token, which is what
// closes it after a quoted path is inserted.
const INVALID_MENTION_QUERY_CHARS = /[\n\r\t"'<>]/;

// A mention trigger only counts at a word boundary. An `@` inside a link (a social
// handle like https://x.com/@user, for example) is plain text: opening the picker
// while someone types or pastes a URL is wrong.
function isAtPartOfUrl(text: string, atIndex: number): boolean {
  let tokenStart = atIndex;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1]!)) {
    tokenStart -= 1;
  }
  const prefix = text.slice(tokenStart, atIndex);
  // Explicit scheme: https://..., git+ssh://..., etc.
  if (prefix.includes("://")) return true;
  // Scheme-less host with a path: www.x.com/@user, x.com/@user.
  return /(?:^|\/)(?:[\w-]+\.)+[a-z]{2,}\//i.test(prefix);
}

function countWords(query: string): number {
  const trimmed = query.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let atIndex = beforeCursor.lastIndexOf("@");
    atIndex >= 0;
    atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)
  ) {
    // Skip @ that looks like part of an email address (local-part char immediately before @).
    if (atIndex > 0 && /[\w+]/.test(beforeCursor[atIndex - 1]!)) {
      continue;
    }
    // Skip @ inside a URL so a pasted link does not open the picker.
    if (isAtPartOfUrl(beforeCursor, atIndex)) {
      continue;
    }

    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) {
      continue;
    }
    if (input.maxWords !== undefined && countWords(query) > input.maxWords) {
      continue;
    }
    return {
      start: atIndex,
      end: clampedCursor,
      query,
    };
  }

  return null;
}

export function formatQuotedFileMentionPath(relativePath: string): string {
  const safePath = relativePath.replace(/"/g, '\\"');
  return `"${safePath}"`;
}

export function applyFileMentionReplacement(
  input: ApplyFileMentionReplacementInput,
): TextReplacement {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  const inserted = formatQuotedFileMentionPath(input.relativePath);
  return {
    text: `${before}${inserted}${after}`,
    selection: collapsedSelection(input.mention.start + inserted.length),
  };
}
