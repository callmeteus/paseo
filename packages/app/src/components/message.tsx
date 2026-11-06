// Barrel: transcript message UI split across `message-*.tsx`; import from here for a stable public API.
export type { InlinePathTarget } from "@/assistant-file-links";
export type { AssistantForkTarget } from "@/components/assistant-fork-menu";

export {
  MessageOuterSpacingProvider,
  MessageOuterSpacingContext,
  STREAM_METADATA_FONT_SIZE,
} from "@/components/message-shared";

export {
  UserMessage,
  AssistantTurnFooter,
  LiveElapsed,
  assistantMessageStylesheet,
  TurnCopyButton,
  AssistantMessage,
  SpeakMessage,
  Notification,
  CompactionMarker,
  PortingMarker,
  TodoListCard,
} from "@/components/message-stream";

export {
  ExpandableBadge,
  type ExpandableBadgeLabelContext,
  ToolCall,
} from "@/components/message-expandable";
