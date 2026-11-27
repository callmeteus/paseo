import { isTurnBoundary } from "./turn-membership";
import type { ChatDisplay } from "@/hooks/use-settings";
import { localizeGoalNotice } from "@/agent-stream/goal-copy";
import type { TimelineItemTransform } from "@/plugins/timeline/model";
import { projectPluginTimelineItems } from "@/plugins/timeline/projection";
import {
  prepareToolCallHistory,
  projectToolCallDetailLevel,
  type PreparedToolCallHistory,
  type ToolCallDetailLevel,
  type ToolCallDetailProjection,
} from "@/tool-calls/detail-level/projection";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import { collapseTurns, type TurnCollapse } from "./turn-collapse/model";
import type { ReadingRowReplacements } from "./reading-anchor";

interface PresentationInput {
  tail: StreamItem[];
  head: StreamItem[];
  transform: TimelineItemTransform | undefined;
  display: ChatDisplay;
  autoExpandReasoning?: boolean;
  /** User messages whose collapsed turn the reader opened. */
  expandedTurnHostIds: ReadonlySet<string>;
  isTurnActive: boolean;
  /** Reasoning keeps its own always-visible row when the reader turned on auto-expand. */
  groupReasoning?: boolean;
  activeTurnId?: string | null;
}

export interface StreamPresentation extends ToolCallDetailProjection {
  turns: Omit<TurnCollapse, "tail">;
  readingRowReplacements: ReadingRowReplacements;
}

function groupedRowHosts(
  rows: readonly StreamItem[],
  groups: ToolCallDetailProjection["groupsByHostId"],
): ReadonlyMap<string, string> {
  const hosts = new Map<string, string>();
  for (const row of rows) {
    const group = groups.get(row.id);
    if (!group) continue;
    for (const call of group.run.calls) {
      if (call.id !== row.id) hosts.set(call.id, row.id);
    }
  }
  return hosts;
}

const NO_COLLAPSED_TURNS: StreamPresentation["turns"] = collapseTurns({
  tail: [],
  isLatestTurnOpen: false,
  expandedHostIds: new Set(),
  getGroupedCalls: () => undefined,
  previousSummaryRowsByHostId: new Map(),
});

/** Source messages reach plugins before display projection. */
// The daemon injects a `/goal` preamble into the provider prompt because most
// harnesses have no system-prompt slot. That text is context, not a chat
// message: hide it (and the completion marker) from the transcript.
const GOAL_PROMPT_PREFIX = "<paseo-goal>";
const GOAL_COMPLETE_MARKER_PATTERN = /<paseo-goal-complete>/gi;

export function createStreamPresentation() {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;

    // Recognize the complete voice envelope, including older messages without the
    // instruction suffix. Leave quoted examples and unrelated XML untouched.
    const spokenInput =
      /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/.exec(
        item.text,
      );
    const projected = spokenInput ? { ...item, text: spokenInput[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  let historySource: StreamItem[] | undefined;
  let historyTransform: TimelineItemTransform | undefined;
  let historyRows: StreamItem[] = [];
  let preparedTail: StreamItem[] | undefined;
  let preparedLevel: ToolCallDetailLevel | undefined;
  let preparedGroupReasoning: boolean | undefined;
  let preparedAutoExpandReasoning: boolean | undefined;
  let preparedHistory: PreparedToolCallHistory | null = null;
  let historyGroupHosts: ReadonlyMap<string, string> = new Map();
  let collapsedSource: StreamItem[] | undefined;
  let collapsedIsLatestTurnOpen = false;
  let collapsedExpandedHostIds: ReadonlySet<string> | undefined;
  let collapsed: TurnCollapse | undefined;

  function presentRows(item: StreamItem): StreamItem[] {
    // A received agent message is a user bubble at the tool call's timeline position.
    if (item.kind === "tool_call" && item.payload.source === "agent") {
      const message = item.payload.data.agentMessage;
      if (message?.event === "message") {
        return [
          presentUserMessage({
            kind: "user_message",
            id: item.id,
            turnId: item.turnId,
            timelineCursor: item.timelineCursor,
            timestamp: item.timestamp,
            text: message.text,
            sender: message.sender,
          }),
        ];
      }
    }
    if (item.kind === "user_message") {
      // Goal preambles are injected context; they never belong in the transcript.
      if (item.text.trimStart().startsWith(GOAL_PROMPT_PREFIX)) return [];
      return [presentUserMessage(item)];
    }
    if (item.kind === "assistant_message" && item.text.includes("<paseo-goal-complete")) {
      const text = item.text.replace(GOAL_COMPLETE_MARKER_PATTERN, "").trim();
      return text ? [{ ...item, text }] : [];
    }
    if (item.kind === "assistant_message") {
      const text = localizeGoalNotice(item.text);
      return text === item.text ? [item] : [{ ...item, text }];
    }
    if (item.kind === "notification") {
      const message = localizeGoalNotice(item.message);
      return message === item.message ? [item] : [{ ...item, message }];
    }
    return [item];
  }

  function collapse(
    projection: ToolCallDetailProjection,
    input: PresentationInput,
  ): Omit<StreamPresentation, "readingRowReplacements"> {
    if (input.display !== "collapseTurns") {
      return { ...projection, turns: NO_COLLAPSED_TURNS };
    }
    // Live text updates reach the head only, so the folded history is reused until the
    // retained rows, the latest turn's liveness, or the reader's expanded turns change.
    const last = projection.tail.at(-1) ?? null;
    const first = projection.head[0] ?? null;
    const activeTurnIsAnother = Boolean(
      input.activeTurnId && last?.turnId && input.activeTurnId !== last.turnId,
    );
    // Without head rows, the latest retained turn is live only while the active run is that
    // turn. A run that has not opened yet carries no id and belongs to the next turn.
    const isLatestTurnOpen = first
      ? !isTurnBoundary(last, first) && !activeTurnIsAnother
      : input.isTurnActive && (last?.turnId === undefined || input.activeTurnId === last.turnId);
    if (
      !collapsed ||
      collapsedSource !== projection.tail ||
      collapsedIsLatestTurnOpen !== isLatestTurnOpen ||
      collapsedExpandedHostIds !== input.expandedTurnHostIds
    ) {
      collapsed = collapseTurns({
        tail: projection.tail,
        isLatestTurnOpen,
        expandedHostIds: input.expandedTurnHostIds,
        getGroupedCalls: (itemId) => projection.groupsByHostId.get(itemId)?.run.calls,
        previousSummaryRowsByHostId:
          collapsed?.summaryRowsByHostId ?? NO_COLLAPSED_TURNS.summaryRowsByHostId,
      });
      collapsedSource = projection.tail;
      collapsedIsLatestTurnOpen = isLatestTurnOpen;
      collapsedExpandedHostIds = input.expandedTurnHostIds;
    }
    const { tail, ...turns } = collapsed;
    if (turns.nestedItemIds.size === 0) return { ...projection, tail, turns };
    // Opening a turn reveals its raw calls; those rows must not become group hosts again.
    const withoutExpandedRows = (groups: StreamPresentation["groupsByHostId"]) => ({
      size: groups.size - [...turns.nestedItemIds].filter((id) => groups.has(id)).length,
      get: (id: string) => (turns.nestedItemIds.has(id) ? undefined : groups.get(id)),
      has: (id: string) => !turns.nestedItemIds.has(id) && groups.has(id),
    });
    return {
      ...projection,
      tail,
      turns,
      groupsByHostId: withoutExpandedRows(projection.groupsByHostId),
      historyGroupUpdatesByHostId: withoutExpandedRows(projection.historyGroupUpdatesByHostId),
    };
  }

  return (input: PresentationInput): StreamPresentation => {
    const level: ToolCallDetailLevel = input.display === "full" ? "detailed" : "overview";
    // Retained history is not reprojected or regrouped on each live text update.
    if (historySource !== input.tail || historyTransform !== input.transform) {
      historyRows = projectPluginTimelineItems(input.tail, input.transform).flatMap<StreamItem>(
        (item) => presentRows(item),
      );
      historySource = input.tail;
      historyTransform = input.transform;
    }
    const head: StreamItem[] = [];
    for (const item of projectPluginTimelineItems(input.head, input.transform, "streaming")) {
      const blocks = presentRows(item);
      head.push(...blocks);
    }
    // Our step grouping and the upstream Expand-thinking setting are two views of the same
    // switch: a turn groups reasoning into its steps unless the reader expanded it.
    const groupReasoning = input.groupReasoning ?? !(input.autoExpandReasoning ?? false);
    if (
      preparedTail !== historyRows ||
      preparedLevel !== level ||
      preparedGroupReasoning !== groupReasoning ||
      preparedAutoExpandReasoning !== input.autoExpandReasoning
    ) {
      preparedHistory = prepareToolCallHistory(
        level,
        historyRows,
        groupReasoning,
        true,
        input.autoExpandReasoning ?? false,
      );
      historyGroupHosts = preparedHistory
        ? groupedRowHosts(preparedHistory.grouped.tail, preparedHistory.grouped.groupsByHostId)
        : new Map();
      preparedTail = historyRows;
      preparedLevel = level;
      preparedGroupReasoning = groupReasoning;
      preparedAutoExpandReasoning = input.autoExpandReasoning;
    }
    const projection = projectToolCallDetailLevel({
      level,
      tail: historyRows,
      head,
      preparedHistory,
      isTurnActive: input.isTurnActive,
      includeThought: groupReasoning,
    });
    const result = collapse(projection, input);
    // Only the trailing retained group can absorb head rows. Reuse the retained
    // index across streaming updates rather than walking the full history again.
    const last = projection.tail.at(-1);
    const liveGroupHosts = groupedRowHosts(
      last ? [last, ...projection.head] : projection.head,
      projection.groupsByHostId,
    );
    const retainedGroupHosts = historyGroupHosts;
    return {
      ...result,
      readingRowReplacements: {
        get(id) {
          if (result.turns.nestedItemIds.has(id)) return undefined;
          const groupHost = liveGroupHosts.get(id) ?? retainedGroupHosts.get(id) ?? id;
          return (
            result.turns.hostIdByHiddenRowId.get(id) ??
            result.turns.hostIdByHiddenRowId.get(groupHost) ??
            (groupHost === id ? undefined : groupHost)
          );
        },
      },
    };
  };
}
