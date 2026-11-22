import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { type ApiTokenVerifier, DAEMON_PASSWORD_BCRYPT_COST } from "./auth.js";
import { writePrivateFileAtomicSync } from "./private-files.js";

const FILE_NAME = "api-tokens.json";
const TOKEN_PREFIX = "paseo_at_";
const TOKEN_BYTES = 32;
const HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export const ApiTokenNameSchema = z.string().trim().min(1).max(80);

export const ApiTokenSummarySchema = z.object({
  id: z.string(),
  name: ApiTokenNameSchema,
  createdAt: z.string(),
});

export type ApiTokenSummary = z.infer<typeof ApiTokenSummarySchema>;

const StoredApiTokenSchema = z.object({
  id: z.string().min(1),
  name: ApiTokenNameSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  hash: z.string().regex(HASH_PATTERN),
  createdAt: z.string(),
});

const StoredApiTokenFileSchema = z.object({
  version: z.literal(1),
  tokens: z.array(StoredApiTokenSchema),
});

type StoredApiToken = z.infer<typeof StoredApiTokenSchema>;

function fingerprintOf(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function fingerprintMatches(expected: string, candidate: string): boolean {
  const actual = Buffer.from(candidate);
  const reference = Buffer.from(expected);
  return actual.length === reference.length && timingSafeEqual(actual, reference);
}

export class DuplicateApiTokenNameError extends Error {
  constructor(name: string) {
    super(`An API token named "${name}" already exists.`);
    this.name = "DuplicateApiTokenNameError";
  }
}

export class ApiTokenStore implements ApiTokenVerifier {
  private readonly filePath: string;
  private tokens: StoredApiToken[];

  private constructor(filePath: string, tokens: StoredApiToken[]) {
    this.filePath = filePath;
    this.tokens = tokens;
  }

  static load(paseoHome: string): ApiTokenStore {
    const filePath = join(paseoHome, FILE_NAME);
    try {
      const parsed = StoredApiTokenFileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      return new ApiTokenStore(filePath, parsed.tokens);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return new ApiTokenStore(filePath, []);
      throw new Error(
        `Failed to load API tokens from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  hasTokens(): boolean {
    return this.tokens.length > 0;
  }

  list(): ApiTokenSummary[] {
    return this.tokens
      .map((token) => ({ id: token.id, name: token.name, createdAt: token.createdAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(nameInput: string): Promise<{ token: ApiTokenSummary; secret: string }> {
    const name = ApiTokenNameSchema.parse(nameInput);
    if (this.tokens.some((token) => token.name.toLowerCase() === name.toLowerCase())) {
      throw new DuplicateApiTokenNameError(name);
    }
    const secret = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
    const record: StoredApiToken = {
      id: randomUUID(),
      name,
      fingerprint: fingerprintOf(secret),
      hash: await hash(secret, DAEMON_PASSWORD_BCRYPT_COST),
      createdAt: new Date().toISOString(),
    };
    this.tokens = [...this.tokens, record];
    this.persist();
    return { token: this.toSummary(record), secret };
  }

  revoke(id: string): boolean {
    const remaining = this.tokens.filter((token) => token.id !== id);
    if (remaining.length === this.tokens.length) return false;
    this.tokens = remaining;
    this.persist();
    return true;
  }

  async verify(secret: string): Promise<boolean> {
    if (!secret.startsWith(TOKEN_PREFIX)) return false;
    const fingerprint = fingerprintOf(secret);
    // The fingerprint selects at most one bcrypt comparison, so verification
    // cost does not grow with the number of tokens on the daemon.
    for (const token of this.tokens) {
      if (
        fingerprintMatches(token.fingerprint, fingerprint) &&
        (await compare(secret, token.hash))
      ) {
        return true;
      }
    }
    return false;
  }

  private toSummary(token: StoredApiToken): ApiTokenSummary {
    return { id: token.id, name: token.name, createdAt: token.createdAt };
  }

  private persist(): void {
    writePrivateFileAtomicSync(
      this.filePath,
      `${JSON.stringify({ version: 1, tokens: this.tokens }, null, 2)}\n`,
    );
  }
}
