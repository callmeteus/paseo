import { isNative } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import {
  ChevronRight,
  FileSymlink,
  Info,
  MicVocal,
  TriangleAlertIcon,
  XCircle,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { withUnistyles } from "react-native-unistyles";

export const MessageOuterSpacingContext = createContext(false);

export function MessageOuterSpacingProvider({
  disableOuterSpacing,
  children,
}: {
  disableOuterSpacing: boolean;
  children: ReactNode;
}) {
  return (
    <MessageOuterSpacingContext.Provider value={disableOuterSpacing}>
      {children}
    </MessageOuterSpacingContext.Provider>
  );
}

function useDisableOuterSpacing(disableOuterSpacing: boolean | undefined) {
  const contextValue = useContext(MessageOuterSpacingContext);
  return disableOuterSpacing ?? contextValue;
}
const WEB_TOOLCALL_SHIMMER_KEYFRAME_ID = "paseo-toolcall-shimmer-keyframes";
const WEB_TOOLCALL_SHIMMER_ANIMATION_NAME = "paseo-toolcall-shimmer";
const ThemedMicVocal = withUnistyles(MicVocal);
const ThemedFileSymlinkIcon = withUnistyles(FileSymlink);
const ThemedTriangleAlertIcon = withUnistyles(TriangleAlertIcon);
const ThemedChevronRightIcon = withUnistyles(ChevronRight);
const ThemedNotificationInfo = withUnistyles(Info);
const ThemedNotificationWarning = withUnistyles(TriangleAlertIcon);
const ThemedNotificationError = withUnistyles(XCircle);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.mutedForeground,
});
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const infoColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[300] });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS = `
  @keyframes ${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: var(--paseo-shimmer-start, -200px) 0;
    }
    100% {
      background-position: var(--paseo-shimmer-end, 200px) 0;
    }
  }
`;
let webToolCallShimmerRegistered = false;
const SCROLL_EDGE_EPSILON = 0.5;

// Font size for stream metadata (timestamps, durations, live elapsed timer).
// Lives between theme.fontSize.sm (12) and theme.fontSize.base (14); no token.
export const STREAM_METADATA_FONT_SIZE = 13;
type ScrollAxis = "x" | "y";

function ensureWebToolCallShimmerKeyframes() {
  if (isNative) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_TOOLCALL_SHIMMER_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS) {
      existing.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
    }
    webToolCallShimmerRegistered = true;
    return;
  }
  if (webToolCallShimmerRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_TOOLCALL_SHIMMER_KEYFRAME_ID;
  styleElement.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webToolCallShimmerRegistered = true;
}

function getWheelEventElementTarget(event: WheelEvent, fallback: HTMLElement): HTMLElement {
  const { target } = event;
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }
  return fallback;
}

function canElementScrollInDirection(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  const overflow = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;
  const isScrollableOverflow =
    overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  if (!isScrollableOverflow) {
    return false;
  }

  const scrollPosition = axis === "x" ? element.scrollLeft : element.scrollTop;
  const scrollSize =
    axis === "x"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
  if (scrollSize <= SCROLL_EDGE_EPSILON) {
    return false;
  }

  if (delta > 0) {
    return scrollPosition < scrollSize - SCROLL_EDGE_EPSILON;
  }
  return scrollPosition > SCROLL_EDGE_EPSILON;
}

function canScrollInsideDetailFromTarget(
  detailRoot: HTMLElement,
  startElement: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  let current: HTMLElement | null = startElement;
  while (current) {
    if (canElementScrollInDirection(current, axis, delta)) {
      return true;
    }
    if (current === detailRoot) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function shouldStopDetailWheelPropagation(detailRoot: HTMLElement, event: WheelEvent): boolean {
  const startElement = getWheelEventElementTarget(event, detailRoot);
  const verticalDelta = event.deltaY;
  let horizontalDelta: number;
  if (event.deltaX !== 0) horizontalDelta = event.deltaX;
  else if (event.shiftKey) horizontalDelta = event.deltaY;
  else horizontalDelta = 0;

  const hasVerticalIntent = Math.abs(verticalDelta) > SCROLL_EDGE_EPSILON;
  const hasHorizontalIntent = Math.abs(horizontalDelta) > SCROLL_EDGE_EPSILON;
  if (!hasVerticalIntent && !hasHorizontalIntent) {
    return false;
  }

  const canScrollVertically = hasVerticalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "y", verticalDelta)
    : false;
  const canScrollHorizontally = hasHorizontalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "x", horizontalDelta)
    : false;

  if (hasVerticalIntent && hasHorizontalIntent) {
    const isVerticalDominant = Math.abs(verticalDelta) >= Math.abs(horizontalDelta);
    return isVerticalDominant
      ? canScrollVertically || canScrollHorizontally
      : canScrollHorizontally || canScrollVertically;
  }

  if (hasVerticalIntent) {
    return canScrollVertically;
  }
  return canScrollHorizontally;
}

export {
  useDisableOuterSpacing,
  WEB_TOOLCALL_SHIMMER_KEYFRAME_ID,
  WEB_TOOLCALL_SHIMMER_ANIMATION_NAME,
  ThemedMicVocal,
  ThemedFileSymlinkIcon,
  ThemedTriangleAlertIcon,
  ThemedChevronRightIcon,
  ThemedNotificationInfo,
  ThemedNotificationWarning,
  ThemedNotificationError,
  foregroundColorMapping,
  foregroundMutedColorMapping,
  mutedForegroundColorMapping,
  destructiveColorMapping,
  infoColorMapping,
  warningColorMapping,
  WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS,
  ensureWebToolCallShimmerKeyframes,
  getWheelEventElementTarget,
  canElementScrollInDirection,
  canScrollInsideDetailFromTarget,
  shouldStopDetailWheelPropagation,
};
