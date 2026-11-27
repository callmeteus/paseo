import { useSyncExternalStore } from "react";

export interface LinkContextMenuRequest {
  url: string;
  x: number;
  y: number;
}

let request: LinkContextMenuRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function openLinkContextMenu(next: LinkContextMenuRequest): void {
  request = next;
  emit();
}

export function closeLinkContextMenu(): void {
  if (request !== null) {
    request = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLinkContextMenuRequest(): LinkContextMenuRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => request,
    () => null,
  );
}

type OpenInPaseoHandler = (url: string) => void;
let openInPaseoHandler: OpenInPaseoHandler | null = null;

/** The workspace screen owns the browser-tab opener; register it while mounted. */
export function setOpenLinkInPaseoHandler(handler: OpenInPaseoHandler | null): void {
  openInPaseoHandler = handler;
}

export function canOpenLinkInPaseo(): boolean {
  return openInPaseoHandler !== null;
}

export function openLinkInPaseo(url: string): void {
  openInPaseoHandler?.(url);
}
