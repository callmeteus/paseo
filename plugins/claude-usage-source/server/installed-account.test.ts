import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inputSchema } from "../shared/input.js";
import {
  commandOnPath,
  signedOutClaudeReport,
  withInstalledClaudeAccount,
} from "./installed-account.js";

describe("withInstalledClaudeAccount", () => {
  it("adds a signed-out account when Claude is installed and no login is stored", async () => {
    const accounts = await withInstalledClaudeAccount({ kind: "global" }, [], async () => true);
    const [account] = accounts;

    expect(accounts).toHaveLength(1);
    expect(account?.harness).toBe("Claude");
    expect(signedOutClaudeReport(inputSchema.parse(account?.input))).toMatchObject({
      status: "unavailable",
      problem: {
        kind: "no_quota",
        detail: "Claude is not signed in. Run claude auth login.",
      },
    });
  });

  it("stays empty when the Claude CLI is not installed", async () => {
    await expect(
      withInstalledClaudeAccount({ kind: "global" }, [], async () => false),
    ).resolves.toEqual([]);
  });

  it("keeps a real login and does not add the signed-out account", async () => {
    const login = {
      key: "account",
      input: {
        route: {
          store: "claude" as const,
          path: "/tmp/claude-credentials.json",
        },
      },
    };

    await expect(
      withInstalledClaudeAccount({ kind: "global" }, [login], async () => true),
    ).resolves.toEqual([login]);
  });

  it("does not invent a host account for a session that has no login", async () => {
    await expect(
      withInstalledClaudeAccount(
        {
          kind: "session",
          provider: "claude",
          env: {},
        },
        [],
        async () => true,
      ),
    ).resolves.toEqual([]);
  });

  it("ignores a real credential path", () => {
    expect(
      signedOutClaudeReport({
        route: {
          store: "claude",
          path: "/tmp/claude-credentials.json",
        },
      }),
    ).toBeNull();
  });
});

describe("commandOnPath", () => {
  it("finds an executable and ignores a missing command", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-path-"));

    try {
      const binary = join(directory, "claude");
      await writeFile(binary, "#!/bin/sh\n");
      await chmod(binary, 0o755);

      await expect(commandOnPath("claude", { PATH: directory })).resolves.toBe(true);
      await expect(commandOnPath("kilo", { PATH: directory })).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores a directory and a file that cannot be executed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "claude-path-"));

    try {
      await mkdir(join(directory, "claude"));
      const binary = join(directory, "other");
      await writeFile(binary, "#!/bin/sh\n");
      await chmod(binary, 0o644);

      await expect(commandOnPath("claude", { PATH: directory })).resolves.toBe(false);
      await expect(commandOnPath("other", { PATH: directory })).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
