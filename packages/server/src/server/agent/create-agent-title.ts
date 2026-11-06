import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import type { FirstAgentContext } from "@getpaseo/protocol/messages";

const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);

/**
 * Provisional title from a prompt that has no stored name.
 * Uses the first non-empty line, collapses spaces, and cuts at 60 characters.
 */
export function deriveInitialAgentTitle(prompt: string): string | null {
  const firstContentLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) {
    return null;
  }
  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const clamped = normalized.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
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
 * opening prompt, or it is still the previous title this flow wrote.
 */
function followsGeneratedChatTitle(
  current: string | null,
  promptTitle: string | null,
  previousTitle: string | null,
): boolean {
  if (!current) {
    return true;
  }
  if (promptTitle !== null && current === promptTitle) {
    return true;
  }
  return previousTitle !== null && current === previousTitle;
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
      if (!followsGeneratedChatTitle(agent.title, promptTitle, previousTitle)) {
        return agent;
      }
      const next = nextWorkspace ?? generated;
      return { id: agent.id, title: next };
    }),
  };
}
