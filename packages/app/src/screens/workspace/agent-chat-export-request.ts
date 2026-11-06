import { useSyncExternalStore } from "react";

/**
 * A chat-tab menu asking to export that chat. Kept outside React so the menu,
 * deep in the tab row, can ask without a callback through every tab.
 */
export interface AgentChatExportRequest {
  agentId: string;
  nonce: number;
}

let request: AgentChatExportRequest | null = null;
let nextNonce = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function requestAgentChatExport(agentId: string): void {
  nextNonce += 1;
  request = { agentId, nonce: nextNonce };
  emit();
}

export function clearAgentChatExportRequest(): void {
  if (request === null) return;
  request = null;
  emit();
}

/** One mounted workspace claims the request. A second host in the same commit gets null. */
export function claimAgentChatExportRequest(claimedNonce: number): AgentChatExportRequest | null {
  if (!request || request.nonce !== claimedNonce) return null;
  const claimed = request;
  request = null;
  emit();
  return claimed;
}

export function getAgentChatExportRequest(): AgentChatExportRequest | null {
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentChatExportRequest(): AgentChatExportRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}
