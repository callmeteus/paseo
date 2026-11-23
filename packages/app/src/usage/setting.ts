import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSessionStore } from "@/stores/session-store";

/** Host policy comes from the live daemon config replica. */
export function useUsageSetting(serverId: string | null) {
  const supported = useSessionStore((state) =>
    Boolean(serverId && state.sessions[serverId]?.serverInfo?.features?.usageSetting),
  );
  const { config, patchConfig } = useDaemonConfig(supported ? serverId : null);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => patchConfig({ usage: { enabled } }),
  });
  const setEnabled = mutation.mutate;
  const turnOn = useCallback(() => setEnabled(true), [setEnabled]);
  return {
    supported,
    error: mutation.error,
    // COMPAT(usageSetting): added in v0.14, remove after 2027-05-01.
    // Fail open while the config replica loads: a null config means "not loaded yet", not "off".
    // Waiting for it used to hide the whole sidebar summary on hosts that do report usage.
    enabled: !supported || config === null || config.usage?.enabled !== false,
    ready: !supported || config !== null,
    setEnabled,
    turnOn,
  };
}
