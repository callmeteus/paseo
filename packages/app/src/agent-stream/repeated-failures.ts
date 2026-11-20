import { readProviderErrorText } from "./provider-error";

/** While an elicitation form is pending, hide the harness's failed-attempt narration. */
export function hidePendingQuestionRefusals<T extends { kind: string; text?: string }>(
  items: readonly T[],
  hasQuestion: boolean,
): T[] {
  if (!hasQuestion) return [...items];
  return items.filter(
    (item) =>
      item.kind !== "assistant_message" ||
      !/recusad|declined|refused|nã[oã] suporta elicitation/i.test(item.text ?? ""),
  );
}

interface FailedTextItem {
  kind: string;
  text?: string | null;
}

/**
 * A provider that fails a turn retries on its own, and each attempt prints the
 * same failure line where the reply should be. One card says it; eight copies
 * under it are noise. A repeated failure is dropped, and a user message clears
 * the run so a new turn reports its own failure again.
 */
export function collapseRepeatedFailures<T extends FailedTextItem>(items: readonly T[]): T[] {
  const kept: T[] = [];
  let lastFailure: string | null = null;
  for (const item of items) {
    if (item.kind === "user_message") {
      lastFailure = null;
      kept.push(item);
      continue;
    }
    if (item.kind !== "assistant_message") {
      kept.push(item);
      continue;
    }
    const failure = readProviderErrorText(item.text ?? "");
    if (failure === null) {
      lastFailure = null;
      kept.push(item);
      continue;
    }
    if (failure === lastFailure) continue;
    lastFailure = failure;
    kept.push(item);
  }
  return kept;
}
