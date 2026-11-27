import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode } from "@getpaseo/protocol/agent-types";

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  return resolveNextChoiceId(modeOptions, selectedMode);
}

export function resolveNextChoiceId(
  options: readonly { id: string }[],
  selectedId: string | null | undefined,
): string | null {
  if (options.length < 2) return null;

  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  return options[(currentIndex + 1) % options.length].id;
}

export function resolveNextWorkflowModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly { id: string }[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
