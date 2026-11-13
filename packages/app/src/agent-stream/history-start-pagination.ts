export const HISTORY_START_THRESHOLD_PX = 96;

export type HistoryStartPaginationState =
  | { status: "dormant" }
  | { status: "ready" }
  | { status: "loading"; requestedProgressKey: string; requestObserved: boolean }
  | { status: "settling"; loadedProgressKey: string }
  | { status: "latched" };

export interface HistoryStartPaginationInput {
  distanceFromHistoryStart: number;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  isReady: boolean;
  progressKey: string | null;
  viewportUnderfilled: boolean;
  followingOutput: boolean;
}

export function isTranscriptShorterThanViewport(input: {
  contentExtent: number;
  viewportHeight: number;
}): boolean {
  return (
    input.viewportHeight > 0 &&
    input.contentExtent > 0 &&
    input.contentExtent < input.viewportHeight
  );
}

function wantsOlderHistory(input: HistoryStartPaginationInput): boolean {
  if (input.viewportUnderfilled) {
    return true;
  }
  return !input.followingOutput && input.distanceFromHistoryStart <= HISTORY_START_THRESHOLD_PX;
}

export interface HistoryStartPaginationTransition {
  state: HistoryStartPaginationState;
  shouldLoad: boolean;
}

export function createHistoryStartPaginationState(): HistoryStartPaginationState {
  return { status: "dormant" };
}

export function isHistoryStartLoadingOperation(state: HistoryStartPaginationState): boolean {
  return state.status === "loading" || state.status === "settling";
}

export function rearmHistoryStartPagination(
  state: HistoryStartPaginationState,
): HistoryStartPaginationState {
  return state.status === "dormant" || state.status === "latched" ? { status: "ready" } : state;
}

export function abandonHistoryStartPaginationRequest(
  state: HistoryStartPaginationState,
  requestedProgressKey: string,
): HistoryStartPaginationState {
  if (
    state.status !== "loading" ||
    state.requestObserved ||
    state.requestedProgressKey !== requestedProgressKey
  ) {
    return state;
  }
  return { status: "latched" };
}

function evaluateLoadingHistoryStart(
  state: Extract<HistoryStartPaginationState, { status: "loading" }>,
  input: HistoryStartPaginationInput,
): HistoryStartPaginationTransition {
  if (input.progressKey !== null && input.progressKey !== state.requestedProgressKey) {
    return {
      state: { status: "settling", loadedProgressKey: input.progressKey },
      shouldLoad: false,
    };
  }
  if (input.isLoadingOlderHistory && !state.requestObserved) {
    return { state: { ...state, requestObserved: true }, shouldLoad: false };
  }
  if (!input.isLoadingOlderHistory && !input.hasOlderHistory) {
    return { state: { status: "latched" }, shouldLoad: false };
  }
  if (
    state.requestObserved &&
    !input.isLoadingOlderHistory &&
    input.progressKey === state.requestedProgressKey
  ) {
    return { state: { status: "latched" }, shouldLoad: false };
  }
  return { state, shouldLoad: false };
}

export function evaluateHistoryStartPagination(
  state: HistoryStartPaginationState,
  input: HistoryStartPaginationInput,
): HistoryStartPaginationTransition {
  if (state.status === "dormant" && !input.viewportUnderfilled) {
    return { state, shouldLoad: false };
  }
  const armed: HistoryStartPaginationState =
    state.status === "dormant" ? { status: "ready" } : state;
  if (armed.status === "loading") {
    return evaluateLoadingHistoryStart(armed, input);
  }
  if (armed.status === "settling") {
    return { state: armed, shouldLoad: false };
  }

  const shouldLoadOlder = wantsOlderHistory(input);
  if (!shouldLoadOlder) {
    return armed.status === "ready"
      ? { state: armed, shouldLoad: false }
      : { state: { status: "ready" }, shouldLoad: false };
  }
  if (
    armed.status === "latched" ||
    !input.isReady ||
    !input.hasOlderHistory ||
    input.isLoadingOlderHistory ||
    input.progressKey === null
  ) {
    return { state: armed, shouldLoad: false };
  }
  return {
    state: {
      status: "loading",
      requestedProgressKey: input.progressKey,
      requestObserved: false,
    },
    shouldLoad: true,
  };
}

export function settleHistoryStartPagination(
  state: HistoryStartPaginationState,
  input: HistoryStartPaginationInput,
): HistoryStartPaginationTransition {
  if (state.status !== "settling") {
    return { state, shouldLoad: false };
  }
  const shouldLoadOlder = wantsOlderHistory(input);
  if (
    !shouldLoadOlder ||
    !input.isReady ||
    !input.hasOlderHistory ||
    input.isLoadingOlderHistory ||
    input.progressKey === null
  ) {
    return {
      state: shouldLoadOlder ? { status: "latched" } : { status: "ready" },
      shouldLoad: false,
    };
  }
  return {
    state: {
      status: "loading",
      requestedProgressKey: input.progressKey,
      requestObserved: false,
    },
    shouldLoad: true,
  };
}
