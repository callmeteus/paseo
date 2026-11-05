export type MobilePanelGestureDirection = -1 | 1;
export type MobilePanelGestureIntent = "activate" | "fail" | "wait";

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
  deltaX: number;
  deltaY: number;
  direction: MobilePanelGestureDirection;
  openGesturesBlocked: boolean;
}): MobilePanelGestureIntent {
  "worklet";
  if (input.openGesturesBlocked) {
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
