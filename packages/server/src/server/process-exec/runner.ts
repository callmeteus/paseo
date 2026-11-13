import { spawn, spawnSync } from "node:child_process";

export interface RunCommandInput {
  cwd: string;
  command: string;
  args?: readonly string[];
  shell?: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface RunCommandResult {
  status: "exited" | "timeout" | "error";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  error: string | null;
}

const KILL_GRACE_MS = 2_000;

/** Runs one command with bounded output and a hard timeout. */
export function runCommand(input: RunCommandInput): Promise<RunCommandResult> {
  const startedAt = Date.now();
  return new Promise<RunCommandResult>((resolve) => {
    let settled = false;
    let truncated = false;
    let timedOut = false;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const limit = input.maxOutputBytes;

    const child = spawn(input.command, [...(input.args ?? [])], {
      cwd: input.cwd,
      shell: input.shell === true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const collect = (chunks: Buffer[], current: number, chunk: Buffer): number => {
      const remaining = limit - current;
      if (remaining <= 0) {
        truncated = true;
        return current;
      }
      if (chunk.byteLength > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        truncated = true;
        return limit;
      }
      chunks.push(chunk);
      return current + chunk.byteLength;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes = collect(stdout, stdoutBytes, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = collect(stderr, stderrBytes, chunk);
    });

    const finish = (result: Pick<RunCommandResult, "status" | "exitCode" | "signal" | "error">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      // eslint-disable-next-line promise/no-multiple-resolved -- every caller goes through the settled guard above.
      resolve({
        ...result,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated,
        durationMs: Date.now() - startedAt,
      });
    };

    const killTree = () => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process already exited.
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      // Do not wait forever for an uncooperative child.
      setTimeout(() => {
        finish({
          status: "timeout",
          exitCode: null,
          signal: "SIGKILL",
          error: `Command timed out after ${input.timeoutMs}ms`,
        });
      }, KILL_GRACE_MS);
    }, input.timeoutMs);

    const abort = () => {
      killTree();
      finish({
        status: "error",
        exitCode: null,
        signal: "SIGKILL",
        error: "Command aborted",
      });
    };
    input.signal?.addEventListener("abort", abort, { once: true });

    child.on("error", (error) => {
      finish({
        status: "error",
        exitCode: null,
        signal: null,
        error: error.message,
      });
    });

    child.on("close", (code, signal) => {
      finish({
        status: timedOut ? "timeout" : "exited",
        exitCode: code,
        signal: signal ?? null,
        error: timedOut ? `Command timed out after ${input.timeoutMs}ms` : null,
      });
    });
  });
}
