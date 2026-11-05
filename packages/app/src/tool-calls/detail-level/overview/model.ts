import { isPaseoToolName } from "@getpaseo/protocol/tool-name-normalization";
import { describeToolCall, type GroupableStep, type StepRun } from "../grouping";

const DIRECT_PASEO_TOOL_PREFIX = "paseo_";
const DIRECT_SEARCH_TOOL_SUFFIX_PATTERN = /(?:^|[_.:/])(?:web_search|llm_context)$/;

export interface OverviewFileChangeStats {
  additions: number;
  deletions: number;
}

export interface OverviewSummary {
  editedFileCount: number;
  commandCount: number;
  readFileCount: number;
  searchCount: number;
  fetchCount: number;
  agentCount: number;
  otherToolCount: number;
  paseoCallCount: number;
  /** Reads that failed or were rejected; a group of only these reads as "Skipped". */
  failedFileCount: number;
  /** Read paths, deduped. One entry lets the label name the file instead of counting. */
  readFiles: readonly string[];
  fileChangeStats?: OverviewFileChangeStats;
  thinkingDurationMs: number;
  thoughtCount: number;
  hasText: boolean;
}

export interface OverviewToolCallGroup {
  mode: "overview";
  run: StepRun;
  summary: OverviewSummary;
  isLoading: boolean;
}

function isPaseoCall(name: string, normalizedName: string): boolean {
  return isPaseoToolName(name) || normalizedName.startsWith(DIRECT_PASEO_TOOL_PREFIX);
}

function isSearchCall(name: string): boolean {
  return DIRECT_SEARCH_TOOL_SUFFIX_PATTERN.test(name);
}

function countDiffLines(diff: string): OverviewFileChangeStats {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function addFileChangeStats(
  total: OverviewFileChangeStats,
  diff: string | undefined,
): OverviewFileChangeStats {
  if (!diff) {
    return total;
  }
  const next = countDiffLines(diff);
  return {
    additions: total.additions + next.additions,
    deletions: total.deletions + next.deletions,
  };
}

/** A thought's duration is frozen when it stops streaming; until then, measure from its start. */
function thoughtDurationMs(step: Extract<GroupableStep, { kind: "thought" }>): number {
  if (step.thinkingDurationMs !== undefined) {
    return step.thinkingDurationMs;
  }
  if (!step.startedAt) {
    return 0;
  }
  return Math.max(0, step.timestamp.getTime() - step.startedAt.getTime());
}

/** Total tool calls a summary stands for. Used to decide whether a stretch did any work. */
export function countSummarizedToolCalls(summary: OverviewSummary): number {
  return (
    summary.commandCount +
    summary.searchCount +
    summary.fetchCount +
    summary.agentCount +
    summary.otherToolCount +
    summary.paseoCallCount +
    summary.editedFileCount +
    summary.failedFileCount +
    summary.readFileCount
  );
}

/** Counts a stretch of agent work by what it did, for any summary of that stretch. */
export function summarizeSteps(steps: readonly GroupableStep[]): OverviewSummary {
  const editedFiles = new Set<string>();
  const readFiles = new Set<string>();
  let commandCount = 0;
  let searchCount = 0;
  let fetchCount = 0;
  let agentCount = 0;
  let otherToolCount = 0;
  let paseoCallCount = 0;
  let failedFileCount = 0;
  let fileChangeStats: OverviewFileChangeStats = { additions: 0, deletions: 0 };
  let thinkingDurationMs = 0;
  let thoughtCount = 0;
  let hasText = false;

  for (const step of steps) {
    if (step.kind === "thought") {
      thoughtCount += 1;
      thinkingDurationMs += thoughtDurationMs(step);
      continue;
    }
    if (step.kind === "assistant_message") {
      hasText = true;
      continue;
    }

    const descriptor = describeToolCall(step);
    const normalizedName = descriptor.name.trim().toLowerCase();
    const failed = descriptor.status === "failed" || descriptor.status === "canceled";

    if (isPaseoCall(descriptor.name, normalizedName)) {
      paseoCallCount += 1;
    } else if (descriptor.detail.type === "edit" || descriptor.detail.type === "write") {
      if (failed) {
        failedFileCount += 1;
      } else {
        editedFiles.add(descriptor.detail.filePath);
        if (descriptor.detail.type === "edit") {
          fileChangeStats = addFileChangeStats(fileChangeStats, descriptor.detail.unifiedDiff);
        }
      }
    } else if (descriptor.detail.type === "shell") {
      commandCount += 1;
    } else if (descriptor.detail.type === "read") {
      if (failed) {
        failedFileCount += 1;
      } else {
        readFiles.add(descriptor.detail.filePath);
      }
    } else if (descriptor.detail.type === "search" || isSearchCall(normalizedName)) {
      searchCount += 1;
    } else if (descriptor.detail.type === "fetch") {
      fetchCount += 1;
    } else if (descriptor.detail.type === "sub_agent") {
      agentCount += 1;
    } else {
      otherToolCount += 1;
    }
  }

  return {
    editedFileCount: editedFiles.size,
    commandCount,
    readFileCount: readFiles.size,
    searchCount,
    fetchCount,
    agentCount,
    otherToolCount,
    paseoCallCount,
    failedFileCount,
    readFiles: [...readFiles],
    ...(fileChangeStats.additions > 0 || fileChangeStats.deletions > 0 ? { fileChangeStats } : {}),
    thinkingDurationMs,
    thoughtCount,
    hasText,
  };
}

export function buildOverviewGroup(run: StepRun): OverviewToolCallGroup {
  const isLoading = run.steps.some((step) => {
    if (step.kind === "thought") {
      return step.status === "loading";
    }
    if (step.kind === "assistant_message") {
      return false;
    }
    const status = describeToolCall(step).status;
    return status === "running" || status === "executing";
  });
  return {
    mode: "overview",
    run,
    isLoading,
    summary: summarizeSteps(run.steps),
  };
}
