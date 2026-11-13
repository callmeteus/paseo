import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "./runner.js";

let cwd: string;

beforeAll(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-run-command-"));
});

afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("runCommand", () => {
  it("returns stdout and a zero exit code", async () => {
    const result = await runCommand({
      cwd,
      command: process.execPath,
      args: ["-e", "process.stdout.write('hello')"],
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
    });
    expect(result.status).toBe("exited");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.stderr).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("reports a non-zero exit code", async () => {
    const result = await runCommand({
      cwd,
      command: process.execPath,
      args: ["-e", "process.stderr.write('bad'); process.exit(3)"],
      timeoutMs: 30_000,
      maxOutputBytes: 1024,
    });
    expect(result.status).toBe("exited");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("bad");
  });

  it("truncates output at the configured limit", async () => {
    const result = await runCommand({
      cwd,
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(5000))"],
      timeoutMs: 30_000,
      maxOutputBytes: 100,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(100);
  });

  it("kills a command that exceeds the timeout", async () => {
    const result = await runCommand({
      cwd,
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.stdout.write('late'), 30000)"],
      timeoutMs: 1_000,
      maxOutputBytes: 1024,
    });
    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
  }, 15_000);

  it("reports a missing executable as an error", async () => {
    const result = await runCommand({
      cwd,
      command: "paseo-definitely-missing-binary",
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    });
    expect(result.status).toBe("error");
    expect(result.error).toBeTruthy();
  });
});
