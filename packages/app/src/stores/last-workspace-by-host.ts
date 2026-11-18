import { z } from "zod";
import {
  ActiveWorkspaceSelectionSchema,
  type ActiveWorkspaceSelection,
} from "@/stores/last-workspace-selection";

export const LAST_WORKSPACE_BY_HOST_STORAGE_KEY = "paseo:last-workspace-by-host";

const LastWorkspaceByHostSchema = z.record(z.string(), ActiveWorkspaceSelectionSchema);

export interface LastWorkspaceByHostStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/**
 * Remembers the last workspace opened on each host.
 *
 * The global last-workspace selection only holds one entry, so navigating to a
 * different host loses the workspace you were on there. The host tab rail uses
 * this map to restore that workspace when you switch back. It is separate from
 * the global selection so the persisted shape of the global key never changes.
 */
export function createLastWorkspaceByHostStore(storage: LastWorkspaceByHostStorage) {
  let selections: Record<string, ActiveWorkspaceSelection> = {};
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function remember(next: ActiveWorkspaceSelection) {
    const parsed = ActiveWorkspaceSelectionSchema.safeParse(next);
    if (!parsed.success) {
      return;
    }
    const normalized = parsed.data;
    const previous = selections[normalized.serverId];
    if (
      previous?.serverId === normalized.serverId &&
      previous.workspaceId === normalized.workspaceId
    ) {
      return;
    }
    selections = { ...selections, [normalized.serverId]: normalized };
    revision += 1;
    notifyListeners();
    void storage.write(JSON.stringify(selections)).catch(() => {});
  }

  function getForHost(serverId: string): ActiveWorkspaceSelection | null {
    return selections[serverId] ?? null;
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision !== hydrationRevision || !stored) {
          return undefined;
        }
        const parsed = LastWorkspaceByHostSchema.safeParse(JSON.parse(stored));
        if (parsed.success) {
          selections = parsed.data;
        }
        return undefined;
      })
      .catch(() => {})
      .finally(() => {
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  return {
    remember,
    getForHost,
    hydrate,
    isHydrated: () => hydrated,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
