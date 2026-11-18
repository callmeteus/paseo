import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** Marks the request block this module replaces on the next model call. */
export const CURSOR_RULES_START = "<cursor-rules>";
export const CURSOR_RULES_END = "</cursor-rules>";

const RULE_CHAR_CAP = 8_000;
const BLOCK_CHAR_CAP = 24_000;
const ALREADY_PRESENT_MIN = 80;
const MAX_RULE_FILES = 200;
const MAX_RULE_BYTES = 256 * 1024;
const MAX_DEPTH = 12;
const CACHE_MS = 2_000;

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".dev",
  "coverage",
  ".next",
  ".turbo",
  "target",
  "vendor",
]);

const FILE_TOOLS = new Set([
  "read",
  "read_file",
  "write",
  "write_file",
  "edit",
  "multiedit",
  "patch",
  "apply_patch",
]);
const SEARCH_TOOLS = new Set(["glob", "grep", "search"]);
const SHELL_TOOLS = new Set(["bash", "shell"]);
const FILE_PATH_KEYS = ["filePath", "file_path", "path", "target_file", "file"];
const DIRECTORY_PATH_KEYS = ["path", "cwd"];

const discoveryCache = new Map();

/**
 * Reads Cursor rules for the git root of a session directory.
 * Repeated calls within two seconds reuse the previous read.
 *
 * @param {string} sessionDirectory
 * @param {number} [now]
 * @returns {CursorRule[]}
 */
function loadCursorRules(sessionDirectory, now = Date.now()) {
  const root = gitRoot(sessionDirectory);
  const cached = discoveryCache.get(root);
  if (cached && now - cached.at < CACHE_MS) return cached.rules;
  const rules = readCursorRules(root);
  discoveryCache.set(root, { at: now, rules });
  return rules;
}

/**
 * Reads Cursor rules from a project root. Does not use the short cache.
 *
 * @param {string} root
 * @returns {CursorRule[]}
 */
function readCursorRules(root) {
  const rules = [];
  for (const file of discoverCursorRuleFiles(resolve(root))) {
    const rule = ruleFromFile(file);
    if (rule) rules.push(rule);
  }
  rules.sort(
    (left, right) => left.scope.length - right.scope.length || left.path.localeCompare(right.path),
  );
  return rules;
}

/**
 * Paths a tool call already put in the request. Relative paths stay relative.
 *
 * @param {unknown[]} messages
 * @returns {string[]}
 */
export function collectVisitedPaths(messages) {
  const paths = new Set();
  const seen = new Set();
  for (const message of messages) walkMessage(message, seen, paths);
  return [...paths];
}

/**
 * Rules that apply to this session directory and the paths already in the request.
 *
 * @param {{ rules: CursorRule[], sessionDirectory: string, visitedPaths: readonly string[] }} input
 * @returns {{ bodies: CursorRule[], index: CursorRule[] }}
 */
function selectCursorRules(input) {
  const sessionDirectory = resolve(input.sessionDirectory);
  const files = input.visitedPaths.map((candidate) =>
    isAbsolute(candidate) ? resolve(candidate) : resolve(sessionDirectory, candidate),
  );
  const bodies = [];
  const index = [];
  for (const rule of input.rules) {
    const inside = files.filter((file) => isInside(rule.scope, file));
    const sessionInside = isInside(rule.scope, sessionDirectory);
    if (rule.kind === "always") {
      if (sessionInside || inside.length > 0) bodies.push(rule);
      continue;
    }
    if (rule.kind === "globs") {
      const matched = inside.some((file) => matchesGlobs(rule.globs, rule.scope, file));
      if (matched) bodies.push(rule);
      continue;
    }
    if (sessionInside || inside.length > 0) index.push(rule);
  }
  return { bodies, index };
}

/**
 * Puts the current rule block on the request, replacing the previous one.
 *
 * @param {unknown[]} messages
 * @param {string} sessionDirectory
 * @param {number} [now]
 * @returns {void}
 */
export function applyCursorRules(messages, sessionDirectory, now = Date.now()) {
  const rules = loadCursorRules(sessionDirectory, now);
  const selected = selectCursorRules({
    rules,
    sessionDirectory,
    visitedPaths: collectVisitedPaths(messages),
  });
  const seen = messages
    .filter((message) => !isCursorRulesMessage(message))
    .map((message) => messageText(message))
    .join("\n");
  const block = renderCursorRules(selected, seen);
  upsertCursorRulesMessage(messages, block);
}

/**
 * Rule block for one Cursor ACP turn. `deliveredPaths` are rule files already
 * sent in this session; Cursor replays each prompt, so those bodies stay out.
 *
 * @param {string} sessionDirectory
 * @param {readonly string[]} [visitedPaths]
 * @param {Iterable<string>} [deliveredPaths]
 * @param {number} [now]
 * @returns {{ block: string | null, paths: string[] }}
 */
export function cursorRulesAddition(
  sessionDirectory,
  visitedPaths = [],
  deliveredPaths = [],
  now = Date.now(),
) {
  const delivered = new Set(deliveredPaths);
  const selected = selectCursorRules({
    rules: loadCursorRules(sessionDirectory, now),
    sessionDirectory,
    visitedPaths,
  });
  return renderCursorRuleContent(
    {
      bodies: selected.bodies.filter((rule) => !delivered.has(rule.path)),
      index: selected.index.filter((rule) => !delivered.has(rule.path)),
    },
    "",
  );
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
function isCursorRulesMessage(message) {
  return messageText(message).includes(CURSOR_RULES_START);
}

function ruleFromFile(file) {
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return null;
  }
  if (size > MAX_RULE_BYTES) return null;
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const parsed = parseCursorRule(raw, basename(file));
  if (!parsed) return null;
  return {
    path: file,
    scope: ruleScope(file),
    kind: parsed.kind,
    globs: parsed.globs,
    description: parsed.description,
    body: parsed.body,
  };
}

function parseCursorRule(raw, baseName) {
  const text = raw.replace(/^\uFEFF/, "");
  let meta = {};
  let body = text.trim();
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      meta = parseFrontmatter(text.slice(3, end).replace(/^\r?\n/, ""));
      body = text
        .slice(end + 4)
        .replace(/^\r?\n/, "")
        .trim();
    }
  }
  const globs = asList(meta.globs ?? meta.glob);
  const description = typeof meta.description === "string" ? meta.description.trim() : "";
  if (meta.alwaysApply === true) return { kind: "always", globs, description, body };
  if (globs.length > 0) return { kind: "globs", globs, description, body };
  if (description) return { kind: "index", globs, description, body };
  if (!body) return null;
  if (baseName === ".cursorrules" || Object.keys(meta).length === 0) {
    return { kind: "always", globs, description, body };
  }
  return null;
}

function parseFrontmatter(header) {
  const meta = {};
  let listKey = null;
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey && Array.isArray(meta[listKey])) {
      const value = unquote(item[1].trim());
      if (value) meta[listKey].push(value);
      continue;
    }
    const field = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const key = field[1];
    const raw = field[2].trim();
    if (!raw) {
      meta[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    if (raw.startsWith("[") && raw.endsWith("]")) {
      meta[key] = raw
        .slice(1, -1)
        .split(",")
        .map((entry) => unquote(entry.trim()))
        .filter((entry) => entry.length > 0);
      continue;
    }
    meta[key] = coerce(unquote(raw));
  }
  return meta;
}

function coerce(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function unquote(value) {
  const quoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return quoted ? value.slice(1, -1) : value;
}

function asList(value) {
  if (Array.isArray(value))
    return value.filter((entry) => typeof entry === "string" && entry.trim());
  if (typeof value !== "string" || !value.trim()) return [];
  if (value.includes(",")) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [value.trim()];
}

function ruleScope(file) {
  if (basename(file) === ".cursorrules") return dirname(file);
  const parts = dirname(file).split(sep);
  const cursor = parts.lastIndexOf(".cursor");
  if (cursor <= 0) return dirname(file);
  return parts.slice(0, cursor).join(sep) || sep;
}

function discoverCursorRuleFiles(root) {
  const found = [];
  walk(root, 0);
  return found;

  function walk(directory, depth) {
    if (depth > MAX_DEPTH || found.length >= MAX_RULE_FILES) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === ".cursor" && entry.isDirectory())) {
      collectRuleDirectory(join(directory, ".cursor", "rules"), found);
    }
    if (entries.some((entry) => entry.name === ".cursorrules" && entry.isFile())) {
      found.push(join(directory, ".cursorrules"));
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRECTORIES.has(entry.name) || entry.name === ".cursor") continue;
      walk(join(directory, entry.name), depth + 1);
    }
  }
}

function collectRuleDirectory(directory, found) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (found.length >= MAX_RULE_FILES) return;
    const file = join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      collectRuleDirectory(file, found);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdc"))) {
      found.push(file);
    }
  }
}

function gitRoot(start) {
  let current = resolve(start);
  const filesystemRoot = parse(current).root;
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    if (current === filesystemRoot) return resolve(start);
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function walkMessage(value, seen, paths) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (isCursorRulesMessage(value)) return;
  if (isToolCarrier(value)) collectToolPaths(value, paths);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) walkMessage(item, seen, paths);
      continue;
    }
    if (child && typeof child === "object") walkMessage(child, seen, paths);
  }
}

function isToolCarrier(value) {
  const name = toolName(value);
  if (!name) return false;
  const type = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (
    type === "tool" ||
    type === "tool-call" ||
    type === "tool_call" ||
    type === "tool-result" ||
    type === "tool_result"
  ) {
    return true;
  }
  return Boolean(value.input || value.args || value.state);
}

function toolName(value) {
  const name = value.toolName ?? value.tool ?? value.name;
  return typeof name === "string" && name.trim() ? name.trim().toLowerCase() : null;
}

function toolInput(value) {
  if (value.input && typeof value.input === "object") return value.input;
  if (value.args && typeof value.args === "object") return value.args;
  if (
    value.state &&
    typeof value.state === "object" &&
    value.state.input &&
    typeof value.state.input === "object"
  ) {
    return value.state.input;
  }
  return null;
}

function pathKeys(name) {
  if (FILE_TOOLS.has(name)) return FILE_PATH_KEYS;
  if (SEARCH_TOOLS.has(name) || SHELL_TOOLS.has(name)) return DIRECTORY_PATH_KEYS;
  return null;
}

function collectToolPaths(value, paths) {
  const name = toolName(value);
  const input = toolInput(value);
  if (!name || !input) return;
  const keys = pathKeys(name);
  if (!keys) return;
  for (const key of keys) {
    const candidate = input[key];
    if (typeof candidate === "string" && candidate.trim()) paths.add(candidate.trim());
  }
}

function isInside(scope, target) {
  const root = resolve(scope);
  const path = resolve(target);
  if (path === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return path.startsWith(prefix);
}

function matchesGlobs(globs, scope, file) {
  const relativePath = relative(scope, file).split(sep).join("/");
  if (!relativePath || relativePath.startsWith("..")) return false;
  return globs.some((pattern) =>
    expandBraces(pattern).some((expanded) => globMatch(expanded, relativePath)),
  );
}

function expandBraces(pattern) {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const options = match[1].split(",").map((option) => option.trim());
  return options.flatMap((option) =>
    expandBraces(
      pattern.slice(0, match.index) + option + pattern.slice(match.index + match[0].length),
    ),
  );
}

function globMatch(pattern, relativePath) {
  const normalized = pattern.replace(/\\/g, "/");
  if (matchGlob(normalized, relativePath)) return true;
  if (!normalized.includes("/")) return matchGlob(`**/${normalized}`, relativePath);
  return false;
}

function matchGlob(pattern, relativePath) {
  return new RegExp(`^${globSource(pattern)}$`).test(relativePath);
}

function globSource(pattern) {
  let source = "";
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (pattern.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }
    const character = pattern[index];
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    index += 1;
  }
  return source;
}

function renderCursorRules(selected, seen) {
  return renderCursorRuleContent(selected, seen).block;
}

function renderCursorRuleContent(selected, seen) {
  const sections = [];
  const paths = [];
  let used = 0;
  for (const rule of selected.bodies) {
    const section = ruleSection(rule, seen);
    if (!section) continue;
    if (used + section.length > BLOCK_CHAR_CAP) {
      const pointer = longRulePointer(rule);
      if (used + pointer.length > BLOCK_CHAR_CAP) break;
      sections.push(pointer);
      paths.push(rule.path);
      used += pointer.length;
      continue;
    }
    sections.push(section);
    paths.push(rule.path);
    used += section.length;
  }
  const indexRules = selected.index.filter((rule) => rule.description.trim().length > 0);
  if (indexRules.length > 0) {
    const indexLines = indexRules.map(
      (rule) => `- ${rule.path}: ${rule.description.replace(/\s+/g, " ").slice(0, 200)}`,
    );
    const index = `When a task matches a description, read that rule file before editing:\n${indexLines.join("\n")}`;
    if (used + index.length <= BLOCK_CHAR_CAP) {
      sections.push(index);
      for (const rule of indexRules) paths.push(rule.path);
    }
  }
  if (sections.length === 0) return { block: null, paths: [] };
  return {
    block: `${CURSOR_RULES_START}\nFollow these Cursor project rules.\n\n${sections.join("\n\n")}\n${CURSOR_RULES_END}`,
    paths,
  };
}

function ruleSection(rule, seen) {
  if (rule.body.length >= ALREADY_PRESENT_MIN && seen.includes(rule.body)) return "";
  if (rule.body.length > RULE_CHAR_CAP) return longRulePointer(rule);
  if (!rule.body) return "";
  return `Rule file: ${rule.path}\n${rule.body}`;
}

function longRulePointer(rule) {
  return `Rule file: ${rule.path}\nThis rule is long. Read the file before editing files in ${rule.scope}.`;
}

function upsertCursorRulesMessage(messages, block) {
  const index = messages.findIndex((message) => isCursorRulesMessage(message));
  if (!block) {
    if (index >= 0) messages.splice(index, 1);
    return;
  }
  const message = { role: "system", content: block, text: block };
  if (index >= 0) messages[index] = message;
  else messages.unshift(message);
}

function messageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n");
  }
  if (typeof message.summary === "string") return message.summary;
  return "";
}
