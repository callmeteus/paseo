import type { TFunction } from "i18next";
import { isSystemErrorText, systemErrorMessage } from "@getpaseo/protocol/provider-error";

/**
 * Cursor reports a spent model session as assistant text, or as a system error:
 * "You've hit your session limit · resets 12:40am (America/Sao_Paulo)".
 *
 * The shared provider-error classifier does not match this sentence. It only
 * believes a short line that opens with a failure verb, and its usage pattern
 * looks for "usage limit", not "session limit". The timeline asks this parser
 * before it renders a reply or the generic error card.
 *
 * The clock is already in the named zone. 12:40am becomes 00:40. This does not
 * shift the hour into the machine's timezone.
 */
const SESSION_LIMIT_LINE =
  /^you['\u2019]ve hit your session limit(?:\s*(?:\u00b7|•|\||-|\u2013|\u2014)\s*resets\s+(.+))?$/i;
const RESET_CLOCK = /^(\d{1,2}):(\d{2})\s*([ap]m)\s+\(([^)]+)\)$/i;

/**
 * America/Sao_Paulo names the city São Paulo. The id drops the accent, and the
 * generic zone name is Brasília, which is a different label than the city.
 */
const ZONE_PLACE: Readonly<Record<string, string>> = {
  "America/Sao_Paulo": "São Paulo",
};

export interface SessionLimitNotice {
  /** The clause after "resets", or null when the line names no reset. */
  reset: string | null;
}

export function readSessionLimitNotice(text: string): SessionLimitNotice | null {
  const line = sessionLimitLine(text);
  if (!line) return null;
  const match = SESSION_LIMIT_LINE.exec(line);
  if (!match) return null;
  const reset = match[1]?.trim();
  return { reset: reset ? reset : null };
}

/** The warning sentence for this notice, or null when the text is not one. */
export function sessionLimitWarning(text: string, t: TFunction): string | null {
  const notice = readSessionLimitNotice(text);
  if (!notice) return null;
  if (!notice.reset) {
    return t("agentStream.sessionLimit.reached");
  }
  const clock = readResetClock(notice.reset);
  if (!clock) {
    return t("agentStream.sessionLimit.resetsRaw", { when: notice.reset });
  }
  return t("agentStream.sessionLimit.resetsAt", { time: clock.time, place: clock.place });
}

/**
 * The notice line. A system error may carry the daemon's code and diagnostic
 * after a blank line; those paragraphs are not part of the sentence. An
 * unprefixed message has to be the sentence alone, so a model discussing the
 * limit in prose keeps its reply.
 */
function sessionLimitLine(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!isSystemErrorText(trimmed)) {
    return SESSION_LIMIT_LINE.test(trimmed) ? trimmed : null;
  }
  const head = systemErrorMessage(trimmed).split("\n\n")[0]?.trim() ?? "";
  return SESSION_LIMIT_LINE.test(head) ? head : null;
}

function readResetClock(reset: string): { time: string; place: string } | null {
  const match = RESET_CLOCK.exec(reset.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  const zone = match[4]?.trim() ?? "";
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (meridiem !== "am" && meridiem !== "pm") return null;
  const place = zonePlace(zone);
  if (!place) return null;
  const hour24 = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  const time = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { time, place };
}

function zonePlace(zone: string): string | null {
  if (!isIanaTimeZone(zone)) return null;
  const known = ZONE_PLACE[zone];
  if (known) return known;
  const city = zone.split("/").pop();
  if (!city) return null;
  return city.replaceAll("_", " ");
}

function isIanaTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
