/**
 * The five workflow modes, as ids and accent colors.
 *
 * The daemon attaches each prompt in `composeWorkflowPrompt`. The composer
 * attaches the translated phrase. This is the only list of the ids and colors.
 */

export const WORKFLOW_MODES = [
  { id: "agent", color: "#3b82f6" },
  { id: "plan", color: "#eab308" },
  { id: "ask", color: "#8b5cf6" },
  { id: "debug", color: "#f97316" },
  { id: "multitask", color: "#22c55e" },
] as const satisfies readonly { id: string; color: string }[];

export type WorkflowModeId = (typeof WORKFLOW_MODES)[number]["id"];

export type WorkflowModeAppearance = (typeof WORKFLOW_MODES)[number];
