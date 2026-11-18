import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import type {
  AgentClient,
  AgentPromptInput,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { readSideChat } from "./side-chat-store.js";
import { resetSideQuestionsForTests, runSideQuestion } from "./side-question.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

const logger = createTestLogger();
const directories: string[] = [];

afterEach(() => {
  resetSideQuestionsForTests();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsSessionListing: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;

class ScriptedSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  readonly prompts: AgentPromptInput[] = [];
  readonly permissionResponses: unknown[] = [];
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(private readonly script: "answer" | "tool" | "quiet") {}

  async run(): Promise<{ sessionId: string; finalText: string; timeline: [] }> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    this.prompts.push(prompt);
    const turnId = `turn-${this.script}`;
    setTimeout(() => {
      if (this.script === "quiet") {
        this.push({ type: "turn_started", provider: this.provider, turnId });
        this.push({ type: "turn_completed", provider: this.provider, turnId });
        return;
      }
      this.push({ type: "turn_started", provider: this.provider, turnId });
      if (this.script === "answer") {
        this.push({
          type: "timeline",
          provider: this.provider,
          turnId,
          item: { type: "assistant_message", text: "because" },
        });
        this.push({
          type: "timeline",
          provider: this.provider,
          turnId,
          item: { type: "assistant_message", text: "because it failed" },
        });
        this.push({ type: "turn_completed", provider: this.provider, turnId });
        return;
      }
      this.push({
        type: "permission_requested",
        provider: this.provider,
        turnId,
        request: {
          id: "perm-1",
          provider: this.provider,
          name: "bash",
          kind: "tool",
          actions: [{ id: "deny", label: "Deny", behavior: "deny" }],
        },
      });
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  push(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) callback(event);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: "test-model", modeId: null };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(_requestId: string, response: unknown): Promise<void> {
    this.permissionResponses.push(response);
  }

  describePersistence() {
    return { provider: this.provider, sessionId: this.id, metadata: {} };
  }

  async interrupt(): Promise<void> {
    this.push({
      type: "turn_canceled",
      provider: this.provider,
      reason: "interrupted",
      turnId: `turn-${this.script}`,
    });
  }

  async close(): Promise<void> {}
}

class ScriptedClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly internalSessions: ScriptedSession[] = [];

  constructor(private readonly script: "answer" | "tool") {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new ScriptedSession(config.internal ? this.script : "quiet");
    if (config.internal) this.internalSessions.push(session);
    return session;
  }

  async resumeSession(): Promise<AgentSession> {
    return new ScriptedSession("quiet");
  }
}

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

async function setup(script: "answer" | "tool") {
  const workdir = mkdtempSync(join(tmpdir(), "side-question-"));
  directories.push(workdir);
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const client = new ScriptedClient(script);
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
    idFactory: () => randomUUID(),
  });
  const parent = await manager.createAgent(
    { provider: "codex", cwd: workdir, model: "test-model", title: "Parent" },
    undefined,
    { workspaceId: undefined },
  );
  await manager.appendTimelineItem(parent.id, { type: "user_message", text: "parent said this" });
  return { manager, storage, client, parent };
}

test("a side question re-reads the parent and leaves its turn alone", async () => {
  const { manager, storage, client, parent } = await setup("answer");
  const before = manager.getTimeline(parent.id);
  const lifecycle = manager.getAgent(parent.id)?.lifecycle;

  const answer = await runSideQuestion({
    agentManager: manager,
    agentStorage: storage,
    parentAgentId: parent.id,
    text: "why did it fail",
    logger,
  });

  expect(answer).toBe("because it failed");
  expect(manager.getTimeline(parent.id)).toEqual(before);
  expect(manager.getAgent(parent.id)?.lifecycle).toBe(lifecycle);
  expect(manager.listAgents().map((agent) => agent.id)).toEqual([parent.id]);
  expect(promptText(client.internalSessions[0]!.prompts[0]!)).toContain("parent said this");
  expect(promptText(client.internalSessions[0]!.prompts[0]!)).toContain("why did it fail");
  const stored = await readSideChat(storage.directory(), parent.id);
  expect(stored.map((item) => item.kind)).toEqual(["question", "answer"]);
  expect(stored[1]?.text).toBe("because it failed");

  await manager.archiveAgent(parent.id);
  expect(await readSideChat(storage.directory(), parent.id)).toEqual([]);
});

test("a side question tool call is denied without a permission on the parent", async () => {
  const { manager, storage, client, parent } = await setup("tool");
  const before = manager.getTimeline(parent.id);

  await expect(
    runSideQuestion({
      agentManager: manager,
      agentStorage: storage,
      parentAgentId: parent.id,
      text: "run a command",
      logger,
    }),
  ).rejects.toThrow("Side chat cannot use tools.");

  expect(manager.getTimeline(parent.id)).toEqual(before);
  expect(manager.getAgent(parent.id)?.pendingPermissions.size).toBe(0);
  expect(manager.listAgents().map((agent) => agent.id)).toEqual([parent.id]);
  expect(client.internalSessions[0]?.permissionResponses).toEqual([
    expect.objectContaining({ behavior: "deny", selectedActionId: "deny" }),
  ]);
  const stored = await readSideChat(storage.directory(), parent.id);
  expect(stored.map((item) => item.kind)).toEqual(["question", "error"]);
});
