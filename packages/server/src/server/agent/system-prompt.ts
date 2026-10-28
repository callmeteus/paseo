/** Providers reject oversized instruction payloads (OpenCode answers 413). */
export const MAX_COMPOSED_SYSTEM_PROMPT_CHARS = 48_000;

const TRIM_MARKER = "\n\n[... older context trimmed ...]\n\n";
/** Keeps the instructions at the top and the most recent context at the bottom. */
const HEAD_SHARE = 0.35;

export function clampSystemPrompt(prompt: string, max = MAX_COMPOSED_SYSTEM_PROMPT_CHARS): string {
  if (prompt.length <= max) return prompt;
  const head = Math.floor((max - TRIM_MARKER.length) * HEAD_SHARE);
  const tail = max - TRIM_MARKER.length - head;
  return `${prompt.slice(0, head)}${TRIM_MARKER}${prompt.slice(prompt.length - tail)}`;
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
