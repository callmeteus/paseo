import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import { expandInlineChips } from "@getpaseo/protocol/inline-chip";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";
import { goalInstructionCorpus, parseGoalCommand } from "./agent-goal.js";
import { workflowInstructionCorpus } from "./workflow-modes.js";

const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);
const WORKFLOW_BLOCK = /<paseo-workflow>\n[\s\S]*?\n<\/paseo-workflow>\s*/g;
const GOAL_BLOCK = /<paseo-goal>\n([\s\S]*?)\n<\/paseo-goal>\s*/g;

let instructionCorpus: string | null = null;

function instructionText(): string {
  if (!instructionCorpus) {
    instructionCorpus = `${workflowInstructionCorpus()}\n${goalInstructionCorpus()}`
      .toLowerCase()
      .replace(/\s+/g, " ");
  }
  return instructionCorpus;
}

/**
 * True when a title is a slice of the Paseo plan/workflow instructions or the
 * goal-tracking boilerplate. The user's task, including a goal objective, is not.
 */
export function isInstructionDerivedTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 12) return false;
  return instructionText().includes(normalized);
}

function goalObjective(body: string): string | null {
  const line = body
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("Goal:"));
  const objective = line?.slice("Goal:".length).trim();
  return objective ? objective : null;
}

/**
 * The task a title should name. Workflow blocks and goal-tracking instructions
 * are removed. A goal objective stays, and so does the user's own text.
 */
export function promptTextForTitle(prompt: string): string {
  const objectives: string[] = [];
  // Chips are stored as serialized atoms in the submitted text. Decode them so
  // a leading paste chip names the chat from its body instead of its JSON.
  const decoded = expandInlineChips(prompt, "prompt");
  const withoutWorkflow = decoded.replace(WORKFLOW_BLOCK, "");
  const withoutGoal = withoutWorkflow.replace(GOAL_BLOCK, (_match, body: string) => {
    const objective = goalObjective(body);
    if (objective) objectives.push(objective);
    return "";
  });
  const command = parseGoalCommand(withoutGoal);
  const task = command?.kind === "set" ? command.objective : withoutGoal.trim();
  const objective = objectives.filter((entry) => entry.length > 0).join("\n");
  if (objective && task) return `${objective}\n\n${task}`;
  return objective || task;
}

/**
 * Provisional title from a prompt that has no stored name.
 * Uses the first non-empty line of the task, collapses spaces, and cuts at 60 characters.
 */
export function deriveInitialAgentTitle(prompt: string): string | null {
  const lines = promptTextForTitle(prompt)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (isInstructionDerivedTitle(line)) continue;
    const clamped = line.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
    if (clamped.length > 0 && !isInstructionDerivedTitle(clamped)) return clamped;
  }
  return null;
}

export function resolveCreateAgentTitles(options: {
  configTitle?: string | null;
  initialPrompt?: string | null;
}): { explicitTitle: string | null; provisionalTitle: string | null } {
  const explicitTitle =
    typeof options.configTitle === "string" && options.configTitle.trim().length > 0
      ? options.configTitle.trim()
      : null;
  const trimmedPrompt = options.initialPrompt?.trim();
  const provisionalTitle =
    explicitTitle ?? (trimmedPrompt ? deriveInitialAgentTitle(trimmedPrompt) : null);

  return {
    explicitTitle,
    provisionalTitle,
  };
}

export function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null {
  return (
    resolveCreateAgentTitles({
      initialPrompt: firstAgentContext?.prompt,
    }).provisionalTitle ?? null
  );
}

/** One workspace agent whose visible name follows the chat title. */
export interface ChatTitleTarget {
  id: string;
  title: string | null;
}

/** The workspace, its tab, and its agents after one chat title is applied. */
export interface AppliedChatTitle {
  workspaceTitle: string | null;
  /**
   * The name shown for the workspace tab. Always the same string as
   * `workspaceTitle`, so the tab and the sidebar cannot diverge.
   */
  tabTitle: string | null;
  agents: ChatTitleTarget[];
  /** True when the workspace name is the generated title. */
  wroteGeneratedTitle: boolean;
}

function normalizeChatTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A name still follows the chat title when it was never set, it is still the
 * opening prompt, it is still the previous title this flow wrote, or it is the
 * workspace title. The last case covers a second agent in an existing workspace:
 * `adoptWorkspaceTitleForAgent` stamps it with the workspace name, and after a
 * daemon restart the in-memory prompt/previous title maps no longer recognise
 * that stamp. Without it, the title the provider generates for this chat never
 * reaches the tab and it stays showing the workspace name forever.
 */
function followsGeneratedChatTitle(
  current: string | null,
  promptTitle: string | null,
  previousTitle: string | null,
  workspaceTitle?: string | null,
): boolean {
  if (!current) {
    return true;
  }
  if (promptTitle !== null && current === promptTitle) {
    return true;
  }
  if (previousTitle !== null && current === previousTitle) {
    return true;
  }
  return workspaceTitle !== null && current === workspaceTitle;
}

/**
 * Applies the title a model already produced for the chat.
 *
 * The workspace and its tab share that name. An agent whose name is empty,
 * still the opening prompt, or still the previous title this flow wrote takes
 * the same name, so OpenCode, Cloud, and the other providers leave the prompt
 * prefix when the title arrives. A later title replaces the previous shared
 * name. A name that was set to something else is left alone, and an agent that
 * still follows the chat title then adopts the workspace name so the tab
 * matches it. An empty generated title does not invent a name from the prompt:
 * the caller keeps the current titles, and the UI can show its existing fallback.
 */
export function applyGeneratedChatTitle(input: {
  generatedTitle: string | null;
  promptTitle: string | null;
  /** The last title this flow wrote for the workspace. */
  previousTitle?: string | null;
  workspaceTitle: string | null;
  agentTitles: readonly ChatTitleTarget[];
}): AppliedChatTitle {
  const generated = normalizeChatTitle(input.generatedTitle);
  const promptTitle = normalizeChatTitle(input.promptTitle);
  const previousTitle = normalizeChatTitle(input.previousTitle);
  const workspaceTitle = normalizeChatTitle(input.workspaceTitle);
  const agents = input.agentTitles.map((agent) => ({
    id: agent.id,
    title: normalizeChatTitle(agent.title),
  }));

  if (!generated) {
    return {
      workspaceTitle,
      tabTitle: workspaceTitle,
      agents,
      wroteGeneratedTitle: false,
    };
  }

  const nextWorkspace = followsGeneratedChatTitle(workspaceTitle, promptTitle, previousTitle)
    ? generated
    : workspaceTitle;

  return {
    workspaceTitle: nextWorkspace,
    tabTitle: nextWorkspace,
    wroteGeneratedTitle: nextWorkspace === generated,
    agents: agents.map((agent) => {
      if (!followsGeneratedChatTitle(agent.title, promptTitle, previousTitle, workspaceTitle)) {
        return agent;
      }
      // An agent still carrying the workspace title follows this chat's own
      // generated title, which can differ from the workspace's established name.
      // `adoptWorkspaceTitleForAgent` stamps the workspace name onto every agent
      // created after it, and after a daemon restart that stamp is the only
      // remaining link between the agent and the title the provider later emits.
      const next =
        workspaceTitle !== null && agent.title === workspaceTitle
          ? generated
          : (nextWorkspace ?? generated);
      return { id: agent.id, title: next };
    }),
  };
}
