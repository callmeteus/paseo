import { decorateOpenCodeV2Env, materializeOpenCodeV2Plugin } from "../bridge.js";
import { resolvePaseoHome } from "../../../../paseo-home.js";
import { OpenCode } from "@opencode/client";
import type { V2Api } from "./api.js";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Logger } from "pino";
import { spawnProcess } from "../../../../../utils/spawn.js";
import { terminateWithTreeKill } from "../../../../../utils/tree-kill.js";
import {
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../../provider-launch-config.js";
import type { ManagedProcessRegistry } from "../../../../managed-processes/managed-processes.js";
import { resolveOpenCodeHomeDir } from "../paths.js";
import { OpenCodeHttpError } from "../http-error.js";
import { raceProviderRefreshAbort } from "../../../provider-refresh-deadline.js";

export interface V2Connection {
  client: V2Api;
  release(): Promise<void>;
  retain(): V2Connection;
  readonly exited: Promise<Error>;
}
interface Generation {
  client: V2Api;
  users: number;
  stop(): Promise<void>;
  exited: Promise<Error>;
  /** External servers outlive this runtime, so release must not stop them. */
  persistent?: boolean;
}
export interface V2RuntimeOptions {
  logger: Logger;
  settings?: ProviderRuntimeSettings;
  managedProcesses?: ManagedProcessRegistry;
  decorateEnv?: (env: Record<string, string>) => Promise<Record<string, string>>;
}

export interface V2RuntimeAcquireOptions {
  fresh?: boolean;
  dedicated?: boolean;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

const OPENCODE_HELPER_TAIL_LINES = 20;
const OPENCODE_HELPER_TAIL_LINE_CHARS = 400;

/** Drops provider credentials before a helper line reaches the daemon log. */
function redactHelperLine(line: string): string {
  return line.replace(/[A-Za-z0-9_-]{24,}/g, "***").slice(0, OPENCODE_HELPER_TAIL_LINE_CHARS);
}

// The runtime owns a credential for each subprocess; sessions only receive its authenticated client.
export class V2Runtime {
  private current: Promise<Generation> | null = null;
  private external: Promise<Generation> | null = null;
  private generations = new Set<Generation>();
  private starts = new Set<Promise<Generation>>();
  private closed = false;

  constructor(private readonly options: V2RuntimeOptions) {}

  async acquire(input: V2RuntimeAcquireOptions = {}): Promise<V2Connection> {
    if (this.closed) throw new Error("OpenCode runtime is closed");
    input.signal?.throwIfAborted();
    const externalUrl = readExternalServerUrl(this.options.settings);
    if (externalUrl) {
      return await this.acquireExternal(input, externalUrl);
    }
    let pending: Promise<Generation>;
    if (input.env || input.dedicated) {
      pending = this.startTracked(input.env);
    } else {
      if (input.fresh || !this.current) this.current = this.startTracked();
      pending = this.current;
    }
    let generation: Generation;
    try {
      generation = await raceProviderRefreshAbort(input.signal, pending);
    } catch (error) {
      if (this.current === pending) this.current = null;
      if (input.signal?.aborted) {
        void pending
          .then(async (started) => {
            if (started.users !== 0) return undefined;
            this.generations.delete(started);
            await started.stop();
            return undefined;
          })
          .catch((cleanupError: unknown) => {
            this.options.logger.warn(
              { error: String(cleanupError) },
              "OpenCode canceled startup cleanup failed",
            );
          });
      }
      throw error;
    }
    if (!this.generations.has(generation)) {
      if (this.current === pending) this.current = null;
      throw new Error("OpenCode helper server exited");
    }
    const connection = this.lease(generation, pending);
    if (input.signal?.aborted || this.closed) {
      await connection.release();
      input.signal?.throwIfAborted();
      throw new Error("OpenCode runtime is closed");
    }
    return connection;
  }

  private async acquireExternal(
    input: V2RuntimeAcquireOptions,
    externalUrl: string,
  ): Promise<V2Connection> {
    if (input.env || input.dedicated) {
      throw new Error(
        "OpenCode is configured with an external server URL, so per-agent process environment and dedicated sessions are not available. Configure those on the external OpenCode server.",
      );
    }
    this.external ??= this.startExternal(externalUrl).catch((error: unknown) => {
      this.external = null;
      throw error;
    });
    const generation = await raceProviderRefreshAbort(input.signal, this.external);
    if (!this.generations.has(generation)) {
      throw new Error("OpenCode external server is unavailable");
    }
    const connection = this.lease(generation, this.external);
    if (input.signal?.aborted || this.closed) {
      await connection.release();
      input.signal?.throwIfAborted();
      throw new Error("OpenCode runtime is closed");
    }
    return connection;
  }

  private lease(generation: Generation, pending: Promise<Generation>): V2Connection {
    if (this.closed || !this.generations.has(generation))
      throw new Error("OpenCode helper server is no longer running");
    generation.users += 1;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      generation.users -= 1;
      if (generation.users !== 0) return;
      if (generation.persistent) return;
      if (this.current === pending) this.current = null;
      this.generations.delete(generation);
      await generation.stop();
    };
    return {
      client: generation.client,
      release,
      retain: () => this.lease(generation, pending),
      exited: generation.exited,
    };
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.starts);
    await Promise.all(
      [...this.generations]
        .filter((generation) => !generation.persistent)
        .map((generation) => generation.stop()),
    );
    this.generations.clear();
    this.current = null;
    this.external = null;
  }

  private async startExternal(url: string): Promise<Generation> {
    const password = readExternalServerPassword(this.options.settings);
    const client = createV2Client(url, password);
    try {
      await client.server.info({ signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenCode external server at ${url} is unavailable: ${reason}`, {
        cause: error,
      });
    }
    const generation: Generation = {
      client,
      users: 0,
      persistent: true,
      stop: async () => undefined,
      exited: new Promise<Error>(() => undefined),
    };
    this.generations.add(generation);
    this.options.logger.info({ url }, "Using external OpenCode server");
    return generation;
  }

  private startTracked(env?: Record<string, string>): Promise<Generation> {
    const pending = this.start(env);
    this.starts.add(pending);
    void pending.then(
      (generation) =>
        generation.exited.then(() => {
          if (this.current === pending) this.current = null;
          return undefined;
        }),
      () => undefined,
    );
    void pending.then(
      () => this.starts.delete(pending),
      () => this.starts.delete(pending),
    );
    return pending;
  }

  private async start(env: Record<string, string> = {}): Promise<Generation> {
    const { settings, managedProcesses, logger } = this.options;
    const launch = await resolveProviderLaunch({
      commandConfig: settings?.command,
      defaultBinary: "opencode",
    });
    const cwd = resolveOpenCodeHomeDir();
    await mkdir(cwd, { recursive: true });
    const password = randomBytes(32).toString("base64url");
    const inheritedConfig = globalThis.process.env.OPENCODE_CONFIG_CONTENT;
    const configured = {
      ...(inheritedConfig ? { OPENCODE_CONFIG_CONTENT: inheritedConfig } : {}),
      ...settings?.env,
      ...env,
    };
    const decorated = this.options.decorateEnv
      ? await this.options.decorateEnv(configured)
      : decorateOpenCodeV2Env(configured, await materializeOpenCodeV2Plugin(resolvePaseoHome()));
    const args = [...launch.args, "serve", "--hostname", "127.0.0.1", "--port", "0"];
    const process = spawnProcess(launch.command, args, {
      cwd,
      detached: globalThis.process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      ...createProviderEnvSpec({
        runtimeSettings: settings,
        overlays: [{ ...decorated, OPENCODE_PASSWORD: password }],
      }),
    });
    const processAbort = new AbortController();
    const startedAt = Date.now();
    // The helper writes its own diagnostics to stderr; keep a small tail so a
    // crash report says why instead of only an exit code.
    const outputTail: string[] = [];
    const rememberOutput = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        outputTail.push(redactHelperLine(line));
        if (outputTail.length > OPENCODE_HELPER_TAIL_LINES) outputTail.shift();
      }
    };
    process.stdout?.on("data", rememberOutput);
    process.stderr?.on("data", rememberOutput);
    let intentionalStop = false;
    const exited = new Promise<Error>((resolve) =>
      process.once("exit", (code, signal) => {
        if (!intentionalStop) {
          logger.error(
            {
              code,
              signal,
              provider: "opencode",
              uptimeMs: Date.now() - startedAt,
              outputTail: [...outputTail],
            },
            "OpenCode helper server exited unexpectedly",
          );
        }
        const error = new Error(`OpenCode helper server exited (${code})`);
        processAbort.abort(error);
        resolve(error);
      }),
    );
    let stopped: Promise<void> | undefined;
    const stop = () => {
      stopped ??= (async () => {
        intentionalStop = true;
        await terminateWithTreeKill(process, { gracefulTimeoutMs: 5_000, forceTimeoutMs: 1_000 });
        const entry = await record;
        if (entry) await managedProcesses?.remove(entry.id);
      })();
      return stopped;
    };
    const record =
      process.pid && managedProcesses
        ? managedProcesses
            .record({
              owner: { provider: "opencode", kind: "helper-server" },
              pid: process.pid,
              command: launch.command,
              args,
            })
            .catch((error: unknown) => {
              logger.warn({ error }, "Could not record OpenCode helper process");
              return null;
            })
        : Promise.resolve(null);
    const deadline = Date.now() + 30_000;
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("OpenCode v2 server startup timed out after 30s")),
          30_000,
        );
        let buffer = "";
        const finish = (result: string | Error) => {
          clearTimeout(timer);
          process.stdout?.off("data", onData);
          process.off("error", onError);
          process.off("exit", onExit);
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const onData = (chunk: Buffer) => {
          buffer = (buffer + chunk.toString()).slice(-8192);
          const match = buffer.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)(?:\r?\n)/);
          if (match) finish(match[1]);
        };
        const onError = (error: Error) => finish(error);
        const onExit = (code: number | null) =>
          finish(new Error(`OpenCode v2 server exited during startup (${code})`));
        process.stdout?.on("data", onData);
        process.once("error", onError);
        process.once("exit", onExit);
        // Drain stderr without retaining provider output that may contain credentials.
        process.stderr?.on("data", () => undefined);
      });
      const client = OpenCode.make({
        baseUrl: url,
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
        },
        fetch: async (request, init) => {
          const signal = init?.signal
            ? AbortSignal.any([init.signal, processAbort.signal])
            : processAbort.signal;
          const response = await fetch(request, { ...init, signal });
          const html = response.headers.get("content-type")?.includes("text/html") ?? false;
          if (!response.ok || html) {
            const requestUrl = request instanceof Request ? request.url : String(request);
            throw new OpenCodeHttpError(new URL(requestUrl).pathname, response.status, html);
          }
          return response;
        },
      });
      await client.server.info({ signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      const generation: Generation = { client, users: 0, stop, exited };
      this.generations.add(generation);
      process.once("exit", () => {
        this.generations.delete(generation);
        void stop().catch((error: unknown) =>
          logger.warn({ error }, "OpenCode process cleanup failed"),
        );
      });
      return generation;
    } catch (error) {
      await stop();
      throw error;
    }
  }
}

function readExternalServerUrl(settings: ProviderRuntimeSettings | undefined): string | null {
  const value = settings?.env?.PASEO_OPENCODE_SERVER_URL;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readExternalServerPassword(settings: ProviderRuntimeSettings | undefined): string | null {
  const value = settings?.env?.PASEO_OPENCODE_SERVER_PASSWORD ?? settings?.env?.OPENCODE_PASSWORD;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function createV2Client(url: string, password: string | null): V2Api {
  return OpenCode.make({
    baseUrl: url,
    ...(password
      ? {
          headers: {
            Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
          },
        }
      : {}),
    fetch: async (request, init) => {
      const response = await fetch(request, init);
      const html = response.headers.get("content-type")?.includes("text/html") ?? false;
      if (!response.ok || html) {
        const requestUrl = request instanceof Request ? request.url : String(request);
        throw new OpenCodeHttpError(new URL(requestUrl).pathname, response.status, html);
      }
      return response;
    },
  });
}
