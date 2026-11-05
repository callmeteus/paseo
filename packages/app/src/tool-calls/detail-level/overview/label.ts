import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatThoughtDuration } from "@/utils/thought-text";
import { countSummarizedToolCalls, type OverviewSummary } from "./model";

type GroupAction = "explored" | "edited" | "ran" | "skipped";

interface CountedPart {
  key: "files" | "exploredFiles" | "searches" | "fetches" | "commands" | "tools" | "agents";
  count: number;
}

interface GroupLabelPlan {
  action: GroupAction;
  parts: readonly CountedPart[];
  /** `+12 -3`, already rendered. Not translated: it is notation, not prose. */
  fileChangeStats?: string;
}

/**
 * Mirrors Cursor's priority chain: a block of edits leads with the edits, a block of
 * shell commands leads with "Ran", a block where every write was rejected reads
 * "Skipped", and everything else reads "Explored".
 */
export function planGroupLabel(summary: OverviewSummary): GroupLabelPlan {
  const hasEdits = summary.editedFileCount > 0;
  const totalCalls = countSummarizedToolCalls(summary);
  const onlyCommands = totalCalls === summary.commandCount;
  const onlyFailedFiles = summary.failedFileCount > 0 && totalCalls === summary.failedFileCount;

  const parts: CountedPart[] = [];
  if (hasEdits) {
    parts.push({ key: "files", count: summary.editedFileCount });
  }
  if (onlyFailedFiles) {
    parts.push({ key: "files", count: summary.failedFileCount });
  }
  if (summary.readFileCount > 0) {
    parts.push({ key: hasEdits ? "exploredFiles" : "files", count: summary.readFileCount });
  }
  if (summary.searchCount > 0) {
    parts.push({ key: "searches", count: summary.searchCount });
  }
  if (summary.fetchCount > 0) {
    parts.push({ key: "fetches", count: summary.fetchCount });
  }
  if (summary.otherToolCount > 0) {
    parts.push({ key: "tools", count: summary.otherToolCount });
  }
  if (summary.commandCount > 0 && !onlyCommands) {
    parts.push({ key: "commands", count: summary.commandCount });
  }
  if (summary.agentCount > 0) {
    parts.push({ key: "agents", count: summary.agentCount });
  }

  let action: GroupAction = "explored";
  if (onlyFailedFiles) {
    action = "skipped";
  } else if (hasEdits) {
    action = "edited";
  } else if (onlyCommands) {
    action = "ran";
  }

  const stats = summary.fileChangeStats;
  const fileChangeStats =
    stats && (stats.additions > 0 || stats.deletions > 0)
      ? [`+${stats.additions}`, `-${stats.deletions}`].join(" ")
      : undefined;

  return { action, parts, ...(fileChangeStats ? { fileChangeStats } : {}) };
}

/** Keeps a joined sentence from reading as two sentences mid-paragraph. */
function lowercaseFirst(text: string): string {
  const first = text[0];
  return first ? `${first.toLocaleLowerCase()}${text.slice(1)}` : text;
}

function joinSections(sections: string[], conjunction: string): string {
  if (sections.length === 0) {
    return "";
  }
  if (sections.length === 1) {
    return sections[0] ?? "";
  }
  const head = sections.slice(0, -1).join(", ");
  return `${head} ${conjunction} ${sections.at(-1)}`;
}

export interface OverviewLabelSegment {
  text: string;
  /** The part carries a glyph, the way Cursor marks a block that used MCP tools. */
  icon?: "tool";
}

export interface OverviewLabel {
  /** The whole sentence, for accessibility labels, sheets, and turn summaries. */
  text: string;
  /** The same sentence split so the view can interleave icons with the text. */
  segments: readonly OverviewLabelSegment[];
}

/**
 * One line describing a stretch of agent work, such as
 * "Explored 8 files, 8 searches, 1 tool" or "Edited 2 files, explored 9 files".
 *
 * `leadingParts` lets a collapsed turn put its message count first, so the same
 * sentence serves both a tool-call group and a whole turn. Segments are only split
 * when there is a single sentence to split; a turn summary is joined with "and" and
 * stays one run of text.
 */
export function useOverviewSummaryDisplay(
  summary: OverviewSummary,
  leadingParts: readonly string[] = [],
): OverviewLabel {
  const { t } = useTranslation();
  return useMemo(() => {
    if (
      countSummarizedToolCalls(summary) === 0 &&
      summary.thoughtCount > 0 &&
      leadingParts.length === 0
    ) {
      const duration = formatThoughtDuration(summary.thinkingDurationMs);
      const text = duration
        ? `${t("toolCallGroup.thought")} ${duration}`
        : t("toolCallGroup.thought");
      return { text, segments: [{ text }] };
    }

    const plan = planGroupLabel(summary);
    const parts = plan.parts.map((part) => ({
      kind: part.key,
      text: t(`toolCallGroup.parts.${part.key}.${part.count === 1 ? "one" : "other"}`, {
        count: part.count,
      }),
    }));

    const action = t(`toolCallGroup.actions.${plan.action}`);
    const groupSentence = buildGroupSentence(action, parts, plan.fileChangeStats);

    if (leadingParts.length === 0) {
      return groupSentence;
    }

    const firstCharacter = leadingParts[0]?.[0];
    const capitalized = firstCharacter
      ? `${firstCharacter.toLocaleUpperCase()}${(leadingParts[0] ?? "").slice(1)}`
      : "";
    const sections = [capitalized, ...leadingParts.slice(1), lowercaseFirst(groupSentence.text)];
    const text = joinSections(sections, t("toolCallGroup.and"));
    return { text, segments: [{ text }] };
  }, [leadingParts, summary, t]);
}

export function buildGroupSentence(
  action: string,
  parts: readonly { kind: CountedPart["key"]; text: string }[],
  fileChangeStats: string | undefined,
): OverviewLabel {
  const segments: OverviewLabelSegment[] = [{ text: action }];
  parts.forEach((part, index) => {
    const separator = index === 0 ? " " : ", ";
    segments.push({
      text: `${separator}${part.text}`,
      ...(part.kind === "tools" ? { icon: "tool" as const } : {}),
    });
  });
  if (fileChangeStats) {
    segments.push({ text: ` ${fileChangeStats}` });
  }
  return { text: segments.map((segment) => segment.text).join(""), segments };
}

/** One line describing a stretch of agent work, as a plain string. */
export function useOverviewSummaryLabel(
  summary: OverviewSummary,
  leadingParts: readonly string[] = [],
): string {
  return useOverviewSummaryDisplay(summary, leadingParts).text;
}
