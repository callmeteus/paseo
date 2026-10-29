import { useSyncExternalStore } from "react";

/**
 * A target the user picked in an existing chat but has not committed yet.
 *
 * Picking a model or a router never mutates the running chat: a model switch on
 * a different provider ports the conversation (archives the source agent), and a
 * router switch may port it too. Applying the pick on selection would replace
 * the conversation under the user's cursor, so the switch is committed by the
 * next composer send instead.
 */
export interface StagedModelTarget {
  kind: "model";
  targetServerId: string;
  provider: string;
  modelId: string;
  /** Detach the chat from its router when this target commits. */
  clearRouter: boolean;
  /** Explicit router binding for the ported chat. Takes precedence over clearRouter. */
  routerId?: string | null;
}

export interface StagedRouterTarget {
  kind: "router";
  targetServerId: string;
  routerId: string;
}

export type PendingProviderSwitch = StagedModelTarget | StagedRouterTarget;

const pendingByAgent = new Map<string, PendingProviderSwitch>();
const listeners = new Set<() => void>();

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function stageProviderSwitch(
  serverId: string,
  agentId: string,
  next: PendingProviderSwitch,
): void {
  pendingByAgent.set(agentKey(serverId, agentId), next);
  emit();
}

export function clearProviderSwitch(serverId: string, agentId: string): void {
  if (pendingByAgent.delete(agentKey(serverId, agentId))) {
    emit();
  }
}

export function getProviderSwitch(serverId: string, agentId: string): PendingProviderSwitch | null {
  return pendingByAgent.get(agentKey(serverId, agentId)) ?? null;
}

/** Reads the staged switch and clears it in one step, so a send applies it once. */
export function takeProviderSwitch(
  serverId: string,
  agentId: string,
): PendingProviderSwitch | null {
  const pending = getProviderSwitch(serverId, agentId);
  if (pending) {
    clearProviderSwitch(serverId, agentId);
  }
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePendingProviderSwitch(
  serverId: string,
  agentId: string,
): PendingProviderSwitch | null {
  return useSyncExternalStore(
    subscribe,
    () => pendingByAgent.get(agentKey(serverId, agentId)) ?? null,
    () => null,
  );
}

/** True when committing the pick needs a port rather than a plain model change. */
export function requiresProviderPort(input: {
  currentProvider: string | null | undefined;
  currentServerId: string;
  nextProvider: string;
  nextServerId?: string | null;
}): boolean {
  const nextHost = (input.nextServerId ?? "").trim() || input.currentServerId;
  return input.nextProvider !== input.currentProvider || nextHost !== input.currentServerId;
}

/**
 * Retargets a staged model pick at another model. Returns false when nothing is
 * staged or a router is staged, so the caller stages a fresh model target.
 */
export function updateStagedProviderModel(
  serverId: string,
  agentId: string,
  modelId: string,
): boolean {
  const pending = getProviderSwitch(serverId, agentId);
  if (!pending || pending.kind !== "model") {
    return false;
  }
  stageProviderSwitch(serverId, agentId, { ...pending, modelId });
  return true;
}

/** Router the chat is bound to, staged pick first, then the agent's binding. */
export function resolveDisplayRouterId(
  pending: PendingProviderSwitch | null,
  boundRouterId: string | null | undefined,
): string | null {
  if (pending?.kind === "router") {
    return pending.routerId;
  }
  if (pending?.kind === "model" && pending.clearRouter) {
    return null;
  }
  return boundRouterId ?? null;
}

/** Provider shown in the picker: the staged target, or the running agent's. */
export function resolveDisplayProvider(
  pending: PendingProviderSwitch | null,
  currentProvider: string,
): string {
  return pending?.kind === "model" ? pending.provider : currentProvider;
}

/** Model shown in the picker: the staged target, or the active model. */
export function resolveDisplayModelId(
  pending: PendingProviderSwitch | null,
  activeModelId: string | null | undefined,
): string | undefined {
  if (pending?.kind === "model" && pending.modelId) {
    return pending.modelId;
  }
  return activeModelId ?? undefined;
}

export type ProviderSwitchRejection =
  | "agentControls.provider.portingUnsupported"
  | "agentControls.provider.crossHostUnsupported"
  | "agentControls.provider.targetHostDisconnected";

/** What picking a provider should do: stay on this host, or move to another one. */
export type ProviderSwitchPlan =
  | { kind: "host"; targetHost: string }
  | { kind: "reject"; messageKey: ProviderSwitchRejection };

export function planProviderSwitch(input: {
  currentProvider: string | null | undefined;
  currentServerId: string;
  nextProvider: string;
  nextServerId?: string | null;
  supportsProviderSwap: boolean;
  targetSupportsSnapshotTransfer: boolean;
  targetClientConnected: boolean;
}): ProviderSwitchPlan {
  const targetHost = (input.nextServerId ?? "").trim() || input.currentServerId;
  if (targetHost === input.currentServerId) {
    if (
      requiresProviderPort({
        currentProvider: input.currentProvider,
        currentServerId: input.currentServerId,
        nextProvider: input.nextProvider,
      }) &&
      !input.supportsProviderSwap
    ) {
      return { kind: "reject", messageKey: "agentControls.provider.portingUnsupported" };
    }
    return { kind: "host", targetHost };
  }
  if (!input.targetSupportsSnapshotTransfer) {
    return { kind: "reject", messageKey: "agentControls.provider.crossHostUnsupported" };
  }
  if (!input.targetClientConnected) {
    return { kind: "reject", messageKey: "agentControls.provider.targetHostDisconnected" };
  }
  return { kind: "host", targetHost };
}
