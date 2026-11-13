import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  DetectedMcpServer,
  McpBridge,
  McpCatalogImportTarget,
  McpServerConfig,
  McpShare,
} from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import {
  supportsMcpBridge,
  supportsMcpBridgeMultiHop,
  supportsMcpCatalog,
  supportsMcpServers,
} from "./capabilities";

export type CopyMcpServersMode = "merge" | "replace";

export interface UseMcpServersResult {
  servers: Record<string, McpServerConfig> | null;
  shares: Record<string, McpShare> | null;
  bridges: Record<string, McpBridge> | null;
  isSupported: boolean;
  isBridgeSupported: boolean;
  isMultiHopSupported: boolean;
  isCatalogSupported: boolean;
  saveServers: (next: Record<string, McpServerConfig>) => Promise<void>;
  saveShares: (next: Record<string, McpShare>) => Promise<void>;
  saveBridges: (next: Record<string, McpBridge>) => Promise<void>;
  scanCatalog: () => Promise<{ servers: DetectedMcpServer[]; errors: string[] }>;
  importCatalog: (
    entries: McpCatalogImportTarget[],
  ) => Promise<{ imported: string[]; skipped: string[]; errors: string[] }>;
  testServer: (config: McpServerConfig) => Promise<{
    ok: boolean;
    tools: string[];
    error: string | null;
  }>;
  copyToHost: (targetServerId: string, mode: CopyMcpServersMode) => Promise<void>;
  discoverServers: (
    hostServerId: string,
  ) => Promise<Array<{ server: string; description?: string | null; tools?: string[] }>>;
}

export function useMcpServers(serverId: string | null): UseMcpServersResult {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const runtimeClient = useHostRuntimeClient(serverId ?? "");
  const features = useSessionStore((state) => state.sessions[serverId ?? ""]?.serverInfo?.features);
  const { t } = useTranslation();
  const isSupported = supportsMcpServers(features);
  const isBridgeSupported = supportsMcpBridge(features);
  const isMultiHopSupported = supportsMcpBridgeMultiHop(features);
  const isCatalogSupported = supportsMcpCatalog(features);

  const saveServers = useCallback(
    async (next: Record<string, McpServerConfig>) => {
      await patchConfig({ mcpServers: next });
    },
    [patchConfig],
  );

  const saveShares = useCallback(
    async (next: Record<string, McpShare>) => {
      await patchConfig({ mcpShares: next });
    },
    [patchConfig],
  );

  const saveBridges = useCallback(
    async (next: Record<string, McpBridge>) => {
      await patchConfig({ mcpBridges: next });
    },
    [patchConfig],
  );

  const copyToHost = useCallback(
    async (targetServerId: string, mode: CopyMcpServersMode) => {
      if (!serverId) throw new Error(t("settings.host.mcp.copy.selectHostTitle"));
      const store = getHostRuntimeStore();
      const source = store.getSnapshot(serverId)?.client;
      const target = store.getSnapshot(targetServerId)?.client;
      if (!source || !target) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const sourceConfig = await source.getDaemonConfig();
      const targetConfig = await target.getDaemonConfig();
      const sourceServers = sourceConfig.config.mcpServers ?? {};
      const targetServers = targetConfig.config.mcpServers ?? {};
      const next = mode === "replace" ? sourceServers : { ...targetServers, ...sourceServers };
      await target.patchDaemonConfig({ mcpServers: next });
    },
    [serverId, t],
  );

  const discoverServers = useCallback(
    async (hostServerId: string) => {
      const client = getHostRuntimeStore().getSnapshot(hostServerId)?.client;
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.listMcpBridgeServers();
    },
    [t],
  );

  const scanCatalog = useCallback(async () => {
    if (!runtimeClient) throw new Error(t("workspace.terminal.hostDisconnected"));
    return runtimeClient.scanMcpCatalog();
  }, [runtimeClient, t]);

  const importCatalog = useCallback(
    async (entries: McpCatalogImportTarget[]) => {
      if (!runtimeClient) throw new Error(t("workspace.terminal.hostDisconnected"));
      return runtimeClient.importMcpCatalog(entries);
    },
    [runtimeClient, t],
  );

  const testServer = useCallback(
    async (serverConfig: McpServerConfig) => {
      if (!runtimeClient) throw new Error(t("workspace.terminal.hostDisconnected"));
      return runtimeClient.testMcpServer(serverConfig);
    },
    [runtimeClient, t],
  );

  return {
    servers: config ? (config.mcpServers ?? {}) : null,
    shares: config ? (config.mcpShares ?? {}) : null,
    bridges: config ? (config.mcpBridges ?? {}) : null,
    isSupported,
    isBridgeSupported,
    isMultiHopSupported,
    isCatalogSupported,
    saveServers,
    saveShares,
    saveBridges,
    copyToHost,
    discoverServers,
    scanCatalog,
    importCatalog,
    testServer,
  };
}
