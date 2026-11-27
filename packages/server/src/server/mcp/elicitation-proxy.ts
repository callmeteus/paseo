/**
 * Paseo-owned MCP elicitation bridge.
 *
 * Harnesses do not agree on how to forward `elicitation/create`: some never
 * advertise the capability, some auto-decline it, and some translate it into
 * their own form tool. Wrapping the configured MCP servers in the local stdio
 * shim makes every provider take the same path — the shim advertises the
 * capability, forwards the request to this bridge, and Paseo renders the form
 * with the shared question card.
 */

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentStreamEvent,
} from "../agent/agent-sdk-types.js";
import {
  acpElicitationContent,
  readACPElicitation,
  type ACPElicitationForm,
} from "../agent/providers/acp-elicitation.js";
import { startElicitationBridge, type ElicitationBridge } from "./elicitation-callback.js";
import { PASEO_MCP_SERVER_NAME } from "../agent/runtime-mcp-config.js";

export type HarnessMcpServerConfig = McpServerConfig & {
  /** OpenCode Code Mode: tools are exposed through `execute` instead of directly. */
  codemode?: boolean;
};

export interface McpElicitationAnswer {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}

interface PendingQuestion {
  request: AgentPermissionRequest;
  form: ACPElicitationForm;
  turnId?: string;
  resolve: (answer: McpElicitationAnswer) => void;
}

/** One card for one elicitation; cancelling it never touches a session's other cards. */
export interface ElicitationCard {
  requestId: string;
  answer: Promise<McpElicitationAnswer>;
  cancel: (reason?: string) => void;
}

/**
 * Managed synthetic question cards for a single agent session. Providers
 * already route `permission_requested`/`respondToPermission` through their
 * stream, so an elicitation card behaves like any other question card.
 */
export class ElicitationQuestions {
  private readonly pending = new Map<string, PendingQuestion>();
  private readonly withdrawn = new Set<string>();

  constructor(
    private readonly provider: string,
    private readonly emit: (event: AgentStreamEvent) => void,
  ) {}

  ask(message: string, form: ACPElicitationForm, turnId?: string): Promise<McpElicitationAnswer> {
    return this.askCard(message, form, turnId).answer;
  }

  askCard(message: string, form: ACPElicitationForm, turnId?: string): ElicitationCard {
    const request: AgentPermissionRequest = {
      id: `elicit-${randomUUID()}`,
      provider: this.provider,
      name: "question",
      kind: "question",
      title: message,
      description: message,
      input: { questions: form.questions, elicitation: true },
    };
    let resolve!: (answer: McpElicitationAnswer) => void;
    const answer = new Promise<McpElicitationAnswer>((done) => {
      resolve = done;
    });
    this.pending.set(request.id, {
      request,
      form,
      ...(turnId ? { turnId } : {}),
      resolve,
    });
    this.emit({
      type: "permission_requested",
      provider: this.provider,
      request,
      ...(turnId ? { turnId } : {}),
    });
    return {
      requestId: request.id,
      answer,
      cancel: (reason) => this.cancel(request.id, reason),
    };
  }

  /** Withdraws only the card for this elicitation, leaving other cards pending. */
  cancel(requestId: string, reason = "cancelled"): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.withdrawn.add(requestId);
    pending.resolve({ action: "decline" });
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: { behavior: "deny", message: `The MCP elicitation was ${reason}.` },
      ...(pending.turnId ? { turnId: pending.turnId } : {}),
    });
    this.emit({
      type: "timeline",
      provider: this.provider,
      item: {
        type: "notification",
        level: "warning",
        message: `MCP elicitation ${reason}; the question was withdrawn.`,
      },
      ...(pending.turnId ? { turnId: pending.turnId } : {}),
    });
  }

  hasWithdrawn(requestId: string): boolean {
    return this.withdrawn.has(requestId);
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  /** Returns true when this request belongs to an elicitation card. */
  respondToPermission(requestId: string, response: AgentPermissionResponse): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    pending.resolve(
      response.behavior === "allow"
        ? {
            action: "accept",
            content: acpElicitationContent(pending.form, response.updatedInput?.answers),
          }
        : { action: "decline" },
    );
    this.emit({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
      ...(pending.turnId ? { turnId: pending.turnId } : {}),
    });
    return true;
  }

  /** Declines every outstanding card when the session closes or the turn ends. */
  declineAll(): void {
    for (const id of this.pending.keys()) {
      const pending = this.pending.get(id);
      if (!pending) continue;
      this.pending.delete(id);
      pending.resolve({ action: "decline" });
      this.emit({
        type: "permission_resolved",
        provider: this.provider,
        requestId: id,
        resolution: { behavior: "deny", message: "The elicitation was cancelled." },
        ...(pending.turnId ? { turnId: pending.turnId } : {}),
      });
    }
  }
}

export interface ElicitationProxyHooks {
  ask: (
    serverName: string,
    message: string,
    form: ACPElicitationForm,
  ) => Promise<McpElicitationAnswer>;
  onToolResult?: (serverName: string, result: unknown) => void;
}

async function shimPath(): Promise<string | null> {
  const candidates = [
    fileURLToPath(new URL("../../../scripts/mcp-proxy-shim.mjs", import.meta.url)),
    fileURLToPath(new URL("../../../../scripts/mcp-proxy-shim.mjs", import.meta.url)),
  ];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      /* try the built layout next */
    }
  }
  return null;
}

/** One proxy per agent session; shares a loopback bridge across its MCP servers. */
export class ElicitationProxy {
  private bridge: ElicitationBridge | null = null;
  private readonly registered = new Set<string>();

  async wrapServers(
    servers: Record<string, McpServerConfig>,
    agentId: string,
    hooks: ElicitationProxyHooks,
  ): Promise<Record<string, McpServerConfig>> {
    // Paseo's own tool server never asks for input, and the agent needs its
    // native connection (capability token, plugin bridge) untouched.
    const names = Object.keys(servers).filter((name) => name !== PASEO_MCP_SERVER_NAME);
    if (names.length === 0) return servers;
    const shim = await shimPath();
    if (!shim) return servers;

    if (!this.bridge) this.bridge = await startElicitationBridge();
    const bridge = this.bridge;
    for (const name of names) {
      const token = `${agentId}:${name}`;
      if (this.registered.has(token)) continue;
      this.registered.add(token);
      bridge.register(`result:${token}`, async (result) => {
        hooks.onToolResult?.(name, result);
        return null;
      });
      bridge.register(token, async (request) => {
        const envelope = request as { params?: unknown };
        const params = envelope.params ?? request;
        const form = readACPElicitation(params);
        if (!form) return { action: "decline" };
        const messageValue = (params as { message?: unknown }).message;
        const message = typeof messageValue === "string" ? messageValue : `Confirm ${name}`;
        return await hooks.ask(name, message, form);
      });
    }

    const proxied = Object.fromEntries(
      names.map((name) => {
        const config = servers[name]!;
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) env[key] = value;
        }
        env.PASEO_MCP_PROXY_CONFIG = Buffer.from(JSON.stringify({ ...config, name })).toString(
          "base64",
        );
        env.PASEO_MCP_PROXY_CALLBACK = `${bridge.origin}/elicit`;
        env.PASEO_MCP_PROXY_TOKEN = `${agentId}:${name}`;
        env.PASEO_MCP_PROXY_LOG = `/tmp/opencode/mcp-proxy-${agentId}-${name}.log`;
        return [
          name,
          {
            type: "stdio" as const,
            command: process.execPath,
            args: [shim],
            env,
          },
        ];
      }),
    );
    return { ...servers, ...proxied };
  }

  async close(): Promise<void> {
    if (!this.bridge) return;
    const bridge = this.bridge;
    this.bridge = null;
    this.registered.clear();
    await bridge.close();
  }
}

/**
 * MCP servers a harness loads from its own config files never appear in the
 * agent's `mcpServers` config. Read the recognized files for the providers we
 * support so Paseo can wrap those servers too. The files are read only — never
 * rewritten — and paths stay inside the user's own home or the agent cwd.
 */
export async function readHarnessMcpServers(input: {
  provider: string;
  cwd: string;
}): Promise<Record<string, McpServerConfig>> {
  const home = homedir();
  const files: string[] = [];
  if (input.provider === "antigravity" || input.provider === "gemini") {
    files.push(path.join(home, ".gemini", "settings.json"));
    files.push(path.join(input.cwd, ".gemini", "settings.json"));
  } else if (input.provider === "claude") {
    files.push(path.join(home, ".claude.json"));
    files.push(path.join(input.cwd, ".mcp.json"));
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const errors: import("jsonc-parser").ParseError[] = [];
    const parsed = parseJsonc(text, errors) as Record<string, unknown> | undefined;
    if (!parsed || errors.length > 0 || typeof parsed !== "object") continue;
    const mcp = parsed.mcpServers ?? parsed.mcp;
    if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) continue;
    const configured =
      "servers" in mcp &&
      mcp.servers &&
      typeof mcp.servers === "object" &&
      !Array.isArray(mcp.servers)
        ? (mcp.servers as Record<string, unknown>)
        : (mcp as Record<string, unknown>);
    for (const [name, raw] of Object.entries(configured)) {
      if (name === PASEO_MCP_SERVER_NAME) continue;
      const parsedServer = harnessServerConfig(raw as Record<string, unknown>);
      if (parsedServer) servers[name] = parsedServer;
    }
  }
  return servers;
}

function harnessServerConfig(server: Record<string, unknown>): McpServerConfig | null {
  if (server.disabled === true) return null;
  if (typeof server.command === "string" && server.command.length > 0) {
    const args = Array.isArray(server.args) && server.args.every((arg) => typeof arg === "string");
    const env = server.env && typeof server.env === "object";
    return {
      type: "stdio",
      command: server.command,
      ...(args ? { args: server.args as string[] } : {}),
      ...(env ? { env: server.env as Record<string, string> } : {}),
      ...(typeof server.cwd === "string" ? { cwd: server.cwd } : {}),
      ...(typeof server.codemode === "boolean" ? { codemode: server.codemode } : {}),
    };
  }
  if (typeof server.url === "string" && server.url.length > 0) {
    const headers = server.headers && typeof server.headers === "object";
    return {
      type: server.type === "sse" ? "sse" : "http",
      url: server.url,
      ...(headers ? { headers: server.headers as Record<string, string> } : {}),
      ...(typeof server.codemode === "boolean" ? { codemode: server.codemode } : {}),
    };
  }
  return null;
}

/**
 * Builds shim-backed MCP configs with a caller-owned callback. Used by the
 * OpenCode router, whose bridge is process-wide rather than per session.
 */
export async function wrapMcpServersWithCallback(input: {
  servers: Record<string, McpServerConfig>;
  tokenFor: (name: string, config: McpServerConfig) => string;
  callback: string;
  onToolResult?: (name: string, result: unknown) => void;
}): Promise<Record<string, HarnessMcpServerConfig>> {
  const shim = await shimPath();
  if (!shim) return input.servers;
  const proxied = Object.fromEntries(
    Object.entries(input.servers)
      .filter(([name]) => name !== PASEO_MCP_SERVER_NAME)
      .map(([name, config]) => {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) env[key] = value;
        }
        const token = input.tokenFor(name, config);
        env.PASEO_MCP_PROXY_CONFIG = Buffer.from(JSON.stringify({ ...config, name })).toString(
          "base64",
        );
        env.PASEO_MCP_PROXY_CALLBACK = input.callback;
        env.PASEO_MCP_PROXY_TOKEN = token;
        env.PASEO_MCP_PROXY_LOG = `/tmp/opencode/mcp-proxy-${token}.log`;
        const codemode = (config as HarnessMcpServerConfig).codemode;
        return [
          name,
          {
            type: "stdio" as const,
            command: process.execPath,
            args: [shim],
            env,
            ...(typeof codemode === "boolean" ? { codemode } : {}),
          },
        ];
      }),
  );
  return { ...input.servers, ...proxied };
}
