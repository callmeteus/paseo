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
 * `readOnly` and `requiresPaseoTools` describe the mode to clients. The daemon
 * currently enforces Ask through the prompt fragment only; provider-level
 * permission gating still follows the provider mode.
 *
 * The mode id is persisted on `AgentSessionConfig.workflowModeId`. The prompt
 * fragment is never persisted; it is recomposed on every launch in
 * `AgentManager.prepareSessionConfig`.
 */

export type WorkflowModeId = "agent" | "ask" | "debug" | "multitask";

export interface WorkflowModeContext {
  agentId: string;
  cwd: string;
  debugEndpoint?: string;
  debugLogPath?: string;
  debugSessionId?: string;
}

export interface WorkflowMode {
  id: WorkflowModeId;
  label: string;
  description: string;
  icon: string;
  /** Accent color (hex) used in the UI, matching Cursor's mode palette. */
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

const ASK_PROMPT = `You are in Ask mode.

You are a read-only assistant. You may read files, search, and explain. You must
NOT edit files, run commands, or make changes of any kind. If the user asks for
a change, describe what you would do and let them switch to Agent mode to apply
it.`;

export const WORKFLOW_MODES: WorkflowMode[] = [
  {
    id: "agent",
    label: "Agent",
    description: "Default coding agent with full tool access.",
    icon: "sparkles",
    color: "#3b82f6",
    readOnly: false,
    requiresPaseoTools: false,
    prompt: () => "",
  },
  {
    id: "ask",
    label: "Ask",
    description: "Read-only: explain and investigate without making changes.",
    icon: "message_circle",
    color: "#8b5cf6",
    readOnly: true,
    requiresPaseoTools: false,
    prompt: () => ASK_PROMPT,
  },
  {
    id: "debug",
    label: "Debug",
    description: "Hypothesis-driven debugging with local log ingestion.",
    icon: "bug",
    color: "#f97316",
    readOnly: false,
    requiresPaseoTools: false,
    prompt: DEBUG_PROMPT,
  },
  {
    id: "multitask",
    label: "Multitask",
    description: "Coordinate multiple parallel sub-agents.",
    icon: "layers",
    color: "#22c55e",
    readOnly: false,
    requiresPaseoTools: true,
    prompt: () => MULTITASK_PROMPT,
  },
];

const BY_ID = new Map(WORKFLOW_MODES.map((m) => [m.id, m]));

export function getWorkflowMode(id: string | null | undefined): WorkflowMode {
  if (id && BY_ID.has(id as WorkflowModeId)) {
    return BY_ID.get(id as WorkflowModeId)!;
  }
  return WORKFLOW_MODES[0];
}

export function isWorkflowModeId(value: unknown): value is WorkflowModeId {
  return typeof value === "string" && BY_ID.has(value as WorkflowModeId);
}

export function composeWorkflowPrompt(
  modeId: string | null | undefined,
  ctx: WorkflowModeContext,
): string {
  const mode = getWorkflowMode(modeId);
  const fragment = mode.prompt(ctx);
  return fragment.trim();
}
