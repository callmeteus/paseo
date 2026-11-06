import { parseRepoNameFromRemoteUrl } from "@/utils/agent-grouping";

export type WorkspaceHoverLocality = "local" | "remote";

export interface WorkspaceHoverRepoLine {
  repo: string | null;
  branch: string | null;
}

export interface WorkspaceHoverPreview {
  title: string | null;
  repoLine: WorkspaceHoverRepoLine | null;
  path: string | null;
  locality: WorkspaceHoverLocality | null;
}

export interface WorkspaceHoverPreviewInput {
  title?: string | null;
  remoteUrl?: string | null;
  branch?: string | null;
  path?: string | null;
  serverId?: string | null;
  localServerId?: string | null;
  /** Desktop has not resolved the local daemon yet, so local and remote are both unknown. */
  localityPending?: boolean;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Owner/repo from a git remote URL the workspace already has.
 * A directory path is not a remote, so it does not become a repo name.
 */
export function workspaceHoverRepoName(remoteUrl: string | null | undefined): string | null {
  const url = nonEmpty(remoteUrl);
  if (!url) return null;
  if (!url.startsWith("git@") && !url.includes("://")) return null;
  return parseRepoNameFromRemoteUrl(url);
}

/** The checkout remote, then the project remote. A blank value is missing, not a name. */
export function workspaceHoverRemoteUrl(input: {
  gitRemoteUrl?: string | null;
  projectRemoteUrl?: string | null;
}): string | null {
  return nonEmpty(input.gitRemoteUrl) ?? nonEmpty(input.projectRemoteUrl);
}

function workspaceHoverLocality(input: WorkspaceHoverPreviewInput): WorkspaceHoverLocality | null {
  if (input.localityPending) return null;
  const localServerId = nonEmpty(input.localServerId);
  const serverId = nonEmpty(input.serverId);
  if (!localServerId || !serverId) return null;
  return serverId === localServerId ? "local" : "remote";
}

/**
 * Lines for the chat hover card. A missing repo, branch, path, or locality
 * is left out. Nothing here is filled in from the project name or the host label.
 */
export function workspaceHoverPreview(input: WorkspaceHoverPreviewInput): WorkspaceHoverPreview {
  const repo = workspaceHoverRepoName(input.remoteUrl);
  const branch = nonEmpty(input.branch);
  return {
    title: nonEmpty(input.title),
    repoLine: repo || branch ? { repo, branch } : null,
    path: nonEmpty(input.path),
    locality: workspaceHoverLocality(input),
  };
}
