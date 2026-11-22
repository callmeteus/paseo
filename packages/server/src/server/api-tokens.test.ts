import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiTokenStore, DuplicateApiTokenNameError } from "./api-tokens.js";
import { isAgentMcpRequestAuthorized, isBearerTokenValidAsync } from "./auth.js";
import { resolveSessionAdmission } from "./session-admission-auth.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "paseo-api-tokens-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("ApiTokenStore", () => {
  test("starts empty and persists a named token as a hash", async () => {
    const store = ApiTokenStore.load(home);
    expect(store.hasTokens()).toBe(false);

    const created = await store.create("MCPJungle");
    expect(created.secret).toMatch(/^paseo_at_[A-Za-z0-9_-]+$/);
    expect(created.token.name).toBe("MCPJungle");
    expect(store.list()).toEqual([created.token]);

    const file = await readFile(join(home, "api-tokens.json"), "utf8");
    expect(file).not.toContain(created.secret);
    expect(file).toContain('"name": "MCPJungle"');

    if (process.platform !== "win32") {
      expect((await stat(join(home, "api-tokens.json"))).mode & 0o777).toBe(0o600);
    }
  });

  test("verifies, revokes, and survives a reload", async () => {
    const store = ApiTokenStore.load(home);
    const { secret, token } = await store.create("relay");

    expect(await store.verify(secret)).toBe(true);
    expect(await store.verify("paseo_at_wrong")).toBe(false);
    expect(ApiTokenStore.load(home).list()).toEqual([token]);

    expect(store.revoke(token.id)).toBe(true);
    expect(store.revoke(token.id)).toBe(false);
    expect(await store.verify(secret)).toBe(false);
    expect(ApiTokenStore.load(home).hasTokens()).toBe(false);
  });

  test("rejects duplicate names case-insensitively", async () => {
    const store = ApiTokenStore.load(home);
    await store.create("ci");
    await expect(store.create("CI")).rejects.toBeInstanceOf(DuplicateApiTokenNameError);
  });
});

describe("named tokens as a password alternative", () => {
  test("a configured token authenticates HTTP and WebSocket callers", async () => {
    const store = ApiTokenStore.load(home);
    const { secret } = await store.create("automation");

    expect(
      await isBearerTokenValidAsync({
        password: undefined,
        token: secret,
        apiTokenVerifier: store,
      }),
    ).toBe(true);
    expect(
      await isBearerTokenValidAsync({
        password: undefined,
        token: "wrong",
        apiTokenVerifier: store,
      }),
    ).toBe(false);
    expect(
      await isAgentMcpRequestAuthorized({
        password: undefined,
        capabilityToken: null,
        authorizationHeader: `Bearer ${secret}`,
        apiTokenVerifier: store,
      }),
    ).toBe(true);

    const admission = await resolveSessionAdmission({
      credential: { kind: "password", password: secret },
      passwordHash: undefined,
      localCredential: null,
      apiTokenVerifier: store,
    });
    expect(admission).toEqual({
      admission: { principalId: "owner", permissions: expect.any(Array) },
    });
  });

  test("tokens do not reopen a daemon that has no credentials configured by other means", async () => {
    const store = ApiTokenStore.load(home);
    expect(await isBearerTokenValidAsync({ password: undefined, token: null })).toBe(true);

    await store.create("first");
    expect(
      await isBearerTokenValidAsync({ password: undefined, token: null, apiTokenVerifier: store }),
    ).toBe(false);
    expect(
      await resolveSessionAdmission({
        credential: undefined,
        passwordHash: undefined,
        localCredential: null,
        apiTokenVerifier: store,
      }),
    ).toEqual({ rejection: "password_required" });
  });
});
