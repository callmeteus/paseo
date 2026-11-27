import { describe, expect, test } from "vitest";
import { formatPasteChipLabel, serializeInlineChip } from "@getpaseo/protocol/inline-chip";

import {
  applyGeneratedChatTitle,
  deriveInitialAgentTitle,
  isInstructionDerivedTitle,
  resolveCreateAgentTitles,
} from "./agent/create-agent-title.js";

describe("resolveCreateAgentTitles", () => {
  test("derives a provisional title from prompt when explicit title is absent", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: undefined,
      initialPrompt: "Implement auth retries with backoff\n\ninclude tests",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBe("Implement auth retries with backoff");
  });

  test("names a leading paste chip from its body, not the serialized atom", () => {
    const body = "Investigate the failed deployment on the staging host";
    const chip = serializeInlineChip({
      id: "paste:ff538e0-72ac",
      kind: "paste",
      label: formatPasteChipLabel({ body }),
      body,
    });

    expect(deriveInitialAgentTitle(chip)).toBe(body);
    expect(deriveInitialAgentTitle(`${chip}\n\nand fix it`)).toBe(body);
  });

  test("preserves explicit title and does not treat it as provisional", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "  Keep This Title  ",
      initialPrompt: "Ignored prompt title",
    });

    expect(resolved.explicitTitle).toBe("Keep This Title");
    expect(resolved.provisionalTitle).toBe("Keep This Title");
  });

  test("names the user's task, not the plan instructions or the goal boilerplate", () => {
    const planWrapped = [
      "<paseo-workflow>",
      "You are in Paseo Plan mode.",
      "Write the plan as markdown with the plan_create_update tool.",
      "</paseo-workflow>",
      "",
      "Fix the login redirect",
    ].join("\n");
    const goalWrapped = [
      "<paseo-goal>",
      "The user set a persistent goal for this session. It stays in effect across turns until it is achieved or cleared.",
      "",
      "Goal: make the test suite pass",
      "",
      "Start working toward this goal now.",
      "</paseo-goal>",
    ].join("\n");

    expect(deriveInitialAgentTitle(planWrapped)).toBe("Fix the login redirect");
    expect(deriveInitialAgentTitle(goalWrapped)).toBe("make the test suite pass");
    expect(deriveInitialAgentTitle("/goal make the test suite pass")).toBe(
      "make the test suite pass",
    );
    expect(isInstructionDerivedTitle("You are in Paseo Plan mode.")).toBe(true);
    expect(isInstructionDerivedTitle("Start working toward this goal now.")).toBe(true);
    expect(isInstructionDerivedTitle("Fix the login redirect")).toBe(false);
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

  test("applies a later title to an agent still carrying the workspace title", () => {
    // After a daemon restart the in-memory prompt/previous title maps are gone.
    // A second agent in the workspace was stamped with the workspace title when
    // it was created, so that stamp is the only thing tying it to the chat title.
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Pendrive multiboot Windows 10 e Debian",
      promptTitle: null,
      previousTitle: null,
      workspaceTitle: "Servers, Deploys e Peças",
      agentTitles: [{ id: "opencode", title: "Servers, Deploys e Peças" }],
      reportingAgentId: "opencode",
    });

    // The workspace keeps its own name, but the agent's tab takes the title
    // the provider generated for this chat.
    expect(applied.workspaceTitle).toBe("Servers, Deploys e Peças");
    expect(applied.agents).toEqual([
      { id: "opencode", title: "Pendrive multiboot Windows 10 e Debian" },
    ]);
  });

  test("only renames the reporting agent when several share the workspace title", () => {
    // `adoptWorkspaceTitleForAgent` stamps the workspace name onto every agent
    // created in it, so several tabs can carry it. One agent's title event must
    // not rename all of them.
    const applied = applyGeneratedChatTitle({
      generatedTitle: "Dados da viagem para a Feira",
      promptTitle: null,
      previousTitle: null,
      workspaceTitle: "Pesquisas Diárias",
      agentTitles: [
        { id: "reporter", title: "Pesquisas Diárias" },
        { id: "other", title: "Pesquisas Diárias" },
      ],
      reportingAgentId: "reporter",
    });

    expect(applied.agents).toEqual([
      { id: "reporter", title: "Dados da viagem para a Feira" },
      { id: "other", title: "Pesquisas Diárias" },
    ]);
  });
});
