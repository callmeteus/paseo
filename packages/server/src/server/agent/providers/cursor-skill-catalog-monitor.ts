import { watch as watchDirectory } from "node:fs";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentManager } from "../agent-manager.js";
import { createFileObserver, type FileObserver } from "../../file-observer/index.js";
import {
  CURSOR_SKILL_CATALOG_RELOAD_DEBOUNCE_MS,
  createSkillCatalogDebounce,
  cursorProjectRoot,
  cursorProjectSkillRoots,
  cursorUserSkillRoots,
  planSkillCatalogWatches,
  selectCursorSkillReloads,
  skillCatalogReloadScopes,
  type CursorSkillCatalog,
  type CursorSkillReloadAgent,
  type SkillCatalogChange,
  type SkillCatalogShallowWatch,
} from "./cursor-skill-catalog.js";

export interface CursorSkillCatalogLogger {
  warn(obj: { err?: unknown; agentId?: string; directory?: string }, message: string): void;
}

interface SkillCatalogWatchHandle {
  close(): void | Promise<void>;
}

export interface SkillCatalogWatcher {
  exists(path: string): boolean;
  watchRecursive(
    directory: string,
    onEvents: (events: SkillCatalogChange[]) => void,
  ): Promise<SkillCatalogWatchHandle>;
  watchShallow(
    directory: string,
    handlers: {
      onChild(name: string | null): void;
      onError(): void;
    },
  ): SkillCatalogWatchHandle;
}

export interface CursorSkillCatalogAgentHost {
  listCursorAgents(): CursorSkillReloadAgent[];
  reload(agentId: string): Promise<void>;
  subscribe(
    listener: (event: {
      type: "agent_state";
      agent: {
        id: string;
        provider: string;
        cwd: string;
        lifecycle: CursorSkillReloadAgent["lifecycle"];
        internal?: boolean;
      };
    }) => void,
  ): () => void;
}

const noopLogger: CursorSkillCatalogLogger = { warn() {} };

/**
 * Watches the skill directories ACP already reads and reloads idle Cursor
 * chats when a skill appears, changes, or disappears.
 *
 * A running turn is not cancelled. That chat reloads once it goes idle, and
 * every subscriber is told to refetch slash commands after the reload.
 */
export class CursorSkillCatalogMonitor implements CursorSkillCatalog {
  private readonly homeDirectory: string;
  private readonly agents: CursorSkillCatalogAgentHost;
  private readonly watcher: SkillCatalogWatcher;
  private readonly logger: CursorSkillCatalogLogger;
  private readonly debounce: { push: () => void; cancel: () => void };
  private readonly listeners = new Set<() => void>();
  private readonly projectRoots = new Set<string>();
  private readonly pendingAgentIds = new Set<string>();
  private readonly reloading = new Set<string>();
  private readonly recursive = new Map<string, SkillCatalogWatchHandle>();
  private readonly shallow = new Map<string, { expect: Set<string>; close(): void }>();
  private pendingChanges: SkillCatalogChange[] = [];
  private watchQueue: Promise<void> = Promise.resolve();
  private unsubscribeAgents: (() => void) | null = null;
  private ready = false;
  private stopped = false;

  constructor(input: {
    homeDirectory: string;
    agents: CursorSkillCatalogAgentHost;
    watcher: SkillCatalogWatcher;
    debounceMs?: number;
    logger?: CursorSkillCatalogLogger;
  }) {
    this.homeDirectory = resolve(input.homeDirectory);
    this.agents = input.agents;
    this.watcher = input.watcher;
    this.logger = input.logger ?? noopLogger;
    this.debounce = createSkillCatalogDebounce({
      delayMs: input.debounceMs ?? CURSOR_SKILL_CATALOG_RELOAD_DEBOUNCE_MS,
      onFire: () => {
        void this.flush().catch((error: unknown) => {
          this.logger.warn({ err: error }, "Failed to refresh the Cursor skill catalog");
        });
      },
    });
  }

  /**
   * Starts home watches and project watches for Cursor chats already open.
   * Draft workspaces are added later through {@link noteWorkspace}.
   */
  async start(): Promise<void> {
    if (this.ready || this.stopped) return;
    this.unsubscribeAgents = this.agents.subscribe((event) => {
      this.recordAgent(event.agent);
      if (event.agent.lifecycle === "idle") {
        void this.flushIdle(event.agent.id).catch((error: unknown) => {
          this.logger.warn(
            { err: error, agentId: event.agent.id },
            "Failed to reload an idle Cursor agent after a skill change",
          );
        });
      }
    });
    this.captureAgentProjects();
    this.ready = true;
    await this.enqueueWatches();
  }

  /** Drops watches and pending reloads. In-flight reloads finish on their own. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    this.debounce.cancel();
    this.pendingChanges = [];
    this.pendingAgentIds.clear();
    this.unsubscribeAgents?.();
    this.unsubscribeAgents = null;
    await this.closeWatches();
  }

  /**
   * Remembers a draft composer directory.
   *
   * The next `list_commands` for that draft spawns a fresh cursor-agent, which
   * reads the skill roots of this project. Watching them here is what makes a
   * skill created after that first listing show up.
   *
   * @param cwd - Draft working directory, already expanded.
   */
  noteWorkspace(cwd: string): void {
    if (this.stopped) return;
    const before = this.projectRoots.size;
    this.projectRoots.add(this.projectRoot(cwd));
    if (this.projectRoots.size === before) return;
    if (this.ready) this.debounce.push();
  }

  /**
   * Registers a composer session that should refetch slash commands.
   *
   * @param listener - Called after idle chats have been reloaded for a skill change.
   * @returns Unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recordAgent(agent: {
    provider: string;
    cwd: string;
    lifecycle: CursorSkillReloadAgent["lifecycle"];
    internal?: boolean;
  }): void {
    if (agent.internal || agent.provider !== "cursor" || agent.lifecycle === "closed") return;
    const before = this.projectRoots.size;
    this.projectRoots.add(this.projectRoot(agent.cwd));
    if (this.projectRoots.size !== before && this.ready) this.debounce.push();
  }

  private captureAgentProjects(): void {
    for (const agent of this.agents.listCursorAgents()) {
      this.recordAgent(agent);
    }
  }

  private projectRoot(cwd: string): string {
    return cursorProjectRoot(cwd, (path) => this.watcher.exists(path));
  }

  private enqueueWatches(): Promise<void> {
    const run = this.watchQueue.then(() => this.applyWatches());
    this.watchQueue = run.catch(() => undefined);
    return run;
  }

  private async applyWatches(): Promise<void> {
    if (this.stopped) return;
    const plan = planSkillCatalogWatches({
      roots: this.catalogRoots(),
      exists: (path) => this.watcher.exists(path),
    });
    await this.syncRecursive(plan.recursive);
    if (this.stopped) return;
    this.syncShallow(plan.shallow);
  }

  private catalogRoots(): string[] {
    return [
      ...cursorUserSkillRoots(this.homeDirectory),
      ...[...this.projectRoots].flatMap((projectRoot) => cursorProjectSkillRoots(projectRoot)),
    ];
  }

  private async syncRecursive(directories: readonly string[]): Promise<void> {
    const next = new Set(directories.map((directory) => resolve(directory)));
    for (const [directory, handle] of this.recursive) {
      if (next.has(directory)) continue;
      this.recursive.delete(directory);
      await Promise.resolve(handle.close()).catch(() => undefined);
    }
    for (const directory of next) {
      if (this.recursive.has(directory) || this.stopped) continue;
      try {
        const handle = await this.watcher.watchRecursive(directory, (events) => {
          this.pendingChanges.push(...events);
          this.debounce.push();
        });
        if (this.stopped) {
          await Promise.resolve(handle.close()).catch(() => undefined);
          continue;
        }
        this.recursive.set(directory, handle);
      } catch (error) {
        this.logger.warn({ err: error, directory }, "Failed to watch a Cursor skill directory");
      }
    }
  }

  private syncShallow(entries: readonly SkillCatalogShallowWatch[]): void {
    const grouped = new Map<string, Set<string>>();
    for (const entry of entries) {
      const directory = resolve(entry.directory);
      const expect = grouped.get(directory) ?? new Set<string>();
      expect.add(entry.expectChild);
      grouped.set(directory, expect);
    }
    for (const [directory, current] of this.shallow) {
      const expect = grouped.get(directory);
      if (expect && sameMembers(expect, current.expect)) continue;
      current.close();
      this.shallow.delete(directory);
    }
    for (const [directory, expect] of grouped) {
      if (this.shallow.has(directory)) continue;
      try {
        const handle = this.watcher.watchShallow(directory, {
          onChild: (name) => {
            if (name !== null && !this.shallow.get(directory)?.expect.has(name)) return;
            if (name !== null) {
              const child = isAbsolute(name) ? name : join(directory, name);
              this.pendingChanges.push({ path: child, type: "create" });
            }
            this.debounce.push();
          },
          onError: () => {
            this.debounce.push();
          },
        });
        this.shallow.set(directory, {
          expect,
          close: () => {
            try {
              handle.close();
            } catch {
              // The directory may already be gone.
            }
          },
        });
      } catch (error) {
        this.logger.warn(
          { err: error, directory },
          "Failed to watch a Cursor skill parent directory",
        );
      }
    }
  }

  private async closeWatches(): Promise<void> {
    const handles = [...this.recursive.values()];
    this.recursive.clear();
    for (const current of this.shallow.values()) current.close();
    this.shallow.clear();
    await Promise.all(
      handles.map((handle) => Promise.resolve(handle.close()).catch(() => undefined)),
    );
  }

  private async flush(): Promise<void> {
    if (this.stopped) return;
    const changes = this.pendingChanges.splice(0);
    this.captureAgentProjects();
    await this.enqueueWatches();
    if (this.stopped || changes.length === 0) return;
    const projects = [...this.projectRoots].map((projectRoot) => ({
      projectRoot,
      directories: cursorProjectSkillRoots(projectRoot),
    }));
    const scopes = skillCatalogReloadScopes({
      changes,
      userRoots: cursorUserSkillRoots(this.homeDirectory),
      projects,
      exists: (path) => this.watcher.exists(path),
    });
    if (scopes.length === 0) return;
    const decision = selectCursorSkillReloads({
      agents: this.agents.listCursorAgents(),
      scopes,
      projectRootOf: (cwd) => this.projectRoot(cwd),
    });
    for (const agentId of decision.later) this.pendingAgentIds.add(agentId);
    await Promise.all(decision.now.map((agentId) => this.reloadAgent(agentId)));
    this.notify();
  }

  private async flushIdle(agentId: string): Promise<void> {
    if (!this.pendingAgentIds.has(agentId) || this.reloading.has(agentId) || this.stopped) return;
    const agent = this.agents.listCursorAgents().find((candidate) => candidate.agentId === agentId);
    if (!agent || agent.lifecycle === "closed") {
      this.pendingAgentIds.delete(agentId);
      return;
    }
    if (agent.busy || agent.lifecycle === "running" || agent.lifecycle === "initializing") return;
    this.pendingAgentIds.delete(agentId);
    await this.reloadAgent(agentId);
    this.notify();
  }

  private async reloadAgent(agentId: string): Promise<void> {
    if (this.stopped) return;
    if (this.reloading.has(agentId)) {
      this.pendingAgentIds.add(agentId);
      return;
    }
    this.reloading.add(agentId);
    this.pendingAgentIds.delete(agentId);
    try {
      await this.agents.reload(agentId);
    } catch (error) {
      this.logger.warn(
        { err: error, agentId },
        "Failed to reload Cursor agent after a skill catalog change",
      );
    } finally {
      this.reloading.delete(agentId);
    }
    if (!this.pendingAgentIds.has(agentId) || this.stopped) return;
    const agent = this.agents.listCursorAgents().find((candidate) => candidate.agentId === agentId);
    if (!agent || agent.lifecycle === "closed") {
      this.pendingAgentIds.delete(agentId);
      return;
    }
    if (agent.busy || agent.lifecycle === "running" || agent.lifecycle === "initializing") return;
    this.pendingAgentIds.delete(agentId);
    await this.reloadAgent(agentId);
  }

  private notify(): void {
    if (this.stopped) return;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.logger.warn({ err: error }, "Failed to notify a Cursor skill catalog listener");
      }
    }
  }
}

/**
 * Node watcher: recursive file observer on skill roots that exist, and a
 * non-recursive `fs.watch` on the parent of a root that does not.
 *
 * @returns A watcher the catalog monitor can own.
 */
export function createNodeSkillCatalogWatcher(): SkillCatalogWatcher {
  let observer: FileObserver | null = null;
  const observerOf = () => (observer ??= createFileObserver());
  return {
    exists: (path) => existsSync(path),
    async watchRecursive(directory, onEvents) {
      const subscription = await observerOf().subscribe(directory, (error, events) => {
        if (error) return;
        onEvents(events);
      });
      return { close: () => subscription.unsubscribe() };
    },
    watchShallow(directory, handlers) {
      const handle = watchDirectory(directory, { persistent: false }, (_eventType, filename) => {
        handlers.onChild(typeof filename === "string" ? filename : null);
      });
      handle.on("error", () => {
        handlers.onError();
      });
      return {
        close: () => {
          handle.close();
        },
      };
    },
  };
}

/**
 * Production monitor bound to the agent manager.
 *
 * Reload keeps the in-memory timeline (`rehydrateFromDisk` stays off) and is
 * only called for chats that are not in a turn.
 *
 * @param input - Home directory, agent manager, and optional watcher for tests.
 * @returns A monitor to start with the daemon and stop on shutdown.
 */
export function createCursorSkillCatalogMonitor(input: {
  homeDirectory: string;
  agentManager: AgentManager;
  logger?: CursorSkillCatalogLogger;
  debounceMs?: number;
  watcher?: SkillCatalogWatcher;
}): CursorSkillCatalogMonitor {
  const agentManager = input.agentManager;
  return new CursorSkillCatalogMonitor({
    homeDirectory: input.homeDirectory,
    debounceMs: input.debounceMs,
    logger: input.logger,
    watcher: input.watcher ?? createNodeSkillCatalogWatcher(),
    agents: {
      listCursorAgents() {
        return agentManager.listAgents().map((agent) => ({
          agentId: agent.id,
          provider: agent.provider,
          cwd: agent.config.cwd || agent.cwd,
          lifecycle: agent.lifecycle,
          busy:
            agent.lifecycle === "initializing" ||
            agent.lifecycle === "running" ||
            agentManager.hasInFlightRun(agent.id),
          internal: agent.internal === true,
        }));
      },
      reload(agentId) {
        return agentManager.reloadAgentSession(agentId).then(() => undefined);
      },
      subscribe(listener) {
        return agentManager.subscribe((event) => {
          if (event.type !== "agent_state") return;
          listener({
            type: "agent_state",
            agent: {
              id: event.agent.id,
              provider: event.agent.provider,
              cwd: event.agent.config.cwd || event.agent.cwd,
              lifecycle: event.agent.lifecycle,
              internal: event.agent.internal,
            },
          });
        });
      },
    },
  });
}

function sameMembers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
