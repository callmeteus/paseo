import { HubCommandError } from "./error.js";

export interface NormalizeHubOriginOptions {
  allowHttp?: boolean;
}

export function normalizeHubOrigin(value: string, options: NormalizeHubOriginOptions = {}): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidHubOrigin();
  }
  const remoteHttp = url.protocol === "http:" && !isLoopbackHostname(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (remoteHttp && options.allowHttp !== true) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw invalidHubOrigin();
  }
  return url.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function invalidHubOrigin(): HubCommandError {
  return new HubCommandError(
    "HUB_INVALID_ORIGIN",
    "Hub URL must be an HTTPS origin without credentials, path, query, or hash. HTTP is allowed for localhost, 127.0.0.1, and [::1]. Enable Allow HTTP in the host settings to use HTTP for other hosts.",
  );
}
