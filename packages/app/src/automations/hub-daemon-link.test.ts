import { afterEach, describe, expect, it } from "vitest";
import { HubDaemonLink } from "./hub-daemon-link";

const INSPECT_ID = "42a22c13c83299b1bf3b9c43f5fb6c3f2fcbeeb748f885bdeb51ca0153a55fc5";
const DECIDE_ID = "39ce72f53fb42b241c26f3bba5c21a268b7de47fa99149037137e3155b5e26d4";

function cliLoginSource(firstId: string, secondId: string): string {
  return [
    'import{C,z as w,a7 as c}from"./index-Dr-fxqQm.js";',
    `const q=C({method:"POST"}).handler(w("${firstId}")),`,
    `T=C({method:"POST"}).handler(w("${secondId}"));`,
  ].join("");
}

interface RecordedCall {
  path: string;
  authorization: string | null;
  body: string | null;
}

interface GuestOptions {
  text: string;
  marker: string | null;
  canManage: boolean;
  inspectFirst: boolean;
  enrollmentStatus: number;
  sessionOrganizationId: string | null;
}

function guest(options: Partial<GuestOptions> = {}) {
  const settings: GuestOptions = {
    text: "paseo hub login http://127.0.0.1:3000",
    marker: null,
    canManage: true,
    inspectFirst: true,
    enrollmentStatus: 201,
    sessionOrganizationId: null,
    ...options,
  };
  const calls: RecordedCall[] = [];
  const serverCalls: { id: string; method: string | undefined; data: Record<string, unknown> }[] =
    [];
  const firstId = settings.inspectFirst ? INSPECT_ID : DECIDE_ID;
  const secondId = settings.inspectFirst ? DECIDE_ID : INSPECT_ID;
  const source = cliLoginSource(firstId, secondId);

  globalThis.location = { origin: "http://127.0.0.1:3000" } as Location;
  globalThis.document = {
    body: { innerText: settings.text },
    querySelector(selector: string) {
      if (selector !== "[data-paseo-daemon-handoff]" || settings.marker === null) {
        return null;
      }
      return {
        getAttribute(name: string) {
          return name === "data-paseo-daemon-handoff" ? settings.marker : null;
        },
      };
    },
  } as unknown as Document;
  globalThis.__paseoLoadModule = async () => ({
    z: (id: string) => async (input: { method?: string; data: Record<string, unknown> }) => {
      serverCalls.push({ id, method: input.method, data: input.data });
      if (id === INSPECT_ID && typeof input.data.decision !== "string") {
        return {
          status: "ok",
          data: {
            organization: { id: "org-1", name: "Org", slug: "org" },
            canManage: settings.canManage,
          },
        };
      }
      if (id === DECIDE_ID && input.data.decision === "approve") {
        return { status: "ok", data: { decision: "approved" } };
      }
      return { status: "error", error: { message: "no" } };
    },
  });
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://127.0.0.1:3000").pathname;
    const headers = new Headers(init?.headers);
    calls.push({
      path,
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (path === "/api/auth/get-session") {
      if (settings.sessionOrganizationId === null) {
        return json(200, { session: null, user: null });
      }
      return json(200, {
        session: { activeOrganizationId: settings.sessionOrganizationId },
        user: { id: "user-1" },
      });
    }
    if (path === "/api/v1/cli-authorizations") {
      return json(201, { deviceCode: "device-1", userCode: "ABCD-EFGH" });
    }
    if (path === "/cli-login") {
      return text(200, '<link rel="modulepreload" href="/assets/cli-login-6eD_BTJ5.js"/>');
    }
    if (path === "/assets/cli-login-6eD_BTJ5.js") {
      return text(200, source);
    }
    if (path === "/api/v1/cli-authorizations/poll") {
      return json(200, { status: "authorized", credential: "paseo_cli_secret" });
    }
    if (path === "/api/v1/daemons/enrollment-tokens") {
      return json(settings.enrollmentStatus, { token: "enroll-once" });
    }
    return json(404, {});
  };

  return { calls, serverCalls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function text(status: number, body: string): Response {
  return new Response(body, { status });
}

async function runGuest(): Promise<unknown> {
  const run = new Function(`return (${HubDaemonLink.script()});`);
  return run();
}

afterEach(() => {
  delete globalThis.__paseoHubDaemonLink;
  delete globalThis.__paseoLoadModule;
});

describe("HubDaemonLink", () => {
  it("approves the device login and returns an enrollment token", async () => {
    const page = guest();

    const first = await runGuest();
    const second = await runGuest();

    expect(HubDaemonLink.readEnrollmentToken(first)).toBe("enroll-once");
    expect(HubDaemonLink.readPhase(first)).toBe("ready");
    expect(HubDaemonLink.readEnrollmentToken(second)).toBe("enroll-once");
    expect(page.calls.filter((call) => call.path === "/api/v1/cli-authorizations")).toHaveLength(1);
    expect(page.serverCalls.map((call) => call.id)).toEqual([INSPECT_ID, DECIDE_ID]);
    expect(page.serverCalls.map((call) => call.method)).toEqual(["POST", "POST"]);
    expect(page.serverCalls[1]?.data).toEqual({
      userCode: "ABCD-EFGH",
      decision: "approve",
      organizationId: "org-1",
    });
    const enrollment = page.calls.find((call) => call.path === "/api/v1/daemons/enrollment-tokens");
    expect(enrollment?.authorization).toBe("Bearer paseo_cli_secret");
  });

  it("still approves when the built client lists the decision function first", async () => {
    guest({ inspectFirst: false });

    const result = await runGuest();

    expect(HubDaemonLink.readEnrollmentToken(result)).toBe("enroll-once");
  });

  it("uses the embedded handoff marker when the command is not on the page", async () => {
    guest({
      text: "Sign in",
      marker: "waiting",
    });

    const result = await runGuest();

    expect(HubDaemonLink.readEnrollmentToken(result)).toBe("enroll-once");
  });

  it("does nothing until the account has an organization", async () => {
    const page = guest({ text: "Sign in" });

    const result = await runGuest();

    expect(HubDaemonLink.readPhase(result)).toBe("pending");
    expect(page.calls.map((call) => call.path)).toEqual(["/api/auth/get-session"]);
  });

  it("connects from the dashboard when this Hub session already has an organization", async () => {
    guest({
      text: "Home",
      sessionOrganizationId: "org-1",
    });

    const result = await runGuest();

    expect(HubDaemonLink.readEnrollmentToken(result)).toBe("enroll-once");
  });

  it("stops when the signed-in account cannot manage the organization", async () => {
    const page = guest({ canManage: false });

    const first = await runGuest();
    const started = page.calls.length;
    const second = await runGuest();

    expect(HubDaemonLink.readPhase(first)).toBe("blocked");
    expect(HubDaemonLink.readEnrollmentToken(first)).toBeNull();
    expect(page.calls.filter((call) => call.path === "/api/v1/cli-authorizations/poll")).toEqual(
      [],
    );
    expect(page.calls).toHaveLength(started);
    expect(HubDaemonLink.readPhase(second)).toBe("blocked");
  });

  it("does not treat a failed enrollment as a token", async () => {
    guest({ enrollmentStatus: 401 });

    const result = await runGuest();

    expect(HubDaemonLink.readEnrollmentToken(result)).toBeNull();
    expect(HubDaemonLink.readPhase(result)).toBe("pending");
  });

  it("ignores a ready phase that forgot the token", () => {
    expect(HubDaemonLink.readEnrollmentToken({ phase: "ready", token: "" })).toBeNull();
    expect(
      HubDaemonLink.readEnrollmentToken({ phase: "pending", token: "enroll-once" }),
    ).toBeNull();
    expect(HubDaemonLink.readPhase(null)).toBe("pending");
  });

  it("connects this computer with permission to run automations", async () => {
    const calls: unknown[][] = [];
    await HubDaemonLink.connect(
      {
        async getHubStatus() {
          return { status: { state: "not_connected", hubOrigin: null } };
        },
        async connectHub(...args) {
          calls.push(args);
          return { status: { state: "connected", hubOrigin: "http://127.0.0.1:3000" } };
        },
      },
      "http://127.0.0.1:3000",
      "enroll-once",
    );

    expect(calls).toEqual([["http://127.0.0.1:3000", "enroll-once", ["hub.execute"]]]);
  });

  it("does not enroll again when this computer is already connected", async () => {
    let connected = false;
    await HubDaemonLink.connect(
      {
        async getHubStatus() {
          return { status: { state: "connected", hubOrigin: "http://127.0.0.1:3000/triggers" } };
        },
        async connectHub() {
          connected = true;
          return { status: { state: "connected", hubOrigin: "http://127.0.0.1:3000" } };
        },
      },
      "http://127.0.0.1:3000",
      "enroll-once",
    );

    expect(connected).toBe(false);
  });

  it("rejects an empty token and a non-http origin", async () => {
    const client = {
      async getHubStatus() {
        return { status: { state: "not_connected", hubOrigin: null } };
      },
      async connectHub() {
        return { status: { state: "connected", hubOrigin: "http://127.0.0.1:3000" } };
      },
    };

    await expect(HubDaemonLink.connect(client, "http://127.0.0.1:3000", "  ")).rejects.toThrow(
      /token/u,
    );
    await expect(HubDaemonLink.connect(client, "file:///tmp/hub", "enroll-once")).rejects.toThrow(
      /origin/u,
    );
  });
});

declare global {
  var __paseoHubDaemonLink: unknown;
  var __paseoLoadModule: ((href: string) => Promise<Record<string, unknown>>) | undefined;
}
