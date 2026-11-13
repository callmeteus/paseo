import { describe, expect, it } from "vitest";
import {
  abandonHistoryStartPaginationRequest,
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
  hasOlderHistory: true,
  isLoadingOlderHistory: false,
  isReady: true,
  progressKey: "epoch-1:20",
  viewportUnderfilled: false,
  followingOutput: false,
};

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
});
