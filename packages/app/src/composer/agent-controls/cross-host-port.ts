import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

export type CrossHostPortClient = Pick<
  DaemonClient,
  "exportAgentSnapshot" | "importAgentSnapshot" | "archiveAgent"
>;

export interface PerformCrossHostPortInput {
  sourceClient: CrossHostPortClient;
  destinationClient: CrossHostPortClient;
  agentId: string;
  provider: string;
  modelId: string;
  agentWorkspaceId: string | null;
  sourceHost: string;
  targetHost: string;
}

export interface PerformCrossHostPortResult {
  newAgentId: string;
}

export class CrossHostPortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossHostPortError";
  }
}

export async function performCrossHostPort(
  input: PerformCrossHostPortInput,
): Promise<PerformCrossHostPortResult> {
  const snapshot = await input.sourceClient.exportAgentSnapshot({ agentId: input.agentId });
  const newAgentId = await input.destinationClient.importAgentSnapshot({
    snapshot,
    targetProvider: input.provider,
    targetModel: input.modelId || null,
    ...(input.agentWorkspaceId ? { workspaceId: input.agentWorkspaceId } : {}),
    sourceHost: input.sourceHost,
  });
  await input.sourceClient.archiveAgent(input.agentId, {
    migratedTo: {
      provider: input.provider,
      agentId: newAgentId,
      host: input.targetHost,
      portedAt: new Date().toISOString(),
    },
  });
  return { newAgentId };
}
