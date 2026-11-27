import type { FormInfo, ModelInfo, SessionMessageInfo } from "@opencode/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTestLogger } from "../../../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import { OpenCodeV2AgentClient } from "./agent.js";
import { V2Harness } from "../test-utils/v2-harness.js";
import type { V2Api } from "./api.js";
import type { OpenCodeBridge } from "../bridge.js";
function toolBridge(): OpenCodeBridge {
  return {
    bindSession: () => () => undefined,
    decorateV2ServerEnv: async (env: Record<string, string>) => env,
  } as unknown as OpenCodeBridge;
}

const SERVER_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const MCP_SHIM = path.join(SERVER_ROOT, "scripts/mcp-proxy-shim.mjs");
const UPSTREAM_SERVER_SCRIPT = `
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const server = new Server({ name: "upstream", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "ask_grant", inputSchema: { type: "object" } }],
}));
await server.connect(new StdioServerTransport());
`;
function definedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function isRetryTimelineEvent(event: AgentStreamEvent): boolean {
  return event.type === "timeline" && event.transient === true && event.item.type === "error";
}

function terminalEvents(events: AgentStreamEvent[]) {
  return events.filter(
    (event) =>
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled",
  );
}

describe("OpenCode v2 session lifecycle", () => {
  test("updates the live session instructions when the workflow prompt changes", async () => {
    const harness = new V2Harness();
    const updates: Array<{ key: string; value: string }> = [];
    let removed = 0;
    harness.api.session.instructions.entry.put = async (input) => {
      updates.push(input);
    };
    harness.api.session.instructions.entry.remove = async () => {
      removed += 1;
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      daemonAppendSystemPrompt: "You are in Plan mode.",
    });
    try {
      await session.setDaemonAppendSystemPrompt?.("You are in Agent mode.", "agent");
      expect(updates.at(-1)).toMatchObject({
        key: "paseo",
        value: "You are in Agent mode.",
      });
      await session.setDaemonAppendSystemPrompt?.(null, "agent");
      expect(removed).toBe(1);
    } finally {
      await session.close();
    }
  });

  test("forwards provider retry status as a transient timeline row", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      harness.push({
        id: "retry-2",
        created: 3,
        type: "session.status",
        data: {
          sessionID: "session",
          status: {
            type: "retry",
            attempt: 2,
            message: "Upstream request failed: rate limit exceeded",
            next: Date.now() + 400_000,
          },
        },
      });
      await expect
        .poll(() => events.find(isRetryTimelineEvent))
        .toMatchObject({
          type: "timeline",
          transient: true,
          item: {
            type: "error",
            message: expect.stringContaining("Provider retry (attempt 2): Upstream request failed"),
          },
        });
    } finally {
      await session.close();
    }
  });

  test("reopening replaces and removes plugin instructions", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const created = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      pluginAppendSystemPrompt: ["first"],
    });
    expect(harness.instructions.get("paseo")).toBe("first");
    const handle = created.describePersistence()!;
    await created.close();
    const resumed = await client.resumeSession(handle, {
      cwd: "/tmp/project",
      pluginAppendSystemPrompt: ["changed"],
    });
    expect(harness.instructions.get("paseo")).toBe("changed");
    await resumed.close();
    const cleared = await client.resumeSession(handle, {
      cwd: "/tmp/project",
      pluginAppendSystemPrompt: undefined,
    });
    expect(harness.instructions.has("paseo")).toBe(false);
    await cleared.close();
  });

  test("opening history does not change an existing session instruction", async () => {
    const harness = new V2Harness();
    harness.instructions.set("paseo", "Existing plugin instruction");
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.resumeSession(
      { provider: "opencode", sessionId: "session", metadata: { cwd: "/tmp/project" } },
      { cwd: "/tmp/project" },
      undefined,
      { purpose: "history" },
    );
    try {
      expect(harness.instructions.get("paseo")).toBe("Existing plugin instruction");
    } finally {
      await session.close();
    }
  });

  test("refreshes the existing location before reading a forced catalog", async () => {
    const harness = new V2Harness();
    const refreshed: string[] = [];
    harness.connection.refreshLocation = async (directory) => {
      refreshed.push(directory);
    };
    harness.api.model.list = async () => ({ location: harness.info.location, data: [] });
    harness.api.provider.list = async () => ({
      location: harness.info.location,
      data: [{ id: "test", name: "Test", activation: "enabled", package: "test" }],
    });
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    await client.fetchCatalog({ scope: "workspace", cwd: "/tmp/project", force: true });
    await client.fetchCatalog({ scope: "workspace", cwd: "/tmp/project", force: false });
    expect(refreshed).toEqual(["/tmp/project"]);
    await client.shutdown();
  });

  test("rejects a live auto_accept the creation schema would reject", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });

    await expect(session.applyOptions?.({ auto_accept: "yes" })).rejects.toThrow(/auto_accept/);
    await expect(session.applyOptions?.({ auto_accept: true })).resolves.toBeUndefined();
    await session.close();
  });

  test("a rejected auto_accept leaves the running session asking for permission", async () => {
    const harness = new V2Harness();
    const permissions = [
      { id: "approval", sessionID: "session", action: "shell", resources: ["pwd"] },
    ];
    harness.api.permission.list = async () => permissions;
    const replies: string[] = [];
    harness.api.permission.reply = async (input) => {
      replies.push(input.requestID);
      throw new Error("upstream refused");
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      await expect(session.applyOptions?.({ auto_accept: true })).rejects.toThrow(
        "upstream refused",
      );

      const next = {
        id: "next",
        sessionID: "session",
        action: "shell",
        resources: ["ls"],
      };
      permissions.push(next);
      harness.push({ id: "asked", created: 2, type: "permission.asked", data: next });

      const pendingIds = () => session.getPendingPermissions().map(({ id }) => id);
      await expect.poll(pendingIds).toContain("next");
      expect(replies).not.toContain("next");
    } finally {
      await session.close();
    }
  });

  test("rejects a live permission change the running session cannot apply", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      providerOptions: { permission: "allow" },
    });

    await expect(session.applyOptions?.({ permission: "deny" })).rejects.toThrow(
      /permission.*cannot change on a running session/,
    );
    await expect(
      session.applyOptions?.({ permission: "allow", auto_accept: true }),
    ).resolves.toBeUndefined();
    await session.close();
  });

  test("completes from execution events without a long-lived HTTP wait", async () => {
    const harness = new V2Harness();
    harness.prompt = async (input) => {
      harness.prompts.push(input.text);
      harness.startExecution();
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("long-running work");
      await expect.poll(() => harness.prompts).toEqual(["long-running work"]);
      expect(events.filter((event) => event.type === "turn_failed")).toEqual([]);
      expect(events.filter((event) => event.type === "turn_completed")).toEqual([]);
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(events.filter((event) => event.type === "turn_failed")).toEqual([]);
    } finally {
      await session.close();
    }
  });
  test.each(["reconnect", "watchdog"])(
    "recovers a missed completion through %s without reconnecting a quiet stream",
    async (recovery) => {
      const harness = new V2Harness();
      harness.autoComplete = false;
      let subscriptions = 0;
      const subscribe = harness.api.event.subscribe;
      harness.api.event.subscribe = (options) => {
        subscriptions += 1;
        return subscribe(options);
      };
      const client = new OpenCodeV2AgentClient({
        logger: createTestLogger(),
        runtime: harness.runtime,
      });
      const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));
      try {
        await session.startTurn("finish while disconnected");
        await expect.poll(() => harness.prompts).toHaveLength(1);
        // Persisted completion without its event, as after an upstream stream gap.
        harness.finishExecution("succeeded", false);
        if (recovery === "reconnect")
          harness.push({ id: "reconnect", created: 3, type: "server.connected", data: {} });
        await expect.poll(() => terminalEvents(events), { timeout: 7_000 }).toHaveLength(1);
        expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
        expect(subscriptions).toBe(1);
      } finally {
        await session.close();
      }
    },
    10_000,
  );

  test("does not finish from a previous outcome before prompt admission", async () => {
    const harness = new V2Harness();
    let accept!: () => void;
    harness.prompt = () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      });
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("fast execution");
      const reads = harness.activeReads;
      harness.push({ id: "reconnect", created: 3, type: "server.connected", data: {} });
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.startExecution();
      harness.finishExecution();
      accept();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("follows a queued successor until the session is idle", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("first and queued work");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      harness.finishExecution();
      harness.startExecution();
      const reads = harness.activeReads;
      harness.push({ id: "reconnect", created: 3, type: "server.connected", data: {} });
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  test("discards an idle snapshot overtaken by a new execution event", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    let readSnapshot!: () => void;
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      readSnapshot = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await session.startTurn("work");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      harness.api.session.get = async () => {
        const snapshot = { ...harness.info };
        readSnapshot();
        await blocked;
        return snapshot;
      };
      harness.finishExecution();
      await reading;
      const reads = harness.activeReads;
      harness.startExecution();
      release();
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
    } finally {
      release();
      await session.close();
    }
  });

  test("does not treat shutdown interruption as a completed or canceled turn", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("resumable work");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      harness.active = false;
      // Shutdown does not project an idle outcome; the preceding run's outcome can remain.
      harness.info.outcome = "succeeded";
      harness.push({
        id: "shutdown",
        created: 3,
        type: "session.execution.interrupted",
        durable: { aggregateID: "session", seq: 3, version: 1 },
        data: { sessionID: "session", reason: "shutdown" },
      });
      const reads = harness.activeReads;
      harness.push({ id: "reconnect", created: 4, type: "server.connected", data: {} });
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.startExecution();
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("ends the turn when the user dismisses a question", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    let form: FormInfo | null = null;
    harness.api.session.form.list = async () => (form ? [form] : []);
    harness.api.session.form.cancel = async () => {
      form = null;
      harness.active = false;
      // OpenCode 2.0.20 reports a dismissed question as an interruption without a user reason.
      harness.push({
        id: "dismissed",
        created: 3,
        type: "session.execution.interrupted",
        durable: { aggregateID: "session", seq: 3, version: 1 },
        data: { sessionID: "session", reason: "shutdown" },
      });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("ask me something");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      form = {
        id: "question",
        sessionID: "session",
        title: "Color",
        fields: [{ key: "color", type: "string", options: [{ label: "Red", value: "red" }] }],
      };
      harness.push({
        id: "form",
        created: 2,
        type: "form.created",
        data: { form },
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);

      await session.respondToPermission("question", { behavior: "deny" });

      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_canceled" });

      await session.startTurn("next message");
      await expect.poll(() => harness.prompts).toHaveLength(2);
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(2);
      expect(terminalEvents(events)[1]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("ends the turn when the user denies a tool permission", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    let permission: Awaited<ReturnType<V2Api["permission"]["list"]>>[number] | null = null;
    harness.api.permission.list = async () => (permission ? [permission] : []);
    harness.api.permission.reply = async () => {
      permission = null;
      harness.active = false;
      // OpenCode 2.0.20 reports a denied tool call as an interruption without a user reason.
      harness.push({
        id: "denied",
        created: 3,
        type: "session.execution.interrupted",
        durable: { aggregateID: "session", seq: 3, version: 1 },
        data: { sessionID: "session", reason: "shutdown" },
      });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("run printf");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      permission = {
        id: "approval",
        sessionID: "session",
        action: "shell",
        resources: ["printf TOOL_PERMISSION_QA"],
      };
      harness.push({
        id: "asked",
        created: 2,
        type: "permission.asked",
        data: permission,
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);

      await session.respondToPermission("approval", { behavior: "deny" });

      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_canceled" });

      await session.startTurn("next message");
      await expect.poll(() => harness.prompts).toHaveLength(2);
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(2);
      expect(terminalEvents(events)[1]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("keeps the turn resumable after the user denies a child session's permission", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const child = { ...harness.info, id: "child", parentID: "session" };
    harness.api.session.list = async (input) => ({
      data: input?.parentID === "session" ? [child] : [],
      cursor: {},
    });
    let permission: Awaited<ReturnType<V2Api["permission"]["list"]>>[number] | null = {
      id: "child-approval",
      sessionID: "child",
      action: "shell",
      resources: ["pwd"],
    };
    harness.api.permission.list = async (input) =>
      permission && input.sessionID === "child" ? [permission] : [];
    harness.api.permission.reply = async () => {
      permission = null;
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("delegate work");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      expect(session.getPendingPermissions()).toHaveLength(1);

      await session.respondToPermission("child-approval", { behavior: "deny" });

      harness.active = false;
      harness.push({
        id: "shutdown",
        created: 3,
        type: "session.execution.interrupted",
        durable: { aggregateID: "session", seq: 3, version: 1 },
        data: { sessionID: "session", reason: "shutdown" },
      });
      const reads = harness.activeReads;
      harness.push({ id: "reconnect", created: 4, type: "server.connected", data: {} });
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.startExecution();
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("recovers the latest execution from the durable log when shutdown and resume events were missed", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      await session.startTurn("resumable work");
      await expect.poll(() => harness.prompts).toHaveLength(1);
      harness.active = false;
      harness.info.outcome = "succeeded";
      harness.api.session.log = async function* () {
        yield {
          id: "shutdown",
          created: 3,
          type: "session.execution.interrupted",
          durable: { aggregateID: "session", seq: 3, version: 1 },
          data: { sessionID: "session", reason: "shutdown" },
        };
      };
      const reads = harness.activeReads;
      harness.push({ id: "reconnect", created: 4, type: "server.connected", data: {} });
      await expect.poll(() => harness.activeReads).toBeGreaterThan(reads);
      expect(terminalEvents(events)).toEqual([]);
      harness.api.session.log = async function* () {
        yield {
          id: "done",
          created: 6,
          type: "session.execution.succeeded",
          durable: { aggregateID: "session", seq: 6, version: 1 },
          data: { sessionID: "session" },
        };
      };
      harness.push({
        id: "reconnect-after-resume",
        created: 7,
        type: "server.connected",
        data: {},
      });
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test("keeps the turn alive through an observation transport failure", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    const active = harness.api.session.active;
    let attempted = false;
    harness.api.session.active = async () => {
      attempted = true;
      throw new Error("fetch failed");
    };
    try {
      await session.startTurn("work");
      await expect.poll(() => attempted).toBe(true);
      expect(terminalEvents(events)).toEqual([]);
      harness.api.session.active = active;
      harness.finishExecution();
      await expect.poll(() => terminalEvents(events)).toHaveLength(1);
      expect(terminalEvents(events)[0]).toMatchObject({ type: "turn_completed" });
    } finally {
      await session.close();
    }
  });

  test.each([
    { variants: ["medium", "custom"], selected: "medium", expected: "medium" },
    { variants: ["custom"], selected: "custom", expected: "custom" },
    { variants: ["high"], selected: "medium", expected: undefined },
    { variants: [], selected: "medium", expected: undefined },
    { variants: ["medium"], selected: "default", expected: undefined },
  ])(
    "model switches retain only supported variants: $selected / $variants",
    async ({ variants, selected, expected }) => {
      const harness = new V2Harness();
      const target: ModelInfo = {
        id: "target",
        modelID: "target",
        providerID: "test",
        name: "Target",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: variants.map((id) => ({ id })),
        time: { released: 1 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 200000, output: 10000 },
      };
      harness.info.model = { providerID: "test", id: "source", variant: selected };
      harness.api.model.list = async () => ({ location: harness.info.location, data: [target] });
      harness.api.session.switchModel = async ({ model }) => {
        harness.info.model = model;
      };
      const client = new OpenCodeV2AgentClient({
        logger: createTestLogger(),
        runtime: harness.runtime,
      });
      const session = await client.createSession({
        provider: "opencode",
        cwd: "/tmp/project",
        model: "test/source",
        thinkingOptionId: selected,
      });
      const events: AgentStreamEvent[] = [];
      session.subscribe((event) => events.push(event));
      try {
        await session.setModel!("test/target");
        expect(await session.getRuntimeInfo()).toMatchObject({
          model: "test/target",
          thinkingOptionId: expected ?? null,
        });
        expect(session.describePersistence().metadata?.thinkingOptionId).toBe(expected);
        expect(events).toContainEqual({
          type: "thinking_option_changed",
          provider: "opencode",
          thinkingOptionId: expected ?? null,
        });
        await expect(session.setModel!("test/missing")).rejects.toThrow(
          "OpenCode model unavailable",
        );
        harness.api.session.switchModel = async () => {
          throw new Error("Switch failed");
        };
        await expect(session.setModel!("test/target")).rejects.toThrow("Switch failed");
        expect(session.describePersistence().metadata?.thinkingOptionId).toBe(expected);
        expect(harness.info.model).toEqual({
          providerID: "test",
          id: "target",
          ...(expected ? { variant: expected } : {}),
        });
        harness.api.session.switchModel = async ({ model }) => {
          harness.info.model = model;
        };
        harness.api.model.default = async () => ({ location: harness.info.location, data: target });
        await session.setThinkingOption!("unsupported");
        await session.setModel!(null);
        expect((await session.getRuntimeInfo()).thinkingOptionId).toBeNull();
        harness.api.model.list = async () => {
          throw new Error("Catalog unavailable");
        };
        await expect(session.setModel!("test/source")).rejects.toThrow("Catalog unavailable");
        expect((await session.getRuntimeInfo()).model).toBe("test/target");
      } finally {
        await session.close();
      }
    },
  );

  test("restores each same-directory agent environment on reconnect and resume", async () => {
    const first = new V2Harness();
    const second = new V2Harness();
    first.info.id = "session-first";
    second.info.id = "session-second";
    const environments = new Map<string, Record<string, string>>();
    const bind = async (input: { sessionID: string; variables: Record<string, string> }) => {
      environments.set(input.sessionID, { ...input.variables });
    };
    first.api.session.environment = bind;
    second.api.session.environment = bind;
    const clients = [first, second].map(
      (harness) =>
        new OpenCodeV2AgentClient({
          logger: createTestLogger(),
          runtime: harness.runtime,
          settings: {
            env: {
              PASEO_ENV_TEST: "configured",
              PASEO_AGENT_ID: "configured",
              ELECTRON_RUN_AS_NODE: "1",
              PASEO_SUPERVISED: "1",
              CLAUDECODE: "1",
            },
          },
        }),
    );
    const config = { provider: "opencode" as const, cwd: "/tmp/project" };
    const launches = ["first", "second"].map((id) => ({
      env: { PASEO_AGENT_ID: id, PASEO_AGENT_CWD: config.cwd },
    }));
    const assertEnvironment = (index: number) => {
      const env = environments.get([first, second][index].info.id);
      expect(env?.PATH).toBe(process.env.PATH);
      expect(env).toMatchObject({ ...launches[index].env, PASEO_ENV_TEST: "configured" });
      expect(env?.USER).toBe(process.env.USER);
      for (const key of [
        "ELECTRON_RUN_AS_NODE",
        "PASEO_SUPERVISED",
        "CLAUDECODE",
        "ESBUILD_BINARY_PATH",
        "PASEO_NODE_ENV",
      ]) {
        expect(env).not.toHaveProperty(key);
      }
    };
    const sessions = await Promise.all(
      clients.map((client, i) => client.createSession(config, launches[i])),
    );
    try {
      assertEnvironment(0);
      assertEnvironment(1);
      environments.clear();
      first.push({ id: "reconnected-first", created: 2, type: "server.connected", data: {} });
      second.push({ id: "reconnected-second", created: 2, type: "server.connected", data: {} });
      await expect.poll(() => environments.size).toBe(2);
      assertEnvironment(0);
      assertEnvironment(1);
    } finally {
      await Promise.all(sessions.map((session) => session.close()));
    }
    environments.clear();
    const resumed = await Promise.all(
      clients.map((client, i) =>
        client.resumeSession(sessions[i].describePersistence(), undefined, launches[i]),
      ),
    );
    try {
      assertEnvironment(0);
      assertEnvironment(1);
      expect(first.prompts).toEqual([]);
      expect(second.prompts).toEqual([]);
    } finally {
      await Promise.all(resumed.map((session) => session.close()));
    }
  });

  test("reconnects after a helper exits and restores session configuration on the next turn", async () => {
    const first = new V2Harness();
    const second = new V2Harness(1);
    let exit!: (error: Error) => void;
    const exited = new Promise<Error>((resolve) => {
      exit = resolve;
    });
    let acquisitions = 0;
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: {
        acquire: async () => {
          acquisitions += 1;
          return acquisitions === 1 ? { ...first.connection, exited } : second.connection;
        },
        shutdown: async () => undefined,
      },
    });
    first.autoComplete = false;
    second.prompt = async (input) => {
      second.history.push({
        id: "answer",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "model" },
        time: { created: 2 },
        content: [{ type: "text", text: "recovered" }],
      });
      second.prompts.push(input.text);
    };
    const session = await client.createSession(
      {
        provider: "opencode",
        cwd: "/tmp/project",
        mcpServers: { tools: { type: "stdio", command: "tools" } },
      },
      { env: { TOKEN: "test" } },
    );
    const running = session.run("before exit");
    await expect.poll(() => first.prompts).toEqual(["before exit"]);
    exit(new Error("helper exited"));
    await expect(running).rejects.toThrow("helper exited");
    expect(acquisitions).toBe(1);
    try {
      expect((await session.run("after exit")).finalText).toBe("recovered");
      expect(second.prompts).toEqual(["after exit"]);
      expect(second.mcpAdds).toEqual(["tools"]);
      expect(second.environments).toMatchObject([
        { sessionID: "session", variables: { TOKEN: "test", PATH: process.env.PATH } },
      ]);
      expect(second.environments).toEqual(first.environments);
      expect(first.releases).toBe(1);
    } finally {
      await session.close();
    }
    await expect(session.startTurn("after close")).rejects.toThrow("OpenCode session is closed");
  });
  test("proxies an MCP elicitation into a question card and sends the answer back", async () => {
    const harness = new V2Harness();
    const adds: Array<{ server: string; config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ server: input.server, config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      mcpServers: { grants: { type: "stdio", command: "node", args: ["server.mjs"] } },
    });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    try {
      expect(adds.map((add) => add.server)).toEqual(["grants"]);
      const registered = adds[0]!.config;
      expect(registered.type).toBe("local");
      expect(registered.command).toEqual([
        process.execPath,
        expect.stringMatching(/mcp-proxy-shim\.mjs$/),
      ]);
      const env = registered.environment as Record<string, string>;
      expect(env.PASEO_MCP_PROXY_CONFIG).toBeTruthy();

      // The shim calls this loopback URL when the upstream MCP server asks for input.
      const elicitation = fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message: "Confirm the grant and pick a duration.",
              requestedSchema: {
                type: "object",
                properties: {
                  grant: { type: "boolean", title: "Grant SSH" },
                  duration: {
                    type: "string",
                    title: "Duration",
                    oneOf: [
                      { const: "4h", title: "4 hours" },
                      { const: "8h", title: "8 hours" },
                    ],
                  },
                },
                required: ["grant", "duration"],
              },
            },
          },
        }),
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);
      const asked = events.find(
        (event): event is Extract<AgentStreamEvent, { type: "permission_requested" }> =>
          event.type === "permission_requested",
      )!;
      expect(asked.request.input).toMatchObject({
        elicitation: true,
        questions: [
          { header: "Grant SSH", type: "boolean" },
          { header: "Duration", options: [{ label: "4 hours" }, { label: "8 hours" }] },
        ],
      });
      expect(session.getPendingPermissions().map((request) => request.id)).toEqual([
        asked.request.id,
      ]);

      await session.respondToPermission(asked.request.id, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true", Duration: "8 hours" } },
      });
      await expect(elicitation).resolves.toBeDefined();
      const answer = await (await elicitation).json();
      expect(answer).toEqual({ action: "accept", content: { grant: true, duration: "8h" } });
      expect(session.getPendingPermissions()).toEqual([]);
    } finally {
      unsubscribe();
      await session.close();
    }
  });

  test("wraps MCP servers from OpenCode's own config in the elicitation shim", async () => {
    const harness = new V2Harness();
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    const adds: Array<{ server: string; config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ server: input.server, config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    try {
      expect(adds).toHaveLength(1);
      const config = adds[0]!.config;
      expect(config.type).toBe("local");
      expect(config.command).toEqual([
        process.execPath,
        expect.stringMatching(/mcp-proxy-shim\.mjs$/),
      ]);
      const env = config.environment as Record<string, string>;
      expect(
        JSON.parse(Buffer.from(env.PASEO_MCP_PROXY_CONFIG!, "base64").toString("utf8")),
      ).toMatchObject({ type: "stdio", command: "node", args: ["server.mjs"] });

      const elicitation = fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message: "Confirm the grant.",
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);
      const asked = events.find(
        (event): event is Extract<AgentStreamEvent, { type: "permission_requested" }> =>
          event.type === "permission_requested",
      )!;
      expect(asked.request.input).toMatchObject({
        elicitation: true,
        questions: [{ header: "Grant SSH", type: "boolean" }],
      });
      await session.respondToPermission(asked.request.id, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true" } },
      });
      expect(await (await elicitation).json()).toEqual({
        action: "accept",
        content: { grant: true },
      });
    } finally {
      unsubscribe();
      await session.close();
    }
  });

  test("preserves OpenCode tool visibility when wrapping harness MCP servers", async () => {
    const harness = new V2Harness();
    harness.harnessMcpConfig.set("/tmp/project", {
      direct: { type: "local", command: ["node", "direct.mjs"] },
      coded: { type: "local", command: ["node", "coded.mjs"], codemode: true },
    });
    const adds: Array<{ server: string; config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ server: input.server, config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      // OpenCode defaults dynamically added servers to Code Mode, so the
      // wrapper must state the original visibility explicitly.
      expect(adds.map((add) => add.server).sort()).toEqual(["coded", "direct"]);
      expect(adds.find((add) => add.server === "direct")?.config.codemode).toBe(false);
      expect(adds.find((add) => add.server === "coded")?.config.codemode).toBe(true);
      const directEnv = adds.find((add) => add.server === "direct")!.config.environment as Record<
        string,
        string
      >;
      expect(
        JSON.parse(Buffer.from(directEnv.PASEO_MCP_PROXY_CONFIG!, "base64").toString("utf8")),
      ).toMatchObject({ type: "stdio", command: "node", args: ["direct.mjs"] });
    } finally {
      await session.close();
    }
  });

  test("starts the MCP proxy shim and relays the upstream tool catalog", async () => {
    // A shim that throws during startup connects no tools at all. Exercise the
    // real script against a real upstream server so a broken SDK call fails here.
    const env = definedEnv();
    env.PASEO_MCP_PROXY_CONFIG = Buffer.from(
      JSON.stringify({
        type: "stdio",
        command: process.execPath,
        args: ["--input-type=module", "-e", UPSTREAM_SERVER_SCRIPT],
        name: "grants",
      }),
    ).toString("base64");
    env.PASEO_MCP_PROXY_CALLBACK = "http://127.0.0.1:1/elicit";
    env.PASEO_MCP_PROXY_TOKEN = "shim-regression";
    env.PASEO_MCP_PROXY_LOG = path.join(tmpdir(), `paseo-shim-regression-${process.pid}.log`);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SHIM],
      cwd: SERVER_ROOT,
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "shim-regression", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("ask_grant");
    } finally {
      await client.close();
    }
  });

  test("routes an elicitation raised inside a Code Mode execute call", async () => {
    const harness = new V2Harness();
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    let env: Record<string, string> = {};
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      env = input.config.environment as Record<string, string>;
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      // Code Mode calls the wrapped server through `execute`, so the tool name
      // carries no server prefix; the call still must mark the session as the
      // elicitation target.
      harness.push({
        id: "started-execute",
        created: 50,
        type: "session.tool.input.started",
        durable: { aggregateID: session.id, seq: 50, version: 1 as const },
        data: {
          sessionID: session.id,
          assistantMessageID: "message",
          id: "call-execute",
          name: "execute",
        },
      });
      const elicitation = fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message: "Grant request from Code Mode",
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);
      const requestId = session.getPendingPermissions()[0]!.id;
      await session.respondToPermission(requestId, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true" } },
      });
      expect(await (await elicitation).json()).toEqual({
        action: "accept",
        content: { grant: true },
      });
    } finally {
      await session.close();
    }
  });

  test("routes an elicitation to the session with the running call even after a sibling closes", async () => {
    const harness = new V2Harness();
    harness.distinctSessionIds = true;
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    const adds: Array<{ server: string; config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ server: input.server, config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const a = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const b = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const eventsA: AgentStreamEvent[] = [];
    const eventsB: AgentStreamEvent[] = [];
    const unsubA = a.subscribe((event) => eventsA.push(event));
    const unsubB = b.subscribe((event) => eventsB.push(event));
    const ask = async (toolCallId: string) => {
      const started = {
        id: `started-${toolCallId}`,
        created: 50,
        type: "session.tool.input.started" as const,
        durable: { aggregateID: a.id, seq: 50, version: 1 as const },
        data: {
          sessionID: a.id,
          assistantMessageID: "message",
          id: toolCallId,
          name: "grants_ask_grant",
        },
      };
      // The harness queue is consumed by one subscriber at a time; publish
      // twice so both session streams see the event and filter by sessionID.
      harness.push(started);
      harness.push({ ...started, id: `started-2-${toolCallId}` });
      const env = adds[0]!.config.environment as Record<string, string>;
      const responsePromise = fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message: "Confirm the grant.",
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });
      await expect.poll(() => a.getPendingPermissions()).toHaveLength(1);
      expect(b.getPendingPermissions()).toEqual([]);
      expect(eventsA.some((event) => event.type === "permission_requested")).toBe(true);
      expect(eventsB.some((event) => event.type === "permission_requested")).toBe(false);
      await a.respondToPermission(a.getPendingPermissions()[0]!.id, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true" } },
      });
      expect(await (await responsePromise).json()).toEqual({
        action: "accept",
        content: { grant: true },
      });
    };
    try {
      expect(adds).toHaveLength(1); // wrapped once for the shared location
      await ask("call-1");
      await b.close();
      await ask("call-2");
    } finally {
      unsubA();
      unsubB();
      await a.close();
    }
  });

  test("wraps harness MCP on a discovered service but declines uncaptured elicitation", async () => {
    const harness = new V2Harness();
    (harness.connection as { serviceKind: string }).serviceKind = "discovered";
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    const adds: Array<{ server: string; config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ server: input.server, config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      expect(adds.map((add) => add.server)).toEqual(["grants"]);
      expect(adds[0]!.config.command).toEqual([
        process.execPath,
        expect.stringMatching(/mcp-proxy-shim\.mjs$/),
      ]);
      const env = adds[0]!.config.environment as Record<string, string>;
      // No Paseo tool call is in flight: a non-Paseo client's request is
      // declined and no question card is emitted on any Paseo chat.

      const response = await fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message: "External client grant request",
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });

      expect(await response.json()).toEqual({ action: "decline" });
      expect(session.getPendingPermissions()).toEqual([]);
    } finally {
      await session.close();
    }
  });

  test("keeps A's unanswered card when B's elicitation arrives on the same server", async () => {
    const harness = new V2Harness();
    harness.distinctSessionIds = true;
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    const adds: Array<{ config: Record<string, unknown> }> = [];
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      adds.push({ config: input.config as Record<string, unknown> });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const a = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const b = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const started = (sessionId: string, toolCallId: string) => ({
      id: `started-${toolCallId}`,
      created: 50,
      type: "session.tool.input.started" as const,
      durable: { aggregateID: sessionId, seq: 50, version: 1 as const },
      data: {
        sessionID: sessionId,
        assistantMessageID: "message",
        id: toolCallId,
        name: "grants_ask_grant",
      },
    });
    const ask = (message: string) => {
      const env = adds[0]!.config.environment as Record<string, string>;
      return fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            params: {
              mode: "form",
              message,
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });
    };
    try {
      harness.push(started(a.id, "call-a"));
      harness.push(started(a.id, "call-a"));
      const responseA = ask("A grant");
      await expect.poll(() => a.getPendingPermissions()).toHaveLength(1);
      const requestA = a.getPendingPermissions()[0]!.id;
      harness.push(started(b.id, "call-b"));
      harness.push(started(b.id, "call-b"));
      const responseB = ask("B grant");
      await expect.poll(() => b.getPendingPermissions()).toHaveLength(1);
      const requestB = b.getPendingPermissions()[0]!.id;
      // B's elicitation must not withdraw A's still-open card.
      expect(a.getPendingPermissions().map((request) => request.id)).toEqual([requestA]);
      expect(requestB).not.toBe(requestA);

      await b.respondToPermission(requestB, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true" } },
      });
      expect(await (await responseB).json()).toEqual({
        action: "accept",
        content: { grant: true },
      });
      // A's original card is still answerable after B finished.
      await a.respondToPermission(requestA, {
        behavior: "allow",
        updatedInput: { answers: { "Grant SSH": "true" } },
      });
      expect(await (await responseA).json()).toEqual({
        action: "accept",
        content: { grant: true },
      });
      expect(a.getPendingPermissions()).toEqual([]);
      expect(b.getPendingPermissions()).toEqual([]);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test("withdraws the card when the upstream MCP request is cancelled", async () => {
    const harness = new V2Harness();
    harness.harnessMcpConfig.set("/tmp/project", {
      grants: { type: "local", command: ["node", "server.mjs"] },
    });
    let env: Record<string, string> = {};
    harness.api.mcp.add = async (input) => {
      harness.mcpAdds.push(input.server);
      env = input.config.environment as Record<string, string>;
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    try {
      harness.push({
        id: "started-cancel",
        created: 50,
        type: "session.tool.input.started",
        durable: { aggregateID: session.id, seq: 50, version: 1 as const },
        data: {
          sessionID: session.id,
          assistantMessageID: "message",
          id: "call-cancel",
          name: "grants_ask_grant",
        },
      });
      const elicitation = fetch(env.PASEO_MCP_PROXY_CALLBACK!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: env.PASEO_MCP_PROXY_TOKEN,
          request: {
            id: "req-1",
            params: {
              mode: "form",
              message: "Grant request",
              requestedSchema: {
                type: "object",
                properties: { grant: { type: "boolean", title: "Grant SSH" } },
                required: ["grant"],
              },
            },
          },
        }),
      });
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(1);
      const requestId = session.getPendingPermissions()[0]!.id;
      const cancelled = await fetch(
        env.PASEO_MCP_PROXY_CALLBACK!.replace(/\/elicit$/, "/elicit-cancel"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: env.PASEO_MCP_PROXY_TOKEN,
            request: { id: "req-1", reason: "cancelled" },
          }),
        },
      );
      expect(cancelled.status).toBe(200);
      await expect.poll(() => session.getPendingPermissions()).toHaveLength(0);
      expect(await (await elicitation).json()).toEqual({ action: "decline" });
      expect(
        events.some(
          (event) =>
            event.type === "timeline" &&
            event.item.type === "notification" &&
            event.item.message.includes("withdrawn"),
        ),
      ).toBe(true);
      await expect(
        session.respondToPermission(requestId, {
          behavior: "allow",
          updatedInput: { answers: { "Grant SSH": "true" } },
        }),
      ).rejects.toThrow(/expired/);
    } finally {
      unsubscribe();
      await session.close();
    }
  });

  test("keeps the chat usable when an MCP server fails", async () => {
    const harness = new V2Harness();
    harness.mcpAddFailures.add("broken");
    harness.mcpConnectFailures.set("cloudflare", "Error POSTing to endpoint: (HTTP 401)");
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      mcpServers: {
        broken: { type: "stdio", command: "broken" },
        cloudflare: { type: "remote", url: "https://example.test/mcp" },
        tools: { type: "stdio", command: "tools" },
      },
    });
    try {
      expect(harness.mcpAdds).toEqual(["broken", "cloudflare", "tools"]);
      await session.startTurn("hello");
      expect(harness.prompts).toEqual(["hello"]);
    } finally {
      await session.close();
    }
  });

  test("does not add an MCP server the location already provides", async () => {
    const harness = new V2Harness();
    harness.mcpExisting.add("cloudflare");
    harness.mcpExisting.add("paseo");
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      mcpServers: {
        paseo: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a" },
        cloudflare: { type: "remote", url: "https://example.test/mcp" },
        tools: { type: "stdio", command: "tools" },
      },
    });
    try {
      expect(harness.mcpAdds).toEqual(["tools"]);
      await session.startTurn("hello");
      expect(harness.prompts).toEqual(["hello"]);
    } finally {
      await session.close();
    }
  });

  test("does not register the Paseo MCP server when the tool plugin carries the catalog", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
      bridge: toolBridge(),
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      mcpServers: {
        paseo: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a" },
        tools: { type: "stdio", command: "tools" },
      },
    });
    try {
      expect(harness.mcpAdds).toEqual(["tools"]);
      await session.startTurn("hello");
      expect(harness.prompts).toEqual(["hello"]);
    } finally {
      await session.close();
    }
  });

  test("fails initialization when the event stream ends before connecting", async () => {
    const harness = new V2Harness();
    harness.api.event.subscribe = async function* () {};
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    await expect(
      client.createSession({ provider: "opencode", cwd: "/tmp/project" }),
    ).rejects.toThrow("event stream ended before connecting");
    expect(harness.releases).toBeGreaterThan(0);
  });

  test("returns only validated structured output and preserves it in history", async () => {
    const harness = new V2Harness();
    harness.prompt = async (input) => {
      harness.history.push({
        id: "user",
        type: "user",
        text: input.text,
        metadata: input.metadata,
        time: { created: 1 },
      });
      harness.history.push({
        id: "answer",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "model" },
        time: { created: 2 },
        content: [
          { type: "text", text: "Here is the answer" },
          {
            type: "tool",
            id: "output",
            name: "paseo_structured_output",
            time: { created: 2 },
            state: {
              status: "completed",
              input: { value: { answer: 42 } },
              content: [{ type: "text", text: "accepted" }],
              metadata: { paseoStructuredOutput: { answer: 42 } },
            },
          },
        ],
      });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      const result = await session.run("answer", {
        outputSchema: {
          type: "object",
          properties: { answer: { const: 42 } },
          required: ["answer"],
        },
      });
      expect(result.finalText).toBe('{"answer":42}');
      const history = [];
      for await (const event of session.streamHistory!()) history.push(event);
      expect(history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "timeline",
            item: expect.objectContaining({ type: "assistant_message", text: result.finalText }),
          }),
        ]),
      );
    } finally {
      await session.close();
    }
  });

  test("fails a structured turn when the model omits the validated output tool", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      await expect(session.run("answer", { outputSchema: { type: "object" } })).rejects.toThrow(
        "without submitting the required structured output",
      );
    } finally {
      await session.close();
    }
  });

  test("resumes the native session ID and never replaces a missing session", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const handle = {
      provider: "opencode",
      sessionId: "session",
      nativeHandle: "session",
      metadata: { cwd: "/tmp/project" },
    } as const;
    harness.api.session.switchAgent = async ({ agent }) => {
      harness.info.agent = agent;
    };
    harness.api.session.switchModel = async ({ model }) => {
      harness.info.model = model;
    };
    const session = await client.resumeSession(handle, {
      modeId: "plan",
      model: "synthetic/test",
      thinkingOptionId: "low",
    });
    try {
      expect(await session.getRuntimeInfo!()).toMatchObject({
        modeId: "plan",
        model: "synthetic/test",
        thinkingOptionId: "low",
      });
      expect(await session.describePersistence()).toMatchObject({
        sessionId: "session",
        nativeHandle: "session",
      });
      expect(harness.creates).toEqual([]);
    } finally {
      await session.close();
    }
    harness.api.session.get = async () => {
      throw new Error("Session not found");
    };
    await expect(client.resumeSession(handle)).rejects.toThrow("Session not found");
    expect(harness.creates).toEqual([]);
  });

  test("reconciles reconnect snapshots without replaying text or losing repeated chunks", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const finish = () => harness.finishExecution();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const chunks: string[] = [];
    session.subscribe((event) => {
      if (event.type === "timeline" && event.item.type === "assistant_message")
        chunks.push(event.item.text);
    });
    try {
      const running = session.run("laugh");
      await expect.poll(() => harness.prompts).toEqual(["laugh"]);
      const answer = {
        id: "answer",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "model" },
        time: { created: 2 },
        content: [{ type: "text", text: "ha" }],
      } satisfies SessionMessageInfo;
      harness.history.push(answer);
      harness.push({ id: "reconnect-1", created: 2, type: "server.connected", data: {} });
      await expect.poll(() => chunks).toEqual(["ha"]);
      answer.content[0].text = "haha";
      harness.push({ id: "reconnect-2", created: 3, type: "server.connected", data: {} });
      await expect.poll(() => chunks).toEqual(["ha", "ha"]);
      finish();
      expect((await running).finalText).toBe("haha");
      expect(chunks).toEqual(["ha", "ha"]);
    } finally {
      await session.close();
    }
  });

  test("retries observation failures without replacing the execution error", async () => {
    const harness = new V2Harness();
    harness.info.outcome = "failed";
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      let attempted = false;
      harness.api.session.log = () => {
        attempted = true;
        throw new Error("log unavailable");
      };
      await session.startTurn("hello");
      const failures = () => events.filter((event) => event.type === "turn_failed");
      await expect.poll(() => attempted).toBe(true);
      expect(failures()).toEqual([]);
      harness.api.session.log = async function* () {
        yield {
          id: "failure",
          created: 2,
          durable: { aggregateID: "session", seq: 2, version: 1 },
          type: "session.execution.failed",
          data: { sessionID: "session", error: { type: "provider", message: "quota exhausted" } },
        };
      };
      harness.push({ id: "reconnect", created: 3, type: "server.connected", data: {} });
      await expect.poll(failures).toHaveLength(1);
      expect(failures()[0]).toMatchObject({ error: "quota exhausted" });
      expect(events.filter((event) => event.type === "turn_completed")).toHaveLength(0);
    } finally {
      await session.close();
    }
  });

  test("waits for prompt acceptance before interrupting", async () => {
    const harness = new V2Harness();
    let accept!: () => void;
    const settle = () => harness.finishExecution("interrupted");
    let interruptions = 0;
    harness.prompt = () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      });

    harness.interrupt = async () => {
      interruptions += 1;
      harness.info.outcome = "interrupted";
      settle();
      return { interrupted: true };
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      await session.startTurn("first");
      const stopping = session.interrupt();
      await Promise.resolve();
      expect(interruptions).toBe(0);
      accept();
      await stopping;
      expect(interruptions).toBe(1);
    } finally {
      await session.close();
    }
  });

  test("completes a submitted turn once and reconciles its final text", async () => {
    const harness = new V2Harness();
    harness.prompt = async (input) => {
      harness.prompts.push(input.text);
      harness.history.push({
        id: "answer",
        type: "assistant",
        agent: "build",
        model: { providerID: "test", id: "model" },
        time: { created: 2 },
        content: [{ type: "text", text: "done" }],
      });
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));
    try {
      const result = await session.run("hello");
      expect(result.finalText).toBe("done");
      expect(events.filter((event) => event.type === "turn_completed")).toHaveLength(1);
      expect(harness.creates[0]).toMatchObject({
        agent: "build",
        location: { directory: "/tmp/project" },
      });
    } finally {
      await session.close();
    }
    expect(harness.releases).toBe(1);
  });

  test("waits for interruption settlement before submitting replacement work", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const finishFirst = () => harness.finishExecution("interrupted");
    let finishStop!: () => void;
    harness.interrupt = () =>
      new Promise((resolve) => {
        finishStop = () => {
          harness.info.outcome = "interrupted";
          finishFirst();
          resolve({ interrupted: true });
        };
      });
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      await session.startTurn("first");
      await expect.poll(() => harness.prompts).toEqual(["first"]);
      const stopping = session.interrupt();
      const replacement = session.startTurn("second");
      await Promise.resolve();
      expect(harness.prompts).toEqual(["first"]);
      harness.autoComplete = true;
      finishStop();
      await stopping;
      await replacement;
      await expect.poll(() => harness.prompts).toEqual(["first", "second"]);
    } finally {
      await session.close();
    }
  });

  test("reuses the shared helper for sessions whose env is only agent identity", async () => {
    const harness = new V2Harness();
    const acquires: Array<{ env?: Record<string, string>; dedicated?: boolean }> = [];
    const runtime = {
      acquire: async (input: { env?: Record<string, string>; dedicated?: boolean } = {}) => {
        acquires.push(input);
        return harness.connection;
      },
      shutdown: async () => undefined,
    };
    const client = new OpenCodeV2AgentClient({ logger: createTestLogger(), runtime });
    const session = await client.createSession(
      { provider: "opencode", cwd: "/tmp/project" },
      { agentId: "agent", env: { PASEO_AGENT_ID: "agent", PASEO_AGENT_CWD: "/tmp/project" } },
    );
    try {
      expect(acquires).toEqual([{}]);
      expect(harness.environments).toMatchObject([
        {
          sessionID: "session",
          variables: { PASEO_AGENT_ID: "agent", PASEO_AGENT_CWD: "/tmp/project" },
        },
      ]);
    } finally {
      await session.close();
    }
  });

  test("starts a dedicated helper when the session carries custom MCP", async () => {
    const harness = new V2Harness();
    const acquires: Array<{ env?: Record<string, string>; dedicated?: boolean }> = [];
    const runtime = {
      acquire: async (input: { env?: Record<string, string>; dedicated?: boolean } = {}) => {
        acquires.push(input);
        return harness.connection;
      },
      shutdown: async () => undefined,
    };
    const client = new OpenCodeV2AgentClient({ logger: createTestLogger(), runtime });
    const session = await client.createSession(
      {
        provider: "opencode",
        cwd: "/tmp/project",
        mcpServers: { custom: { type: "stdio", command: "custom", args: [] } },
      },
      { agentId: "agent", env: { PASEO_AGENT_ID: "agent", PASEO_AGENT_CWD: "/tmp/project" } },
    );
    try {
      expect(acquires).toHaveLength(1);
      expect(acquires[0]?.dedicated).toBe(true);
    } finally {
      await session.close();
    }
  });

  test("does not register the Paseo MCP server when the tool plugin carries the catalog", async () => {
    const harness = new V2Harness();
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
      bridge: {
        bindSession: () => () => undefined,
        decorateV2ServerEnv: async (env: Record<string, string>) => env,
      } as unknown as OpenCodeBridge,
    });
    const session = await client.createSession({
      provider: "opencode",
      cwd: "/tmp/project",
      mcpServers: {
        paseo: { type: "http", url: "http://127.0.0.1:6767/mcp/agents?callerAgentId=a" },
        tools: { type: "stdio", command: "tools" },
      },
    });
    try {
      expect(harness.mcpAdds).toEqual(["tools"]);
      await session.startTurn("hello");
      expect(harness.prompts).toEqual(["hello"]);
    } finally {
      await session.close();
    }
  });

  test("refuses replacement work after a failed stop until Stop succeeds", async () => {
    const harness = new V2Harness();
    harness.autoComplete = false;
    const finishFirst = () => harness.finishExecution("interrupted");
    harness.interrupt = async () => {
      throw new Error("stop failed");
    };
    const client = new OpenCodeV2AgentClient({
      logger: createTestLogger(),
      runtime: harness.runtime,
    });
    const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
    try {
      await session.startTurn("first");
      await expect.poll(() => harness.prompts).toEqual(["first"]);
      await expect(session.interrupt()).rejects.toThrow("stop failed");
      await expect(session.startTurn("unsafe replacement")).rejects.toThrow("stop failed");
      expect(harness.prompts).toEqual(["first"]);
      harness.interrupt = async () => {
        finishFirst();
        return { interrupted: true };
      };
      await session.interrupt();
      harness.autoComplete = true;
      await session.startTurn("retry");
      await expect.poll(() => harness.prompts).toEqual(["first", "retry"]);
    } finally {
      await session.close();
    }
  });
});

test("OpenCode v2 runtime safety retains shells, queued reports and shared executions", async () => {
  const harness = new V2Harness();
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  try {
    expect(await session.canStopRuntime!()).toBe(true);
    harness.api.shell.list = async () => ({
      location: { directory: "/tmp/project" },
      data: [
        {
          id: "quiet-shell",
          status: "running",
          command: "sleep 7200",
          cwd: "/tmp/project",
          shell: "sh",
          file: "/tmp/out",
          metadata: {},
          time: { started: 1 },
        },
      ],
    });
    expect(await session.canStopRuntime!()).toBe(false);
    harness.api.shell.list = async () => ({ location: { directory: "/tmp/project" }, data: [] });
    harness.api.session.inbox.list = async () => [
      {
        id: "report",
        sessionID: session.id!,
        type: "synthetic",
        delivery: "queue",
        time: { created: 1 },
        payload: { text: "Background child finished" },
      },
    ];
    expect(await session.canStopRuntime!()).toBe(false);
    harness.api.session.inbox.list = async () => [];
    harness.api.session.active = async () => ({
      "unrelated-autonomous-session": { type: "running" },
    });
    expect(await session.canStopRuntime!()).toBe(false);
    harness.api.session.active = async () => ({});
    expect(await session.canStopRuntime!()).toBe(true);
    harness.api.shell.list = async () => {
      throw new Error("No shell inventory");
    };
    await expect(session.canStopRuntime!()).rejects.toThrow("No shell inventory");
  } finally {
    await session.close();
  }
});

test("OpenCode v2 runtime safety follows descendant locations before releasing the last lease", async () => {
  const harness = new V2Harness();
  const child = {
    ...harness.info,
    id: "child",
    parentID: harness.info.id,
    location: { directory: "/tmp/child-worktree" },
  };
  const locations: string[] = [];
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  // A completed native child can still own a quiet shell in another location.
  harness.api.session.list = async (input) => ({
    data: input.parentID === session.id ? [child] : [],
    cursor: {},
  });
  let running = true;
  harness.api.shell.list = async (input) => {
    const directory = input?.location?.directory ?? "";
    locations.push(directory);
    return {
      location: { directory },
      data:
        directory === child.location.directory && running
          ? [
              {
                id: "child-shell",
                status: "running",
                command: "sleep 7200",
                cwd: directory,
                shell: "sh",
                file: "/tmp/out",
                metadata: {},
                time: { started: 1 },
              },
            ]
          : [],
    };
  };
  try {
    expect(await session.canStopRuntime!()).toBe(false);
    expect(locations).toEqual(["/tmp/project", "/tmp/child-worktree"]);
    running = false;
    expect(await session.canStopRuntime!()).toBe(true);
    await session.close();
    expect(harness.releases).toBe(1);
  } finally {
    await session.close();
  }
});

test("reconstructs only promoted session-owned running shells and reconciles exits", async () => {
  const harness = new V2Harness();
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool",
        name: "shell",
        time: { created: 1 },
        state: {
          status: "completed",
          input: { description: "Watch tests", command: "sleep ours" },
          content: [{ type: "text", text: "" }],
          metadata: { status: "running", shellID: "ours" },
        },
      },
    ],
  });
  harness.api.message.list = async (input) =>
    input.cursor
      ? { data: [...harness.history], cursor: {} }
      : { data: [], cursor: { next: "second-page" } };
  let live = ["ours", "other"];
  harness.api.shell.list = async () => ({
    location: harness.info.location,
    data: live.map((id) => ({
      id,
      status: "running" as const,
      command: `sleep ${id}`,
      cwd: "/tmp/project",
      shell: "sh",
      file: "sh",
      metadata: { sessionID: id === "ours" ? harness.info.id : "other" },
      time: { started: 1 },
    })),
  });
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({
        items: [{ id: "ours", kind: "shell", description: "Watch tests", command: "sleep ours" }],
      });
    live = [];
    harness.push({ id: "reconnect", created: 2, type: "server.connected", data: {} });
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [] });
  } finally {
    await session.close();
  }
});

test("an exit received during shell listing cannot restore an old row", async () => {
  const harness = new V2Harness();
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool",
        name: "shell",
        time: { created: 1 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "" }],
          metadata: { status: "running", shellID: "shell" },
        },
      },
    ],
  });
  const shell = {
    id: "shell",
    status: "running" as const,
    command: "sleep 120",
    cwd: "/tmp/project",
    shell: "sh",
    file: "sh",
    metadata: { sessionID: harness.info.id },
    time: { started: 1 },
  };
  let listCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.api.shell.list = async () => {
    listCount++;
    if (listCount === 2) {
      await gate;
      return { location: harness.info.location, data: [shell] };
    }
    return { location: harness.info.location, data: [] };
  };
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    harness.push({ id: "created", created: 2, type: "shell.created", data: { info: shell } });
    await expect.poll(() => listCount).toBe(2);
    harness.push({
      id: "exited",
      created: 3,
      type: "shell.exited",
      data: { id: "shell", status: "exited" },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await expect.poll(() => listCount).toBeGreaterThan(2);
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [] });
    expect(events.filter((event) => event.type === "background_work")).not.toContainEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: "shell" })] }),
    );
  } finally {
    release();
    await session.close();
  }
});

test("does not publish a shell list from a lost server generation", async () => {
  const harness = new V2Harness();
  let exit!: (error: Error) => void;
  Object.assign(harness.connection, {
    exited: new Promise<Error>((resolve) => {
      exit = resolve;
    }),
  });
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool",
        name: "shell",
        time: { created: 1 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "" }],
          metadata: { status: "running", shellID: "old" },
        },
      },
    ],
  });
  const shell = {
    id: "old",
    status: "running" as const,
    command: "sleep 120",
    cwd: "/tmp/project",
    shell: "sh",
    file: "sh",
    metadata: { sessionID: harness.info.id },
    time: { started: 1 },
  };
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.api.shell.list = async () => {
    reads++;
    if (reads === 2) {
      await gate;
      return { location: harness.info.location, data: [shell] };
    }
    return { location: harness.info.location, data: [] };
  };
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    harness.push({ id: "created", created: 2, type: "shell.created", data: { info: shell } });
    await expect.poll(() => reads).toBe(2);
    exit(new Error("server exited"));
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: null });
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.filter((event) => event.type === "background_work")).not.toContainEqual(
      expect.objectContaining({ items: [expect.objectContaining({ id: "old" })] }),
    );
  } finally {
    release();
    await session.close();
  }
});

test("polls a live shell without rereading conversation history", async () => {
  const harness = new V2Harness();
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool",
        name: "shell",
        time: { created: 1 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "" }],
          metadata: { status: "running", shellID: "live" },
        },
      },
    ],
  });
  let historyReads = 0;
  let shellReads = 0;
  const readHistory = harness.api.message.list;
  harness.api.message.list = async (...args) => {
    historyReads++;
    return readHistory(...args);
  };
  harness.api.shell.list = async () => {
    shellReads++;
    return {
      location: harness.info.location,
      data: [
        {
          id: "live",
          status: "running",
          command: "sleep 120",
          cwd: "/tmp/project",
          shell: "sh",
          file: "sh",
          metadata: { sessionID: harness.info.id },
          time: { started: 1 },
        },
      ],
    };
  };
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [{ id: "live" }] });
    const initialHistoryReads = historyReads;
    const initialShellReads = shellReads;
    await expect.poll(() => shellReads, { timeout: 7000 }).toBeGreaterThan(initialShellReads);
    expect(historyReads).toBe(initialHistoryReads);
  } finally {
    await session.close();
  }
}, 12000);

test("buffers tool promotion and shell events during background history bootstrap", async () => {
  const harness = new V2Harness();
  let historyReads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  harness.api.message.list = async () => {
    historyReads++;
    if (historyReads === 3) await gate;
    return { data: [], cursor: {} };
  };
  const shell = {
    id: "promoted",
    status: "running" as const,
    command: "sleep 120",
    cwd: "/tmp/project",
    shell: "sh",
    file: "sh",
    metadata: { sessionID: harness.info.id },
    time: { started: 1 },
  };
  harness.api.shell.list = async () => ({ location: harness.info.location, data: [shell] });
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    await expect.poll(() => historyReads).toBeGreaterThanOrEqual(3);
    harness.push({
      id: "input",
      created: 2,
      type: "session.tool.input.started",
      durable: { aggregateID: harness.info.id, seq: 1, version: 1 },
      data: { sessionID: harness.info.id, assistantMessageID: "msg", id: "tool", name: "shell" },
    });
    harness.push({
      id: "input-ended",
      created: 3,
      type: "session.tool.input.ended",
      durable: { aggregateID: harness.info.id, seq: 2, version: 1 },
      data: {
        sessionID: harness.info.id,
        assistantMessageID: "msg",
        id: "tool",
        text: JSON.stringify({ description: "Watch tests", command: "sleep 120" }),
      },
    });
    harness.push({ id: "created", created: 3, type: "shell.created", data: { info: shell } });
    harness.push({
      id: "success",
      created: 4,
      type: "session.tool.success",
      durable: { aggregateID: harness.info.id, seq: 3, version: 2 },
      data: {
        sessionID: harness.info.id,
        assistantMessageID: "msg",
        id: "tool",
        executed: true,
        content: [{ type: "text", text: "" }],
        metadata: { status: "running", shellID: "promoted" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.filter((event) => event.type === "background_work")).toEqual([]);
    release();
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({
        items: [{ id: "promoted", description: "Watch tests", command: "sleep 120" }],
      });
    harness.push({
      id: "next-input",
      created: 5,
      type: "session.tool.input.started",
      durable: { aggregateID: harness.info.id, seq: 4, version: 1 },
      data: { sessionID: harness.info.id, assistantMessageID: "next", id: "tool", name: "shell" },
    });
    harness.push({
      id: "next-success",
      created: 6,
      type: "session.tool.success",
      durable: { aggregateID: harness.info.id, seq: 5, version: 2 },
      data: {
        sessionID: harness.info.id,
        assistantMessageID: "next",
        id: "tool",
        executed: true,
        content: [{ type: "text", text: "" }],
        metadata: { status: "running", shellID: "second" },
      },
    });
    harness.api.shell.list = async () => ({
      location: harness.info.location,
      data: [shell, { ...shell, id: "second" }],
    });
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [{ id: "promoted" }, { id: "second" }] });
  } finally {
    release();
    await session.close();
  }
});

test("retries failed background bootstrap and roster without losing stale work", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  try {
    const { OpenCodeBackgroundInventory } = await import("./background-inventory.js");
    const harness = new V2Harness();
    harness.history.push({
      id: "assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: "tool",
          name: "shell",
          time: { created: 1 },
          state: {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "" }],
            metadata: { status: "running", shellID: "live" },
          },
        },
      ],
    });
    let historyCalls = 0;
    let shellCalls = 0;
    let historyFails = true;
    let shellFails = true;
    harness.api.message.list = async () => {
      historyCalls++;
      if (historyFails) throw new Error("history unavailable");
      return { data: harness.history, cursor: {} };
    };
    harness.api.shell.list = async () => {
      shellCalls++;
      if (shellFails) throw new Error("roster unavailable");
      return {
        location: harness.info.location,
        data: [
          {
            id: "live",
            status: "running",
            command: "sleep 120",
            cwd: "/tmp/project",
            shell: "sh",
            file: "sh",
            metadata: { sessionID: harness.info.id },
            time: { started: 1 },
          },
        ],
      };
    };
    const inventory = new OpenCodeBackgroundInventory({
      id: harness.info.id,
      cwd: "/tmp/project",
      emit: () => {},
      report: () => {},
    });
    inventory.start(harness.api);
    await vi.advanceTimersByTimeAsync(0);
    expect(inventory.snapshot()).toBeNull();
    historyFails = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(historyCalls).toBe(2);
    expect(shellCalls).toBe(1);
    expect(inventory.snapshot()).toBeNull();
    inventory.observe({ id: "deleted", created: 1, type: "shell.deleted", data: { id: "other" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(shellCalls).toBe(1);
    shellFails = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(historyCalls).toBe(2);
    expect(inventory.snapshot()?.items).toMatchObject([{ id: "live", canStop: true }]);
    historyFails = true;
    inventory.start(harness.api);
    await vi.advanceTimersByTimeAsync(0);
    expect(inventory.snapshot()?.items).toEqual([
      { id: "live", kind: "shell", description: null, command: "sleep 120" },
    ]);
    await expect(inventory.stopItem("live")).rejects.toThrow("no longer available");
    historyFails = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(historyCalls).toBe(4);
    expect(inventory.snapshot()?.items).toMatchObject([{ id: "live", canStop: true }]);
    shellFails = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(inventory.snapshot()?.items).toMatchObject([{ id: "live" }]);
    inventory.disconnect();
    const stoppedCalls = shellCalls;
    await vi.advanceTimersByTimeAsync(15000);
    expect(shellCalls).toBe(stoppedCalls);
  } finally {
    vi.useRealTimers();
  }
});

test("does not retry a failed bootstrap from a disconnected generation", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  try {
    const { OpenCodeBackgroundInventory } = await import("./background-inventory.js");
    const harness = new V2Harness();
    let reject!: (error: Error) => void;
    let calls = 0;
    const response = new Promise<Awaited<ReturnType<typeof harness.api.message.list>>>(
      (_, fail) => {
        reject = fail;
      },
    );
    harness.api.message.list = () => {
      calls++;
      return response;
    };
    const inventory = new OpenCodeBackgroundInventory({
      id: harness.info.id,
      cwd: "/tmp/project",
      emit: () => {},
      report: () => {},
    });
    inventory.start(harness.api);
    inventory.disconnect();
    reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls).toBe(1);
    expect(inventory.snapshot()).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("stops a selected promoted shell and retains its sibling", async () => {
  const harness = new V2Harness();
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: ["one", "two"].map((id) => ({
      type: "tool" as const,
      id,
      name: "shell",
      time: { created: 1 },
      state: {
        status: "completed" as const,
        input: {},
        content: [{ type: "text" as const, text: "" }],
        metadata: { status: "running", shellID: id },
      },
    })),
  });
  let live = ["one", "two"];
  harness.api.shell.list = async () => ({
    location: harness.info.location,
    data: live.map((id) => ({
      id,
      status: "running" as const,
      command: `sleep ${id}`,
      cwd: "/tmp/project",
      shell: "sh",
      file: "sh",
      metadata: { sessionID: harness.info.id },
      time: { started: 1 },
    })),
  });
  harness.api.shell.remove = async ({ id }) => {
    live = live.filter((entry) => entry !== id);
    return { data: true };
  };
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [{ id: "one" }, { id: "two" }] });
    await session.stopBackgroundWork!("one");
    expect(events.findLast((event) => event.type === "background_work")).toMatchObject({
      items: [{ id: "two" }],
    });
    await expect(session.stopBackgroundWork!("one")).rejects.toThrow();
  } finally {
    await session.close();
  }
});

test("closing during reconnect does not restart the background inventory", async () => {
  const harness = new V2Harness();
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  await expect
    .poll(() => events.findLast((event) => event.type === "background_work"))
    .toMatchObject({ items: [] });
  let unblock!: () => void;
  let entered = false;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  harness.connection.bindSession = async () => {
    entered = true;
    await blocked;
  };
  let reads = 0;
  const original = harness.api.message.list;
  harness.api.message.list = (...args) => {
    reads++;
    return original(...args);
  };
  harness.push({ id: "reconnect-close", created: 2, type: "server.connected", data: {} });
  await expect.poll(() => entered).toBe(true);
  const closing = session.close();
  unblock();
  await closing;
  expect(reads).toBe(0);
});

test("keeps a shell available when its stop request times out", async () => {
  const { vi } = await import("vitest");
  vi.useFakeTimers();
  try {
    const { OpenCodeBackgroundInventory } = await import("./background-inventory.js");
    const harness = new V2Harness();
    harness.history.push({
      id: "assistant",
      type: "assistant",
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      time: { created: 1 },
      content: [
        {
          type: "tool",
          id: "tool",
          name: "shell",
          time: { created: 1 },
          state: {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "" }],
            metadata: { status: "running", shellID: "live" },
          },
        },
      ],
    });
    harness.api.shell.list = async () => ({
      location: harness.info.location,
      data: [
        {
          id: "live",
          status: "running",
          command: "sleep 120",
          cwd: "/tmp/project",
          shell: "sh",
          file: "sh",
          metadata: { sessionID: harness.info.id },
          time: { started: 1 },
        },
      ],
    });
    harness.api.shell.remove = () => new Promise(() => {});
    const inventory = new OpenCodeBackgroundInventory({
      id: harness.info.id,
      cwd: "/tmp/project",
      emit: () => {},
      report: () => {},
    });
    inventory.start(harness.api);
    await vi.advanceTimersByTimeAsync(0);
    expect(inventory.snapshot()?.items).toMatchObject([{ id: "live", canStop: true }]);
    const result = expect(inventory.stopItem("live")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10000);
    await result;
    expect(inventory.snapshot()?.items).toMatchObject([{ id: "live" }]);
    inventory.disconnect();
  } finally {
    vi.useRealTimers();
  }
});

test("keeps a live background shell visible and stoppable after its launch is rewound", async () => {
  const harness = new V2Harness();
  harness.history.push({
    id: "assistant",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [
      {
        type: "tool",
        id: "tool",
        name: "shell",
        time: { created: 1 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "text", text: "" }],
          metadata: { status: "running", shellID: "live" },
        },
      },
    ],
  });
  let live = true;
  harness.api.shell.list = async () => ({
    location: harness.info.location,
    data: live
      ? [
          {
            id: "live",
            status: "running",
            command: "sleep 180",
            cwd: "/tmp/project",
            shell: "sh",
            file: "sh",
            metadata: { sessionID: harness.info.id },
            time: { started: 1 },
          },
        ]
      : [],
  });
  harness.api.shell.remove = async () => {
    live = false;
    return { data: true };
  };
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    runtime: harness.runtime,
  });
  const session = await client.createSession({ provider: "opencode", cwd: "/tmp/project" });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  try {
    await expect
      .poll(() => events.findLast((event) => event.type === "background_work"))
      .toMatchObject({ items: [{ id: "live", canStop: true }] });
    harness.history.length = 0;
    harness.push({
      id: "revert",
      created: 2,
      type: "session.revert.committed",
      durable: { aggregateID: harness.info.id, seq: 1, version: 1 },
      data: { sessionID: harness.info.id, to: "earlier" },
    });
    await expect
      .poll(() => events.filter((event) => event.type === "background_work").length)
      .toBeGreaterThanOrEqual(3);
    expect(events.findLast((event) => event.type === "background_work")).toMatchObject({
      items: [{ id: "live", canStop: true }],
    });
    harness.push({ id: "reconnect-after-rewind", created: 3, type: "server.connected", data: {} });
    await expect
      .poll(() => events.filter((event) => event.type === "background_work").length)
      .toBeGreaterThanOrEqual(5);
    expect(events.findLast((event) => event.type === "background_work")).toMatchObject({
      items: [{ id: "live", canStop: true }],
    });
    await session.stopBackgroundWork!("live");
    expect(events.findLast((event) => event.type === "background_work")).toMatchObject({
      items: [],
    });
  } finally {
    await session.close();
  }
});
