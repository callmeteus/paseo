import { zSessionConfigOption } from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";
import type { Logger } from "pino";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { z } from "zod";

import type {
  AgentModelDefinition,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  FetchCatalogOptions,
  ProviderMcpLoginResult,
  ProviderMcpServerInfo,
  ProviderRefreshContext,
} from "../agent-sdk-types.js";
import { CLI_MODEL_REFRESH_TIMEOUT_MS, cursorModelsArgv } from "../cli-model-refresh.js";
import { execCommand } from "../../../utils/spawn.js";
import {
  deriveSelectorOptions,
  type ACPCatalogModelResolverContext,
  type ACPConfigFeatureOption,
} from "./acp-agent.js";
import { createCursorMcpConfigBridge } from "./cursor-mcp-config.js";
import {
  cursorCliEnv,
  disposeCursorMcpLogins,
  listCursorMcpServers,
  loginCursorMcpServer,
  resolveCursorCliCommand,
} from "./cursor-mcp-auth.js";
import { cursorProjectRoot } from "./cursor-skill-catalog.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface CursorACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
}

const COMMAND_LISTING_IDLE_MS = 2 * 60 * 1000;
// Cursor may start several workspace MCP servers before advertising slash commands.
const CURSOR_COMMAND_LISTING_WAIT_TIMEOUT_MS = 120_000;
const CURSOR_CLIENT_CAPABILITY_META = {
  parameterizedModelPicker: true,
};

export const CURSOR_FAST_FEATURE_OPTION: ACPConfigFeatureOption = {
  id: "fast",
  configId: "fast",
  label: "Fast",
  description: "Cursor fast mode",
  tooltip: "Toggle Cursor fast mode",
  icon: "zap",
  toggle: true,
};

const CursorModelCatalogSchema = z.object({
  models: z.array(
    z.object({
      value: z.string().min(1),
      name: z.string(),
      configOptions: z.array(zSessionConfigOption),
    }),
  ),
});

// Cursor model switches persist CLI preferences, even in a throwaway probe session.
// Its extension returns each model's parameter definitions without selecting it.
export async function resolveCursorCatalogModels({
  connection,
  models,
  provider,
  runRequest,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  const catalog = await runRequest(() => fetchCursorModelCatalog(connection));
  const currentModelId = models.find((model) => model.isDefault)?.id;

  return catalog.models.map((model) => {
    const thinkingOptions = deriveSelectorOptions(model.configOptions, "thought_level");
    const defaultThinkingOptionId = thinkingOptions.find((option) => option.isDefault)?.id;
    return {
      provider,
      id: model.value,
      label: model.name,
      isDefault: model.value === currentModelId,
      thinkingOptions: thinkingOptions.length > 0 ? thinkingOptions : undefined,
      defaultThinkingOptionId,
    };
  });
}

async function fetchCursorModelCatalog(connection: ACPCatalogModelResolverContext["connection"]) {
  try {
    const response = await connection.extMethod("cursor/list_available_models", {});
    return CursorModelCatalogSchema.parse(response);
  } catch (error) {
    const extensionUnavailable =
      typeof error === "object" && error !== null && "code" in error && error.code === -32601;
    if (extensionUnavailable) {
      throw new Error(
        "Update Cursor CLI: this version does not support cursor/list_available_models.",
        { cause: error },
      );
    }
    throw error;
  }
}

interface CommandListingEntry {
  session: AgentSession;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closing: Promise<void> | null;
}

export class CursorACPAgentClient extends GenericACPAgentClient {
  private readonly cliCommand: [string, ...string[]];
  private readonly cliEnv?: Record<string, string>;
  private readonly cursorMcpConfigBridge: ReturnType<typeof createCursorMcpConfigBridge>;
  private cursorMcpConfigPrepared = false;
  private readonly commandListingByRoot = new Map<string, CommandListingEntry>();
  private readonly commandListingInFlight = new Map<string, Promise<AgentSlashCommand[]>>();

  constructor(options: CursorACPAgentClientOptions) {
    const mcpConfigBridge = createCursorMcpConfigBridge({
      logger: options.logger.child({ module: "cursor-mcp-config" }),
    });
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId ?? "cursor",
      label: options.label,
      usageProvider: "cursor",
      // cursor-agent publishes slash commands asynchronously via available_commands_update.
      waitForInitialCommands: true,
      initialCommandsWaitTimeoutMs: CURSOR_COMMAND_LISTING_WAIT_TIMEOUT_MS,
      clientCapabilityMeta: CURSOR_CLIENT_CAPABILITY_META,
      configFeatureOptions: [CURSOR_FAST_FEATURE_OPTION],
      catalogModelResolver: resolveCursorCatalogModels,
      // Cursor's ACP mode loads native mcp.json entries but not Cursor plugins.
      // Mirror plugin MCP servers into the native config before spawn.
      mcpConfigBridge,
    });
    this.cliCommand = resolveCursorCliCommand(options.command);
    this.cliEnv = options.env;
    this.cursorMcpConfigBridge = mcpConfigBridge;
  }

  clearCommandListingCache(): void {
    for (const [root, entry] of this.commandListingByRoot) {
      void this.evictCommandListingRoot(root, entry);
    }
    this.commandListingByRoot.clear();
    this.commandListingInFlight.clear();
  }

  async listCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const root = cursorProjectRoot(config.cwd, existsSync);
    const inFlight = this.commandListingInFlight.get(root);
    if (inFlight) {
      return inFlight;
    }
    const listing = this.listCommandsForProjectRoot(root, config);
    this.commandListingInFlight.set(root, listing);
    try {
      return await listing;
    } finally {
      this.commandListingInFlight.delete(root);
    }
  }

  private async listCommandsForProjectRoot(
    root: string,
    config: AgentSessionConfig,
  ): Promise<AgentSlashCommand[]> {
    let entry = this.commandListingByRoot.get(root);
    if (!entry || entry.closing) {
      const session = await this.createSession(config);
      entry = { session, idleTimer: null, closing: null };
      this.commandListingByRoot.set(root, entry);
    }
    this.scheduleCommandListingIdle(root, entry);
    if (!entry.session.listCommands) {
      return [];
    }
    return await entry.session.listCommands();
  }

  private scheduleCommandListingIdle(root: string, entry: CommandListingEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }
    entry.idleTimer = setTimeout(() => {
      void this.evictCommandListingRoot(root, entry);
    }, COMMAND_LISTING_IDLE_MS);
  }

  private async evictCommandListingRoot(root: string, entry: CommandListingEntry): Promise<void> {
    if (this.commandListingByRoot.get(root) !== entry) {
      return;
    }
    this.commandListingByRoot.delete(root);
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (entry.closing) {
      await entry.closing;
      return;
    }
    entry.closing = entry.session.close().catch(() => undefined);
    await entry.closing;
  }

  async listMcpServers(): Promise<ProviderMcpServerInfo[]> {
    if (!this.cursorMcpConfigPrepared) {
      await this.cursorMcpConfigBridge.acquire();
      this.cursorMcpConfigPrepared = true;
    }
    return listCursorMcpServers({ command: this.cliCommand, env: this.cliEnv });
  }

  async loginMcpServer(server: string): Promise<ProviderMcpLoginResult> {
    await this.cursorMcpConfigBridge.acquire();
    this.cursorMcpConfigPrepared = true;
    return loginCursorMcpServer({ command: this.cliCommand, server, env: this.cliEnv });
  }

  async shutdown(): Promise<void> {
    this.clearCommandListingCache();
    disposeCursorMcpLogins();
  }

  async getCatalogCacheKey(_options: FetchCatalogOptions): Promise<string> {
    // Models and modes come from the signed-in account, not the project.
    // One probe covers every workspace. Refreshing each cwd at once opened
    // several session/new calls, and those probes stalled past the deadline.
    return "cursor-host";
  }

  async refreshOwnedModelList(context?: ProviderRefreshContext): Promise<void> {
    const invocation = cursorModelsArgv(this.cliCommand);
    await execCommand(invocation.command, invocation.args, {
      cwd: homedir(),
      env: cursorCliEnv(this.cliEnv),
      timeout: CLI_MODEL_REFRESH_TIMEOUT_MS,
      signal: context?.signal,
      maxBuffer: 2 * 1024 * 1024,
    });
  }
}
