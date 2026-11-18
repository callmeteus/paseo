import path from "node:path";
import { describe, expect, test } from "vitest";
import { PlanPathError, resolvePlanFile } from "./plan-files.js";

const home = path.resolve("/tmp/paseo-home");
const workspaceId = "wks_abc";
const root = path.join(home, "plans", workspaceId);

describe("resolvePlanFile", () => {
  test("stores a plan name outside the workspace checkout", () => {
    expect(
      resolvePlanFile({ paseoHome: home, workspaceId, requestedPath: "feature-name" }),
    ).toEqual({
      absolutePath: path.join(root, "feature-name.md"),
      title: "feature-name",
    });
    expect(
      resolvePlanFile({ paseoHome: home, workspaceId, requestedPath: "plans/feature-name.md" })
        .absolutePath,
    ).toBe(path.join(root, "feature-name.md"));
    expect(
      resolvePlanFile({ paseoHome: home, workspaceId, requestedPath: "./plans/auth/login" })
        .absolutePath,
    ).toBe(path.join(root, "auth", "login.md"));
  });

  test("accepts the absolute path it previously returned", () => {
    const absolutePath = path.join(root, "feature-name.md");
    expect(
      resolvePlanFile({ paseoHome: home, workspaceId, requestedPath: absolutePath }).absolutePath,
    ).toBe(absolutePath);
  });

  test("rejects paths that leave the Paseo plans directory", () => {
    expect(() =>
      resolvePlanFile({ paseoHome: home, workspaceId, requestedPath: "plans/../../secret" }),
    ).toThrow(PlanPathError);
    expect(() =>
      resolvePlanFile({
        paseoHome: home,
        workspaceId,
        requestedPath: path.resolve("/etc/passwd.md"),
      }),
    ).toThrow(PlanPathError);
    expect(() =>
      resolvePlanFile({ paseoHome: home, workspaceId: "../wks_abc", requestedPath: "feature.md" }),
    ).toThrow(PlanPathError);
    expect(() =>
      resolvePlanFile({ paseoHome: "  ", workspaceId, requestedPath: "feature.md" }),
    ).toThrow(PlanPathError);
  });
});
