import { describe, expect, it } from "vitest";
import { en } from "@/i18n/resources/en";
import { ptBR } from "@/i18n/resources/pt-BR";
import {
  workspaceHoverPreview,
  workspaceHoverRemoteUrl,
  workspaceHoverRepoName,
} from "./workspace-hover-preview";

describe("workspace hover preview", () => {
  it("shows title, owner/repo, branch, path, and local when each one is known", () => {
    expect(
      workspaceHoverPreview({
        title: "[SRE] MCP E7",
        remoteUrl: "git@github.com:even7hq/even7-sre.git",
        branch: "master",
        path: "~/luckymaker-workspace/even7-sre",
        serverId: "local-daemon",
        localServerId: "local-daemon",
      }),
    ).toEqual({
      title: "[SRE] MCP E7",
      repoLine: { repo: "even7hq/even7-sre", branch: "master" },
      path: "~/luckymaker-workspace/even7-sre",
      locality: "local",
    });
    expect(workspaceHoverRepoName("https://github.com/even7hq/even7-sre")).toBe(
      "even7hq/even7-sre",
    );
  });

  it("omits a line when that fact is missing, and does not borrow the project name", () => {
    expect(
      workspaceHoverPreview({
        title: "Paseo",
        remoteUrl: null,
        branch: null,
        path: "   ",
        serverId: "srv",
        localServerId: null,
      }),
    ).toEqual({
      title: "Paseo",
      repoLine: null,
      path: null,
      locality: null,
    });
    expect(workspaceHoverRepoName("/home/gio/Projetos Pessoais")).toBeNull();
    expect(workspaceHoverRepoName("Projetos Pessoais")).toBeNull();
  });

  it("keeps a branch without a repo, and a repo without a branch", () => {
    expect(
      workspaceHoverPreview({
        title: "Paseo",
        branch: "master",
      }).repoLine,
    ).toEqual({ repo: null, branch: "master" });
    expect(
      workspaceHoverPreview({
        title: "Paseo",
        remoteUrl: "ssh://git@github.com/even7hq/even7-sre.git",
      }).repoLine,
    ).toEqual({ repo: "even7hq/even7-sre", branch: null });
  });

  it("prefers the checkout remote and ignores a blank one", () => {
    expect(
      workspaceHoverRemoteUrl({
        gitRemoteUrl: "git@github.com:even7hq/even7-sre.git",
        projectRemoteUrl: "https://github.com/other/repo.git",
      }),
    ).toBe("git@github.com:even7hq/even7-sre.git");
    expect(
      workspaceHoverRemoteUrl({
        gitRemoteUrl: "  ",
        projectRemoteUrl: "https://github.com/even7hq/even7-sre.git",
      }),
    ).toBe("https://github.com/even7hq/even7-sre.git");
    expect(workspaceHoverRemoteUrl({ gitRemoteUrl: null, projectRemoteUrl: null })).toBeNull();
  });

  it("says remote only when the local daemon id is known and this chat is on another host", () => {
    expect(
      workspaceHoverPreview({
        title: "Paseo",
        serverId: "remote-host",
        localServerId: "local-daemon",
      }).locality,
    ).toBe("remote");
    expect(
      workspaceHoverPreview({
        title: "Paseo",
        serverId: "local-daemon",
        localServerId: "local-daemon",
        localityPending: true,
      }).locality,
    ).toBeNull();
  });

  it("uses the existing local and remote words, without an exclamation", () => {
    expect(en.workspace.hoverCard.local).toBe("Local");
    expect(en.workspace.hoverCard.remote).toBe("Remote");
    expect(ptBR.workspace.hoverCard.local).toBe("Local");
    expect(ptBR.workspace.hoverCard.remote).toBe("Remoto");
    for (const text of [
      en.workspace.hoverCard.local,
      en.workspace.hoverCard.remote,
      ptBR.workspace.hoverCard.local,
      ptBR.workspace.hoverCard.remote,
    ]) {
      expect(text).not.toContain("!");
    }
  });
});
