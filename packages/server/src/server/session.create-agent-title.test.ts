import { describe, expect, test } from "vitest";

import { applyGeneratedChatTitle, resolveCreateAgentTitles } from "./agent/create-agent-title.js";

describe("resolveCreateAgentTitles", () => {
  test("derives a provisional title from prompt when explicit title is absent", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: undefined,
      initialPrompt: "Implement auth retries with backoff\n\ninclude tests",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBe("Implement auth retries with backoff");
  });

  test("preserves explicit title and does not treat it as provisional", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "  Keep This Title  ",
      initialPrompt: "Ignored prompt title",
    });

    expect(resolved.explicitTitle).toBe("Keep This Title");
    expect(resolved.provisionalTitle).toBe("Keep This Title");
  });

  test("returns null values when prompt and title are empty", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "   ",
      initialPrompt: "   ",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBeNull();
  });
});

describe("applyGeneratedChatTitle", () => {
  const prompt = "Fix the login bug before the release";

  test("gives the workspace, the tab, and the OpenCode or Cloud agent the same generated title", () => {
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Repair the login",
      promptTitle: prompt,
      workspaceTitle: prompt,
      agentTitles: [
        { id: "opencode", title: prompt },
        { id: "cloud", title: prompt },
      ],
    });

    expect(applied.tabTitle).toBe(applied.workspaceTitle);
    expect(applied.workspaceTitle).toBe("Repair the login");
    expect(applied.agents).toEqual([
      { id: "opencode", title: "Repair the login" },
      { id: "cloud", title: "Repair the login" },
    ]);
    expect(applied.agents.every((agent) => agent.title !== prompt)).toBe(true);
  });

  test("updates the shared name when a later title arrives", () => {
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Shorter login fix",
      promptTitle: prompt,
      previousTitle: "Repair the login",
      workspaceTitle: "Repair the login",
      agentTitles: [{ id: "opencode", title: "Repair the login" }],
    });

    expect(applied.tabTitle).toBe("Shorter login fix");
    expect(applied.workspaceTitle).toBe(applied.tabTitle);
    expect(applied.agents).toEqual([{ id: "opencode", title: "Shorter login fix" }]);
  });

  test("keeps the current names when the model has not produced a title", () => {
    const applied = applyGeneratedChatTitle({
      generatedTitle: "   ",
      promptTitle: prompt,
      workspaceTitle: null,
      agentTitles: [{ id: "cloud", title: prompt }],
    });

    expect(applied.workspaceTitle).toBeNull();
    expect(applied.tabTitle).toBe(applied.workspaceTitle);
    expect(applied.agents).toEqual([{ id: "cloud", title: prompt }]);
    expect(applied.wroteGeneratedTitle).toBe(false);
  });

  test("keeps a manual workspace title and moves the provisional agent onto it", () => {
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Repair the login",
      promptTitle: prompt,
      workspaceTitle: "User rename",
      agentTitles: [{ id: "opencode", title: prompt }],
    });

    expect(applied.workspaceTitle).toBe("User rename");
    expect(applied.tabTitle).toBe(applied.workspaceTitle);
    expect(applied.agents).toEqual([{ id: "opencode", title: "User rename" }]);
    expect(applied.wroteGeneratedTitle).toBe(false);
  });

  test("leaves an agent the user already renamed", () => {
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Repair the login",
      promptTitle: prompt,
      workspaceTitle: prompt,
      agentTitles: [{ id: "opencode", title: "Custom session" }],
    });

    expect(applied.workspaceTitle).toBe("Repair the login");
    expect(applied.tabTitle).toBe(applied.workspaceTitle);
    expect(applied.agents).toEqual([{ id: "opencode", title: "Custom session" }]);
  });
});
