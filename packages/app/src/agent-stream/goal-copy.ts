import { i18n } from "@/i18n/i18next";
import type { TFunction } from "i18next";

/**
 * The daemon writes `/goal` command feedback as plain English timeline rows so
 * every harness sees the same text. Translate the known shapes for display.
 */
type GoalNotice =
  | { key: "goalNotice.noGoal" }
  | { key: "goalNotice.status"; status: "active" | "paused"; objective: string }
  | { key: "goalNotice.set"; objective: string }
  | { key: "goalNotice.paused"; objective: string }
  | { key: "goalNotice.resumed"; objective: string }
  | { key: "goalNotice.cleared" }
  | { key: "goalNotice.complete"; objective: string }
  | { key: "goalNotice.continuousLimit"; max: string };

function matchGoalNotice(text: string): GoalNotice | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("No goal set.")) return { key: "goalNotice.noGoal" };
  if (trimmed === "Goal cleared.") return { key: "goalNotice.cleared" };

  const status = /^Goal \((active|paused)\):\s*([\s\S]*)$/.exec(trimmed);
  if (status) {
    return {
      key: "goalNotice.status",
      status: status[1] === "paused" ? "paused" : "active",
      objective: status[2],
    };
  }
  const set = /^Goal set:\s*([\s\S]*)$/.exec(trimmed);
  if (set) return { key: "goalNotice.set", objective: set[1] };
  const paused = /^Goal paused:\s*([\s\S]*)$/.exec(trimmed);
  if (paused) return { key: "goalNotice.paused", objective: paused[1] };
  const resumed = /^Goal resumed:\s*([\s\S]*)$/.exec(trimmed);
  if (resumed) return { key: "goalNotice.resumed", objective: resumed[1] };
  const complete = /^Goal complete:\s*([\s\S]*)$/.exec(trimmed);
  if (complete) return { key: "goalNotice.complete", objective: complete[1] };
  const limit = /^Goal did not complete after (\d+) continuation attempts[\s\S]*$/.exec(trimmed);
  if (limit) return { key: "goalNotice.continuousLimit", max: limit[1] };
  return null;
}

export function localizeGoalNotice(text: string, t: TFunction = i18n.t): string {
  const notice = matchGoalNotice(text);
  if (!notice) return text;
  switch (notice.key) {
    case "goalNotice.status":
      return t(notice.key, {
        status: t(notice.status === "paused" ? "goalNotice.pausedLabel" : "goalNotice.activeLabel"),
        objective: notice.objective,
      });
    case "goalNotice.set":
    case "goalNotice.paused":
    case "goalNotice.resumed":
    case "goalNotice.complete":
      return t(notice.key, { objective: notice.objective });
    case "goalNotice.continuousLimit":
      return t(notice.key, { max: notice.max });
    default:
      return t(notice.key);
  }
}
