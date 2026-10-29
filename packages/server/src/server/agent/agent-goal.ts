import type { AgentPromptInput, AgentSlashCommand } from "./agent-sdk-types.js";

/**
 * A persistent goal attached to an agent.
 *
 * Goals live in the daemon instead of a provider session so `/goal` behaves the
 * same on every harness. The objective is re-sent with each turn as a context
 * preamble, because most providers have no runtime slot for extra instructions
 * (ACP ignores system prompts entirely).
 */
export interface AgentGoal {
  objective: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export const GOAL_COMMAND_NAME = "goal";

export const GOAL_SLASH_COMMAND: AgentSlashCommand = {
  name: GOAL_COMMAND_NAME,
  description: "Set, pause, resume, or clear this agent's goal",
  argumentHint: "[<objective>|pause|resume|clear]",
  kind: "command",
};

export type GoalCommand =
  | { kind: "status" }
  | { kind: "set"; objective: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" };

const GOAL_PROMPT_PREFIX = "<paseo-goal>";
const GOAL_PROMPT_SUFFIX = "</paseo-goal>";

/**
 * Marker the model is asked to append to its final message when the goal is
 * fully achieved. The daemon uses it to stop auto-continuation.
 */
export const GOAL_COMPLETE_MARKER = "<paseo-goal-complete>";

/**
 * Parse `/goal ...`. Returns null when the text is not a goal command, so the
 * caller can forward it to the provider untouched.
 */
export function parseGoalCommand(text: string): GoalCommand | null {
  const trimmed = text.trim();
  if (!/^\/goal(?:\s|$)/i.test(trimmed)) return null;
  const args = trimmed.slice(GOAL_COMMAND_NAME.length + 1).trim();
  if (!args) return { kind: "status" };
  switch (args.toLowerCase()) {
    case "pause":
      return { kind: "pause" };
    case "resume":
      return { kind: "resume" };
    case "clear":
    case "stop":
    case "off":
      return { kind: "clear" };
    default:
      return { kind: "set", objective: args };
  }
}

export function isGoalPromptText(text: string): boolean {
  return text.trimStart().startsWith(GOAL_PROMPT_PREFIX);
}

export function formatGoalStatus(goal: AgentGoal | undefined): string {
  if (!goal) {
    return "No goal set. Usage: /goal <objective> | /goal pause | /goal resume | /goal clear";
  }
  return `Goal (${goal.status}): ${goal.objective}`;
}

export function formatGoalSet(goal: AgentGoal): string {
  return `Goal set: ${goal.objective}`;
}

export function formatGoalPaused(goal: AgentGoal): string {
  return `Goal paused: ${goal.objective}`;
}

export function formatGoalResumed(goal: AgentGoal): string {
  return `Goal resumed: ${goal.objective}`;
}

export function formatGoalCleared(): string {
  return "Goal cleared.";
}

function buildGoalPreamble(goal: AgentGoal, instruction: string): string {
  return [
    GOAL_PROMPT_PREFIX,
    "The user set a persistent goal for this session. It stays in effect across turns until it is achieved or cleared.",
    "",
    `Goal: ${goal.objective}`,
    "",
    instruction,
    "Report what remains when you stop.",
    "Saying the work is done or finished does NOT end the goal — only the marker below does.",
    `When every requirement of the goal is actually met, end your final message with this marker on its own line: ${GOAL_COMPLETE_MARKER}`,
    GOAL_PROMPT_SUFFIX,
  ].join("\n");
}

/** First turn after `/goal <objective>`: the user expects work to start now. */
export function buildGoalStartPrompt(goal: AgentGoal): string {
  return buildGoalPreamble(goal, "Start working toward this goal now.");
}

/** Any later turn while the goal is active. */
export function buildGoalContinuationPrompt(goal: AgentGoal, userText: string): string {
  const preamble = buildGoalPreamble(
    goal,
    "Keep working toward this goal. The user's message follows.",
  );
  return `${preamble}\n\n${userText}`;
}

/**
 * Daemon-initiated turn fired when the agent stops while the goal is still
 * active. No user message is pending; the model either keeps working or
 * declares completion with the marker.
 */
export function buildGoalAutoContinuationPrompt(goal: AgentGoal): string {
  return buildGoalPreamble(
    goal,
    "No new user message is pending. Continue working toward this goal now.",
  );
}

export function isGoalCompleteText(text: string): boolean {
  return text.toLowerCase().includes(GOAL_COMPLETE_MARKER);
}

export function formatGoalComplete(goal: AgentGoal): string {
  return `Goal complete: ${goal.objective}`;
}

export function formatGoalContinuationLimit(max: number): string {
  return `Goal did not complete after ${max} continuation attempts. The goal watcher stopped; send another message, or /goal resume to restart it.`;
}

/**
 * Advertise `/goal` on every provider. A provider that already publishes a
 * command with the same name keeps its own entry: the daemon intercepts the
 * command before it reaches the provider anyway.
 */
export function withDaemonSlashCommands(
  commands: readonly AgentSlashCommand[],
): AgentSlashCommand[] {
  if (commands.some((command) => command.name === GOAL_COMMAND_NAME)) {
    return [...commands];
  }
  return [...commands, GOAL_SLASH_COMMAND].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

/**
 * Convert a `/goal` prompt into the text the provider should receive.
 * Control subcommands return null: they run out-of-band and never start a turn.
 */
export function planGoalPrompt(input: {
  prompt: AgentPromptInput;
  goal: AgentGoal | undefined;
  /** Set when the prompt was `/goal <objective>` and the goal was just created. */
  startedGoal: AgentGoal | null;
}): { prompt: AgentPromptInput; submittedPromptText: string } | null {
  const { prompt, goal, startedGoal } = input;
  if (typeof prompt !== "string") return null;
  if (startedGoal) {
    return { prompt: buildGoalStartPrompt(startedGoal), submittedPromptText: prompt };
  }
  if (!goal || goal.status !== "active") return null;
  // Slash commands belong to the provider (`/compact`, skills, ...) and must be
  // forwarded verbatim. The goal stays in effect for the next real message.
  if (prompt.trimStart().startsWith("/")) return null;
  if (isGoalPromptText(prompt)) return null;
  return {
    prompt: buildGoalContinuationPrompt(goal, prompt),
    submittedPromptText: prompt,
  };
}
