import { buildAgentForkContextAttachment, MAX_FORK_CONTEXT_CHARS } from "./activity-curator.js";
import type { AgentManager } from "./agent-manager.js";
import { sendPromptToAgent } from "./agent-prompt.js";
import type {
  AgentPermissionRequest,
  AgentPromptInput,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
} from "./agent-sdk-types.js";
import type { AgentStorage } from "./agent-storage.js";
import { buildAgentPrompt } from "./prompt-attachments.js";
import { appendSideChat, readSideChat, type SideChatItem } from "./side-chat-store.js";
import type { Logger } from "pino";

const SIDE_SYSTEM_PROMPT = [
  "You are answering one side question about an existing chat.",
  "The user message contains the chat transcript and the question.",
  "Answer from that transcript.",
  "Do not call tools. Do not edit files, run commands, or continue the chat's task.",
  "If the transcript does not contain the answer, say so.",
].join(" ");

const TOOL_ERROR = "Side chat cannot use tools.";
const SIDE_QUESTION_TIMEOUT_MS = 10 * 60 * 1000;

export class SideQuestionCanceled extends Error {
  constructor() {
    super("Side chat canceled");
    this.name = "SideQuestionCanceled";
  }
}

interface Inflight {
  abort: AbortController;
  internalAgentId: string | null;
}

const inflight = new Map<string, Inflight>();

export function resetSideQuestionsForTests(): void {
  inflight.clear();
}

export async function cancelSideQuestion(
  agentManager: AgentManager,
  parentAgentId: string,
): Promise<void> {
  const current = inflight.get(parentAgentId);
  if (!current) return;
  current.abort.abort();
  if (current.internalAgentId) {
    await agentManager.cancelAgentRun(current.internalAgentId).catch(() => undefined);
  }
}

function assistantDelta(previous: string, next: string): { delta: string; text: string } {
  if (next.startsWith(previous)) {
    return { delta: next.slice(previous.length), text: next };
  }
  return { delta: next, text: previous + next };
}

function renderSideHistory(items: readonly SideChatItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind === "question") lines.push(`User: ${item.text ?? ""}`);
    else if (item.kind === "answer") lines.push(`Assistant: ${item.text ?? ""}`);
    else lines.push(`Error: ${item.message ?? item.text ?? ""}`);
  }
  const text = lines.join("\n\n");
  if (text.length <= MAX_FORK_CONTEXT_CHARS) return text;
  return `[Earlier side chat omitted]\n${text.slice(text.length - MAX_FORK_CONTEXT_CHARS)}`;
}

function isProviderToolCall(item: AgentTimelineItem): boolean {
  return item.type === "tool_call" && !item.agentMessage;
}

export async function runSideQuestion(input: {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  parentAgentId: string;
  text: string;
  logger: Logger;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  const question = input.text.trim();
  if (!question) throw new Error("Side question is empty");

  const parent = input.agentManager.getAgent(input.parentAgentId);
  if (!parent || parent.internal) throw new Error("Agent not found");
  const stored = await input.agentStorage.get(input.parentAgentId);
  if (stored?.archivedAt) throw new Error("Agent is archived");

  await cancelSideQuestion(input.agentManager, input.parentAgentId);
  const abort = new AbortController();
  const run: Inflight = { abort, internalAgentId: null };
  inflight.set(input.parentAgentId, run);

  let internalAgentId: string | null = null;
  try {
    if (abort.signal.aborted) throw new SideQuestionCanceled();
    const timeline = input.agentManager.fetchTimeline(input.parentAgentId, {
      direction: "tail",
      limit: 0,
    });
    const fork = buildAgentForkContextAttachment({
      rows: timeline.rows,
      agentTitle: parent.config.title,
      cwd: parent.cwd,
    });
    const history = await readSideChat(input.agentStorage.directory(), input.parentAgentId);
    const historyText = renderSideHistory(history);
    const attachments = [fork.attachment];
    if (historyText.trim()) {
      attachments.push({
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "Side chat",
        text: historyText,
      });
    }
    const config: AgentSessionConfig = {
      provider: parent.provider,
      cwd: parent.cwd,
      internal: true,
      systemPrompt: SIDE_SYSTEM_PROMPT,
      mcpServers: {},
      ...(parent.config.model ? { model: parent.config.model } : {}),
      ...(parent.config.thinkingOptionId
        ? { thinkingOptionId: parent.config.thinkingOptionId }
        : {}),
    };
    const internal = await input.agentManager.createAgent(config, undefined, {
      workspaceId: undefined,
      persistSession: false,
      paseoTools: "none",
      sideQuestion: true,
      initialTitle: "Side question",
    });
    internalAgentId = internal.id;
    run.internalAgentId = internal.id;
    if (abort.signal.aborted) throw new SideQuestionCanceled();

    const answer = await waitForSideAnswer({
      agentManager: input.agentManager,
      agentStorage: input.agentStorage,
      internalAgentId: internal.id,
      prompt: buildAgentPrompt(question, undefined, attachments),
      logger: input.logger,
      abort: abort.signal,
      onDelta: input.onDelta,
    });
    if (inflight.get(input.parentAgentId) !== run || abort.signal.aborted) {
      throw new SideQuestionCanceled();
    }
    await appendSideChat(input.agentStorage.directory(), input.parentAgentId, [
      { kind: "question", text: question },
      { kind: "answer", text: answer },
    ]);
    return answer;
  } catch (error) {
    if (!(error instanceof SideQuestionCanceled) && inflight.get(input.parentAgentId) === run) {
      const message = error instanceof Error ? error.message : String(error);
      await appendSideChat(input.agentStorage.directory(), input.parentAgentId, [
        { kind: "question", text: question },
        { kind: "error", message },
      ]).catch(() => undefined);
    }
    throw error;
  } finally {
    if (inflight.get(input.parentAgentId) === run) inflight.delete(input.parentAgentId);
    if (internalAgentId) {
      await input.agentManager.cancelAgentRun(internalAgentId).catch(() => undefined);
      await input.agentManager.archiveAgent(internalAgentId).catch(() => undefined);
    }
  }
}

function waitForSideAnswer(input: {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  internalAgentId: string;
  prompt: AgentPromptInput;
  logger: Logger;
  abort: AbortSignal;
  onDelta?: (delta: string) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let text = "";
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      finish(() => reject(new Error("Side question timed out")));
    }, SIDE_QUESTION_TIMEOUT_MS);

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      input.abort.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(new SideQuestionCanceled()));

    const failTools = (request?: AgentPermissionRequest) => {
      if (request) {
        const deny = request.actions?.find((action) => action.behavior === "deny");
        void input.agentManager
          .respondToPermission(input.internalAgentId, request.id, {
            behavior: "deny",
            interrupt: true,
            ...(deny ? { selectedActionId: deny.id } : {}),
            message: TOOL_ERROR,
          })
          .catch(() => undefined);
      }
      finish(() => reject(new Error(TOOL_ERROR)));
    };

    const onEvent = (event: AgentStreamEvent) => {
      if (event.type === "timeline" && event.item.type === "assistant_message") {
        const next = assistantDelta(text, event.item.text);
        text = next.text;
        if (next.delta) input.onDelta?.(next.delta);
        return;
      }
      if (event.type === "timeline" && isProviderToolCall(event.item)) {
        failTools();
        return;
      }
      if (event.type === "permission_requested") {
        failTools(event.request);
        return;
      }
      if (event.type === "turn_completed") {
        finish(() => resolve(text));
        return;
      }
      if (event.type === "turn_failed") {
        finish(() => reject(new Error(event.error || "Side question failed")));
        return;
      }
      if (event.type === "turn_canceled") {
        finish(() =>
          reject(
            input.abort.aborted
              ? new SideQuestionCanceled()
              : new Error(event.reason || "Side chat was canceled."),
          ),
        );
      }
    };

    unsubscribe = input.agentManager.subscribe(
      (event) => {
        if (event.type !== "agent_stream" || event.agentId !== input.internalAgentId) return;
        onEvent(event.event);
      },
      { agentId: input.internalAgentId, replayState: false },
    );
    if (input.abort.aborted) {
      onAbort();
      return;
    }
    input.abort.addEventListener("abort", onAbort, { once: true });

    void sendPromptToAgent({
      agentManager: input.agentManager,
      agentStorage: input.agentStorage,
      agentId: input.internalAgentId,
      prompt: input.prompt,
      unarchive: false,
      logger: input.logger,
    }).then(
      (result) => {
        if (result.disposition !== "turn_started") {
          finish(() => reject(new Error("Side question was not started")));
        }
        return result;
      },
      (error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        return undefined;
      },
    );
  });
}
