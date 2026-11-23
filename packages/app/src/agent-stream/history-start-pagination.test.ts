import { nativeHistoryStartGeometry } from "./native-history-start-geometry";
import { describe, expect, it, vi } from "vitest";
import {
  abandonHistoryStartPaginationRequest,
  createHistoryStartPagination,
  createHistoryStartPaginationState,
  evaluateHistoryStartPagination,
  isHistoryStartLoadingOperation,
  isTranscriptShorterThanViewport,
  rearmHistoryStartPagination,
  settleHistoryStartPagination,
  type HistoryStartPaginationInput,
} from "./history-start-pagination";

function createArmedHistoryStartPaginationState() {
  return rearmHistoryStartPagination(createHistoryStartPaginationState());
}

const visibleHistoryStart: HistoryStartPaginationInput = {
  distanceFromHistoryStart: 0,
  isUnderfilled: true,
  hasOlderHistory: true,
  isLoadingOlderHistory: false,
  isReady: true,
  progressKey: "epoch-1:20",
  viewportUnderfilled: false,
  followingOutput: false,
};

const initial: HistoryStartPaginationInput = { ...visibleHistoryStart, progressKey: "20" };

function harness(initiallyVisible = false) {
  let geometry = { ...initial };
  const requests: Array<(value: boolean) => void> = [];
  let settles = 0;
  const pagination = createHistoryStartPagination({
    initiallyVisible,
    read: () => geometry,
    load: () => new Promise<boolean>((resolve) => requests.push(resolve)),
    changed: () => {},
    scheduleSettle: () => {
      settles++;
    },
  });
  return {
    pagination,
    requests,
    get settles() {
      return settles;
    },
    set(patch: Partial<HistoryStartPaginationInput>) {
      geometry = { ...geometry, ...patch };
      pagination.update();
    },
  };
}

describe("history start pagination", () => {
  it("treats locally revealed history as progress before remote pagination", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const localReveal = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:20:local-60",
    });

    expect(first.shouldLoad).toBe(true);
    expect(localReveal.state).toEqual({
      status: "settling",
      loadedProgressKey: "epoch-1:20:local-60",
    });
  });
  it("waits for user scroll intent before loading a filled window", () => {
    const dormant = createHistoryStartPaginationState();
    const evaluated = evaluateHistoryStartPagination(dormant, {
      ...visibleHistoryStart,
      followingOutput: true,
    });

    expect(evaluated).toEqual({ state: { status: "dormant" }, shouldLoad: false });
  });

  it("loads older history when the open transcript does not fill the window", () => {
    const evaluated = evaluateHistoryStartPagination(createHistoryStartPaginationState(), {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
    });

    expect(evaluated.shouldLoad).toBe(true);
    expect(evaluated.state).toEqual({
      status: "loading",
      requestedProgressKey: "epoch-1:20",
      requestObserved: false,
    });
  });

  it("stops filling once the followed transcript covers the window", () => {
    const started = evaluateHistoryStartPagination(createHistoryStartPaginationState(), {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
    });
    const pageApplied = evaluateHistoryStartPagination(started.state, {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
      progressKey: "epoch-1:0",
    });
    const filled = settleHistoryStartPagination(pageApplied.state, {
      ...visibleHistoryStart,
      followingOutput: true,
      distanceFromHistoryStart: 0,
      progressKey: "epoch-1:0",
    });

    expect(filled).toEqual({ state: { status: "ready" }, shouldLoad: false });
  });

  it("keeps paging while the followed transcript is still shorter than the window", () => {
    const started = evaluateHistoryStartPagination(createHistoryStartPaginationState(), {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
    });
    const pageApplied = evaluateHistoryStartPagination(started.state, {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
      progressKey: "epoch-1:0",
    });
    const stillShort = settleHistoryStartPagination(pageApplied.state, {
      ...visibleHistoryStart,
      followingOutput: true,
      viewportUnderfilled: true,
      progressKey: "epoch-1:0",
    });

    expect(stillShort.shouldLoad).toBe(true);
  });

  it("treats a stretched scroll box as empty only when the rows are shorter than the window", () => {
    expect(isTranscriptShorterThanViewport({ contentExtent: 240, viewportHeight: 800 })).toBe(true);
    expect(isTranscriptShorterThanViewport({ contentExtent: 800, viewportHeight: 800 })).toBe(
      false,
    );
    expect(isTranscriptShorterThanViewport({ contentExtent: 0, viewportHeight: 800 })).toBe(false);
  });

  it("waits for anchored page geometry before authorizing another page", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const inFlight = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      isLoadingOlderHistory: true,
    });
    const pageApplied = evaluateHistoryStartPagination(inFlight.state, {
      ...visibleHistoryStart,
      isLoadingOlderHistory: true,
      progressKey: "epoch-1:10",
    });

    expect([first.shouldLoad, inFlight.shouldLoad, pageApplied.shouldLoad]).toEqual([
      true,
      false,
      false,
    ]);
    expect(pageApplied.state).toEqual({ status: "settling", loadedProgressKey: "epoch-1:10" });
  });

  it("loads one page each time anchored geometry leaves and returns to history start", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const pageApplied = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });
    const settledAway = settleHistoryStartPagination(pageApplied.state, {
      ...visibleHistoryStart,
      distanceFromHistoryStart: 300,
      progressKey: "epoch-1:10",
    });
    const returned = evaluateHistoryStartPagination(settledAway.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });

    expect([
      first.shouldLoad,
      pageApplied.shouldLoad,
      settledAway.shouldLoad,
      returned.shouldLoad,
    ]).toEqual([true, false, false, true]);
  });

  it("continues the same loading operation when anchored geometry remains at history start", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const pageApplied = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });
    const continued = settleHistoryStartPagination(pageApplied.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });

    expect(continued.shouldLoad).toBe(true);
    expect(isHistoryStartLoadingOperation(first.state)).toBe(true);
    expect(isHistoryStartLoadingOperation(pageApplied.state)).toBe(true);
    expect(isHistoryStartLoadingOperation(continued.state)).toBe(true);
  });

  it("latches a request that finishes without cursor progress", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const inFlight = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      isLoadingOlderHistory: true,
    });
    const finished = evaluateHistoryStartPagination(inFlight.state, visibleHistoryStart);
    const duplicate = evaluateHistoryStartPagination(finished.state, visibleHistoryStart);
    const away = evaluateHistoryStartPagination(duplicate.state, {
      ...visibleHistoryStart,
      distanceFromHistoryStart: 300,
    });

    expect(finished.state).toEqual({ status: "latched" });
    expect([finished.shouldLoad, duplicate.shouldLoad, away.shouldLoad]).toEqual([
      false,
      false,
      false,
    ]);
    expect(away.state).toEqual({ status: "ready" });
  });

  it("allows another user attempt after a request finishes without progress", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const inFlight = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      isLoadingOlderHistory: true,
    });
    const failed = evaluateHistoryStartPagination(inFlight.state, visibleHistoryStart);
    const retried = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(failed.state),
      visibleHistoryStart,
    );

    expect(failed.state).toEqual({ status: "latched" });
    expect(retried.shouldLoad).toBe(true);
  });

  it("latches an attempt that becomes invalid before entering flight", () => {
    const requested = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );

    expect(abandonHistoryStartPaginationRequest(requested.state, "epoch-1:20")).toEqual({
      status: "latched",
    });
  });

  it("does not mistake repeated edge observations for a finished request", () => {
    const first = evaluateHistoryStartPagination(
      createArmedHistoryStartPaginationState(),
      visibleHistoryStart,
    );
    const repeated = evaluateHistoryStartPagination(first.state, visibleHistoryStart);

    expect(repeated.state).toBe(first.state);
    expect(repeated.shouldLoad).toBe(false);
  });

  it("waits while history loading is unavailable or already active", () => {
    const state = createArmedHistoryStartPaginationState();

    expect([
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, isReady: false }).shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, hasOlderHistory: false })
        .shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, isLoadingOlderHistory: true })
        .shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, progressKey: null })
        .shouldLoad,
    ]).toEqual([false, false, false, false]);
  });
  it("waits for a delayed request and its committed page before settling", async () => {
    const h = harness();
    h.pagination.update();
    h.set({ progressKey: "10" });
    expect(h.settles).toBe(0);
    h.requests[0](true);
    await Promise.resolve();
    expect(h.settles).toBe(1);
    expect(h.pagination.state.visible).toBe(false);
    h.set({ isUnderfilled: false });
    h.pagination.settle();
    expect(h.pagination.state).toEqual({ status: "dormant", visible: true });
    h.pagination.dispose();
  });
  it("waits for the committed page after a request completes", async () => {
    const h = harness();
    h.pagination.update();
    h.requests[0](true);
    await Promise.resolve();
    expect(h.settles).toBe(0);
    h.set({ progressKey: "10" });
    expect(h.settles).toBe(1);
    h.pagination.dispose();
  });
  it("continues short pages and reveals on exhaustion", async () => {
    const h = harness();
    h.pagination.update();
    h.set({ progressKey: "10" });
    h.requests[0](true);
    await Promise.resolve();
    h.pagination.settle();
    expect(h.requests).toHaveLength(2);
    h.set({ hasOlderHistory: false });
    h.requests[1](true);
    await Promise.resolve();
    expect(h.pagination.state).toEqual({ status: "dormant", visible: true });
    h.pagination.dispose();
  });
  it("releases a failed or stalled request and allows retry", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.pagination.update();
    vi.advanceTimersByTime(15_000);
    expect(h.pagination.state).toEqual({ status: "failed", visible: true });
    h.pagination.rearm();
    expect(h.requests).toHaveLength(2);
    h.requests[1](false);
    await Promise.resolve();
    expect(h.pagination.state.status).toBe("failed");
    h.pagination.dispose();
    vi.useRealTimers();
  });
  it("keeps visible history visible while filling", () => {
    const h = harness(true);
    h.pagination.update();
    expect(h.pagination.state.visible).toBe(true);
    h.pagination.dispose();
  });
  it("does not load a full viewport until user intent and respects inactive views", () => {
    const h = harness();
    h.set({ isUnderfilled: false });
    expect(h.requests).toHaveLength(0);
    h.set({ isReady: false });
    h.pagination.rearm();
    expect(h.requests).toHaveLength(0);
    h.set({ isReady: true });
    expect(h.requests).toHaveLength(1);
    h.pagination.dispose();
  });
  it("preserves the reading position after an anchored page moves away from the start", async () => {
    const h = harness(true);
    h.set({ isUnderfilled: false });
    h.pagination.rearm();
    h.set({ progressKey: "10", distanceFromHistoryStart: 300 });
    h.requests[0](true);
    await Promise.resolve();
    h.pagination.settle();
    expect(h.requests).toHaveLength(1);
    h.set({ distanceFromHistoryStart: 0 });
    expect(h.requests).toHaveLength(2);
    h.pagination.dispose();
  });
});

it("ignores a timed-out response after the reader retries", async () => {
  vi.useFakeTimers();
  const h = harness();
  h.pagination.update();
  vi.advanceTimersByTime(15_000);
  h.pagination.rearm();
  h.requests[0](true);
  await Promise.resolve();
  expect(h.pagination.state.status).toBe("loading");
  expect(h.settles).toBe(0);
  h.requests[1](false);
  await Promise.resolve();
  expect(h.pagination.state.status).toBe("failed");
  h.pagination.dispose();
  vi.useRealTimers();
});

it("does not repeat a successful page that made no progress", async () => {
  vi.useFakeTimers();
  const h = harness();
  h.pagination.update();
  h.requests[0](true);
  await Promise.resolve();
  h.pagination.update();
  expect(h.requests).toHaveLength(1);
  vi.advanceTimersByTime(15_000);
  expect(h.pagination.state).toEqual({ status: "failed", visible: true });
  h.pagination.dispose();
  vi.useRealTimers();
});

it("waits until the cursor and active history are available", () => {
  const h = harness();
  h.set({ isReady: false, progressKey: null });
  h.set({ isReady: true, isLoadingOlderHistory: true });
  h.set({ isLoadingOlderHistory: false });
  expect(h.requests).toHaveLength(0);
  h.set({ progressKey: "20" });
  expect(h.requests).toHaveLength(1);
  h.pagination.dispose();
});

it("reveals immediately on exhausted history without offering retry", () => {
  const h = harness();
  h.set({ hasOlderHistory: false });
  expect(h.requests).toHaveLength(0);
  expect(h.pagination.state).toEqual({ status: "dormant", visible: true });
  h.pagination.dispose();
});

it("keeps a settled page pending while its view is inactive", async () => {
  const h = harness();
  h.pagination.update();
  h.set({ progressKey: "10" });
  h.requests[0](true);
  await Promise.resolve();
  h.set({ isReady: false });
  h.pagination.settle();
  expect(h.pagination.state.status).toBe("settling");
  expect(h.requests).toHaveLength(1);
  h.set({ isReady: true, isUnderfilled: false });
  h.pagination.settle();
  expect(h.pagination.state).toEqual({ status: "dormant", visible: true });
  h.pagination.dispose();
});

it("keeps cached history visible after synchronization and subsequent pagination", async () => {
  const h = harness();
  h.pagination.reveal();
  h.pagination.update();
  h.set({ progressKey: "10" });
  h.requests[0](true);
  await Promise.resolve();
  h.pagination.settle();
  expect(h.pagination.state.visible).toBe(true);
  expect(h.requests).toHaveLength(2);
  h.pagination.dispose();
});

it.each([true, false])(
  "handles native padding when short history has older=%s",
  (hasOlderHistory) => {
    const geometry = nativeHistoryStartGeometry({
      contentHeight: 825,
      viewportHeight: 700,
      offsetY: 125,
      topOverlayInset: 123,
    });
    let requests = 0;
    const pagination = createHistoryStartPagination({
      initiallyVisible: false,
      read: () => ({ ...initial, ...geometry, hasOlderHistory }),
      load: () => {
        requests++;
        return new Promise<boolean>(() => {});
      },
      changed: () => {},
      scheduleSettle: () => {},
    });
    pagination.update();
    expect(requests).toBe(hasOlderHistory ? 1 : 0);
    expect(pagination.state.visible).toBe(!hasOlderHistory);
    pagination.dispose();
  },
);

it("uses the forward native list's top edge to request older history", () => {
  let offsetY = 1300;
  let requests = 0;
  const pagination = createHistoryStartPagination({
    initiallyVisible: true,
    read: () => ({
      ...initial,
      ...nativeHistoryStartGeometry({
        contentHeight: 2000,
        viewportHeight: 700,
        offsetY,
        topOverlayInset: 123,
      }),
    }),
    load: () => {
      requests++;
      return new Promise<boolean>(() => {});
    },
    changed: () => {},
    scheduleSettle: () => {},
  });
  pagination.rearm();
  expect(requests).toBe(0);
  offsetY = 155;
  pagination.update();
  expect(requests).toBe(1);
  pagination.dispose();
});

it.each([null, { ...initial, isReady: false }])(
  "resumes a completed page after its view stays inactive beyond the deadline (%j)",
  async (inactive) => {
    vi.useFakeTimers();
    let geometry: HistoryStartPaginationInput | null = { ...initial };
    let complete!: (applied: boolean) => void;
    let requests = 0;
    const pagination = createHistoryStartPagination({
      initiallyVisible: false,
      read: () => geometry,
      load: () => {
        requests++;
        return new Promise<boolean>((resolve) => {
          complete = resolve;
        });
      },
      changed: () => {},
      scheduleSettle: () => {},
    });
    try {
      pagination.update();
      geometry = inactive;
      pagination.update();
      complete(true);
      await Promise.resolve();
      vi.advanceTimersByTime(30_000);
      expect(pagination.state.status).toBe("loading");
      geometry = { ...initial, progressKey: "10" };
      pagination.update();
      expect(pagination.state.status).toBe("settling");
      geometry = inactive;
      pagination.update();
      pagination.settle();
      vi.advanceTimersByTime(30_000);
      expect(pagination.state.status).toBe("settling");
      geometry = { ...initial, progressKey: "10" };
      pagination.update();
      pagination.settle();
      expect(requests).toBe(2);
      expect(pagination.state.status).toBe("loading");
      vi.advanceTimersByTime(15_000);
      expect(pagination.state.status).toBe("failed");
    } finally {
      pagination.dispose();
      vi.useRealTimers();
    }
  },
);
