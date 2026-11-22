import { compare, hashSync } from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { matchesLocalCredential } from "./local-credential.js";

export const DAEMON_PASSWORD_BCRYPT_COST = 12;

export interface ApiTokenVerifier {
  hasTokens(): boolean;
  verify(secret: string): Promise<boolean>;
}

export interface DaemonAuthConfig {
  password?: string;
  localCredential?: () => string | null;
  apiTokens?: ApiTokenVerifier;
}

export interface BearerAuthRejectContext {
  path: string;
  method: string;
  hasToken: boolean;
}

interface BearerValidationInput {
  password: string | undefined;
  token: string | null;
  apiTokenVerifier?: ApiTokenVerifier;
}

export async function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean> {
  if (!input.password && !input.apiTokenVerifier?.hasTokens()) {
    return true;
  }
  if (input.token === null) {
    return false;
  }
  if (input.apiTokenVerifier && (await input.apiTokenVerifier.verify(input.token))) {
    return true;
  }

  return input.password ? compare(input.token, input.password) : false;
}

export function hashDaemonPassword(password: string): string {
  return hashSync(password, DAEMON_PASSWORD_BCRYPT_COST);
}

export function extractHttpBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  if (scheme !== "Bearer" || tokenParts.length !== 1) {
    return null;
  }
  return tokenParts[0] ?? null;
}

export function extractWsBearerProtocol(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  for (const protocol of value.split(",")) {
    const trimmed = protocol.trim();
    const segments = trimmed.split(".");
    if (segments[0] === "paseo" && segments[1] === "bearer" && segments.length >= 3) {
      return trimmed;
    }
  }

  return null;
}

export function extractWsBearerToken(protocol: string | null): string | null {
  if (!protocol) {
    return null;
  }
  const segments = protocol.split(".");
  if (segments[0] !== "paseo" || segments[1] !== "bearer" || segments.length < 3) {
    return null;
  }
  return segments.slice(2).join(".");
}

export function createRequireBearerMiddleware(
  auth: DaemonAuthConfig | undefined,
  onReject?: (context: BearerAuthRejectContext) => void,
): RequestHandler {
  const password = auth?.password;
  const apiTokenVerifier = auth?.apiTokens;
  return (req, res, next) => {
    if (
      (!password && !apiTokenVerifier?.hasTokens()) ||
      shouldBypassBearerAuth(req.method, req.path)
    ) {
      next();
      return;
    }

    void (async () => {
      try {
        const token = extractHttpBearerToken(req.header("authorization"));
        const localCredential = req.path === "/api/status" ? auth?.localCredential?.() : null;
        const isLocal =
          localCredential !== null &&
          localCredential !== undefined &&
          token !== null &&
          matchesLocalCredential(localCredential, token);
        if (!isLocal && !(await isBearerTokenValidAsync({ password, token, apiTokenVerifier }))) {
          onReject?.({
            path: req.path,
            method: req.method,
            hasToken: token !== null,
          });
          res.status(401).json({ error: "Unauthorized" });
          return;
        }

        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

const SELF_AUTHENTICATING_ROUTES = new Set(["/api/files/download", "/mcp/agents"]);

function isBearerFreeRoute(path: string): boolean {
  return path === "/api/health" || SELF_AUTHENTICATING_ROUTES.has(path);
}

export function shouldBypassBearerAuth(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  return isBearerFreeRoute(path);
}

/**
 * Authorizes a request to the Agent MCP endpoint (/mcp/agents), which is exempt
 * from the global daemon-password middleware. Accepts either the per-daemon-run
 * capability token the daemon injects into its own agents' configs and MCP
 * client, a named API token, or a valid daemon-password bearer (so existing
 * password-authenticated callers keep working). The endpoint is open only when
 * neither a password nor named tokens are configured.
 */
export async function isAgentMcpRequestAuthorized(input: {
  password: string | undefined;
  capabilityToken: string | null;
  authorizationHeader: string | undefined;
  apiTokenVerifier?: ApiTokenVerifier;
}): Promise<boolean> {
  if (!input.password && !input.apiTokenVerifier?.hasTokens()) {
    return true;
  }
  const token = extractHttpBearerToken(input.authorizationHeader);
  if (input.capabilityToken !== null && token !== null) {
    // Constant-time compare; length-guard first because timingSafeEqual throws
    // on differing buffer lengths.
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.capabilityToken);
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return isBearerTokenValidAsync({
    password: input.password,
    token,
    apiTokenVerifier: input.apiTokenVerifier,
  });
}
