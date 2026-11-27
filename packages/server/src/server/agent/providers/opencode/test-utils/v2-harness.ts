import type {
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
  SessionCreateInput,
  SessionLogItem,
} from "@opencode/client";
import type { V2Api } from "../v2/api.js";
import type { V2Connection } from "../v2/runtime.js";

function unexpected(): never {
  throw new Error("Unexpected OpenCode v2 test operation");
}

export class V2Harness {
  static sequenceCounter = 0;
  /** Give each created session its own id so shared-connection tests can route events. */
  serviceKind: V2Connection["serviceKind"] = "owned";
  distinctSessionIds = false;
  readonly sessionInfos: SessionInfo[] = [];
  readonly info: SessionInfo = {
    id: "session",
    projectID: "project",
    location: { directory: "/tmp/project" },
    agent: "build",
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    time: { created: 1, updated: 1 },
    outcome: "succeeded",
  };
  readonly history: SessionMessageInfo[] = [];
  readonly creates: SessionCreateInput[] = [];
  readonly prompts: string[] = [];
  readonly environments: Array<{ sessionID: string; variables: Record<string, string> }> = [];
  readonly mcpAdds: string[] = [];
  /** Servers the location already provides from its own config. */
  readonly mcpExisting = new Set<string>();
  /** Servers whose `mcp.add` call rejects. */
  readonly mcpAddFailures = new Set<string>();
  /** Servers that register but never reach the connected state. */
  readonly mcpConnectFailures = new Map<string, string>();
  /** MCP servers from OpenCode's own config, keyed by location directory. */
  readonly harnessMcpConfig = new Map<string, Record<string, Record<string, unknown>>>();
  readonly instructions = new Map<string, string>();
  releases = 0;
  active = false;
  activeReads = 0;
  autoComplete = true;
  constructor(private sequence = 0) {}
  private executions: SessionLogItem[] = [];
  startExecution() {
    this.active = true;
    this.push({
      id: `execution-${++this.sequence}`,
      created: this.sequence,
      type: "session.execution.started",
      durable: { aggregateID: this.info.id, seq: this.sequence, version: 1 },
      data: { sessionID: this.info.id },
    });
  }
  finishExecution(outcome: "succeeded" | "interrupted" = "succeeded", publish = true) {
    this.active = false;
    this.info.outcome = outcome;
    const common = {
      id: `execution-${++this.sequence}`,
      created: this.sequence,
      durable: { aggregateID: this.info.id, seq: this.sequence, version: 1 as const },
    };
    this.push(
      outcome === "succeeded"
        ? { ...common, type: "session.execution.succeeded", data: { sessionID: this.info.id } }
        : {
            ...common,
            type: "session.execution.interrupted",
            data: { sessionID: this.info.id, reason: "user" },
          },
      publish,
    );
  }
  prompt: V2Api["session"]["prompt"] = async (input) => {
    this.prompts.push(input.text);
    if (!this.autoComplete) this.startExecution();
  };
  interrupt: V2Api["session"]["interrupt"] = async () => {
    this.finishExecution("interrupted");
    return { interrupted: true };
  };
  private readonly subscribers: Array<{
    queue: OpenCodeEvent[];
    wake: (() => void) | null;
  }> = [];
  push(event: OpenCodeEvent, publish = true) {
    if (
      event.type === "session.execution.started" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    ) {
      this.sequence = Math.max(this.sequence, event.durable.seq);
      this.executions.push(event);
    }
    if (!publish) return;
    for (const subscriber of this.subscribers) {
      subscriber.queue.push(event);
      subscriber.wake?.();
      subscriber.wake = null;
    }
  }

  readonly api: V2Api = {
    server: { info: unexpected },
    shell: {
      remove: unexpected,
      list: async () => ({ location: { directory: this.info.location.directory }, data: [] }),
    },
    plugin: {
      list: async () => ({
        location: { directory: this.info.location.directory },
        data: [
          { id: "paseo", source: { type: "builtin" }, features: {}, state: { status: "active" } },
        ],
      }),
    },
    agent: {
      list: async () => ({
        location: {
          ...this.info.location,
          project: { id: "project", directory: "/tmp/project", canonical: "/tmp/project" },
        },
        data: [],
      }),
    },
    model: { list: unexpected, default: unexpected },
    provider: { list: unexpected },
    config: {
      get: async (input) => {
        const directory = input?.location?.directory ?? this.info.location.directory;
        const servers = this.harnessMcpConfig.get(directory) ?? {};
        return [
          {
            type: "document" as const,
            path: directory,
            info: { mcp: { servers } },
          },
        ];
      },
    },
    command: { list: unexpected },
    skill: { list: unexpected },
    mcp: {
      add: async (input) => {
        this.mcpAdds.push(input.server);
        if (this.mcpAddFailures.has(input.server)) {
          throw new Error(`OpenCode could not register MCP server ${input.server}`);
        }
      },
      remove: async (input) => {
        this.mcpExisting.delete(input.server);
      },
      list: async (input) => ({
        location: { directory: input?.location?.directory ?? this.info.location.directory },
        data: [...new Set([...this.mcpExisting, ...this.mcpAdds])].map((name) => ({
          name,
          status: this.mcpConnectFailures.has(name)
            ? { status: "failed" as const, error: this.mcpConnectFailures.get(name)! }
            : { status: "connected" as const },
        })),
      }),
    },
    message: {
      list: async (input) => {
        if (input.cursor && input.order) throw new Error("cursor cannot be combined with order");
        return { data: [...this.history], cursor: {} };
      },
    },
    permission: { list: async () => [], reply: unexpected },
    session: {
      inbox: { list: async () => [] },
      form: { list: async () => [], reply: unexpected, cancel: unexpected },
      create: async (input = {}) => {
        this.creates.push(input);
        const info = this.distinctSessionIds
          ? { ...this.info, id: `session-${this.sessionInfos.length + 1}` }
          : this.info;
        this.sessionInfos.push(info);
        return info;
      },
      get: async (input) =>
        this.sessionInfos.find((info) => info.id === input.sessionID) ?? this.info,
      list: async () => ({ data: [], cursor: {} }),
      active: async () => {
        this.activeReads += 1;
        return this.active ? { [this.info.id]: { type: "running" as const } } : {};
      },
      remove: async () => undefined,
      switchAgent: unexpected,
      switchModel: unexpected,
      environment: async (input) => {
        this.environments.push(input);
      },
      instructions: {
        entry: {
          list: async () => [...this.instructions].map(([key, value]) => ({ key, value })),
          put: async ({ key, value }) => {
            this.instructions.set(key, String(value));
          },
          remove: async ({ key }) => {
            this.instructions.delete(key);
          },
        },
      },
      prompt: async (input, options) => {
        const before = this.executions.length;
        await this.prompt(input, options);
        if (
          this.autoComplete &&
          this.executions.length === before &&
          this.info.outcome !== "failed"
        )
          this.finishExecution();
      },
      interrupt: (input, options) => this.interrupt(input, options),
      command: unexpected,
      compact: unexpected,
      revert: { stage: unexpected, clear: unexpected, commit: unexpected },
      log: (input) => this.executionLog(input.after),
    },
    event: { subscribe: (options) => this.events(options?.signal) },
  };
  readonly connection: V2Connection = {
    bindSession: async () => {},
    unbindSession: async () => {},
    refreshLocation: async () => {},
    client: this.api,
    release: async () => {
      this.releases += 1;
    },
    retain: () => this.connection,
    exited: new Promise<Error>(() => undefined),
    serviceKind: this.serviceKind,
    id: "harness-" + ++V2Harness.sequenceCounter,
  };
  readonly runtime = { acquire: async () => this.connection, shutdown: async () => undefined };

  private async *executionLog(after = 0) {
    for (const event of this.executions) {
      if ("durable" in event && event.durable.seq > after) yield event;
    }
  }

  private async *events(signal?: AbortSignal): AsyncGenerator<OpenCodeEvent> {
    const subscriber: { queue: OpenCodeEvent[]; wake: (() => void) | null } = {
      queue: [],
      wake: null,
    };
    this.subscribers.push(subscriber);
    yield { id: "connected", created: 1, type: "server.connected", data: {} };
    const wake = () => {
      subscriber.wake?.();
      subscriber.wake = null;
    };
    signal?.addEventListener("abort", wake);
    try {
      while (true) {
        if (signal?.aborted) return;
        const event = subscriber.queue.shift();
        if (event) yield event;
        else
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve;
          });
      }
    } finally {
      signal?.removeEventListener("abort", wake);
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    }
  }
}
