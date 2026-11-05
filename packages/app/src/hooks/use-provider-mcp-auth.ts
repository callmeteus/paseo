import { useCallback, useEffect, useRef, useState } from "react";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export type ProviderMcpServerStatus =
  | "ready"
  | "needs_auth"
  | "needs_approval"
  | "error"
  | "unknown";

export interface ProviderMcpServer {
  name: string;
  status: ProviderMcpServerStatus;
  detail?: string | null;
}

export interface ProviderMcpLoginState {
  server: string;
  status: "starting" | "waiting" | "authenticated" | "failed";
  url: string | null;
  message: string | null;
}

export interface UseProviderMcpAuthResult {
  supported: boolean;
  servers: ProviderMcpServer[];
  isLoading: boolean;
  error: string | null;
  login: ProviderMcpLoginState | null;
  refresh: () => Promise<void>;
  authenticate: (server: string) => Promise<void>;
}

const LOGIN_POLL_INTERVAL_MS = 2_000;
const LOGIN_POLL_TIMEOUT_MS = 2 * 60_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useProviderMcpAuth(input: {
  serverId: string;
  provider: string;
  enabled: boolean;
}): UseProviderMcpAuthResult {
  const { serverId, provider, enabled } = input;
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "providerMcpAuth");
  const [servers, setServers] = useState<ProviderMcpServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<ProviderMcpLoginState | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!client || !supported) return;
    setIsLoading(true);
    try {
      const result = await client.listProviderMcpServers(provider);
      if (!mountedRef.current) return;
      setServers(result.servers);
      setError(result.error);
    } catch (cause) {
      if (!mountedRef.current) return;
      setError(errorMessage(cause));
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [client, provider, supported]);

  const pollLoginStatus = useCallback(
    async (serverName: string, startedAt: number) => {
      if (!client) return;
      if (Date.now() - startedAt > LOGIN_POLL_TIMEOUT_MS) {
        stopPolling();
        return;
      }
      try {
        const result = await client.listProviderMcpServers(provider);
        if (!mountedRef.current) return;
        setServers(result.servers);
        setError(result.error);
        const target = result.servers.find((entry) => entry.name === serverName);
        if (target?.status === "ready") {
          stopPolling();
          setLogin(null);
        } else if (target?.status === "error") {
          stopPolling();
          setLogin((current) =>
            current
              ? {
                  ...current,
                  status: "failed",
                  message: target.detail ?? current.message,
                }
              : current,
          );
        }
      } catch {
        // Keep the previous list; the next poll retries.
      }
    },
    [client, provider, stopPolling],
  );

  const startPolling = useCallback(
    (serverName: string) => {
      if (!client) return;
      stopPolling();
      const startedAt = Date.now();
      pollTimerRef.current = setInterval(() => {
        void pollLoginStatus(serverName, startedAt);
      }, LOGIN_POLL_INTERVAL_MS);
    },
    [client, pollLoginStatus, stopPolling],
  );

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      setLogin(null);
      return;
    }
    if (!supported) return;
    void load();
    return stopPolling;
  }, [enabled, load, stopPolling, supported]);

  const authenticate = useCallback(
    async (serverName: string) => {
      if (!client) return;
      setError(null);
      setLogin({ server: serverName, status: "starting", url: null, message: null });
      try {
        const result = await client.loginProviderMcpServer(provider, serverName);
        if (!mountedRef.current) return;
        setLogin({
          server: serverName,
          status: result.status,
          url: result.url ?? null,
          message: result.message ?? null,
        });
        if (result.status === "waiting") {
          startPolling(serverName);
        } else if (result.status === "authenticated") {
          await load();
        }
      } catch (cause) {
        if (!mountedRef.current) return;
        setLogin({
          server: serverName,
          status: "failed",
          url: null,
          message: errorMessage(cause),
        });
      }
    },
    [client, load, provider, startPolling],
  );

  return {
    supported,
    servers,
    isLoading,
    error,
    login,
    refresh: load,
    authenticate,
  };
}
