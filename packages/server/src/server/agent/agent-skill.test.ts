import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { planSkillPrompt } from "./agent-skill.js";
import { formatAgentMessage } from "./agent-messages/index.js";
import type {
  AgentClient,
  AgentRunResult,
  AgentSession,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const SKILLS = ["deploy", "taste"];

describe("planSkillPrompt", () => {
  test("hoists a mid-sentence skill to the first token", () => {
    expect(planSkillPrompt({ prompt: "use /taste before merging", skillNames: SKILLS })).toEqual({
      prompt: "/taste use before merging",
      submittedPromptText: "use /taste before merging",
    });
  });

  test("leaves a prompt that already starts with a slash command alone", () => {
    expect(planSkillPrompt({ prompt: "/taste now", skillNames: SKILLS })).toBeNull();
    expect(planSkillPrompt({ prompt: "  /deploy now", skillNames: SKILLS })).toBeNull();
  });

  test("ignores prompts without an installed skill", () => {
    expect(planSkillPrompt({ prompt: "use /missing now", skillNames: SKILLS })).toBeNull();
    expect(planSkillPrompt({ prompt: "plain prompt", skillNames: SKILLS })).toBeNull();
  });

  test("ignores paths and URLs", () => {
    expect(planSkillPrompt({ prompt: "read /tmp/deploy now", skillNames: SKILLS })).toBeNull();
    expect(
      planSkillPrompt({ prompt: "see https://example.com/deploy", skillNames: SKILLS }),
    ).toBeNull();
  });

  test("keeps internal newlines in the remaining prompt", () => {
    expect(
      planSkillPrompt({ prompt: "use /taste then\nkeep this line", skillNames: SKILLS }),
    ).toEqual({
      prompt: "/taste use then\nkeep this line",
      submittedPromptText: "use /taste then\nkeep this line",
    });
  });

  test("hoists only the first of several skills", () => {
    expect(planSkillPrompt({ prompt: "use /taste and /deploy", skillNames: SKILLS })).toEqual({
      prompt: "/taste use and /deploy",
      submittedPromptText: "use /taste and /deploy",
    });
  });
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

class SkillListingSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  readonly listCommands = vi.fn(async () => [
    { name: "taste", description: "", argumentHint: "", kind: "skill" as const },
    { name: "compact", description: "", argumentHint: "", kind: "command" as const },
  ]);

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: "turn-1" };
  }

  subscribe(_callback: (event: AgentStreamEvent) => void): () => void {
    return () => {};
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}

  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: null, modeId: null };
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

  async respondToPermission(): Promise<void> {}

  describePersistence() {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {}
}

class SkillListingClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly sessions: SkillListingSession[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createSession(): Promise<AgentSession> {
    const session = new SkillListingSession();
    this.sessions.push(session);
    return session;
  }

  async fetchCatalog() {
    return { models: [], modes: [] };
  }

  async resumeSession(): Promise<AgentSession> {
    return await this.createSession();
  }
}

async function createScenario(): Promise<{
  agentManager: AgentManager;
  agentId: string;
  client: SkillListingClient;
  cleanup: () => Promise<void>;
}> {
  const workdir = mkdtempSync(join(tmpdir(), "agent-skill-"));
  const client = new SkillListingClient();
  const agentManager = new AgentManager({
    clients: { codex: client },
    logger: createTestLogger(),
  });
  const snapshot = await agentManager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  return {
    agentManager,
    agentId: snapshot.id,
    client,
    cleanup: async () => {
      await agentManager.closeAgent(snapshot.id).catch(() => undefined);
      rmSync(workdir, { recursive: true, force: true });
    },
  };
}

test("planSkillTurn hoists an installed skill and caches the command list", async () => {
  const scenario = await createScenario();
  try {
    await expect(
      scenario.agentManager.planSkillTurn(scenario.agentId, "use /taste now"),
    ).resolves.toEqual({
      prompt: "/taste use now",
      submittedPromptText: "use /taste now",
    });
    await scenario.agentManager.planSkillTurn(scenario.agentId, "use /taste again");

    const session = scenario.client.sessions[0]!;
    expect(session.listCommands).toHaveBeenCalledTimes(1);
  } finally {
    await scenario.cleanup();
  }
});

test("planSkillTurn ignores envelopes, slash-first prompts and unknown skills", async () => {
  const scenario = await createScenario();
  try {
    const envelope = formatAgentMessage({
      id: "delivery-1",
      source: { kind: "agent-message", agentId: "remote::worker" },
      text: "use /taste now",
    });
    await expect(
      scenario.agentManager.planSkillTurn(scenario.agentId, envelope),
    ).resolves.toBeNull();
    await expect(
      scenario.agentManager.planSkillTurn(scenario.agentId, "/taste now"),
    ).resolves.toBeNull();
    await expect(
      scenario.agentManager.planSkillTurn(scenario.agentId, "use /missing now"),
    ).resolves.toBeNull();
  } finally {
    await scenario.cleanup();
  }
});
