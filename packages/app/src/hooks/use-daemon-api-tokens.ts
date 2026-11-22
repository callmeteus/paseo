import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiTokenSummary } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export function daemonApiTokensQueryKey(serverId: string | null) {
  return ["daemon-api-tokens", serverId] as const;
}

export function useDaemonApiTokens(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => daemonApiTokensQueryKey(serverId), [serverId]);

  const tokensQuery = useFetchQuery({
    queryKey,
    enabled: Boolean(serverId && client && isConnected),
    dataShape: "list",
    staleTimeMs: 10_000,
    queryFn: async (): Promise<ApiTokenSummary[]> => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.listDaemonApiTokens();
      return result.tokens;
    },
  });

  const createToken = useCallback(
    async (name: string): Promise<string> => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.createDaemonApiToken(name);
      queryClient.setQueryData<ApiTokenSummary[]>(queryKey, (current) => [
        result.token,
        ...(current ?? []),
      ]);
      return result.secret;
    },
    [client, queryClient, queryKey],
  );

  const renameToken = useCallback(
    async (id: string, name: string): Promise<void> => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.renameDaemonApiToken(id, name);
      queryClient.setQueryData<ApiTokenSummary[]>(queryKey, (current) =>
        (current ?? []).map((token) => (token.id === id ? result.token : token)),
      );
    },
    [client, queryClient, queryKey],
  );

  const rotateToken = useCallback(
    async (id: string): Promise<string> => {
      if (!client) throw new Error("Host is disconnected");
      const result = await client.rotateDaemonApiToken(id);
      queryClient.setQueryData<ApiTokenSummary[]>(queryKey, (current) =>
        (current ?? []).map((token) => (token.id === id ? result.token : token)),
      );
      return result.secret;
    },
    [client, queryClient, queryKey],
  );

  const revokeToken = useCallback(
    async (id: string): Promise<void> => {
      if (!client) throw new Error("Host is disconnected");
      await client.revokeDaemonApiToken(id);
      queryClient.setQueryData<ApiTokenSummary[]>(queryKey, (current) =>
        (current ?? []).filter((token) => token.id !== id),
      );
    },
    [client, queryClient, queryKey],
  );

  return {
    tokens: tokensQuery.data ?? [],
    isLoading: tokensQuery.isLoading,
    isError: tokensQuery.isError,
    createToken,
    renameToken,
    rotateToken,
    revokeToken,
  };
}
