import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  hiddenSearchModelKeys,
  type ModelRouter,
  type ModelRouterMode,
} from "@getpaseo/protocol/model-router";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import type { ModelIconId } from "@/model-icons/icons";
import { resolveRouterIconId } from "@/model-icons/resolve";

export interface RouterPickerRow {
  id: string;
  name: string;
  description: string;
  iconId: ModelIconId | null;
}

interface RouterPicker {
  rows: RouterPickerRow[];
  selectedRouterId: string | null;
  getRouter: (routerId: string) => ModelRouter | undefined;
  /** `provider::model` keys the routers keep out of cross-provider search. */
  hiddenSearchKeys: ReadonlySet<string>;
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
      iconId: resolveRouterIconId(router),
    }));
  }, [routers, t]);

  const getRouter = useCallback(
    (routerId: string) => routers.find((router) => router.id === routerId),
    [routers],
  );

  const hiddenSearchKeys = useMemo(() => hiddenSearchModelKeys(routers), [routers]);

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
    hiddenSearchKeys,
    select,
  };
}

/** Router a chat is bound to, or the default router when the chat has not picked one. */
export function useActiveRouter(
  serverId: string | null,
  routerId?: string | null,
): ModelRouter | null {
  const { getRouter, selectedRouterId } = useRouterPicker(serverId);
  const resolvedId = routerId === undefined ? selectedRouterId : routerId;
  if (!resolvedId) return null;
  return getRouter(resolvedId) ?? null;
}

/** Name of the router a chat is bound to (or the default), or null when none. */
export function useActiveRouterName(
  serverId: string | null,
  routerId?: string | null,
): string | null {
  return useActiveRouter(serverId, routerId)?.name ?? null;
}
