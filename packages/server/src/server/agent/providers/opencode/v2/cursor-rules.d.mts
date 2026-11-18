export const CURSOR_RULES_START: string;
export const CURSOR_RULES_END: string;

export function collectVisitedPaths(messages: unknown[]): string[];

export function applyCursorRules(messages: unknown[], sessionDirectory: string, now?: number): void;

export function cursorRulesAddition(
  sessionDirectory: string,
  visitedPaths?: readonly string[],
  deliveredPaths?: Iterable<string>,
  now?: number,
): { block: string | null; paths: string[] };
