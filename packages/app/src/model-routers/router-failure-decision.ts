import {
  isProviderCrashFailure,
  isRetryableRouterFailure,
  isSessionCorruptionFailure,
  isToolSurfaceOverflowFailure,
} from "@getpaseo/protocol/model-router";

/**
 * A repair that already failed on a repair is not worth repeating: the provider
 * keeps rejecting the same request, and every attempt archives another chat and
 * navigates the user away from the tab they were reading.
 */
export const MAX_SESSION_REPAIRS = 2;

export type RouterFailureAction =
  | { kind: "retry-same" }
  | { kind: "repair-session" }
  | { kind: "shrink-tools" }
  | { kind: "port" }
  | { kind: "surface" };

/**
 * Decides what a failed chat should do next.
 *
 * The order matters. A tool-surface overflow and a corrupt session look alike
 * upstream (`[invalid_value]`) but need opposite responses: a fresh session
 * sends the same oversized tool list and fails again, while shrinking the list
 * would not fix a malformed stored tool call.
 *
 * @param input - The failure text plus what has already been tried
 * @returns The action the caller should run
 */
export function decideRouterFailure(input: {
  errorKey: string;
  repairChainLength: number;
  alreadyShrunkTools: boolean;
  hasRouterTarget: boolean;
}): RouterFailureAction {
  const failure = { error: input.errorKey };

  if (isToolSurfaceOverflowFailure(failure)) {
    return input.alreadyShrunkTools ? { kind: "surface" } : { kind: "shrink-tools" };
  }

  if (isSessionCorruptionFailure(failure)) {
    if (input.repairChainLength >= MAX_SESSION_REPAIRS) return { kind: "surface" };
    return { kind: "repair-session" };
  }

  if (isProviderCrashFailure(failure)) {
    return { kind: "retry-same" };
  }

  if (isRetryableRouterFailure(failure)) {
    return input.hasRouterTarget ? { kind: "port" } : { kind: "surface" };
  }

  return { kind: "surface" };
}
