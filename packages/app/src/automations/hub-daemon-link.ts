/**
 * Connects the desktop daemon when the embedded Hub asks for `paseo hub login`.
 *
 * The command is a device-code login followed by an enrollment token. The guest
 * page already holds the Hub session, so it approves that login. The daemon
 * then enrolls with `hub.execute`, which is what lets automations run here.
 */

const LINK_INTERVAL_MS = 2_000;
const HANDOFF_ATTRIBUTE = "[data-paseo-daemon-handoff]";
const COMMAND_MARKER = "paseo hub login";
const EMBEDDED_MARKER = "Paseo is connecting this computer.";
const EXECUTE_PERMISSION = "hub.execute";

const LINK_SCRIPT = `
(async () => {
  const commandMarker = ${JSON.stringify(COMMAND_MARKER)};
  const embeddedMarker = ${JSON.stringify(EMBEDDED_MARKER)};
  const handoffAttribute = ${JSON.stringify(HANDOFF_ATTRIBUTE)};

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function linkState() {
    const current = globalThis.__paseoHubDaemonLink;
    if (isRecord(current) && typeof current.phase === "string") {
      return current;
    }
    const created = {
      phase: "idle",
      busy: false,
      inspectAttempts: 0,
      retryAt: 0,
      deviceCode: null,
      userCode: null,
      token: null,
    };
    globalThis.__paseoHubDaemonLink = created;
    return created;
  }

  function handoffWaiting() {
    const page = globalThis.document;
    if (!page || typeof page.querySelector !== "function") {
      return false;
    }
    const marked = page.querySelector(handoffAttribute);
    if (marked && typeof marked.getAttribute === "function") {
      return marked.getAttribute("data-paseo-daemon-handoff") === "waiting";
    }
    const body = page.body;
    const text = body && typeof body.innerText === "string" ? body.innerText : "";
    return text.includes(commandMarker) || text.includes(embeddedMarker);
  }

  function factoryExportName(specifiers, handlerName) {
    const parts = specifiers.split(",");
    for (let index = 0; index < parts.length; index += 1) {
      const alias = parts[index].trim().match(/^(\\w+) as (\\w+)$/);
      if (alias && alias[2] === handlerName) {
        return alias[1];
      }
      if (parts[index].trim() === handlerName) {
        return handlerName;
      }
    }
    return null;
  }

  function parseCliLoginModule(source) {
    const handlerMatch = source.match(/\\.handler\\((\\w+)\\(\\s*"/);
    if (!handlerMatch) {
      return null;
    }
    const handlerName = handlerMatch[1];
    const imports = [...source.matchAll(/import\\{([^}]+)\\}from"(\\.\\/index-[^"]+\\.js)"/g)];
    let factoryExport = null;
    let indexSpecifier = null;
    for (let index = 0; index < imports.length; index += 1) {
      const imported = imports[index];
      const exportName = factoryExportName(imported[1], handlerName);
      if (exportName) {
        factoryExport = exportName;
        indexSpecifier = imported[2];
        break;
      }
    }
    if (!factoryExport || !indexSpecifier) {
      return null;
    }
    const ids = [...source.matchAll(/\\.handler\\(\\w+\\(\\s*"([a-f0-9]{64})"\\s*\\)/g)].map((match) => match[1]);
    if (ids.length !== 2 || ids[0] === ids[1]) {
      return null;
    }
    return { factoryExport, indexSpecifier, ids };
  }

  function payloadOf(value) {
    if (!isRecord(value)) {
      return null;
    }
    if (value.status === "ok" && isRecord(value.data)) {
      return value.data;
    }
    if (isRecord(value.organization)) {
      return value;
    }
    return null;
  }

  function organizationFromInspect(value) {
    const record = payloadOf(value);
    if (!record || !isRecord(record.organization) || typeof record.organization.id !== "string") {
      return null;
    }
    if (record.organization.id.length === 0) {
      return null;
    }
    return {
      id: record.organization.id,
      canManage: record.canManage === true,
    };
  }

  function decisionAccepted(value) {
    if (!isRecord(value)) {
      return false;
    }
    if (value.status === "ok") {
      return true;
    }
    return isRecord(value.data) && value.data.status === "ok";
  }

  async function jsonFetch(url, options) {
    const headers = { accept: "application/json" };
    if (typeof options.body === "string") {
      headers["content-type"] = "application/json";
    }
    if (typeof options.authorization === "string") {
      headers.authorization = "Bearer " + options.authorization;
    }
    const response = await globalThis.fetch(url, {
      method: options.method,
      credentials: "include",
      headers,
      body: options.body,
    });
    const text = await response.text();
    let body = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  async function approve(userCode) {
    const htmlResponse = await globalThis.fetch("/cli-login", { credentials: "include" });
    const html = await htmlResponse.text();
    const chunkMatch = html.match(/\\/assets\\/cli-login-[^"]+\\.js/);
    if (!chunkMatch) {
      return "retry";
    }
    const chunkUrl = new URL(chunkMatch[0], globalThis.location.origin).href;
    const sourceResponse = await globalThis.fetch(chunkUrl, { credentials: "include" });
    const source = await sourceResponse.text();
    const parsed = parseCliLoginModule(source);
    if (!parsed) {
      return "retry";
    }
    const indexUrl = new URL(parsed.indexSpecifier, chunkUrl).href;
    const loadModule = globalThis.__paseoLoadModule
      ? globalThis.__paseoLoadModule
      : (href) => import(href);
    const loaded = await loadModule(indexUrl);
    const factory = loaded[parsed.factoryExport];
    if (typeof factory !== "function") {
      return "retry";
    }
    let organizationId = null;
    let canManage = false;
    let decideId = null;
    for (let index = 0; index < parsed.ids.length; index += 1) {
      const id = parsed.ids[index];
      let result = null;
      try {
        result = await factory(id)({ method: "POST", data: { userCode } });
      } catch {
        result = null;
      }
      const organization = organizationFromInspect(result);
      if (organization) {
        organizationId = organization.id;
        canManage = organization.canManage;
        decideId = parsed.ids.find((other) => other !== id) ?? null;
        break;
      }
    }
    if (!organizationId || !decideId) {
      return "retry";
    }
    if (!canManage) {
      return "blocked";
    }
    try {
      const decision = await factory(decideId)({
        method: "POST",
        data: {
          userCode,
          decision: "approve",
          organizationId,
        },
      });
      return decisionAccepted(decision) ? "approved" : "retry";
    } catch {
      return "retry";
    }
  }

  const state = linkState();
  if (state.phase === "blocked") {
    return { phase: "blocked" };
  }
  if (state.phase === "ready" && typeof state.token === "string" && state.token.length > 0) {
    return { phase: "ready", token: state.token };
  }
  async function signedIntoOrganization() {
    // The connect page is enough. A reload skips that page and opens the dashboard,
    // so a session that already has an organization is the other signal.
    if (handoffWaiting()) {
      return true;
    }
    const session = await jsonFetch("/api/auth/get-session", { method: "GET" });
    if (session.status !== 200 || !isRecord(session.body) || !isRecord(session.body.session)) {
      return false;
    }
    const organizationId = session.body.session.activeOrganizationId;
    return typeof organizationId === "string" && organizationId.length > 0;
  }

  if (state.busy) {
    return { phase: "pending" };
  }
  state.busy = true;
  try {
    const ready = await signedIntoOrganization();
    if (!ready) {
      return { phase: "pending" };
    }
    if (state.phase === "idle") {
      if (typeof state.retryAt === "number" && Date.now() < state.retryAt) {
        return { phase: "pending" };
      }
      const started = await jsonFetch("/api/v1/cli-authorizations", {
        method: "POST",
        body: "{}",
      });
      if (started.status === 429) {
        state.retryAt = Date.now() + 15000;
        return { phase: "pending" };
      }
      if (
        started.status !== 201 ||
        !isRecord(started.body) ||
        typeof started.body.deviceCode !== "string" ||
        typeof started.body.userCode !== "string"
      ) {
        return { phase: "pending" };
      }
      state.deviceCode = started.body.deviceCode;
      state.userCode = started.body.userCode;
      state.phase = "started";
      state.inspectAttempts = 0;
    }
    if (state.phase !== "started" || typeof state.userCode !== "string" || typeof state.deviceCode !== "string") {
      return { phase: "pending" };
    }
    const approved = await approve(state.userCode);
    if (approved === "blocked") {
      state.phase = "blocked";
      return { phase: "blocked" };
    }
    if (approved !== "approved") {
      state.inspectAttempts = (typeof state.inspectAttempts === "number" ? state.inspectAttempts : 0) + 1;
      if (state.inspectAttempts > 15) {
        state.phase = "idle";
        state.deviceCode = null;
        state.userCode = null;
        state.inspectAttempts = 0;
      }
      return { phase: "pending" };
    }
    const polled = await jsonFetch("/api/v1/cli-authorizations/poll", {
      method: "POST",
      body: JSON.stringify({ deviceCode: state.deviceCode }),
    });
    if (
      !isRecord(polled.body) ||
      polled.body.status !== "authorized" ||
      typeof polled.body.credential !== "string"
    ) {
      return { phase: "pending" };
    }
    const issued = await jsonFetch("/api/v1/daemons/enrollment-tokens", {
      method: "POST",
      body: "{}",
      authorization: polled.body.credential,
    });
    if (
      issued.status !== 201 ||
      !isRecord(issued.body) ||
      typeof issued.body.token !== "string" ||
      issued.body.token.length === 0
    ) {
      return { phase: "pending" };
    }
    state.phase = "ready";
    state.token = issued.body.token;
    return { phase: "ready", token: state.token };
  } catch {
    return { phase: "pending" };
  } finally {
    state.busy = false;
  }
})()
`;

const RESET_SCRIPT = `
(() => {
  globalThis.__paseoHubDaemonLink = {
    phase: "idle",
    busy: false,
    inspectAttempts: 0,
    retryAt: 0,
    deviceCode: null,
    userCode: null,
    token: null,
  };
  return true;
})()
`;

export namespace HubDaemonLink {
  /**
   * How often the guest page is asked to finish the daemon handoff.
   *
   * @returns Interval in milliseconds.
   */
  export function intervalMs(): number {
    return LINK_INTERVAL_MS;
  }

  /**
   * Page script that approves the Hub device login and returns an enrollment token.
   *
   * @returns Script for the Hub guest. It returns `{ phase, token? }`.
   */
  export function script(): string {
    return LINK_SCRIPT;
  }

  /**
   * Clears a failed handoff so the next tick starts a new device login.
   *
   * @returns Script for the Hub guest.
   */
  export function resetScript(): string {
    return RESET_SCRIPT;
  }

  /**
   * Reads the guest result without accepting a token from any other phase.
   *
   * @param value - Value returned by {@link script}.
   * @returns `ready` when an enrollment token is present.
   */
  export function readPhase(value: unknown): "ready" | "blocked" | "pending" {
    if (!isRecord(value)) {
      return "pending";
    }
    if (value.phase === "blocked") {
      return "blocked";
    }
    if (readEnrollmentToken(value) !== null) {
      return "ready";
    }
    return "pending";
  }

  /**
   * Reads the one-time enrollment token from a ready guest result.
   *
   * @param value - Value returned by {@link script}.
   * @returns The token, or null when the page is still waiting.
   */
  export function readEnrollmentToken(value: unknown): string | null {
    if (!isRecord(value) || value.phase !== "ready" || typeof value.token !== "string") {
      return null;
    }
    if (value.token.length === 0) {
      return null;
    }
    return value.token;
  }

  /**
   * Enrolls this computer's daemon with the local Hub.
   *
   * `hub.execute` is included because automations on this computer run through it.
   * A daemon that is already connected to the same origin is left as it is.
   *
   * @param client - Daemon that owns the local Hub process.
   * @param origin - Hub origin shown in the app.
   * @param token - One-time enrollment token from the Hub session.
   * @returns Nothing.
   */
  export async function connect(
    client: LocalHubDaemonClient,
    origin: string,
    token: string,
  ): Promise<void> {
    if (!isHttpOrigin(origin)) {
      throw new Error("Hub origin is not an http(s) address.");
    }
    if (token.trim().length === 0) {
      throw new Error("Hub enrollment token is empty.");
    }
    let status: HubDaemonStatus | null = null;
    try {
      status = (await client.getHubStatus()).status;
    } catch {
      status = null;
    }
    if (status !== null && isAlreadyLinked(status, origin)) {
      return;
    }
    const connected = await client.connectHub(origin, token, [EXECUTE_PERMISSION]);
    if (!isAlreadyLinked(connected.status, origin)) {
      throw new Error("Hub did not accept this computer.");
    }
  }
}

interface LocalHubDaemonClient {
  getHubStatus(): Promise<{ status: HubDaemonStatus }>;
  connectHub(
    origin: string,
    token: string,
    permissions: readonly string[],
  ): Promise<{ status: HubDaemonStatus }>;
}

interface HubDaemonStatus {
  state: string;
  hubOrigin: string | null;
}

/**
 * Narrows an unknown guest result to a plain object.
 *
 * @param value - Guest result or a status payload.
 * @returns Whether the value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accepts only http and https origins for the daemon enrollment call.
 *
 * @param origin - Candidate Hub origin.
 * @returns Whether the daemon may connect there.
 */
function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A connecting daemon is already on its way. Issuing another token would enroll a second one.
 *
 * @param status - Current daemon relationship.
 * @param origin - Hub origin shown in the app.
 * @returns Whether this computer is already linked to that Hub.
 */
function isAlreadyLinked(status: HubDaemonStatus, origin: string): boolean {
  if (status.hubOrigin === null || !sameOrigin(status.hubOrigin, origin)) {
    return false;
  }
  return (
    status.state === "connected" || status.state === "connecting" || status.state === "reconnecting"
  );
}

/**
 * Compares Hub origins without their paths.
 *
 * @param left - First origin or URL.
 * @param right - Second origin or URL.
 * @returns Whether both name the same origin.
 */
function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
