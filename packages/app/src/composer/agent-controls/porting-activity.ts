import { useSyncExternalStore } from "react";

/**
 * A port that is running right now, keyed by the agent being ported away from.
 * The source chat reads it to show a loading porting marker until the app
 * switches to the destination agent.
 */
export interface PortingActivity {
  toProvider: string;
}

const activityByAgent = new Map<string, PortingActivity>();
const listeners = new Set<() => void>();

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function startPortingActivity(
  serverId: string,
  agentId: string,
  activity: PortingActivity,
): void {
  activityByAgent.set(agentKey(serverId, agentId), activity);
  emit();
}

export function finishPortingActivity(serverId: string, agentId: string): void {
  if (activityByAgent.delete(agentKey(serverId, agentId))) {
    emit();
  }
}

export function getPortingActivity(serverId: string, agentId: string): PortingActivity | null {
  return activityByAgent.get(agentKey(serverId, agentId)) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePortingActivity(serverId: string, agentId: string): PortingActivity | null {
  return useSyncExternalStore(
    subscribe,
    () => activityByAgent.get(agentKey(serverId, agentId)) ?? null,
    () => null,
  );
}
