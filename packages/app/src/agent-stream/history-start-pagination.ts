export const HISTORY_START_THRESHOLD_PX = 96;

/**
 * `visible` is owned by the imperative controller and drives the initial
 * viewport reveal. The remaining fields are set by the pure decision helpers
 * that fill the chat window when a conversation opens.
 */
export interface HistoryStartPaginationState {
  status: "dormant" | "ready" | "loading" | "settling" | "latched" | "failed";
  visible?: boolean;
  requestedProgressKey?: string;
  requestObserved?: boolean;
  loadedProgressKey?: string;
}

export interface HistoryStartPaginationInput {
  distanceFromHistoryStart: number;
  isUnderfilled: boolean;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  isReady: boolean;
  progressKey: string | null;
  viewportUnderfilled: boolean;
  followingOutput: boolean;
}

export interface HistoryStartPaginationTransition {
  state: HistoryStartPaginationState;
  shouldLoad: boolean;
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
  state: HistoryStartPaginationState,
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

/** Owns one pagination operation, including the initial viewport reveal. */
export function createHistoryStartPagination(input: {
  initiallyVisible: boolean;
  read: () => HistoryStartPaginationInput | null;
  load: () => Promise<boolean>;
  changed: (state: HistoryStartPaginationState) => void;
  scheduleSettle: () => void;
}) {
  let state: HistoryStartPaginationState = { status: "dormant", visible: input.initiallyVisible };
  let requestedKey: string | null = null;
  let completed = false;
  let fill = false;
  let generation = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const publish = (
    status: HistoryStartPaginationState["status"],
    visible = state.visible ?? false,
  ) => {
    if (status === state.status && visible === state.visible) return;
    state = { status, visible };
    input.changed(state);
  };
  const clear = () => {
    generation++;
    clearTimeout(timeout);
    timeout = undefined;
  };
  const finish = (status: HistoryStartPaginationState["status"]) => {
    clear();
    publish(status, true);
  };
  const fail = () => finish("failed");

  const watchProgress = (geometry: HistoryStartPaginationInput | null) => {
    if (completed && !geometry?.isReady) {
      clearTimeout(timeout);
      timeout = undefined;
    } else if (timeout === undefined) {
      const request = generation;
      timeout = setTimeout(() => {
        timeout = undefined;
        // A completed request waits for its retained view to become measurable again.
        // Unfinished requests still time out even while the view is inactive.
        if (request === generation && (!completed || input.read()?.isReady)) fail();
      }, 15_000);
    }
  };

  const update = () => {
    const geometry = input.read();
    if (isHistoryStartLoadingOperation(state)) watchProgress(geometry);
    if (!geometry) return;
    if (state.status === "loading") {
      if (!completed) return;
      if (geometry.progressKey !== null && geometry.progressKey !== requestedKey) {
        publish("settling");
        input.scheduleSettle();
      } else if (!geometry.hasOlderHistory) {
        finish("dormant");
      }
      return;
    }
    if (state.status === "settling" || state.status === "failed" || !geometry.isReady) return;
    const atStart = geometry.distanceFromHistoryStart <= HISTORY_START_THRESHOLD_PX;
    if (state.status === "dormant" && !geometry.isUnderfilled) {
      publish("dormant", true);
      return;
    }
    if (!atStart || (!geometry.isUnderfilled && state.status !== "ready")) return;
    if (!geometry.hasOlderHistory) {
      finish("dormant");
      return;
    }
    if (geometry.isLoadingOlderHistory || geometry.progressKey === null) return;
    fill = geometry.isUnderfilled;
    requestedKey = geometry.progressKey;
    completed = false;
    publish("loading");
    const request = ++generation;
    watchProgress(geometry);
    void input.load().then(
      (applied) => {
        if (request !== generation) return undefined;
        if (!applied) {
          fail();
          return undefined;
        }
        completed = true;
        update();
        return undefined;
      },
      () => {
        if (request === generation) fail();
      },
    );
  };
  return {
    get state() {
      return state;
    },
    update,
    settle() {
      if (state.status !== "settling") return;
      const geometry = input.read();
      if (!geometry?.isReady) return;
      clear();
      if (fill && !geometry.isUnderfilled) {
        publish("dormant", true);
      } else if (geometry.distanceFromHistoryStart > HISTORY_START_THRESHOLD_PX) {
        publish("ready", true);
      } else if (!geometry.hasOlderHistory) {
        publish("dormant", true);
      } else {
        publish("ready");
        update();
      }
    },
    rearm() {
      if (state.status === "dormant" || state.status === "failed") publish("ready", true);
      update();
    },
    reveal() {
      publish(state.status, true);
    },
    reset(visible: boolean) {
      clear();
      publish("dormant", visible);
    },
    dispose: clear,
  };
}
