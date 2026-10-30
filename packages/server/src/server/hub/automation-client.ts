export interface HubAutomationAccess {
  origin: string;
  daemonId: string;
  credential: string;
}

export interface HubAutomationDocument {
  id: string;
  name: string;
  enabled: boolean;
  format: string;
  yaml: string;
}

export interface SavedHubAutomation {
  triggerId: string;
  name: string;
  revisionId: string;
  version: number;
  active: true;
}

/**
 * Lists the automations the connected daemon can see.
 *
 * @param access - Origin and daemon credential
 * @param request - HTTP client. Tests pass a fake
 * @returns The organization's trigger documents
 */
export async function listHubAutomations(
  access: HubAutomationAccess,
  request: typeof fetch = fetch,
): Promise<HubAutomationDocument[]> {
  const response = await request(hubUrl(access.origin, "/api/v1/triggers"), {
    headers: daemonHeaders(access),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new HubAutomationRequestError(response.status, problemMessage(body));
  }
  if (!isRecord(body) || !Array.isArray(body["triggers"])) {
    throw new HubAutomationRequestError(
      response.status,
      "Hub returned an unexpected trigger list.",
    );
  }
  return body["triggers"].map(readDocument);
}

/**
 * Creates or replaces one automation. The YAML name is the identity.
 *
 * @param access - Origin and daemon credential
 * @param yaml - Self-contained trigger document
 * @param request - HTTP client. Tests pass a fake
 * @returns The active revision Hub stored
 */
export async function saveHubAutomation(
  access: HubAutomationAccess,
  yaml: string,
  request: typeof fetch = fetch,
): Promise<SavedHubAutomation> {
  const response = await request(hubUrl(access.origin, "/api/v1/triggers/install"), {
    method: "POST",
    headers: {
      ...daemonHeaders(access),
      "content-type": "application/json",
    },
    body: JSON.stringify({ yaml }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new HubAutomationRequestError(response.status, problemMessage(body));
  }
  return readSaved(body);
}

/**
 * Hub refused or could not complete an automation request.
 */
export class HubAutomationRequestError extends Error {
  /**
   * @param status - HTTP status
   * @param message - Operator-facing detail from Hub, when it sent one
   */
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubAutomationRequestError";
  }
}

/**
 * @param origin - Hub origin without a path
 * @param path - Public API path
 * @returns Absolute URL
 */
function hubUrl(origin: string, path: string): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}${path}`;
}

/**
 * @param access - Daemon credential
 * @returns Headers Hub uses to recognize the daemon
 */
function daemonHeaders(access: HubAutomationAccess): Record<string, string> {
  return {
    authorization: `Bearer ${access.credential}`,
    "x-paseo-daemon-id": access.daemonId,
  };
}

/**
 * @param response - Hub response
 * @returns Parsed JSON, or an empty object when the body is not JSON
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * @param body - Hub error payload
 * @returns A short message
 */
function problemMessage(body: unknown): string {
  if (!isRecord(body)) {
    return "Hub could not complete that automation request.";
  }
  const detail = body["detail"];
  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }
  const title = body["title"];
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  return "Hub could not complete that automation request.";
}

/**
 * @param value - One trigger object from the list
 * @returns The document
 */
function readDocument(value: unknown): HubAutomationDocument {
  if (!isRecord(value)) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected trigger list.");
  }
  const id = value["id"];
  const name = value["name"];
  const enabled = value["enabled"];
  const format = value["format"];
  const yaml = value["yaml"];
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof enabled !== "boolean" ||
    typeof format !== "string" ||
    typeof yaml !== "string"
  ) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected trigger list.");
  }
  return { id, name, enabled, format, yaml };
}

/**
 * @param value - Install response body
 * @returns The saved revision
 */
function readSaved(value: unknown): SavedHubAutomation {
  if (!isRecord(value)) {
    throw new HubAutomationRequestError(201, "Hub returned an unexpected save result.");
  }
  const triggerId = value["triggerId"];
  const name = value["name"];
  const revisionId = value["revisionId"];
  const version = value["version"];
  const active = value["active"];
  if (
    typeof triggerId !== "string" ||
    typeof name !== "string" ||
    typeof revisionId !== "string" ||
    typeof version !== "number" ||
    active !== true
  ) {
    throw new HubAutomationRequestError(201, "Hub returned an unexpected save result.");
  }
  return { triggerId, name, revisionId, version, active };
}

/**
 * @param value - Unknown JSON
 * @returns Whether it is a JSON object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
