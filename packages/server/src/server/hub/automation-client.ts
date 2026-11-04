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

export interface HubSlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface HubSlackChannelList {
  connection: string;
  channels: HubSlackChannel[];
  truncated: boolean;
}

export interface HubSlackMessage {
  ts: string;
  author: string | null;
  text: string;
  threadTs: string | null;
  isReply: boolean;
}

export interface HubSlackMessageList {
  connection: string;
  channel: { id: string; name: string };
  messages: HubSlackMessage[];
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
 * Lists Slack channels the connected Hub bot can see.
 *
 * @param access - Origin and daemon credential
 * @param input - Optional connection slug and channel-name query
 * @param request - HTTP client. Tests pass a fake
 * @returns Channel ids a trigger can store
 */
export async function listHubSlackChannels(
  access: HubAutomationAccess,
  input: { connection?: string | undefined; query?: string | undefined },
  request: typeof fetch = fetch,
): Promise<HubSlackChannelList> {
  const response = await request(
    hubUrlWithQuery(access.origin, "/api/v1/slack/channels", {
      connection: input.connection,
      query: input.query,
    }),
    { headers: daemonHeaders(access) },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new HubAutomationRequestError(response.status, problemMessage(body));
  }

  return readChannelList(body);
}

/**
 * Reads recent messages in a Slack channel the Hub bot belongs to.
 *
 * @param access - Origin and daemon credential
 * @param input - Channel name or id, optional connection, and page size
 * @param request - HTTP client. Tests pass a fake
 * @returns The resolved channel and the newest messages
 */
export async function readHubSlackMessages(
  access: HubAutomationAccess,
  input: {
    channel: string;
    connection?: string | undefined;
    limit?: number | undefined;
  },
  request: typeof fetch = fetch,
): Promise<HubSlackMessageList> {
  const response = await request(
    hubUrlWithQuery(access.origin, "/api/v1/slack/messages", {
      connection: input.connection,
      channel: input.channel,
      limit: input.limit,
    }),
    { headers: daemonHeaders(access) },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new HubAutomationRequestError(response.status, problemMessage(body));
  }

  return readMessageList(body);
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
 * @param origin - Hub origin without a path
 * @param path - Public API path
 * @param query - Query fields. Blank values are omitted
 * @returns Absolute URL
 */
function hubUrlWithQuery(
  origin: string,
  path: string,
  query: Record<string, string | number | undefined>,
): string {
  const url = new URL(hubUrl(origin, path));

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }

    const text = typeof value === "number" ? value.toString() : value;

    if (text.length === 0) {
      continue;
    }

    url.searchParams.set(key, text);
  }

  return url.href;
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
    return "Hub could not complete that request.";
  }
  const detail = body["detail"];
  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }
  const title = body["title"];
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  return "Hub could not complete that request.";
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

/**
 * @param body - Channel list payload
 * @returns The channels
 */
function readChannelList(body: unknown): HubSlackChannelList {
  if (
    !isRecord(body) ||
    typeof body["connection"] !== "string" ||
    !Array.isArray(body["channels"])
  ) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected channel list.");
  }

  if (typeof body["truncated"] !== "boolean") {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected channel list.");
  }

  return {
    connection: body["connection"],
    truncated: body["truncated"],
    channels: body["channels"].map(readChannel),
  };
}

/**
 * @param value - One channel object
 * @returns The channel
 */
function readChannel(value: unknown): HubSlackChannel {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["isPrivate"] !== "boolean"
  ) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected channel list.");
  }

  return {
    id: value["id"],
    name: value["name"],
    isPrivate: value["isPrivate"],
  };
}

/**
 * @param body - Message list payload
 * @returns The messages
 */
function readMessageList(body: unknown): HubSlackMessageList {
  if (!isRecord(body) || typeof body["connection"] !== "string" || !isRecord(body["channel"])) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  const channelId = body["channel"]["id"];
  const channelName = body["channel"]["name"];

  if (
    typeof channelId !== "string" ||
    typeof channelName !== "string" ||
    !Array.isArray(body["messages"])
  ) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  return {
    connection: body["connection"],
    channel: {
      id: channelId,
      name: channelName,
    },
    messages: body["messages"].map(readMessage),
  };
}

/**
 * @param value - One message object
 * @returns The message
 */
function readMessage(value: unknown): HubSlackMessage {
  if (!isRecord(value)) {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  const ts = value["ts"];
  const author = value["author"];
  const text = value["text"];
  const threadTs = value["threadTs"];
  const isReply = value["isReply"];

  if (typeof ts !== "string" || typeof text !== "string" || typeof isReply !== "boolean") {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  if (author !== null && typeof author !== "string") {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  if (threadTs !== null && typeof threadTs !== "string") {
    throw new HubAutomationRequestError(200, "Hub returned an unexpected message list.");
  }

  return {
    ts,
    author,
    text,
    threadTs,
    isReply,
  };
}
