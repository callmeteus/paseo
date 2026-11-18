import type { QueryClient } from "@tanstack/react-query";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export const AGENT_COMMANDS_QUERY_ROOT = "agentCommands";

export interface AgentCommandsDraftConfig {
  provider: AgentProvider;
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export function normalizeAgentCommandsCwd(cwd: string): string {
  return normalizeWorkspacePath(cwd) ?? "";
}

export function agentCommandsQueryRoot(serverId: string) {
  return [AGENT_COMMANDS_QUERY_ROOT, serverId] as const;
}

export function sessionAgentCommandsQueryKey(input: { serverId: string; agentId: string }) {
  return [...agentCommandsQueryRoot(input.serverId), "session", input.agentId] as const;
}

function draftAgentCommandsCheckoutScope(input: { serverId: string; cwd: string }) {
  return [
    ...agentCommandsQueryRoot(input.serverId),
    "draft",
    "cwd",
    normalizeAgentCommandsCwd(input.cwd),
  ] as const;
}

export function draftAgentCommandsQueryKey(input: {
  serverId: string;
  draftConfig: AgentCommandsDraftConfig;
}) {
  const { draftConfig } = input;
  return [
    ...draftAgentCommandsCheckoutScope({ serverId: input.serverId, cwd: draftConfig.cwd }),
    "provider",
    draftConfig.provider,
    "mode",
    draftConfig.modeId ?? null,
    "model",
    draftConfig.model ?? null,
    "thinking",
    draftConfig.thinkingOptionId ?? null,
    "features",
    draftConfig.featureValues ?? null,
  ] as const;
}

// Draft commands include project skills read from the checkout. When the checkout moves to
// another branch the cached list describes files that are gone, so it is dropped rather than
// shown while a refetch runs.
export function resetDraftAgentCommandsForCheckout(
  queryClient: QueryClient,
  input: { serverId: string; cwd: string },
): Promise<void> {
  return queryClient.resetQueries({ queryKey: draftAgentCommandsCheckoutScope(input) });
}

/**
 * A live agent can list its own commands even while the draft's provider
 * selection is unresolved. The remote host commonly has no ready draft config,
 * and gating the highlighter's query on the draft left every skill uncolored.
 */
export function shouldListCommandsForComposer(input: {
  serverId: string;
  agentId: string;
  hasReadyDraftConfig: boolean;
}): boolean {
  return Boolean(input.serverId) && (Boolean(input.agentId) || input.hasReadyDraftConfig);
}

export function agentCommandsQueryKey(input: {
  serverId: string;
  agentId: string;
  draftConfig?: AgentCommandsDraftConfig;
}) {
  if (input.draftConfig) {
    return draftAgentCommandsQueryKey({
      serverId: input.serverId,
      draftConfig: input.draftConfig,
    });
  }
  return sessionAgentCommandsQueryKey({ serverId: input.serverId, agentId: input.agentId });
}
