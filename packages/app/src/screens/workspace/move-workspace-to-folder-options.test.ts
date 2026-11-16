import { describe, expect, it } from "vitest";

import {
  buildDirectorySuggestionRows,
  workspaceRowMatchesQuery,
} from "./move-workspace-to-folder-options";

describe("move workspace to folder options", () => {
  it("filters open workspace rows by name and path", () => {
    const row = {
      directory: "/srv/paseo",
      name: "paseo",
      project: "Paseo",
      isCurrent: false,
    };
    expect(workspaceRowMatchesQuery(row, "paseo")).toBe(true);
    expect(workspaceRowMatchesQuery(row, "other")).toBe(false);
  });

  it("skips directories that are already open workspaces", () => {
    const suggestions = buildDirectorySuggestionRows({
      debouncedQuery: "/opt",
      serverPaths: ["/opt/tools", "/opt/tools"],
      recommendedPaths: ["/opt/apps"],
      openDirectories: ["/opt/tools"],
      currentDirectory: "/home/current",
    });
    expect(suggestions.map((row) => row.directory)).toContain("/opt/apps");
    expect(suggestions.some((row) => row.directory === "/opt/tools")).toBe(false);
  });
});
