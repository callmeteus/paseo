import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

import { CursorImportError } from "./types.js";

export type CursorSqliteValue = string | number | null;

interface CursorSqliteStatement {
  all(...params: CursorSqliteValue[]): unknown[];
  get(...params: CursorSqliteValue[]): unknown;
}

export interface CursorSqliteDatabase {
  prepare(sql: string): CursorSqliteStatement;
  close(): void;
}

interface CursorSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => CursorSqliteDatabase;
}

const sqliteModuleSchema = z.object({
  DatabaseSync: z.custom<CursorSqliteModule["DatabaseSync"]>(
    (value) => typeof value === "function",
  ),
});

/**
 * Node 20 must still compile. Only the Cursor importer needs `node:sqlite`, so
 * a missing builtin fails the import instead of the daemon process.
 */
export function loadCursorSqlite(): CursorSqliteModule {
  const parsed = sqliteModuleSchema.safeParse(process.getBuiltinModule?.("node:sqlite"));
  if (!parsed.success) {
    throw new CursorImportError(
      "cursor.sqlite_unavailable",
      "This Node runtime does not expose node:sqlite, so Cursor chats cannot be read",
    );
  }
  return parsed.data;
}

export interface CursorStateLocation {
  root?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

/**
 * Path to Cursor's global `state.vscdb`.
 *
 * `PASEO_CURSOR_STATE_DB` wins so a user can point at a backup or another
 * profile. Otherwise the platform's Cursor application-data directory is used.
 */
export function resolveCursorStateDbPath(location: CursorStateLocation = {}): string {
  const env = location.env ?? process.env;
  const configured = env.PASEO_CURSOR_STATE_DB?.trim();
  if (configured) {
    return resolve(configured);
  }

  const home = location.home ?? homedir();
  const platform = location.platform ?? process.platform;
  const root = location.root?.trim() ? resolve(location.root) : null;
  if (root) {
    return join(root, "User", "globalStorage", "state.vscdb");
  }

  if (platform === "win32") {
    const appData = env.APPDATA?.trim() || join(home, "AppData", "Roaming");
    return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  return join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

export function openCursorStateDb(path: string, sqlite = loadCursorSqlite()): CursorSqliteDatabase {
  if (!existsSync(path)) {
    throw new CursorImportError(
      "cursor.state_db_missing",
      `Cursor state database not found at ${path}`,
    );
  }
  try {
    return new sqlite.DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new CursorImportError(
      "cursor.state_db_unreadable",
      `Could not open Cursor state database at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function withCursorStateDb<T>(path: string, operation: (db: CursorSqliteDatabase) => T): T {
  const db = openCursorStateDb(path);
  try {
    return operation(db);
  } finally {
    db.close();
  }
}

export function readJsonColumn<T>(raw: unknown, parse: (value: unknown) => T | null): T | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
