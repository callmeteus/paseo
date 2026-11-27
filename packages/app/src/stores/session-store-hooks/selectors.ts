import equal from "fast-deep-equal";
import { applyStoredOrdering } from "@/hooks/sidebar-workspaces-view-model";
import {
  buildWorkspaceStructureProjects,
  indexWorkspaceActivityAt,
  type WorkspaceSort,
  type WorkspaceStructure,
  type WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "../session-store";

export type { WorkspaceStructure, WorkspaceStructureProject } from "@/projects/workspace-structure";

export interface SessionsSnapshot {
  agentLastActivity?: ReadonlyMap<string, Date>;
  sessions: Record<
    string,
    {
      hasHydratedWorkspaces?: boolean;
      hasWorkspaceDirectorySnapshot?: boolean;
      workspaces: Map<string, WorkspaceDescriptor>;
      projects?: Map<string, ProjectDescriptor>;
      agents?: ReadonlyMap<string, Agent>;
    }
  >;
}

export interface SidebarOrderSnapshot {
  projectOrder: string[];
}

const EMPTY_WORKSPACE_KEYS: string[] = [];
const EMPTY_WORKSPACE_STRUCTURE: WorkspaceStructure = { projects: [] };

export const workspaceEqualityFns = {
  identity: Object.is as (a: unknown, b: unknown) => boolean,
  deep: equal as (a: unknown, b: unknown) => boolean,
};

export function selectWorkspace(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): WorkspaceDescriptor | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  const workspaceKey = resolveWorkspaceMapKeyByIdentity({
    workspaces,
    workspaceId,
  });
  return workspaceKey ? (workspaces?.get(workspaceKey) ?? null) : null;
}

export function selectWorkspaceFields<T>(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
  project: (w: WorkspaceDescriptor) => T,
): T | null {
  const workspace = selectWorkspace(state, serverId, workspaceId);
  return workspace ? project(workspace) : null;
}

export function selectWorkspaceDirectory(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return selectWorkspace(state, serverId, workspaceId)?.workspaceDirectory || null;
}

export function selectWorkspaceExists(
  state: SessionsSnapshot,
  serverId: string | null,
  workspaceId: string | null,
): boolean {
  return selectWorkspace(state, serverId, workspaceId) !== null;
}

export function selectHasHydratedWorkspaces(
  state: SessionsSnapshot,
  serverId: string | null,
): boolean {
  return serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false;
}

export function selectHydratedWorkspaceServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => state.sessions[serverId]?.hasHydratedWorkspaces === true);
}

export function selectWorkspaceDirectoryServerIds(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): string[] {
  return serverIds.filter((serverId) => {
    const session = state.sessions[serverId];
    return (
      session?.hasHydratedWorkspaces === true || session?.hasWorkspaceDirectorySnapshot === true
    );
  });
}

export function selectWorkspaceStructureProjects(
  state: SessionsSnapshot,
  serverIds: readonly string[],
  workspaceSort?: WorkspaceSort,
): WorkspaceStructureProject[] {
  const sessions: Array<{
    serverId: string;
    workspaces: Iterable<WorkspaceDescriptor>;
    projects: Iterable<ProjectDescriptor>;
  }> = [];

  for (const serverId of serverIds) {
    const session = state.sessions[serverId];
    const workspaces = session?.workspaces;
    const projects = session?.projects;
    if (!projects || projects.size === 0) {
      continue;
    }
    sessions.push({
      serverId,
      workspaces: workspaces?.values() ?? [],
      projects: projects.values(),
    });
  }

  if (sessions.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE.projects;
  }

  return buildWorkspaceStructureProjects({
    sessions,
    workspaceSort,
    activityAtByWorkspaceKey:
      workspaceSort === "updated" ? activityAtByWorkspaceKey(state, serverIds) : undefined,
  });
}

function activityAtByWorkspaceKey(
  state: SessionsSnapshot,
  serverIds: readonly string[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (const serverId of serverIds) {
    const agents = state.sessions[serverId]?.agents;
    if (!agents) continue;
    const serverActivity = indexWorkspaceActivityAt({
      serverId,
      agents: agents.values(),
      liveActivity: state.agentLastActivity,
    });
    for (const [key, at] of serverActivity) {
      index.set(key, at);
    }
  }
  return index;
}

export function createWorkspaceStructureProjectsSelector(
  serverIds: readonly string[],
  workspaceSort?: WorkspaceSort,
): (state: SessionsSnapshot) => WorkspaceStructureProject[] {
  let previousInputs: Array<{
    workspaces: Map<string, WorkspaceDescriptor> | undefined;
    projects: Map<string, ProjectDescriptor> | undefined;
  }> | null = null;
  let previousAgentMaps: Array<ReadonlyMap<string, Agent> | undefined> | null = null;
  let previousLiveActivity: ReadonlyMap<string, Date> | undefined;
  let previousProjects: WorkspaceStructureProject[] | null = null;

  return (state) => {
    const tracksActivity = workspaceSort === "updated";
    const inputs = serverIds.map((serverId) => ({
      workspaces: state.sessions[serverId]?.workspaces,
      projects: state.sessions[serverId]?.projects,
    }));
    const agentMaps = tracksActivity
      ? serverIds.map((serverId) => state.sessions[serverId]?.agents)
      : null;
    const liveActivity = tracksActivity ? state.agentLastActivity : undefined;
    const priorInputs = previousInputs;
    const directoriesUnchanged =
      priorInputs !== null &&
      inputs.every(
        (input, index) =>
          input.workspaces === priorInputs[index]?.workspaces &&
          input.projects === priorInputs[index]?.projects,
      );
    const activityUnchanged =
      !tracksActivity ||
      (liveActivity === previousLiveActivity &&
        agentMaps !== null &&
        previousAgentMaps !== null &&
        agentMaps.every((agents, index) => agents === previousAgentMaps?.[index]));
    if (directoriesUnchanged && activityUnchanged && previousProjects) {
      return previousProjects;
    }

    previousInputs = inputs;
    previousAgentMaps = agentMaps;
    previousLiveActivity = liveActivity;
    const next = selectWorkspaceStructureProjects(state, serverIds, workspaceSort);
    const previousByKey = new Map(previousProjects?.map((project) => [project.viewKey, project]));
    previousProjects = next.map((project) => {
      const previous = previousByKey.get(project.viewKey);
      return previous && equal(previous, project) ? previous : project;
    });
    return previousProjects;
  };
}

export function selectProject(
  state: SessionsSnapshot,
  serverId: string | null,
  projectId: string | null,
): ProjectDescriptor | null {
  if (!serverId || !projectId) return null;
  return state.sessions[serverId]?.projects?.get(projectId) ?? null;
}

export function selectProjectIdForServer(
  state: SessionsSnapshot,
  input: {
    sourceServerId: string;
    projectId: string;
    targetServerId: string;
  },
): string | null {
  if (input.sourceServerId === input.targetServerId) return input.projectId;
  const source = selectProject(state, input.sourceServerId, input.projectId);
  if (!source?.projectKey) return null;
  for (const project of state.sessions[input.targetServerId]?.projects?.values() ?? []) {
    if (project.projectKey === source.projectKey) return project.projectId;
  }
  return null;
}

export function selectProjectOrder(state: SidebarOrderSnapshot): string[] {
  return state.projectOrder ?? EMPTY_WORKSPACE_KEYS;
}

export function composeWorkspaceStructure(input: {
  projects: WorkspaceStructureProject[];
  projectOrder: readonly string[];
  workspaceOrderByProject?: Readonly<Record<string, string[]>>;
}): WorkspaceStructure {
  if (input.projects.length === 0) {
    return EMPTY_WORKSPACE_STRUCTURE;
  }

  const orderedProjects = applyStoredOrdering({
    items: input.projects,
    storedOrder: input.projectOrder,
    getKey: (project) => project.viewKey,
  });

  return {
    // Keep the shared automatic projection immutable when applying a sidebar preference.
    // eslint-disable-next-line oxc/no-map-spread
    projects: orderedProjects.map((project) => {
      const storedOrder = input.workspaceOrderByProject?.[project.viewKey];
      if (!storedOrder) return project;
      const orderedProject = { ...project };
      orderedProject.workspaceKeys = applyStoredOrdering({
        items: project.workspaceKeys,
        storedOrder,
        getKey: (key) => key,
      });
      return orderedProject;
    }),
  };
}

export function selectWorkspaceKeys(state: SessionsSnapshot, serverId: string | null): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  return workspaces ? Array.from(workspaces.keys()) : EMPTY_WORKSPACE_KEYS;
}

export function selectRecommendedProjectPaths(
  state: SessionsSnapshot,
  serverId: string | null,
): string[] {
  if (!serverId) {
    return EMPTY_WORKSPACE_KEYS;
  }
  const workspaces = state.sessions[serverId]?.workspaces;
  if (!workspaces) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return (
    Array.from(workspaces.values())
      .map((workspace) => workspace.projectRootPath)
      // A stale or partially hydrated descriptor can omit the root path. Filtering
      // here keeps a picker that reads recommended paths from crashing on open.
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
  );
}

export function selectProjectRootPaths(state: SessionsSnapshot, serverId: string | null): string[] {
  const projects = serverId ? state.sessions[serverId]?.projects : undefined;
  if (!projects || projects.size === 0) {
    return EMPTY_WORKSPACE_KEYS;
  }
  return Array.from(projects.values(), (project) => project.projectRootPath);
}

export function selectHasWorkspaces(state: SessionsSnapshot, serverId: string | null): boolean {
  if (!serverId) {
    return false;
  }
  return (state.sessions[serverId]?.workspaces?.size ?? 0) > 0;
}
