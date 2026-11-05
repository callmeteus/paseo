/**
 * A short, plain sentence from the agent folds into the surrounding work the way Cursor
 * does it: narration like "Let me check the config" belongs with the tool calls it
 * introduces, while anything long or structured stays a full message.
 *
 * The thresholds match Cursor's `Tff` guard. Raise them and the chat starts swallowing
 * real replies; lower them and almost nothing folds.
 */
const MAX_CHARS = 100;
const MAX_LINES = 2;
const STRUCTURED_CONTENT_PATTERN = /```|^#{1,6}\s|^\s*[-*]\s|\|.*\|/m;

export function isFoldableText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > MAX_CHARS) {
    return false;
  }
  if (trimmed.split("\n").length > MAX_LINES) {
    return false;
  }
  return !STRUCTURED_CONTENT_PATTERN.test(trimmed);
}
