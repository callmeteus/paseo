import { beforeEach, describe, expect, it } from "vitest";
import { useModelPickerRequestStore } from "./model-picker-request-store";

beforeEach(() => {
  useModelPickerRequestStore.setState({ agentId: null, nonce: 0, retryNonce: 0 });
});

describe("model picker request", () => {
  it("marks the nonce of a request that must retry the rejected prompt", () => {
    useModelPickerRequestStore.getState().request("agent-1", { retryAfterPick: true });
    const afterRetry = useModelPickerRequestStore.getState();
    expect(afterRetry.nonce).toBe(1);
    expect(afterRetry.retryNonce).toBe(afterRetry.nonce);
  });

  it("drops a stale retry intent on the next ordinary picker request", () => {
    useModelPickerRequestStore.getState().request("agent-1", { retryAfterPick: true });
    useModelPickerRequestStore.getState().request("agent-1");
    const afterOrdinary = useModelPickerRequestStore.getState();
    expect(afterOrdinary.nonce).toBe(2);
    expect(afterOrdinary.retryNonce).toBe(0);
  });

  it("keeps the intent for the same agent only", () => {
    useModelPickerRequestStore.getState().request("agent-1", { retryAfterPick: true });
    useModelPickerRequestStore.getState().request("agent-2");
    const otherAgent = useModelPickerRequestStore.getState();
    expect(otherAgent.agentId).toBe("agent-2");
    expect(otherAgent.retryNonce).toBe(0);
  });
});
