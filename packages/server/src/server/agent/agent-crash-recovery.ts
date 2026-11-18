import { isProviderCrashFailure } from "@getpaseo/protocol/model-router";

/** Matches the app's crash retry budget so a failed daemon never outlasts the old behavior. */
export const MAX_DAEMON_CRASH_RETRIES = 5;

export type CrashRecoveryDecision = "retry" | "give-up" | "none";

/**
 * A provider that died mid-turn gets a bounded number of daemon retries. Anything
 * else keeps the current contract: the prompt is dropped back to the composer and
 * the error card stays. `fromHistory` replays an old turn and never triggers work.
 */
export function resolveCrashRecovery(input: {
  event: { error?: string | null; code?: string | null; diagnostic?: string | null };
  fromHistory: boolean;
  attempts: number;
}): CrashRecoveryDecision {
  if (input.fromHistory || !isProviderCrashFailure(input.event)) return "none";
  if (input.attempts >= MAX_DAEMON_CRASH_RETRIES) return "give-up";
  return "retry";
}
