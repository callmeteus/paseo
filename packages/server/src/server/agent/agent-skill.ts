import { findInlineSkillCommandToken } from "@getpaseo/protocol/skill-command";

export interface SkillTurnPlan {
  /** Provider-facing prompt, with the skill command moved to the front. */
  prompt: string;
  /** What the user actually typed; the timeline shows this instead of the rewrite. */
  submittedPromptText: string;
}

/**
 * Providers only parse a slash command as the first token, so a skill typed mid
 * sentence (`use /taste before merging`) has to become `/taste use before merging`.
 * The words are reordered, which is the only shape every provider understands.
 *
 * Returns null when there is nothing to hoist: the prompt already starts with a
 * slash command, no installed skill appears, or the only skill is already first.
 */
export function planSkillPrompt(input: {
  prompt: string;
  skillNames: readonly string[];
}): SkillTurnPlan | null {
  const { prompt, skillNames } = input;
  if (prompt.trimStart().startsWith("/")) return null;

  const token = findInlineSkillCommandToken(prompt, skillNames);
  if (!token) return null;

  const before = prompt.slice(0, token.start).trimEnd();
  const after = prompt.slice(token.end).trimStart();
  const rest = [before, after].filter((part) => part.length > 0).join(" ");
  const hoisted = rest.length > 0 ? `${token.raw} ${rest}` : token.raw;

  return { prompt: hoisted, submittedPromptText: prompt };
}
