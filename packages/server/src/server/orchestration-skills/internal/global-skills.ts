import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentGlobalSkill } from "@getpaseo/protocol/messages";
import { cursorUserSkillRoots } from "../../agent/providers/cursor-skill-catalog.js";

type SkillSource = AgentGlobalSkill["sources"][number];

interface SourceRoot {
  source: SkillSource;
  path: string;
}

export async function listGlobalSkills(
  home: string,
  managedNames: ReadonlySet<string>,
): Promise<AgentGlobalSkill[]> {
  const roots = resolveGlobalSkillRoots(home);
  const byName = new Map<string, AgentGlobalSkill>();

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(root.path, entry.name);
      const skillFile = join(skillPath, "SKILL.md");
      let text: string;
      try {
        text = await readFile(skillFile, "utf8");
      } catch {
        continue;
      }
      const frontmatter = parseFrontmatter(text);
      const name = frontmatter.name?.trim() || entry.name;
      const description = frontmatter.description?.trim() || null;
      const existing = byName.get(name);
      if (existing) {
        if (!existing.sources.includes(root.source)) existing.sources.push(root.source);
        if (!existing.paths.includes(skillPath)) existing.paths.push(skillPath);
        if (!existing.description && description) existing.description = description;
        continue;
      }
      byName.set(name, {
        name,
        sources: [root.source],
        paths: [skillPath],
        description,
        managed: managedNames.has(name),
      });
    }
  }

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveGlobalSkillRoots(home: string): SourceRoot[] {
  const roots: SourceRoot[] = cursorUserSkillRoots(home, true).map((path) => ({
    source: sourceForPath(home, path),
    path,
  }));
  const extras: SourceRoot[] = [
    { source: "opencode", path: join(home, ".config", "opencode", "skills") },
    { source: "pi", path: join(home, ".pi", "agent", "skills") },
  ];
  return [...roots, ...extras];
}

function sourceForPath(home: string, path: string): SkillSource {
  const relative = path
    .slice(home.length)
    .replace(/^[/\\]+/, "")
    .split(/[/\\]/);
  const configDir = relative[0];
  switch (configDir) {
    case ".agents":
      return "agents";
    case ".claude":
      return "claude";
    case ".codex":
      return "codex";
    case ".grok":
      return "grok";
    case ".cursor":
      return "cursor";
    default:
      return "unknown";
  }
}

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const block = text.slice(3, end);
  const result: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2]!.trim().replace(/^['"]|['"]$/g, "");
    result[match[1]!] = value;
  }
  return result;
}
