/**
 * One tokenizer for `/skill` mentions, shared by the app (highlight + autocomplete)
 * and the daemon (hoisting a mid-sentence skill to the start of the prompt).
 *
 * The rules exist to keep prose and paths out of the way: `and/or`, `./taste`,
 * `/tmp/deploy` and `https://example.com/x` are not skills even when the name after
 * the slash happens to match an installed one.
 */
export interface SkillCommandToken {
  /** Index of the leading slash. */
  start: number;
  /** Exclusive end, right after the name. */
  end: number;
  /** Name without the slash and without trailing punctuation. */
  name: string;
  /** The token as typed, including the slash and the typed casing. */
  raw: string;
}

const ALLOWED_PRECEDING_CHARACTERS = new Set([
  "(",
  "[",
  "{",
  "<",
  '"',
  "'",
  "!",
  "?",
  ",",
  ";",
  ":",
]);

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** A slash starts a token at the start of the text, after whitespace, or after punctuation. */
export function isSlashCommandBoundary(previousCharacter: string | undefined): boolean {
  if (!previousCharacter) return true;
  if (/\s/.test(previousCharacter)) return true;
  return ALLOWED_PRECEDING_CHARACTERS.has(previousCharacter);
}

function normalizeSkillNames(skillNames: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const skillName of skillNames) {
    const normalized = skillName.trim().replace(/^\//, "").toLowerCase();
    if (normalized.length > 0) names.add(normalized);
  }
  return names;
}

function findRawNameEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const character = text[index]!;
    if (/\s/.test(character) || character === "/") return index;
  }
  return text.length;
}

function tokenize(text: string, skillNames: readonly string[]): SkillCommandToken[] {
  const names = normalizeSkillNames(skillNames);
  if (names.size === 0 || !text.includes("/")) return [];

  const tokens: SkillCommandToken[] = [];
  let slashIndex = text.indexOf("/");
  while (slashIndex !== -1) {
    const previousCharacter = slashIndex > 0 ? text[slashIndex - 1] : undefined;
    if (isSlashCommandBoundary(previousCharacter)) {
      const rawNameEnd = findRawNameEnd(text, slashIndex + 1);
      // `/tmp/deploy` reaches this branch with a slash right after `tmp`: the token
      // would be a path segment, so drop it and let the scan continue.
      if (text[rawNameEnd] !== "/") {
        const rawName = text.slice(slashIndex + 1, rawNameEnd);
        const trimmedName = rawName.replace(TRAILING_PUNCTUATION, "");
        if (trimmedName.length > 0 && names.has(trimmedName.toLowerCase())) {
          tokens.push({
            start: slashIndex,
            end: slashIndex + 1 + trimmedName.length,
            name: trimmedName,
            raw: `/${trimmedName}`,
          });
        }
      }
    }
    slashIndex = text.indexOf("/", slashIndex + 1);
  }
  return tokens;
}

/** Every `/name` token whose name is an installed skill. */
export function findSkillCommandTokens(
  text: string,
  skillNames: readonly string[],
): SkillCommandToken[] {
  return tokenize(text, skillNames);
}

/** The first installed-skill token that is not the first thing in the prompt. */
export function findInlineSkillCommandToken(
  text: string,
  skillNames: readonly string[],
): SkillCommandToken | null {
  return tokenize(text, skillNames).find((token) => token.start > 0) ?? null;
}
