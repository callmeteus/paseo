import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execCommand: vi.fn(),
  findExecutable: vi.fn(),
}));

vi.mock("../utils/spawn.js", () => ({
  execCommand: mocks.execCommand,
}));

vi.mock("../executable-resolution/executable-resolution.js", () => ({
  findExecutable: mocks.findExecutable,
}));

import { createForgeCliRunner } from "./forge-cli-command.js";

function makeRunner() {
  return createForgeCliRunner({
    binary: "gh",
    envOverlay: {},
    timeoutMs: 1000,
    isAuthFailureText: () => false,
    errorClasses: {
      isAlreadyClassified: () => false,
      isCommandError: () => false,
      createAuthError: (stderr) => new Error(stderr),
      createMissingError: () => new Error("missing"),
      createCommandError: () => new Error("command failed"),
    },
  });
}

describe("forge CLI runner executable resolution", () => {
  it("runs a bare CLI name through its resolved path so multi-line args survive", async () => {
    mocks.findExecutable.mockResolvedValue("C:\\Program Files\\GitHub CLI\\gh.EXE");
    mocks.execCommand.mockResolvedValue({ stdout: "{}", stderr: "" });
    const runner = makeRunner();
    const query = "query Foo {\n  rateLimit {\n    limit\n  }\n}";

    await runner.run(["api", "graphql", "-f", `query=${query}`], { cwd: "/repo" });

    expect(mocks.findExecutable).toHaveBeenCalledWith("gh");
    expect(mocks.execCommand).toHaveBeenCalledWith(
      "C:\\Program Files\\GitHub CLI\\gh.EXE",
      ["api", "graphql", "-f", `query=${query}`],
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("keeps the bare name when resolution fails so ENOENT stays a missing-CLI error", async () => {
    mocks.findExecutable.mockResolvedValue(null);
    mocks.execCommand.mockRejectedValue(
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
    );
    const runner = makeRunner();

    const error = await runner.run(["auth", "status"], { cwd: "/repo" }).catch((e: unknown) => e);

    expect(mocks.execCommand).toHaveBeenCalledWith(
      "gh",
      ["auth", "status"],
      expect.objectContaining({ cwd: "/repo" }),
    );
    const normalized = runner.normalizeError(error, { args: ["auth", "status"], cwd: "/repo" });
    expect(normalized.message).toBe("missing");
  });
});
