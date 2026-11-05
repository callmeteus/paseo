import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import stripAnsi from "strip-ansi";
import type {
  ProviderMcpLoginResult,
  ProviderMcpServerInfo,
  ProviderMcpServerStatus,
} from "../agent-sdk-types.js";
import { execCommand, spawnProcess } from "../../../utils/spawn.js";

const MCP_LIST_TIMEOUT_MS = 20_000;
const MCP_ENABLE_TIMEOUT_MS = 30_000;
const LOGIN_URL_WAIT_MS = 8_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/u;
const OUTPUT_TAIL_CHARS = 2_000;

const activeLogins = new Map<string, ChildProcess>();

/** `cursor-agent acp` -> `cursor-agent`, preserving any wrapper flags before `acp`. */
export function resolveCursorCliCommand(command: [string, ...string[]]): [string, ...string[]] {
  const acpIndex = command.lastIndexOf("acp");
  const base = acpIndex > 0 ? command.slice(0, acpIndex) : command;
  if (base.length === 0) {
    return ["cursor-agent"];
  }
  return base as [string, ...string[]];
}

export async function listCursorMcpServers(input: {
  command: [string, ...string[]];
  env?: Record<string, string>;
}): Promise<ProviderMcpServerInfo[]> {
  const { stdout } = await execCommand(
    input.command[0],
    [...input.command.slice(1), "mcp", "list"],
    {
      cwd: homedir(),
      env: input.env,
      timeout: MCP_LIST_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  return parseCursorMcpList(stdout);
}

export function parseCursorMcpList(output: string): ProviderMcpServerInfo[] {
  const servers: ProviderMcpServerInfo[] = [];
  for (const rawLine of stripAnsi(output).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^:]+):\s*(.*)$/u.exec(line);
    if (!match) continue;
    const name = match[1]?.trim();
    const value = match[2]?.trim() ?? "";
    if (!name) continue;
    servers.push({ name, ...parseCursorMcpStatus(value) });
  }
  return servers;
}

function parseCursorMcpStatus(value: string): {
  status: ProviderMcpServerStatus;
  detail?: string | null;
} {
  const normalized = value.toLowerCase();
  if (normalized === "ready") return { status: "ready" };
  if (normalized === "requires_authentication") return { status: "needs_auth" };
  if (normalized.includes("needs approval") || normalized.includes("not loaded")) {
    return { status: "needs_approval", detail: value };
  }
  if (normalized.startsWith("error")) {
    return { status: "error", detail: value.replace(/^error:\s*/iu, "") || value };
  }
  return { status: "unknown", detail: value || null };
}

/**
 * Cursor stores OAuth tokens outside mcp.json. Approval is required before the
 * login command will load the server, so always enable first.
 */
export async function loginCursorMcpServer(input: {
  command: [string, ...string[]];
  server: string;
  env?: Record<string, string>;
}): Promise<ProviderMcpLoginResult> {
  const loginKey = input.server;
  activeLogins.get(loginKey)?.kill("SIGTERM");
  activeLogins.delete(loginKey);

  const enable = await runCursorCli(input, ["mcp", "enable", input.server], MCP_ENABLE_TIMEOUT_MS);
  if (enable.exitCode !== 0) {
    return {
      status: "failed",
      message: tail(enable.output) || `Could not approve MCP server '${input.server}'.`,
    };
  }

  const child = spawnProcess(
    input.command[0],
    [...input.command.slice(1), "mcp", "login", input.server],
    {
      cwd: homedir(),
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  activeLogins.set(loginKey, child);

  let output = "";
  let url: string | null = null;
  let settled = false;

  const waitingResult = (): ProviderMcpLoginResult => {
    if (url) {
      return { status: "waiting", url, message: tail(output) };
    }
    if (child.exitCode !== null) {
      return { status: "failed", message: tail(output) || "MCP login failed." };
    }
    return {
      status: "waiting",
      message: tail(output) || "Waiting for the browser to finish authentication.",
    };
  };

  const deferred = createDeferred<ProviderMcpLoginResult>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settle = (result: ProviderMcpLoginResult) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    deferred.resolve(result);
  };
  const handleOutput = (chunk: Buffer) => {
    output = `${output}${stripAnsi(chunk.toString("utf8"))}`.slice(-OUTPUT_TAIL_CHARS);
    const found = URL_PATTERN.exec(output);
    if (found && !url) {
      url = found[0];
      settle({ status: "waiting", url, message: tail(output) });
    }
  };

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);

  child.once("error", (error) => {
    activeLogins.delete(loginKey);
    settle({ status: "failed", message: error.message });
  });
  child.once("exit", (code) => {
    activeLogins.delete(loginKey);
    const text = tail(output);
    if (code === 0 && !/✗|failed|error:/iu.test(text)) {
      settle({ status: "authenticated", message: text || null });
    } else {
      settle({
        status: "failed",
        message: text || `MCP login exited with code ${code ?? "null"}.`,
      });
    }
  });

  // The command prints the URL and then waits for the localhost callback. If
  // no URL appeared yet, hand control back so the UI can explain what to do;
  // the process keeps waiting and the server list reflects the result.
  timer = setTimeout(() => {
    settle(waitingResult());
  }, LOGIN_URL_WAIT_MS);

  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
    activeLogins.delete(loginKey);
  }, LOGIN_TIMEOUT_MS).unref?.();

  return await deferred.promise;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

export async function runCursorCli(
  input: { command: [string, ...string[]]; env?: Record<string, string> },
  args: string[],
  timeout: number,
): Promise<{ exitCode: number; output: string }> {
  try {
    const result = await execCommand(input.command[0], [...input.command.slice(1), ...args], {
      cwd: homedir(),
      env: input.env,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}` };
  } catch (error) {
    return {
      exitCode: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export function disposeCursorMcpLogins(): void {
  for (const child of activeLogins.values()) {
    child.kill("SIGTERM");
  }
  activeLogins.clear();
}

function tail(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 600 ? trimmed.slice(-600) : trimmed;
}
