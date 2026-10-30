import type { AgentPromptInput } from "../agent-sdk-types.js";

/**
 * Puts a Paseo note in front of the text an ACP provider receives.
 * The chat bubble keeps the original prompt.
 *
 * @param prompt - User prompt for this turn
 * @param prefix - Note the provider must see
 * @returns The prompt with the note first, or the original when the note is empty
 */
export function prependAcpPromptText(prompt: AgentPromptInput, prefix: string): AgentPromptInput {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return prompt;
  }

  if (typeof prompt === "string") {
    return `${trimmed}\n\n${prompt}`;
  }

  return [{ type: "text", text: trimmed }, ...prompt];
}
