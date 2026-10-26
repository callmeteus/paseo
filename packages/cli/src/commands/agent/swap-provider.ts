import type { Command } from "commander";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { connectToDaemon } from "../../utils/client.js";
import { describeDaemonTarget, selectDaemonTarget } from "../../utils/daemon-target.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

export interface SwapProviderResult {
  newAgentId: string | null;
  previousAgentId: string;
  error: string | null;
}

export const swapProviderSchema: OutputSchema<SwapProviderResult> = {
  idField: "newAgentId",
  columns: [
    { header: "NEW AGENT", field: "newAgentId" },
    { header: "PREVIOUS", field: "previousAgentId" },
    { header: "ERROR", field: "error" },
  ],
};

export interface SwapProviderOptions extends CommandOptions {
  provider?: string;
  model?: string;
  /** Target daemon endpoint for a cross-host port. */
  toHost?: string;
  /** Target local daemon home for a cross-host port. */
  toHome?: string;
  /** Target workspace on the destination host. */
  toWorkspace?: string;
}

export type SwapProviderCommandResult = SingleResult<SwapProviderResult>;

function requireAgentId(agentIdArg: string): string {
  const agentId = agentIdArg?.trim();
  if (!agentId) {
    const error: CommandError = {
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
    };
    throw error;
  }
  return agentId;
}

function requireProvider(options: SwapProviderOptions): string {
  const provider = options.provider?.trim();
  if (!provider) {
    const error: CommandError = {
      code: "MISSING_PROVIDER",
      message: "Target provider is required",
    };
    throw error;
  }
  return provider;
}

function resolveCrossHostTarget(
  options: SwapProviderOptions,
): ReturnType<typeof selectDaemonTarget> | null {
  const toHost = options.toHost?.trim();
  const toHome = options.toHome?.trim();
  if (toHost && toHome) {
    const error: CommandError = {
      code: "TARGET_AMBIGUOUS",
      message: "Choose either --to-host or --to-home, not both.",
    };
    throw error;
  }
  if (toHost) {
    return selectDaemonTarget({ host: toHost });
  }
  if (toHome) {
    return selectDaemonTarget({ home: toHome });
  }
  return null;
}

function swapFailure(error: unknown): CommandError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "SWAP_FAILED",
    message: `Failed to swap provider: ${message}`,
  };
}

function singleResult(
  newAgentId: string | null,
  previousAgentId: string,
): SwapProviderCommandResult {
  return {
    type: "single",
    data: { newAgentId, previousAgentId, error: null },
    schema: swapProviderSchema,
  };
}

async function runSameHostSwap(
  agentId: string,
  provider: string,
  options: SwapProviderOptions,
): Promise<SwapProviderCommandResult> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const result = await client.swapAgentProvider({
      agentId,
      targetProvider: provider,
      targetModel: options.model ?? null,
    });
    return {
      type: "single",
      data: result,
      schema: swapProviderSchema,
    };
  } catch (error) {
    throw swapFailure(error);
  } finally {
    await client.close().catch(() => {});
  }
}

async function runCrossHostSwap(
  agentId: string,
  provider: string,
  options: SwapProviderOptions,
  target: ReturnType<typeof selectDaemonTarget>,
): Promise<SwapProviderCommandResult> {
  const source = await connectToDaemon({ target: options.daemonTarget });
  let destination: DaemonClient | null = null;
  try {
    destination = await connectToDaemon({ target });
    const snapshot = await source.exportAgentSnapshot({ agentId });
    const newAgentId = await destination.importAgentSnapshot({
      snapshot,
      targetProvider: provider,
      targetModel: options.model ?? null,
      ...(options.toWorkspace ? { workspaceId: options.toWorkspace } : {}),
      sourceHost: describeDaemonTarget(options.daemonTarget),
    });
    await source.archiveAgent(agentId, {
      migratedTo: {
        provider,
        agentId: newAgentId,
        host: describeDaemonTarget(target),
        portedAt: new Date().toISOString(),
      },
    });
    return singleResult(newAgentId, agentId);
  } catch (error) {
    throw swapFailure(error);
  } finally {
    await destination?.close().catch(() => {});
    await source.close().catch(() => {});
  }
}

export async function runSwapProviderCommand(
  agentIdArg: string,
  options: SwapProviderOptions,
  _command: Command,
): Promise<SwapProviderCommandResult> {
  const agentId = requireAgentId(agentIdArg);
  const provider = requireProvider(options);
  const crossHostTarget = resolveCrossHostTarget(options);

  if (crossHostTarget) {
    return runCrossHostSwap(agentId, provider, options, crossHostTarget);
  }
  return runSameHostSwap(agentId, provider, options);
}
