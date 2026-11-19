import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import {
  applyCursorRules,
  collectVisitedPaths,
  cursorRulesAddition,
  CURSOR_RULES_START,
} from "./cursor-rules.mjs";

const roots = new Set<string>();

afterAll(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "paseo-cursor-rules-"));
  roots.add(root);
  await writeFile(join(root, ".git"), "gitdir: /unused\n");
  return root;
}

async function writeRule(file: string, body: string): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, body);
}

describe("OpenCode cursor rules", () => {
  test("the injected rules message uses text parts so OpenCode can map its content", async () => {
    const root = await project();
    await writeRule(
      join(root, ".cursor", "rules", "root.mdc"),
      "---\nalwaysApply: true\n---\nTEXT_PARTS\n",
    );

    const messages: unknown[] = [];
    applyCursorRules(messages, root);

    expect(messages).toHaveLength(1);
    const injected = messages[0] as { role: string; content: unknown; text: string };
    expect(injected.role).toBe("system");
    expect(injected.content).toEqual([{ type: "text", text: injected.text }]);
  });

  test("includes root always-on rules and leaves a nested rule until a tool path enters it", async () => {
    const root = await project();
    await writeRule(
      join(root, ".cursor", "rules", "root.mdc"),
      "---\nalwaysApply: true\n---\nROOT_ALWAYS\n",
    );
    await writeRule(
      join(root, ".cursor", "rules", "typed.mdc"),
      "---\nglobs: **/*.ts\n---\nROOT_TS\n",
    );
    await writeRule(
      join(root, ".cursor", "rules", "ask.mdc"),
      "---\ndescription: Ask before deleting\n---\nASK_BODY\n",
    );
    await writeRule(
      join(root, ".cursor", "rules", "manual.mdc"),
      "---\nalwaysApply: false\n---\nMANUAL_BODY\n",
    );
    await writeRule(join(root, ".cursorrules"), "LEGACY\n");
    await writeRule(
      join(root, "packages", "server", ".cursor", "rules", "server.mdc"),
      "---\nalwaysApply: true\n---\nSERVER_ALWAYS\n",
    );
    await writeRule(
      join(root, "packages", "server", ".cursor", "rules", "tests.mdc"),
      "---\nglobs: *.test.ts\n---\nSERVER_TEST\n",
    );
    await writeRule(
      join(root, "packages", "web", ".cursor", "rules", "web.mdc"),
      "---\nalwaysApply: true\n---\nWEB_ALWAYS\n",
    );

    const opened = [{ role: "user", content: "fix the bug" }];
    applyCursorRules(opened, root);
    const openedText = JSON.stringify(opened);
    expect(openedText).toContain("ROOT_ALWAYS");
    expect(openedText).toContain("LEGACY");
    expect(openedText).toContain("Ask before deleting");
    expect(openedText).not.toContain("ASK_BODY");
    expect(openedText).not.toContain("ROOT_TS");
    expect(openedText).not.toContain("MANUAL_BODY");
    expect(openedText).not.toContain("SERVER_ALWAYS");
    expect(openedText).not.toContain("SERVER_TEST");
    expect(openedText).not.toContain("WEB_ALWAYS");

    const visiting = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolName: "read",
            input: { filePath: "packages/server/src/a.test.ts" },
          },
          {
            type: "tool-call",
            toolName: "bash",
            input: { command: "ls packages/web", cwd: "packages/web" },
          },
        ],
      },
    ];
    applyCursorRules(visiting, root);
    const visitingText = JSON.stringify(visiting);
    expect(visitingText).toContain("SERVER_ALWAYS");
    expect(visitingText).toContain("SERVER_TEST");
    expect(visitingText).toContain("ROOT_TS");
    expect(visitingText).toContain("WEB_ALWAYS");
    expect(visitingText).not.toContain("MANUAL_BODY");
    expect(
      visiting.filter((message) => JSON.stringify(message).includes(CURSOR_RULES_START)),
    ).toHaveLength(1);
  });

  test("a session opened inside a package includes that package's always-on rule", async () => {
    const root = await project();
    await writeRule(
      join(root, "packages", "server", ".cursor", "rules", "server.mdc"),
      "---\nalwaysApply: true\n---\nSERVER_ALWAYS\n",
    );
    await writeRule(
      join(root, "packages", "web", ".cursor", "rules", "web.mdc"),
      "---\nalwaysApply: true\n---\nWEB_ALWAYS\n",
    );
    const messages = [{ role: "user", content: "look here" }];
    applyCursorRules(messages, join(root, "packages", "server"));
    const text = JSON.stringify(messages);
    expect(text).toContain("SERVER_ALWAYS");
    expect(text).not.toContain("WEB_ALWAYS");
  });

  test("replaces the previous rule block and skips a body the request already contains", async () => {
    const root = await project();
    const body = "REPEAT_ME_".repeat(12);
    await writeRule(
      join(root, ".cursor", "rules", "root.mdc"),
      `---\nalwaysApply: true\n---\n${body}\n`,
    );
    const messages = [{ role: "user", content: `please follow ${body}` }];
    applyCursorRules(messages, root);
    expect(JSON.stringify(messages)).not.toContain("Rule file:");
    await writeRule(
      join(root, ".cursor", "rules", "other.mdc"),
      "---\nalwaysApply: true\n---\nOTHER_RULE\n",
    );
    applyCursorRules(messages, root, Date.now() + 5_000);
    const blocks = messages.filter((message) =>
      JSON.stringify(message).includes(CURSOR_RULES_START),
    );
    expect(blocks).toHaveLength(1);
    expect(JSON.stringify(blocks[0])).toContain("OTHER_RULE");
    expect(JSON.stringify(blocks[0])).not.toContain(body);
  });

  test("points at a long rule instead of pasting it", async () => {
    const root = await project();
    const body = `LONG_${"x".repeat(9_000)}`;
    await writeRule(
      join(root, ".cursor", "rules", "long.mdc"),
      `---\nalwaysApply: true\n---\n${body}\n`,
    );
    const messages = [{ role: "user", content: "go" }];
    applyCursorRules(messages, root);
    const text = JSON.stringify(messages);
    expect(text).toContain("long.mdc");
    expect(text).toContain("This rule is long");
    expect(text).not.toContain(body);
  });

  test("reads an OpenCode tool part and a shell working directory", () => {
    expect(
      collectVisitedPaths([
        {
          type: "assistant",
          parts: [{ type: "tool", name: "edit", state: { input: { path: "src/b.ts" } } }],
        },
        { type: "tool-call", toolName: "grep", input: { path: "packages/server" } },
      ]),
    ).toEqual(["src/b.ts", "packages/server"]);
  });

  test("ignores a manual rule and a rule above the git root", async () => {
    const parent = await project();
    await writeRule(
      join(parent, ".cursor", "rules", "parent.mdc"),
      "---\nalwaysApply: true\n---\nPARENT\n",
    );
    const root = join(parent, "checkout");
    await mkdir(root);
    await writeFile(join(root, ".git"), "gitdir: /unused\n");
    await writeRule(
      join(root, ".cursor", "rules", "kept.mdc"),
      "---\nalwaysApply: true\n---\nKEPT\n",
    );
    await writeRule(
      join(root, ".cursor", "rules", "manual.mdc"),
      "---\nalwaysApply: false\n---\nMANUAL_BODY\n",
    );
    const messages = [{ role: "user", content: "go" }];
    applyCursorRules(messages, root);
    const text = JSON.stringify(messages);
    expect(text).toContain("KEPT");
    expect(text).not.toContain("PARENT");
    expect(text).not.toContain("MANUAL_BODY");
  });

  test("returns only rule files that have not been sent yet", async () => {
    const root = await project();
    await writeRule(
      join(root, ".cursor", "rules", "root.mdc"),
      "---\nalwaysApply: true\n---\nROOT_ALWAYS\n",
    );
    await writeRule(
      join(root, "packages", "server", ".cursor", "rules", "server.mdc"),
      "---\nalwaysApply: true\n---\nSERVER_ALWAYS\n",
    );
    const first = cursorRulesAddition(root, []);
    expect(first.block).toContain("ROOT_ALWAYS");
    expect(first.block).not.toContain("SERVER_ALWAYS");
    const second = cursorRulesAddition(root, [], first.paths);
    expect(second.block).toBeNull();
    const nested = cursorRulesAddition(
      root,
      [join(root, "packages", "server", "src", "a.ts")],
      first.paths,
    );
    expect(nested.block).toContain("SERVER_ALWAYS");
    expect(nested.block).not.toContain("ROOT_ALWAYS");
  });
});
