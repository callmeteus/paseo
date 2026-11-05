import { describe, expect, it } from "vitest";
import {
  createSidebarCalloutState,
  dismissSidebarCallout,
  loadDismissedCalloutKeys,
  selectActiveSidebarCallout,
  showSidebarCallout,
} from "../contexts/sidebar-callout-state";
import {
  buildWorktreeSetupCalloutPolicy,
  selectActiveGitWorkspaceProject,
  shouldShowWorktreeSetupCallout,
  WORKTREE_SETUP_CALLOUT_DISMISSAL_KEY,
} from "./worktree-setup-callout-policy";

describe("selectActiveGitWorkspaceProject", () => {
  it("selects the host-local project id for a git workspace", () => {
    expect(
      selectActiveGitWorkspaceProject("server-1", {
        projectId: "prj_local",
        projectKind: "git",
        projectRootPath: "/repo/project",
      }),
    ).toEqual({
      serverId: "server-1",
      projectId: "prj_local",
      repoRoot: "/repo/project",
    });
  });

  it("ignores non-git workspaces and blank coordinates", () => {
    expect(
      selectActiveGitWorkspaceProject("server-1", {
        projectId: "project",
        projectKind: "directory",
        projectRootPath: "/repo",
      }),
    ).toBeNull();
  });
});

describe("shouldShowWorktreeSetupCallout", () => {
  it("shows only after a successful config read with no setup command", () => {
    expect(shouldShowWorktreeSetupCallout({ ok: true, config: {} })).toBe(true);
    expect(
      shouldShowWorktreeSetupCallout({ ok: true, config: { worktree: { setup: "npm i" } } }),
    ).toBe(false);
    expect(shouldShowWorktreeSetupCallout({ ok: false })).toBe(false);
  });
});

describe("buildWorktreeSetupCalloutPolicy", () => {
  it("routes by server id and project id", () => {
    expect(
      buildWorktreeSetupCalloutPolicy({
        serverId: "server-1",
        projectId: "prj_local",
        repoRoot: "/repo/project",
      }),
    ).toMatchObject({
      id: "worktree-setup-missing:server-1:prj_local",
      dismissalKey: WORKTREE_SETUP_CALLOUT_DISMISSAL_KEY,
      actionLabel: "Open project settings",
      dismissLabel: "Don't show again",
      projectSettingsRoute: "/settings/hosts/server-1/projects/prj_local",
      testID: "worktree-setup-callout-prj_local",
    });
  });

  it("keeps the callout hidden for every project after one dismissal on this machine", () => {
    const first = buildWorktreeSetupCalloutPolicy({
      serverId: "server-1",
      projectId: "prj_a",
      repoRoot: "/repo/a",
    });
    const second = buildWorktreeSetupCalloutPolicy({
      serverId: "server-2",
      projectId: "prj_b",
      repoRoot: "/repo/b",
    });

    expect(first.dismissalKey).toBe(WORKTREE_SETUP_CALLOUT_DISMISSAL_KEY);
    expect(second.dismissalKey).toBe(first.dismissalKey);

    let state = loadDismissedCalloutKeys(createSidebarCalloutState(), new Set());
    state = showSidebarCallout(state, {
      id: first.id,
      dismissalKey: first.dismissalKey,
      title: first.title,
    }).state;
    state = dismissSidebarCallout(state, first.id).state;
    state = showSidebarCallout(state, {
      id: second.id,
      dismissalKey: second.dismissalKey,
      title: second.title,
    }).state;

    expect(selectActiveSidebarCallout(state)).toBeNull();
  });
});
