import pino from "pino";
import { expect, test } from "vitest";
import type { AgentManager } from "./agent/agent-manager.js";
import type { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createPersistedWorkspaceRecord, type WorkspaceRegistry } from "./workspace-registry.js";
import type { WorkspaceGitService } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "update">;
  const autoName = new WorkspaceAutoName({
    agentManager: {} as AgentManager,
    workspaceRegistry,
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});

test("auto-name gives the workspace and the OpenCode agent the same title", async () => {
  const prompt = "Fix the login bug before the release";
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-shared-title",
    projectId: "project-shared-title",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    title: prompt,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const agentTitles: string[] = [];
  const updateEmitted = deferred();
  const autoName = new WorkspaceAutoName({
    agentManager: {
      setTitle: async (_agentId: string, title: string) => {
        agentTitles.push(title);
      },
    } as AgentManager,
    workspaceRegistry: {
      update: async (_workspaceId, updater) => {
        workspace = updater(workspace);
        return workspace;
      },
    },
    workspaceGitService: {} as WorkspaceGitService,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "Repair the login", branch: null }),
    listWorkspaceAgentTitles: async () => [
      { id: "opencode", title: prompt },
      { id: "cloud", title: prompt },
    ],
    readWorkspace: async () => workspace,
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt },
  });
  await updateEmitted.promise;

  expect(workspace.title).toBe("Repair the login");
  expect(agentTitles).toEqual(["Repair the login", "Repair the login"]);

  await autoName.applyObservedSessionTitle({
    workspaceId: workspace.workspaceId,
    agentId: "opencode",
    agentTitle: "Repair the login",
    observedTitle: "Shorter login fix",
  });

  expect(workspace.title).toBe("Shorter login fix");
  expect(agentTitles).toEqual([
    "Repair the login",
    "Repair the login",
    "Shorter login fix",
    "Shorter login fix",
  ]);
});
