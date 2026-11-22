export type MobilePanelGestureDirection = -1 | 1;
export type MobilePanelGestureIntent = "activate" | "fail" | "wait";

/** How far from the window edge an edge-only open gesture may start. */
export const MOBILE_PANEL_OPEN_EDGE_WIDTH = 32;

/**
 * Where an edge-only open gesture started. Phone web opens drawers only from the edge they slide in
 * from: interior horizontal scrollers (terminals, code blocks, diffs) keep their swipes there.
 */
export interface MobilePanelOpenEdge {
  startX: number;
  windowWidth: number;
}

function startsAtOpenEdge(edge: MobilePanelOpenEdge, direction: MobilePanelGestureDirection) {
  "worklet";
  return direction === 1
    ? edge.startX <= MOBILE_PANEL_OPEN_EDGE_WIDTH
    : edge.startX >= edge.windowWidth - MOBILE_PANEL_OPEN_EDGE_WIDTH;
}

/**
 * The left-edge gate exists so a mouse drag on the web can still select a paragraph
 * instead of opening a panel. A finger has no such conflict, so on touch devices the
 * swipe may start anywhere — which is the only way to reach the drawer from the middle
 * of a chat.
 */
export function isOutsideOpenGestureEdge(input: {
  isWeb: boolean;
  isTouchPointer: boolean;
  touchStartX: number;
  edgeWidth: number;
}): boolean {
  "worklet";
  if (!input.isWeb || input.isTouchPointer) {
    return false;
  }
  return input.touchStartX > input.edgeWidth;
}

export function resolveMobilePanelGestureIntent(input: {
  enabled: boolean;
  deltaX: number;
  deltaY: number;
  direction: MobilePanelGestureDirection;
  openGesturesBlocked: boolean;
  /** Required start edge for opening gestures, or `null` when they may start anywhere. */
  openEdge: MobilePanelOpenEdge | null;
}): MobilePanelGestureIntent {
  "worklet";
  if (!input.enabled || input.openGesturesBlocked) {
    return "fail";
  }
  if (input.openEdge && !startsAtOpenEdge(input.openEdge, input.direction)) {
    return "fail";
  }
  const directedDelta = input.deltaX * input.direction;
  const absDeltaX = Math.abs(input.deltaX);
  const absDeltaY = Math.abs(input.deltaY);
  if (directedDelta <= -10 || (absDeltaY > 10 && absDeltaY > absDeltaX)) {
    return "fail";
  }
  if (directedDelta >= 15 && absDeltaX > absDeltaY) {
    return "activate";
  }
  return "wait";
}
