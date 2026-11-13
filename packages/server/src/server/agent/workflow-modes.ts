/**
 * Daemon-level workflow modes.
 *
 * These are orthogonal to the provider permission modes (`AgentMode`): a
 * provider mode decides what the provider is allowed to do (plan, bypass, ...),
 * while a workflow mode decides what role the agent plays (read-only Ask,
 * Debug with a local log ingest endpoint, Multitask coordinator, ...).
 *
 * Each mode contributes a fragment appended to the provider's system prompt.
 * Debug mode also points the agent at the daemon's local log ingest endpoint.
 *
 * The mode id is persisted on `AgentSessionConfig.workflowModeId`. The prompt
 * fragment is never persisted; it is composed for every request at dispatch and
 * again at launch in `AgentManager.prepareSessionConfig`.
 */

import { decodeMultitaskTaskTarget } from "@getpaseo/protocol/multitask-task-target";
import {
  WORKFLOW_MODES as WORKFLOW_MODE_CATALOG,
  type WorkflowModeId,
} from "@getpaseo/protocol/workflow-modes";

export type { WorkflowModeId };

export interface WorkflowModeContext {
  agentId: string;
  cwd: string;
  debugEndpoint?: string;
  debugLogPath?: string;
  debugSessionId?: string;
  /**
   * Raw `paseo.multitask-task-target` label. Only the Multitask prompt reads it.
   * Absent means each task is a Paseo agent on this chat's CLI.
   */
  taskTargetLabel?: string | null;
}

export interface WorkflowMode {
  id: WorkflowModeId;
  icon: string;
  /** Accent color from the shared workflow-mode catalog. */
  color: string;
  /** When true the daemon denies edit/execution permission requests. */
  readOnly: boolean;
  /** When true the mode requires Paseo tools (create_agent, ...). */
  requiresPaseoTools: boolean;
  /** Compose the prompt fragment for this mode. */
  prompt: (ctx: WorkflowModeContext) => string;
}

const DEBUG_PROMPT = (ctx: WorkflowModeContext): string => `You are in Debug mode.

A local log ingest endpoint is available for the application under debug:
- endpoint: ${ctx.debugEndpoint ?? "(unavailable)"}
- log file: ${ctx.debugLogPath ?? "(unavailable)"}
- session id header: X-Debug-Session-Id: ${ctx.debugSessionId ?? "(unavailable)"}

Workflow:
1. Form several hypotheses about the root cause before touching code.
2. Instrument the code with temporary logging between markers:
   // #region paseo-debug
   ...logging...
   // #endregion paseo-debug
   The application must POST NDJSON lines to the endpoint above with the session id header.
3. Ask the user to reproduce the issue. Do not guess.
4. Read the log file with your file reading tool and analyze the evidence.
5. Apply the smallest fix that addresses the confirmed root cause.
6. Ask the user to reproduce again to verify, then remove every #region paseo-debug block.
7. Never leave instrumentation behind.`;

const MULTITASK_PROMPT = `You are in Multitask mode (coordinator).

You coordinate work; you do not edit code directly. Decompose the user's request
into independent sub-tasks and delegate each one with create_agent. Give each
worker a clean, self-contained prompt and a dedicated worktree (isolation:
"worktree") so they do not conflict. Wait for notifyOnFinish callbacks, then
integrate the results and report back. Limit nesting: a worker you create must
not create further workers.`;

/**
 * Multitask instructions plus the target stored on the chat.
 *
 * The text tells the model what the control chose. The daemon still applies
 * that choice when `create_agent` omits `taskAgent`.
 *
 * @param ctx - Workflow context, including the stored task-target label
 * @returns The prompt fragment for this turn
 */
function composeMultitaskPrompt(ctx: WorkflowModeContext): string {
  const target = decodeMultitaskTaskTarget(ctx.taskTargetLabel);
  let choice: string;
  if (target.kind === "paseo") {
    choice =
      "The Multitask control is set to a Paseo agent, so each task inherits this chat's CLI and model.";
  } else if (target.model) {
    choice = `The Multitask control is set to the ${target.provider} CLI, model ${target.model}.`;
  } else {
    choice = `The Multitask control is set to the ${target.provider} CLI and that CLI's default model.`;
  }
  return `${MULTITASK_PROMPT}

${choice} The daemon applies that choice when create_agent omits taskAgent. Do not pass provider to override the control. A single task overrides it with taskAgent set to {"kind":"paseo"} or {"kind":"cli","provider":"<id from list_providers>","model":"<id from list_models>"}. Do not invent a model id. If create_agent returns an error for one task, leave the other tasks running and report that error on the failed task.`;
}

const WORKFLOW_LABEL: Record<string, string> = {
  agent: "Agent",
  plan: "Plan",
  ask: "Ask",
  debug: "Debug",
  multitask: "Multitask",
};

/**
 * Told to the model when the user changes workflow. Agent mode has no standing
 * instructions, so without this the previous mode's block stays in the
 * transcript and the model keeps following it.
 */
export function workflowChangeNotice(
  previousId: string | null | undefined,
  nextId: string | null | undefined,
): string {
  const previous = previousId?.trim() || "agent";
  const next = nextId?.trim() || "agent";
  if (previous === next) return "";
  const previousLabel = WORKFLOW_LABEL[previous] ?? previous;
  const nextLabel = WORKFLOW_LABEL[next] ?? next;
  return `The active workflow is now ${nextLabel} mode. ${previousLabel} mode has ended. Follow only ${nextLabel} mode. Instructions from ${previousLabel} mode earlier in this conversation no longer apply, including any instruction to ignore a message that the previous mode ended.`;
}

const ASK_PROMPT = `You are in Ask mode.

You are a read-only assistant. You may read files, search, and explain. You must
NOT edit files, run commands, or make changes of any kind. If the user asks for
a change, describe what you would do and let them switch to Agent mode to apply
it.`;

const PLAN_PROMPT = `You are in Paseo Plan mode.

This workflow overrides any provider-specific plan mode instructions. Ignore
instructions to write plans in provider directories such as ~/.opencode/plan or
.cursor/plans, and ignore any "no longer in Plan mode" message from the provider.

You are a planning assistant. Investigate the codebase with read-only tools, then
produce a concrete implementation plan. Do NOT edit project files or code, run
mutating commands, or make changes of any kind outside the plan file. The only
write allowed is plan_create_update.

Write the plan as markdown with the plan_create_update tool. Use a workspace-relative
path under plans/ (for example plans/feature-name.md), pass a short title, and put
the full markdown in content. Call plan_create_update again whenever the plan
changes so the sidebar stays current.

The plan must include:
1. The goal and the relevant files.
2. Ordered implementation steps naming the functions or components to change.
3. Risks, edge cases, and anything that needs a decision from the user.
4. How to verify the change.

Stop after presenting the plan. When the user asks to build, execute, or implement
the plan, call plan_build with the plan path instead of asking them to switch modes.
plan_build switches you to Agent mode, queues the build, and marks the plan as
building in the sidebar; the build starts as soon as your turn ends, so end the turn
right after the call instead of implementing anything yourself.`;

const WORKFLOW_MODE_BEHAVIOR: Record<
  WorkflowModeId,
  Pick<WorkflowMode, "icon" | "readOnly" | "requiresPaseoTools" | "prompt">
> = {
  agent: {
    icon: "sparkles",
    readOnly: false,
    requiresPaseoTools: false,
    prompt: () => "",
  },
  plan: {
    icon: "todos",
    readOnly: true,
    requiresPaseoTools: false,
    prompt: () => PLAN_PROMPT,
  },
  ask: {
    icon: "message_circle",
    readOnly: true,
    requiresPaseoTools: false,
    prompt: () => ASK_PROMPT,
  },
  debug: {
    icon: "bug",
    readOnly: false,
    requiresPaseoTools: false,
    prompt: DEBUG_PROMPT,
  },
  multitask: {
    icon: "layers",
    readOnly: false,
    requiresPaseoTools: true,
    prompt: composeMultitaskPrompt,
  },
};

/** Daemon modes: the shared ids and colors, plus the prompt for each id. */
export const WORKFLOW_MODES: WorkflowMode[] = WORKFLOW_MODE_CATALOG.map((mode) => {
  const behavior = WORKFLOW_MODE_BEHAVIOR[mode.id];
  return {
    id: mode.id,
    color: mode.color,
    icon: behavior.icon,
    readOnly: behavior.readOnly,
    requiresPaseoTools: behavior.requiresPaseoTools,
    prompt: behavior.prompt,
  };
});

const BY_ID = new Map(WORKFLOW_MODES.map((m) => [m.id, m]));

/** The provider's normal writable mode, restored when a read-only workflow ends. */
const DEFAULT_WRITABLE_PROVIDER_MODE: Record<string, string> = {
  opencode: "build",
  claude: "default",
  codex: "auto",
  copilot: "https://agentclientprotocol.com/protocol/session-modes#agent",
  kilo: "code",
  cline: "act",
  cursor: "agent",
};

export function resolveDefaultWritableProviderMode(provider: string): string | null {
  return DEFAULT_WRITABLE_PROVIDER_MODE[provider] ?? null;
}

export function getWorkflowMode(id: string | null | undefined): WorkflowMode {
  if (id && BY_ID.has(id as WorkflowModeId)) {
    return BY_ID.get(id as WorkflowModeId)!;
  }
  return WORKFLOW_MODES[0];
}

export function isWorkflowModeId(value: unknown): value is WorkflowModeId {
  return typeof value === "string" && BY_ID.has(value as WorkflowModeId);
}

/**
 * Removes the daemon's workflow preamble from text a provider echoes back as a user message.
 *
 * The block is prepended to the provider-facing prompt, so providers that persist their input
 * verbatim replay it as part of the user's turn. Only the anchored prefix is stripped; a user
 * quoting the tag mid-message keeps their text.
 */
export function stripWorkflowInstruction(text: string): string {
  return text.replace(/^<paseo-workflow>\n[\s\S]*?\n<\/paseo-workflow>\n*/, "");
}

export function composeWorkflowPrompt(
  modeId: string | null | undefined,
  ctx: WorkflowModeContext,
): string {
  const mode = getWorkflowMode(modeId);
  const fragment = mode.prompt(ctx);
  return fragment.trim();
}
