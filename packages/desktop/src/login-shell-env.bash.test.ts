import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inheritLoginShellEnv } from "./login-shell-env";

const bash = "/bin/bash";
const describeIfBash = existsSync(bash) ? describe : describe.skip;
const basePath = "/usr/bin:/bin:/usr/sbin:/sbin";

interface RecordedLog {
  message: string;
  fields: Record<string, unknown>;
}

class RecordingLoginShellLogger {
  readonly infos: RecordedLog[] = [];
  readonly warnings: RecordedLog[] = [];

  info(message: string, fields: Record<string, unknown>): void {
    this.infos.push({ message, fields });
  }

  warn(message: string, fields: Record<string, unknown>): void {
    this.warnings.push({ message, fields });
  }
}

function createEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USER: "paseo-test",
    LOGNAME: "paseo-test",
    SHELL: bash,
    PATH: basePath,
  };
}

describeIfBash("bash login shell env", () => {
  const homes = new Set<string>();

  afterEach(async () => {
    await Promise.all([...homes].map((home) => rm(home, { recursive: true, force: true })));
    homes.clear();
  });

  it("loads bins from bashrc when bash_profile does not source it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paseo-login-shell-env-bash-"));
    homes.add(home);
    const profileBin = path.join(home, "profile-bin");
    const nvmBin = path.join(home, "nvm-bin");
    await mkdir(profileBin);
    await mkdir(nvmBin);
    await writeFile(path.join(home, ".bash_profile"), 'export PATH="$HOME/profile-bin:$PATH"\n');
    await writeFile(
      path.join(home, ".bashrc"),
      [
        "case $- in",
        "  *i*) ;;",
        "  *) return ;;",
        "esac",
        'export PATH="$HOME/nvm-bin:$PATH"',
        "export PASEO_TEST_BASHRC_LOADED=1",
        "",
      ].join("\n"),
    );
    const env = createEnv(home);
    const logger = new RecordingLoginShellLogger();

    inheritLoginShellEnv({ env, logger, platform: "linux" });

    const pathEntries = env.PATH?.split(path.delimiter) ?? [];
    expect(pathEntries[0]).toBe(nvmBin);
    expect(pathEntries).toContain(profileBin);
    expect(env.PASEO_TEST_BASHRC_LOADED).toBe("1");
    expect(logger.warnings).toEqual([]);
    expect(logger.infos.map((entry) => entry.message)).toEqual([
      "[login-shell-env] start",
      "[login-shell-env] attempt applied",
      "[login-shell-env] applied",
    ]);
  });

  it("keeps the login profile when bashrc exits during the interactive capture", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "paseo-login-shell-env-bash-"));
    homes.add(home);
    const profileBin = path.join(home, "profile-bin");
    await mkdir(profileBin);
    await writeFile(path.join(home, ".bash_profile"), 'export PATH="$HOME/profile-bin:$PATH"\n');
    await writeFile(
      path.join(home, ".bashrc"),
      ["case $- in", "  *i*) ;;", "  *) return ;;", "esac", "exit 9", ""].join("\n"),
    );
    const env = createEnv(home);
    const logger = new RecordingLoginShellLogger();

    inheritLoginShellEnv({ env, logger, platform: "linux" });

    const pathEntries = env.PATH?.split(path.delimiter) ?? [];
    expect(pathEntries).toContain(profileBin);
    expect(env.PASEO_TEST_BASHRC_LOADED).toBeUndefined();
    expect(logger.warnings.map((entry) => entry.message)).toEqual([
      "[login-shell-env] attempt failed; retrying",
    ]);
    expect(logger.infos.map((entry) => entry.message)).toEqual([
      "[login-shell-env] start",
      "[login-shell-env] attempt applied",
      "[login-shell-env] applied",
    ]);
    expect(logger.infos[1]?.fields).toMatchObject({
      attemptKind: "non-interactive",
      reason: "success",
    });
  });
});
