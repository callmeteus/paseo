import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ModelRouter, ModelRouterMode } from "@getpaseo/protocol/model-router";
import { useDaemonConfig } from "@/hooks/use-daemon-config";

export interface RouterPickerRow {
  id: string;
  name: string;
  description: string;
}

interface RouterPicker {
  rows: RouterPickerRow[];
  selectedRouterId: string | null;
  getRouter: (routerId: string) => ModelRouter | undefined;
  select: (routerId: string | null) => Promise<void>;
}

function modeLabel(mode: ModelRouterMode, t: ReturnType<typeof useTranslation>["t"]): string {
  return t(
    mode === "fallback"
      ? "settings.modelRouters.modeFallback"
      : "settings.modelRouters.modeDistribution",
  );
}

/**
 * Routers offered inside the chat's model selector. Picking one writes it as
 * the default router for new chats; picking it again clears the default.
 */
export function useRouterPicker(serverId: string | null): RouterPicker {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);

  const routers = useMemo(
    () => config?.modelRouters?.routers ?? [],
    [config?.modelRouters?.routers],
  );
  const rows = useMemo<RouterPickerRow[]>(() => {
    return routers.map((router) => ({
      id: router.id,
      name: router.name,
      description: router.summary
        ? `${modeLabel(router.mode, t)} · ${router.summary}`
        : modeLabel(router.mode, t),
    }));
  }, [routers, t]);

  const getRouter = useCallback(
    (routerId: string) => routers.find((router) => router.id === routerId),
    [routers],
  );

  const select = useCallback(
    async (routerId: string | null) => {
      if (routerId === (config?.modelRouters?.defaultRouterId ?? null)) return;
      try {
        // The patch replaces the whole settings object, so the routers stay.
        await patchConfig({
          modelRouters: {
            routers,
            defaultRouterId: routerId,
          },
        });
      } catch (error) {
        console.warn("[RouterPicker] failed to set the default router", error);
      }
    },
    [config?.modelRouters?.defaultRouterId, patchConfig, routers],
  );

  return {
    rows,
    selectedRouterId: config?.modelRouters?.defaultRouterId ?? null,
    getRouter,
    select,
  };
}

/** Name of the router a chat is bound to (or the default), or null when none. */
export function useActiveRouterName(
  serverId: string | null,
  routerId?: string | null,
): string | null {
  const { rows, selectedRouterId } = useRouterPicker(serverId);
  const resolvedId = routerId === undefined ? selectedRouterId : routerId;
  if (!resolvedId) return null;
  return rows.find((row) => row.id === resolvedId)?.name ?? null;
}
