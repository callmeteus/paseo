import { useSyncExternalStore } from "react";

/**
 * A provider/host change the user picked but has not committed yet. Porting
 * archives the current agent and creates a new one, so applying it on pick would
 * replace the conversation under the user's cursor. The switch is committed by
 * the next composer send instead.
 */
export interface PendingProviderSwitch {
  targetServerId: string;
  provider: string;
  modelId: string;
}

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

/** Retargets a staged pick at another model. Returns false when nothing is staged. */
export function updateStagedProviderModel(
  serverId: string,
  agentId: string,
  modelId: string,
): boolean {
  const pending = getProviderSwitch(serverId, agentId);
  if (!pending) {
    return false;
  }
  stageProviderSwitch(serverId, agentId, { ...pending, modelId });
  return true;
}

/** Provider shown in the picker: the staged target, or the running agent's. */
export function resolveDisplayProvider(
  pending: PendingProviderSwitch | null,
  currentProvider: string,
): string {
  return pending ? pending.provider : currentProvider;
}

/** Model shown in the picker: the staged target, or the active model. */
export function resolveDisplayModelId(
  pending: PendingProviderSwitch | null,
  activeModelId: string | null | undefined,
): string | undefined {
  if (pending && pending.modelId) {
    return pending.modelId;
  }
  return activeModelId ?? undefined;
}

export type ProviderSwitchRejection =
  | "agentControls.provider.portingUnsupported"
  | "agentControls.provider.crossHostUnsupported"
  | "agentControls.provider.targetHostDisconnected";

/** What picking a provider should do right now: change the model, stage, or refuse. */
export type ProviderSwitchPlan =
  | { kind: "model" }
  | { kind: "reject"; messageKey: ProviderSwitchRejection }
  | { kind: "stage"; targetHost: string };

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
  if (!requiresProviderPort(input)) {
    return { kind: "model" };
  }
  if (targetHost === input.currentServerId) {
    return input.supportsProviderSwap
      ? { kind: "stage", targetHost }
      : { kind: "reject", messageKey: "agentControls.provider.portingUnsupported" };
  }
  if (!input.targetSupportsSnapshotTransfer) {
    return { kind: "reject", messageKey: "agentControls.provider.crossHostUnsupported" };
  }
  if (!input.targetClientConnected) {
    return { kind: "reject", messageKey: "agentControls.provider.targetHostDisconnected" };
  }
  return { kind: "stage", targetHost };
}
