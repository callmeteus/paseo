export interface AgentProviderSwapResult {
  newAgentId?: string | null;
  error?: string | null;
}

export interface AgentProviderSwapClient {
  swapAgentProvider(input: {
    agentId: string;
    targetProvider: string;
    targetModel: string | null;
  }): Promise<AgentProviderSwapResult>;
}

export class ProviderSwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderSwapError";
  }
}

export interface PerformAgentProviderSwapInput {
  client: AgentProviderSwapClient;
  agentId: string;
  provider: string;
  modelId: string;
  persistPreference: (provider: string, modelId: string) => Promise<unknown>;
  onPreferencePersistError?: (error: unknown) => void;
}

export interface PerformAgentProviderSwapResult {
  newAgentId: string;
}

/**
 * Run the swap and preference persistence steps behind a provider/model choice.
 * Kept free of React state so the failure paths are testable.
 */
export async function performAgentProviderSwap(
  input: PerformAgentProviderSwapInput,
): Promise<PerformAgentProviderSwapResult> {
  const result = await input.client.swapAgentProvider({
    agentId: input.agentId,
    targetProvider: input.provider,
    targetModel: input.modelId || null,
  });

  if (result.error) {
    throw new ProviderSwapError(result.error);
  }
  if (!result.newAgentId) {
    throw new ProviderSwapError("Provider swap did not return a new agent");
  }

  try {
    await input.persistPreference(input.provider, input.modelId);
  } catch (error) {
    input.onPreferencePersistError?.(error);
  }

  return { newAgentId: result.newAgentId };
}
