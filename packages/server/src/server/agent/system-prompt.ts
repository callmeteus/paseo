/** Providers reject oversized instruction payloads (OpenCode answers 413). */
export const MAX_COMPOSED_SYSTEM_PROMPT_CHARS = 48_000;

/**
 * Prefix of the block Paseo appends when porting or importing a chat into another provider.
 * Kept in one place so load-time healing and port logic stay aligned.
 */
export const PORTED_CONTEXT_MARKER = "The following conversation was ported from";

const TRIM_MARKER = "\n\n[... older context trimmed ...]\n\n";
/** Keeps the instructions at the top and the most recent context at the bottom. */
const HEAD_SHARE = 0.35;

export function clampSystemPrompt(prompt: string, max = MAX_COMPOSED_SYSTEM_PROMPT_CHARS): string {
  if (prompt.length <= max) return prompt;
  const head = Math.floor((max - TRIM_MARKER.length) * HEAD_SHARE);
  const tail = max - TRIM_MARKER.length - head;
  return `${prompt.slice(0, head)}${TRIM_MARKER}${prompt.slice(prompt.length - tail)}`;
}

/**
 * Clamp `base` to fit under `max` while keeping `suffix` intact (joined with a blank line).
 * Use when the suffix must survive trimming — for example the ported transcript block
 * appended after a provider’s long default system prompt; unscoped `clampSystemPrompt`
 * on the full string can remove both ends and drop the suffix entirely.
 */
export function preserveSuffixSystemPrompt(
  base: string,
  suffix: string,
  max = MAX_COMPOSED_SYSTEM_PROMPT_CHARS,
): string {
  const trimmedBase = base.trim();
  const trimmedSuffix = suffix.trim();
  if (!trimmedSuffix) {
    return trimmedBase.length > 0 ? clampSystemPrompt(trimmedBase, max) : "";
  }
  if (!trimmedBase) {
    return clampSystemPrompt(trimmedSuffix, max);
  }
  const joinGap = 2;
  const combinedLength = trimmedBase.length + joinGap + trimmedSuffix.length;
  if (combinedLength <= max) {
    return `${trimmedBase}\n\n${trimmedSuffix}`;
  }
  const baseMax = max - joinGap - trimmedSuffix.length;
  if (baseMax <= 0) {
    return clampSystemPrompt(trimmedSuffix, max);
  }
  return `${clampSystemPrompt(trimmedBase, baseMax)}\n\n${trimmedSuffix}`;
}

/**
 * When a stored system prompt exceeds the wire cap, trim without dropping an appended
 * ported-transcript block (identified by {@link PORTED_CONTEXT_MARKER}).
 */
export function healOversizedStoredSystemPrompt(
  prompt: string,
  max = MAX_COMPOSED_SYSTEM_PROMPT_CHARS,
): string {
  if (prompt.length <= max) {
    return prompt;
  }
  const markerIndex = prompt.lastIndexOf(PORTED_CONTEXT_MARKER);
  if (markerIndex < 0) {
    return clampSystemPrompt(prompt, max);
  }
  const base = prompt.slice(0, markerIndex).trimEnd();
  const portedBlock = prompt.slice(markerIndex).trim();
  return preserveSuffixSystemPrompt(base, portedBlock, max);
}

export function composeSystemPromptParts(
  ...parts: Array<string | null | undefined>
): string | undefined {
  const prompt = parts
    .map((part) => part?.trim())
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");

  return prompt.length > 0 ? clampSystemPrompt(prompt) : undefined;
}
