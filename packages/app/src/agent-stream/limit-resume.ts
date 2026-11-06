import { classifyProviderError, readProviderErrorText } from "@getpaseo/protocol/provider-error";
import {
  readSessionLimitClock,
  readSessionLimitNotice,
  type SessionLimitClock,
} from "./session-limit";

/** A usage window reduced to the fields that say when a spent limit returns. */
export interface UsageResetWindow {
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
}

export interface UsageResetReport {
  sourceId: string;
  report:
    | { status: "available"; windows: readonly UsageResetWindow[] }
    | { status: "unavailable" | "error" };
}

/** Past this, a checked chat is dropped instead of resumed. The user is no longer waiting on it. */
const LATE_GRACE_MS = 6 * 60 * 60 * 1000;

export type LimitResumeAction = "send" | "wait" | "drop";

/**
 * The next time `clock` happens in its zone, strictly after `now` when that
 * minute has already started. Returns null when the zone cannot be formatted.
 */
export function nextZonedClock(clock: SessionLimitClock, now: number): number | null {
  const parts = zonedParts(now, clock.timeZone);
  if (!parts) return null;
  let date = { year: parts.year, month: parts.month, day: parts.day };
  const current = parts.hour * 60 + parts.minute;
  const target = clock.hour * 60 + clock.minute;
  const passed = current > target || (current === target && parts.second > 0);
  if (passed) {
    date = addCalendarDay(date.year, date.month, date.day);
  }
  return wallToUtc(clock.timeZone, date.year, date.month, date.day, clock.hour, clock.minute);
}

/**
 * When a provider's usage says the block lifts.
 *
 * Windows that are already full win: the soonest of those resets is the first
 * moment quota comes back. If the meter has not caught up to the error, the
 * soonest future reset of any window is used instead.
 */
export function soonestUsageReset(
  windows: readonly UsageResetWindow[],
  now: number,
): number | null {
  const exhausted = windows.filter(isExhaustedWindow);
  const pool = exhausted.length > 0 ? exhausted : windows;
  let soonest: number | null = null;
  for (const window of pool) {
    const at = parseReset(window.resetsAt);
    if (at == null || at <= now) continue;
    if (soonest == null || at < soonest) soonest = at;
  }
  return soonest;
}

/** Windows of the provider this chat runs on. Another CLI's reset is not this chat's. */
export function usageResetWindows(
  reports: readonly UsageResetReport[],
  provider: string | null | undefined,
): UsageResetWindow[] {
  if (!provider) return [];
  const windows: UsageResetWindow[] = [];
  for (const entry of reports) {
    if (entry.sourceId !== provider || entry.report.status !== "available") continue;
    windows.push(...entry.report.windows);
  }
  return windows;
}

/**
 * When this chat can continue. A session-limit sentence carries its own clock
 * and that clock wins. Anything else uses the provider's usage windows.
 */
export function resolveLimitResumeAt(input: {
  text: string;
  windows: readonly UsageResetWindow[];
  now: number;
}): number | null {
  const clock = readSessionLimitClock(input.text);
  if (clock) {
    const at = nextZonedClock(clock, input.now);
    if (at != null) return at;
  }
  if (!readSessionLimitNotice(input.text) && !isUsageLimitText(input.text)) return null;
  return soonestUsageReset(input.windows, input.now);
}

/** The checkbox exists only for this chat, only while a reset is still ahead, and never under a router. */
export function limitResumeIsOffered(input: {
  routerId: string | null | undefined;
  resetAt: number | null;
  now: number;
}): boolean {
  if (input.resetAt == null || input.resetAt <= input.now) return false;
  return !hasRouter(input.routerId);
}

/**
 * What to do with a chat the user asked to resume.
 * A router bound after the check drops it: the router already changes model.
 */
export function limitResumeAction(input: {
  routerId: string | null | undefined;
  resetAt: number;
  now: number;
}): LimitResumeAction {
  if (hasRouter(input.routerId)) return "drop";
  if (input.now + 250 < input.resetAt) return "wait";
  if (input.now - input.resetAt > LATE_GRACE_MS) return "drop";
  return "send";
}

/** Session-limit text, or a usage-limit failure. Ordinary replies are not notices. */
export function isLimitResumeNotice(text: string): boolean {
  if (readSessionLimitNotice(text)) return true;
  return isUsageLimitText(text);
}

/** The newest notice in the transcript. Older limits keep their warning and do not grow a second checkbox. */
export function latestLimitResumeItemId(
  items: readonly { id: string; text: string | null }[],
): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.text && isLimitResumeNotice(item.text)) return item.id;
  }
  return null;
}

function isUsageLimitText(text: string): boolean {
  const error = readProviderErrorText(text);
  return error != null && classifyProviderError(error) === "usage_limit";
}

function hasRouter(routerId: string | null | undefined): boolean {
  return Boolean(routerId?.trim());
}

function isExhaustedWindow(window: UsageResetWindow): boolean {
  if (window.usedPct != null && window.usedPct >= 100) return true;
  return window.remainingPct != null && window.remainingPct <= 0;
}

function parseReset(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(utcMs: number, timeZone: string): ZonedParts | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMs));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      formatted.find((entry) => entry.type === type)?.value;
    const year = Number(part("year"));
    const month = Number(part("month"));
    const day = Number(part("day"));
    const hour = Number(part("hour"));
    const minute = Number(part("minute"));
    const second = Number(part("second"));
    if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
    return { year, month, day, hour: hour === 24 ? 0 : hour, minute, second };
  } catch {
    return null;
  }
}

function zoneOffsetMs(timeZone: string, utcMs: number): number | null {
  const parts = zonedParts(utcMs, timeZone);
  if (!parts) return null;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - utcMs;
}

function wallToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zoneOffsetMs(timeZone, guess);
  if (offset == null) return null;
  let utc = guess - offset;
  const corrected = zoneOffsetMs(timeZone, utc);
  if (corrected != null && corrected !== offset) utc = guess - corrected;
  return utc;
}

function addCalendarDay(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}
