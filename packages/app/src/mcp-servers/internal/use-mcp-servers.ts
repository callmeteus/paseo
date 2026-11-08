import { useCallback } from "react";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";
import { supportsMcpServers } from "./capabilities";
import type { McpServersCapabilities } from "./capabilities";

export interface UseMcpServersResult {
  servers: Record<string, McpServerConfig> | null;
  isSupported: boolean;
  saveServers: (next: Record<string, McpServerConfig>) => Promise<void>;
}

export function useMcpServers(serverId: string | null): UseMcpServersResult {
  const { config, patchConfig } = useDaemonConfig(serverId);
  const isSupported = useSessionStore((state) => {
    return supportsMcpServers(
      state.sessions[serverId ?? ""]?.serverInfo?.features as
        | McpServersCapabilities
        | undefined,
    );
  });

  const saveServers = useCallback(
    async (next: Record<string, McpServerConfig>) => {
      await patchConfig({ mcpServers: next });
    },
    [patchConfig],
  );

  return {
    servers: config ? ((config.mcpServers as Record<string, McpServerConfig> | undefined) ?? null) : null,
    isSupported,
    saveServers,
  };
}
