import { useSyncExternalStore } from "react";

/**
 * Reveals a workspace row after it moved to another folder or workspace.
 *
 * The move sheets only know a `serverId` and `workspaceId`, and either list mode may be the one
 * rendering the row, so the request lives here instead of in a list component. Rows and the scroll
 * view register themselves; the list that owns the request expands the collapsed section first.
 */
export interface SidebarRevealRequest {
  workspaceKey: string;
  requestedAt: number;
  /** Distinguishes two reveals of the same row, so an effect reacts to both. */
  nonce: number;
}

export interface SidebarMeasurableNode {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
}

export interface SidebarScrollNode extends SidebarMeasurableNode {
  scrollTo: (options: { y: number; animated?: boolean }) => void;
}

export interface SidebarScrollTargetInput {
  rowTop: number;
  rowHeight: number;
  viewportTop: number;
  viewportHeight: number;
  offsetY: number;
  margin?: number;
}

const REVEAL_MARGIN = 12;
const REVEAL_FRAME_BUDGET = 24;
/**
 * A move sheet can close while the sidebar is unmounted (compact layouts keep it closed). Reveals
 * that old are dropped rather than scrolling the list the next time it happens to open.
 */
const REVEAL_EXPIRY_MS = 5_000;

let request: SidebarRevealRequest | null = null;
let requestNonce = 0;
const listeners = new Set<() => void>();

let scrollNode: SidebarScrollNode | null = null;
let scrollOffsetY = 0;
const rowNodes = new Map<string, SidebarMeasurableNode>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function workspaceKeyForSidebarRow(input: {
  serverId: string;
  workspaceId: string;
}): string {
  return `${input.serverId}:${input.workspaceId}`;
}

export function requestSidebarReveal(workspaceKey: string): void {
  if (!workspaceKey) return;
  requestNonce += 1;
  request = { workspaceKey, requestedAt: Date.now(), nonce: requestNonce };
  emit();
}

export function useSidebarRevealRequest(): SidebarRevealRequest | null {
  return useSyncExternalStore(subscribe, getSidebarRevealRequest, getSidebarRevealRequest);
}

export function getSidebarRevealRequest(): SidebarRevealRequest | null {
  return request;
}

export function isSidebarRevealExpired(reveal: SidebarRevealRequest): boolean {
  return Date.now() - reveal.requestedAt > REVEAL_EXPIRY_MS;
}

export function clearSidebarReveal(nonce: number): void {
  if (request?.nonce !== nonce) return;
  request = null;
  emit();
}

export function registerSidebarScrollNode(node: unknown): void {
  scrollNode = isSidebarScrollNode(node) ? node : null;
  if (!scrollNode) {
    scrollOffsetY = 0;
  }
}

export function registerSidebarRowNode(workspaceKey: string, node: unknown): void {
  if (isSidebarMeasurableNode(node)) {
    rowNodes.set(workspaceKey, node);
  } else {
    rowNodes.delete(workspaceKey);
  }
}

function isSidebarMeasurableNode(value: unknown): value is SidebarMeasurableNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<SidebarMeasurableNode>).measureInWindow === "function"
  );
}

function isSidebarScrollNode(value: unknown): value is SidebarScrollNode {
  return (
    isSidebarMeasurableNode(value) &&
    typeof (value as Partial<SidebarScrollNode>).scrollTo === "function"
  );
}

export function setSidebarScrollOffset(offsetY: number): void {
  scrollOffsetY = offsetY;
}

/**
 * Absolute offset that brings the row inside the viewport, or `null` when it already is. Aligning
 * a row taller than the viewport to the top keeps its title visible.
 */
export function resolveSidebarScrollTarget(input: SidebarScrollTargetInput): number | null {
  const margin = input.margin ?? REVEAL_MARGIN;
  const top = input.viewportTop + margin;
  const bottom = input.viewportTop + input.viewportHeight - margin;
  const rowBottom = input.rowTop + input.rowHeight;
  if (input.rowTop >= top && rowBottom <= bottom) return null;
  const delta = input.rowTop < top ? input.rowTop - top : rowBottom - bottom;
  return Math.max(0, input.offsetY + delta);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });
}

function scrollRowIntoView(workspaceKey: string): boolean {
  const host = scrollNode;
  const row = rowNodes.get(workspaceKey);
  if (!host || !row) return false;
  row.measureInWindow((_x, rowTop, _width, rowHeight) => {
    host.measureInWindow((_hostX, viewportTop, _hostWidth, viewportHeight) => {
      const target = resolveSidebarScrollTarget({
        rowTop,
        rowHeight,
        viewportTop,
        viewportHeight,
        offsetY: scrollOffsetY,
      });
      if (target === null) return;
      host.scrollTo({ y: target, animated: true });
    });
  });
  return true;
}

/**
 * Scrolls the mounted sidebar to a row. Measured a frame at a time so a row inside a section the
 * caller just expanded is found after it renders, and reports whether the row was reached.
 */
export async function revealSidebarWorkspaceRow(workspaceKey: string): Promise<boolean> {
  for (let frame = 0; frame < REVEAL_FRAME_BUDGET; frame += 1) {
    if (scrollRowIntoView(workspaceKey)) return true;
    await nextFrame();
  }
  return false;
}

/** Test seam: drops every registration so one test cannot reveal into the next one's list. */
export function resetSidebarReveal(): void {
  request = null;
  requestNonce = 0;
  listeners.clear();
  scrollNode = null;
  scrollOffsetY = 0;
  rowNodes.clear();
}
