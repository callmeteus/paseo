export const HUB_START_STILL_INITIALIZING_MS = 15_000;
export const HUB_START_SLOWER_THAN_EXPECTED_MS = 45_000;
export const HUB_START_STILL_TRYING_MS = 75_000;

export type HubStartStatusId = "starting" | "stillStarting" | "slowerThanExpected" | "stillTrying";

/**
 * Copy shown while the daemon waits for Hub's health check.
 *
 * @param elapsedMs - Time since the starting phase began
 * @returns i18n id under sidebar.automationsPage.progress
 */
export function hubStartStatusId(elapsedMs: number): HubStartStatusId {
  if (elapsedMs >= HUB_START_STILL_TRYING_MS) return "stillTrying";
  if (elapsedMs >= HUB_START_SLOWER_THAN_EXPECTED_MS) return "slowerThanExpected";
  if (elapsedMs >= HUB_START_STILL_INITIALIZING_MS) return "stillStarting";
  return "starting";
}
