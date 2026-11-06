import type { PaseoApi } from "@getpaseo/client";
import {
  buildProviderRouters,
  disabledModelIdsByProviderFromConfig,
  isAutoProviderRouter,
  mergeAutoProviderRouters,
} from "@getpaseo/plugin/server";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ModelRouter } from "@getpaseo/protocol/model-router";

export interface SyncResult {
  providers: string[];
  routers: ModelRouter[];
}

/**
 * Rebuilds every `auto-provider:` router from the live provider catalogue and
 * writes the set to the daemon config, preserving user routers and the daemon's
 * own automatic routers. The patch is skipped when nothing changed, so watching
 * the catalogue cannot loop.
 */
export async function syncProviderRouters(paseo: PaseoApi): Promise<SyncResult> {
  const snapshot = await paseo.providers.waitForReady({ timeoutMs: 30000 });
  const { config } = await paseo.config.get();

  const entries = snapshot.entries as ProviderSnapshotEntry[];
  const generated = buildProviderRouters(
    entries,
    disabledModelIdsByProviderFromConfig(config.providers),
  );

  const current = config.modelRouters;
  const existing = current?.routers ?? [];
  const providers = availableProviders(entries);
  if (sameAutoRouters(existing, generated)) return { providers, routers: generated };

  await paseo.config.patch({
    modelRouters: {
      routers: mergeAutoProviderRouters(existing, generated),
      ...(current?.defaultRouterId !== undefined
        ? { defaultRouterId: current.defaultRouterId }
        : {}),
    },
  });

  return { providers, routers: generated };
}

function availableProviders(entries: readonly ProviderSnapshotEntry[]): string[] {
  const providers: string[] = [];
  for (const entry of entries) {
    if (!entry.enabled || entry.status !== "ready") continue;
    if (!(entry.models ?? []).some((model) => model.isSelectable !== false)) continue;
    providers.push(entry.provider);
  }
  return providers;
}

function sameAutoRouters(
  existing: readonly ModelRouter[],
  generated: readonly ModelRouter[],
): boolean {
  return JSON.stringify(existing.filter(isAutoProviderRouter)) === JSON.stringify(generated);
}
