import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentPermissionRequest, AgentSession } from "../../agent/agent-sdk-types.js";
import { OpenCodeV2AgentClient } from "./opencode/v2/agent.js";
import { V2Runtime } from "./opencode/v2/runtime.js";

/**
 * A real MCP server that asks for confirmation before a write. It sends the
 * elicitation as soon as it connects, so the proof needs no model turn. The
 * answer the server receives is written to a file: that proves the operator's
 * decision travelled back to the MCP server, not just to the Paseo UI.
 */
function mcpServerScript(): string {
  const sdk = path.dirname(
    createRequire(import.meta.url).resolve("@modelcontextprotocol/sdk/package.json"),
  );
  const esm = (relative: string) => pathToFileURL(path.join(sdk, "..", "esm", relative)).href;
  return `
import { writeFileSync } from "node:fs";
import { Server } from "${esm("server/index.js")}";
import { StdioServerTransport } from "${esm("server/stdio.js")}";
import { CallToolRequestSchema, ListToolsRequestSchema } from "${esm("types.js")}";

const answerFile = process.env.ELICITATION_RESULT_FILE;
const server = new Server(
  { name: "elicitation-test", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "confirm_write",
      description: "Asks the operator to confirm a write, then reports the answer.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: "text", text: "write done" }],
}));
await server.connect(new StdioServerTransport());

// Server-initiated requests are valid MCP. Wait for the initialize handshake
// to finish so the shim's elicitation capability is already known.
setTimeout(async () => {
  try {
    const answer = await server.elicitInput({
      message: "Paseo elicitation test: allow this write?",
      requestedSchema: {
        type: "object",
        properties: { confirm: { type: "boolean", title: "Confirm" } },
        required: ["confirm"],
      },
    });
    writeFileSync(answerFile, JSON.stringify(answer));
  } catch (error) {
    writeFileSync(answerFile, JSON.stringify({ error: String(error) }));
  }
}, 2_000);
`;
}

async function startProbe(input: { root: string }) {
  const script = path.join(input.root, "elicitation-server.mjs");
  const resultFile = path.join(input.root, "answer.json");
  await writeFile(script, mcpServerScript(), "utf8");
  const client = new OpenCodeV2AgentClient({
    logger: createTestLogger(),
    // A private helper server keeps this probe away from any OpenCode service
    // the developer already has running on the machine.
    runtime: new V2Runtime({ logger: createTestLogger(), selection: { kind: "owned" } }),
  });
  const session = await client.createSession(
    {
      provider: "opencode",
      cwd: input.root,
      model: process.env.OPENCODE_TEST_MODEL ?? "openai/gpt-6-astra",
      mcpServers: {
        "elicitation-test": {
          type: "stdio",
          command: process.execPath,
          args: [script],
          env: { ELICITATION_RESULT_FILE: resultFile },
        },
      },
    },
    undefined,
    { persistSession: false },
  );
  return { client, session, resultFile };
}

/** A card that never arrives must fail with a clear message, not a bare timeout. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    }),
  ]);
}

interface McpAnswer {
  action: string;
  content?: Record<string, unknown>;
  error?: string;
}

async function waitForAnswer(file: string): Promise<McpAnswer> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as McpAnswer;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`The MCP server never received an answer (${file})`);
}

async function firstCard(session: AgentSession): Promise<AgentPermissionRequest> {
  let unsubscribe: () => void = () => undefined;
  const card = new Promise<AgentPermissionRequest>((resolve) => {
    unsubscribe = session.subscribe((event) => {
      if (event.type !== "permission_requested") return;
      unsubscribe();
      resolve(event.request);
    });
  });
  return within(card, 30_000, "No elicitation card appeared in the Paseo session");
}

test("shows an MCP elicitation as a question card and returns the approval to the server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-elicitation-allow-"));
  const { client, session, resultFile } = await startProbe({ root });
  try {
    const request = await firstCard(session);

    expect(request.kind).toBe("question");
    expect(request.title).toBe("Paseo elicitation test: allow this write?");
    expect(request.input).toMatchObject({
      elicitation: true,
      questions: [{ header: "Confirm", type: "boolean" }],
    });

    await session.respondToPermission(request.id, {
      behavior: "allow",
      updatedInput: { answers: { Confirm: "true" } },
    });

    expect(await waitForAnswer(resultFile)).toEqual({
      action: "accept",
      content: { confirm: true },
    });
    expect(session.getPendingPermissions()).toEqual([]);
  } finally {
    await session.interrupt().catch(() => undefined);
    await session.close();
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("denying the card declines the elicitation instead of accepting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-elicitation-deny-"));
  const { client, session, resultFile } = await startProbe({ root });
  try {
    const request = await firstCard(session);
    await session.respondToPermission(request.id, { behavior: "deny", message: "Not now" });

    expect((await waitForAnswer(resultFile)).action).toBe("decline");
    expect(session.getPendingPermissions()).toEqual([]);
  } finally {
    await session.interrupt().catch(() => undefined);
    await session.close();
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
