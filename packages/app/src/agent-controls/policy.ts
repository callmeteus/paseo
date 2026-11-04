import type { AgentMode } from "@getpaseo/protocol/agent-types";

export const PLAN_MODE_FEATURE_ID = "plan_mode";
export const FAST_MODE_FEATURE_ID = "fast_mode";
export const SPEED_FEATURE_ID = "service_tier";
/** Preferred permission mode while Paseo workflow modes are active. */
export const FORCED_AGENT_MODE_ID = "build";

export function isPlanningAgentMode(mode: Pick<AgentMode, "id" | "colorTier">): boolean {
  return mode.colorTier === "planning" || mode.id === "plan" || mode.id.endsWith("#plan");
}

export function resolveNonPlanningModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && !isPlanningAgentMode(defaultMode)) {
    return defaultMode.id;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}

/**
 * Permission mode for a new agent while Paseo workflow modes are active.
 * Prefers Build; providers without it (Cursor, Claude, Codex, ...) keep their
 * default mode unless it is a planning mode.
 */
export function resolveForcedAgentModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const buildMode = modes.find((mode) => mode.id === FORCED_AGENT_MODE_ID);
  if (buildMode) {
    return buildMode.id;
  }
  return resolveNonPlanningModeId(modes, defaultModeId);
}

/**
 * Permission mode for a live agent while Paseo workflow modes are active.
 * Only planning modes are switched; a provider's own safe mode is left alone.
 */
export function resolveForcedLiveModeId(
  modes: readonly AgentMode[],
  currentModeId: string | null,
): string | null {
  const buildMode = modes.find((mode) => mode.id === FORCED_AGENT_MODE_ID);
  if (buildMode) {
    return buildMode.id;
  }
  if (!currentModeId) {
    return null;
  }
  const currentMode = modes.find((mode) => mode.id === currentModeId);
  if (!currentMode || !isPlanningAgentMode(currentMode)) {
    return null;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}
