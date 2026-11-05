import { z } from "zod";

import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { normalizeToolCallStatus } from "../tool-call-mapper-utils.js";
import { deriveOpencodeToolDetail } from "./tool-call-detail-parser.js";

interface OpencodeToolCallParams {
  toolName: string;
  callId?: string | null;
  status?: unknown;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

const OpencodeRawToolCallSchema = z
  .object({
    toolName: z.string().min(1),
    callId: z.string().optional().nullable(),
    status: z.unknown().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// OpenCode keeps a `question` part running while the form is open. Nothing in the timeline can
// finish that row, so a reopened chat shows a spinner that never resolves. The pending form owns
// the "waiting for you" state; the row itself is only the record of what was asked.
const QUESTION_TOOL_NAME = "question";

function isQuestionTool(name: string): boolean {
  return name.trim().toLowerCase() === QUESTION_TOOL_NAME;
}

export function mapOpencodeToolCall(params: OpencodeToolCallParams): ToolCallTimelineItem | null {
  const parsed = OpencodeRawToolCallSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  const raw = parsed.data;
  const callId =
    typeof raw.callId === "string" && raw.callId.trim().length > 0 ? raw.callId.trim() : null;
  if (callId === null) {
    return null;
  }
  const name = raw.toolName.trim();
  const input = raw.input ?? null;
  const output = raw.output ?? null;
  const error = raw.error ?? null;
  const rawStatus = typeof raw.status === "string" ? raw.status : undefined;
  const normalizedStatus = normalizeToolCallStatus(rawStatus, error, output);
  // A question is either waiting for the form (OpenCode says running) or was interrupted when the
  // user answered elsewhere (OpenCode says aborted). Neither is work the timeline can finish, and
  // painting the aborted case as an error blames the tool for the user's choice.
  const status = isQuestionTool(name) ? "completed" : normalizedStatus;
  const detail = deriveOpencodeToolDetail(name, input, output, error, raw.metadata);

  if (status === "failed") {
    return {
      type: "tool_call",
      callId,
      name,
      status: "failed",
      detail,
      error: error ?? { message: "Tool call failed" },
      ...(raw.metadata ? { metadata: raw.metadata } : {}),
    };
  }
  return {
    type: "tool_call",
    callId,
    name,
    status,
    detail,
    error: null,
    ...(raw.metadata ? { metadata: raw.metadata } : {}),
  };
}
