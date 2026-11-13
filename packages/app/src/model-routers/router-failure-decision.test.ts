import { describe, expect, it } from "vitest";
import { decideRouterFailure, MAX_SESSION_REPAIRS } from "./router-failure-decision";

const OVERFLOW =
  "Upstream request failed: [invalid_value] Invalid value for 'tools': maximum number of items is 128.";
const CORRUPTION =
  "Upstream request failed: [invalid_value] Validation: `messages[451].tool_calls[0].function.arguments` must be a valid JSON object string";
const REASONING =
  "Missing required parameter: 'messages[107].reasoning_content'. This model needs the reasoning of every earlier assistant message";
const CRASH = "OpenCode helper server exited (4294967295)";
const QUOTA = "Free usage limit reached";
const UNKNOWN = "model not found";

function decide(
  errorKey: string,
  overrides: Partial<Parameters<typeof decideRouterFailure>[0]> = {},
) {
  return decideRouterFailure({
    errorKey,
    repairChainLength: 0,
    alreadyShrunkTools: false,
    hasRouterTarget: true,
    ...overrides,
  });
}

describe("decideRouterFailure", () => {
  it("shrinks the tool surface instead of repairing an oversized tool list", () => {
    expect(decide(OVERFLOW)).toEqual({ kind: "shrink-tools" });
  });

  it("surfaces the overflow once the shrink already ran", () => {
    expect(decide(OVERFLOW, { alreadyShrunkTools: true })).toEqual({ kind: "surface" });
  });

  it("repairs a corrupt session", () => {
    expect(decide(CORRUPTION)).toEqual({ kind: "repair-session" });
    expect(decide(REASONING)).toEqual({ kind: "repair-session" });
  });

  it("stops repairing once the chain reached the cap", () => {
    expect(decide(CORRUPTION, { repairChainLength: MAX_SESSION_REPAIRS })).toEqual({
      kind: "surface",
    });
    expect(decide(CORRUPTION, { repairChainLength: MAX_SESSION_REPAIRS - 1 })).toEqual({
      kind: "repair-session",
    });
  });

  it("retries a provider crash on the same provider", () => {
    expect(decide(CRASH)).toEqual({ kind: "retry-same" });
  });

  it("ports a retryable failure to the next router target", () => {
    expect(decide(QUOTA)).toEqual({ kind: "port" });
  });

  it("surfaces a retryable failure when the chat has no router", () => {
    expect(decide(QUOTA, { hasRouterTarget: false })).toEqual({ kind: "surface" });
  });

  it("surfaces an unknown failure", () => {
    expect(decide(UNKNOWN)).toEqual({ kind: "surface" });
  });
});
