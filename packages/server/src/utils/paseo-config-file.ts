import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PaseoConfigRawSchema,
  type PaseoConfigRaw,
  type PaseoConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";
export {
  PaseoConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type PaseoConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";

export const PASEO_CONFIG_FILE_NAME = "paseo.json";

export type ReadPaseoConfigForEditResult =
  | { ok: true; config: PaseoConfigRaw | null; revision: PaseoConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WritePaseoConfigForEditResult =
  | { ok: true; config: PaseoConfigRaw; revision: PaseoConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WritePaseoConfigForEditInput {
  repoRoot: string;
  config: PaseoConfigRaw;
  expectedRevision: PaseoConfigRevision | null;
}

export function resolvePaseoConfigPath(repoRoot: string): string {
  return join(repoRoot, PASEO_CONFIG_FILE_NAME);
}

export function statPaseoConfigPath(repoRoot: string): PaseoConfigRevision | null {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readPaseoConfigJson(repoRoot: string): unknown {
  const configPath = resolvePaseoConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

const projectChatInstructionsCache = new Map<string, { revision: string; instructions: string }>();

/**
 * Reads `chat.instructions` for a project. Cached by config revision so agent
 * creation does not re-parse paseo.json on every new chat.
 */
export function readProjectChatInstructions(repoRoot: string): string {
  const configPath = resolvePaseoConfigPath(repoRoot);
  const revision = statPaseoConfigPath(repoRoot);
  const cacheKey = revision ? `${revision.mtimeMs}:${revision.size}` : "missing";
  const cached = projectChatInstructionsCache.get(configPath);
  if (cached?.revision === cacheKey) {
    return cached.instructions;
  }

  const result = readPaseoConfigForEdit(repoRoot);
  const instructions =
    result.ok && typeof result.config?.chat?.instructions === "string"
      ? result.config.chat.instructions.trim()
      : "";
  projectChatInstructionsCache.set(configPath, { revision: cacheKey, instructions });
  return instructions;
}

export function readPaseoConfigForEdit(repoRoot: string): ReadPaseoConfigForEditResult {
  try {
    const json = readPaseoConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: PaseoConfigRawSchema.parse(json),
      revision: statPaseoConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writePaseoConfigForEdit(
  input: WritePaseoConfigForEditInput,
): WritePaseoConfigForEditResult {
  const parsed = PaseoConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolvePaseoConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${PASEO_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statPaseoConfigPath(input.repoRoot);
    if (!paseoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempPaseoConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statPaseoConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempPaseoConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function paseoConfigRevisionsEqual(
  left: PaseoConfigRevision | null,
  right: PaseoConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempPaseoConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
