import { z } from "zod";

export interface ValidatedStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

async function clearInvalidValue(storage: ValidatedStorage, key: string): Promise<void> {
  try {
    await storage.removeItem(key);
  } catch {
    // Invalid persisted data must never cross the boundary, even when cleanup fails.
  }
}

interface SchemaReader {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaShape(schema: unknown): Record<string, SchemaReader> | null {
  if (schema instanceof z.ZodObject) return schema.shape;
  if (schema instanceof z.ZodCatch) return schemaShape(schema.def.innerType);
  return null;
}

function salvageField(schema: SchemaReader, value: unknown): unknown | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const shape = schemaShape(schema);
  if (!shape || !isRecord(value)) return undefined;
  const reparsed = schema.safeParse(salvageFields(shape, value));
  return reparsed.success ? reparsed.data : undefined;
}

function salvageFields(
  shape: Record<string, SchemaReader>,
  decoded: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (!Object.hasOwn(decoded, key)) continue;
    const field = salvageField(fieldSchema, decoded[key]);
    if (field !== undefined) fields[key] = field;
  }
  return fields;
}

/**
 * Keep every field the current schema still understands. A schema from another build can reject
 * a field it does not know; dropping only that field preserves the rest of the user's data.
 */
export function salvageObject<Value>(schema: z.ZodType<Value>, decoded: unknown): Value | null {
  const shape = schemaShape(schema);
  if (!shape || !isRecord(decoded)) return null;
  const result = schema.safeParse(salvageFields(shape, decoded));
  return result.success ? result.data : null;
}

export async function readValidatedString<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  await clearInvalidValue(storage, key);
  return null;
}

export async function readValidatedJson<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    await clearInvalidValue(storage, key);
    return null;
  }
  const result = schema.safeParse(decoded);
  if (result.success) return result.data;
  return salvageObject(schema, decoded);
}
