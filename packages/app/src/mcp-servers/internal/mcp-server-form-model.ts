import type { McpServerConfig } from "@getpaseo/protocol/messages";
import type { McpServerPresetVariant, PresetField } from "./mcp-server-presets";

export interface KeyValueEntry {
  id: string;
  key: string;
  value: string;
}

let entrySequence = 0;

export function createKeyValueEntry(key = "", value = ""): KeyValueEntry {
  entrySequence += 1;
  return { id: `kv-${entrySequence}`, key, value };
}

export interface McpServerDraft {
  name: string;
  type: "stdio" | "http" | "sse";
  command: string;
  args: string[];
  env: KeyValueEntry[];
  cwd: string;
  url: string;
  headers: KeyValueEntry[];
  alwaysLoad: boolean;
  variables: Record<string, string>;
}

export type ValidationErrorCode =
  | "nameRequired"
  | "nameDuplicate"
  | "commandRequired"
  | "urlRequired"
  | "urlInvalid"
  | "keyRequired"
  | "fieldRequired";

export interface ValidationError {
  field: string;
  code: ValidationErrorCode;
}

export type DraftResult =
  | { ok: true; config: McpServerConfig }
  | { ok: false; errors: ValidationError[] };

export function emptyDraft(): McpServerDraft {
  return {
    name: "",
    type: "stdio",
    command: "",
    args: [],
    env: [],
    cwd: "",
    url: "",
    headers: [],
    alwaysLoad: false,
    variables: {},
  };
}

export function fromMcpServerConfig(config: McpServerConfig): McpServerDraft {
  if (config.type === "stdio") {
    return {
      ...emptyDraft(),
      name: "",
      type: "stdio",
      command: config.command,
      args: [...(config.args ?? [])],
      env: recordToEntries(config.env),
      cwd: config.cwd ?? "",
      alwaysLoad: config.alwaysLoad ?? false,
    };
  }
  return {
    ...emptyDraft(),
    name: "",
    type: config.type,
    url: config.url,
    headers: recordToEntries(config.headers),
    alwaysLoad: config.alwaysLoad ?? false,
  };
}

export function draftFromPresetVariant(
  presetName: string,
  variant: McpServerPresetVariant,
  fields: readonly PresetField[],
): McpServerDraft {
  const variables = Object.fromEntries(
    fields.map((field) => [field.key, field.defaultValue ?? ""]),
  );
  return {
    ...emptyDraft(),
    name: presetName,
    type: variant.transport,
    command: variant.command ?? "",
    args: [...(variant.args ?? [])],
    url: variant.url ?? "",
    variables,
  };
}

export function toMcpServerConfig(
  draft: McpServerDraft,
  fields: readonly PresetField[] = [],
  takenNames: readonly string[] = [],
): DraftResult {
  const errors = nameErrors(draft, takenNames);
  for (const field of fields) {
    if (field.required && !draft.variables[field.key]?.trim()) {
      errors.push({ field: field.key, code: "fieldRequired" });
    }
  }

  if (draft.type === "stdio") {
    const command = substitute(draft.command, draft.variables).trim();
    if (!command) errors.push({ field: "command", code: "commandRequired" });
    const env = entriesToRecord(draft.env);
    const presetEnv = presetRecord(fields, draft.variables, "env");
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      config: {
        type: "stdio",
        command,
        ...(draft.args.length > 0
          ? { args: draft.args.map((arg) => substitute(arg, draft.variables)) }
          : {}),
        ...(Object.keys({ ...presetEnv, ...env }).length > 0
          ? { env: { ...presetEnv, ...env } }
          : {}),
        ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
        ...(draft.alwaysLoad ? { alwaysLoad: true } : {}),
      },
    };
  }

  const url = substitute(draft.url, draft.variables).trim();
  if (!url) errors.push({ field: "url", code: "urlRequired" });
  else if (!/^https?:\/\//i.test(url)) errors.push({ field: "url", code: "urlInvalid" });
  const headers = entriesToRecord(draft.headers);
  const presetHeaders = presetRecord(fields, draft.variables, "header");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      type: draft.type,
      url,
      ...(Object.keys({ ...presetHeaders, ...headers }).length > 0
        ? { headers: { ...presetHeaders, ...headers } }
        : {}),
      ...(draft.alwaysLoad ? { alwaysLoad: true } : {}),
    },
  };
}

export function parseInstallCommand(input: string): { command: string; args: string[] } {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { command: "", args: [] };
  return { command: tokens[0]!, args: tokens.slice(1) };
}

export function parseArgs(input: string): string[] {
  return tokenize(input.trim());
}

export function formatInstallCommand(draft: McpServerDraft): string {
  return [draft.command, ...draft.args].filter(Boolean).join(" ");
}

function nameErrors(draft: McpServerDraft, takenNames: readonly string[]): ValidationError[] {
  const name = draft.name.trim();
  if (!name) return [{ field: "name", code: "nameRequired" }];
  if (takenNames.includes(name)) return [{ field: "name", code: "nameDuplicate" }];
  return [];
}

function substitute(value: string, variables: Record<string, string>): string {
  return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, key: string) => variables[key] ?? "");
}

function recordToEntries(record: Record<string, string> | undefined): KeyValueEntry[] {
  return record
    ? Object.entries(record).map(([key, value]) => createKeyValueEntry(key, value))
    : [];
}

function entriesToRecord(entries: readonly KeyValueEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries
      .map((entry) => [entry.key.trim(), entry.value] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function presetRecord(
  fields: readonly PresetField[],
  variables: Record<string, string>,
  target: "env" | "header",
): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.target === target)
      .map((field) => [field.key, variables[field.key] ?? ""] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}
