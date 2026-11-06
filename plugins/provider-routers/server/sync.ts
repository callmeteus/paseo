import type { PaseoApi } from "@getpaseo/client";
import type { ModelRouter } from "@getpaseo/protocol/model-router";
import { omitDisabledModels } from "@getpaseo/protocol/disabled-models";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";

export const AUTO_PROVIDER_ROUTER_PREFIX = "auto-provider:";

export interface SyncResult {
  providers: string[];
  routers: ModelRouter[];
}

function isAutoProviderRouter(router: { id: string }): boolean {
  return router.id.startsWith(AUTO_PROVIDER_ROUTER_PREFIX);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 120)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export async function syncProviderRouters(paseo: PaseoApi): Promise<SyncResult> {
  const snapshot = await paseo.providers.waitForReady({ timeoutMs: 30000 });
  const configResponse = await paseo.config.get();
  const config = configResponse.config;

  const existingRouters = config.modelRouters?.routers ?? [];
  const preserved = existingRouters.filter((router) => !isAutoProviderRouter(router));
  const usedIds = new Set(preserved.map((router) => router.id));

  const activeProviders: string[] = [];
  const generated: ModelRouter[] = [];

  for (const entry of snapshot.entries as ProviderSnapshotEntry[]) {
    if (!entry.enabled || entry.status !== "ready") continue;
    const disabledIds = config.providers?.[entry.provider]?.disabledModelIds;
    const models = omitDisabledModels(entry.models ?? null, disabledIds) ?? [];
    const selectable = models.filter((model) => model.isSelectable !== false);
    if (selectable.length === 0) continue;

    activeProviders.push(entry.provider);

    const targets = selectable
      .slice(0, 32)
      .map((model) => ({ provider: entry.provider, model: model.id }));

    const base = `${AUTO_PROVIDER_ROUTER_PREFIX}${slug(entry.provider) || "provider"}`.slice(
      0,
      128,
    );
    const id = uniqueId(base, usedIds);
    usedIds.add(id);

    generated.push({
      id,
      name: (entry.label ?? entry.provider).slice(0, 80),
      summary: `${selectable.length} models from ${entry.label ?? entry.provider}`.slice(0, 200),
      mode: "distribution",
      targets,
    });
  }

  const nextRouters = [...preserved, ...generated];
  await paseo.config.patch({
    modelRouters: {
      routers: nextRouters,
      ...(config.modelRouters?.defaultRouterId !== undefined
        ? { defaultRouterId: config.modelRouters.defaultRouterId }
        : {}),
    },
  });

  return { providers: activeProviders, routers: generated };
}
