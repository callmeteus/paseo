import { describe, expect, it } from "vitest";
import {
  automationsHubUrl,
  hubOriginOnPageHost,
  resolveAutomationsView,
  type AutomationsHostSnapshot,
} from "./automations-view";

function host(overrides: Partial<AutomationsHostSnapshot> = {}): AutomationsHostSnapshot {
  return {
    serverId: "local",
    label: "This computer",
    online: true,
    relationship: "not_connected",
    hubOrigin: null,
    localInstalled: true,
    localRunning: true,
    localOrigin: "http://127.0.0.1:3000",
    ...overrides,
  };
}

describe("resolveAutomationsView", () => {
  it("opens the connected Hub", () => {
    expect(
      resolveAutomationsView([
        host({ relationship: "connected", hubOrigin: "https://hub.example.com" }),
      ]),
    ).toEqual({ kind: "webview", origin: "https://hub.example.com" });
  });

  it("asks for a choice when two Hubs are connected", () => {
    const view = resolveAutomationsView([
      host({ relationship: "connected", hubOrigin: "https://one.example.com" }),
      host({
        serverId: "other",
        label: "Other",
        relationship: "connected",
        hubOrigin: "https://two.example.com",
      }),
    ]);
    expect(view.kind).toBe("choose");
  });

  it("asks to connect an existing Hub or install one the first time", () => {
    expect(resolveAutomationsView([host({ relationship: "not_connected" })])).toEqual({
      kind: "setup",
      serverId: "local",
      label: "This computer",
      canInstall: true,
      installed: true,
      localOrigin: "http://127.0.0.1:3000",
    });
  });

  it("asks to connect when this computer cannot report a local Hub", () => {
    expect(
      resolveAutomationsView([
        host({
          relationship: "not_connected",
          localInstalled: null,
          localRunning: false,
          localOrigin: null,
        }),
      ]),
    ).toEqual({
      kind: "setup",
      serverId: "local",
      label: "This computer",
      canInstall: false,
      installed: false,
      localOrigin: null,
    });
  });

  it("offers install from the first-time choice when Hub is not installed", () => {
    expect(
      resolveAutomationsView([
        host({ localInstalled: false, localRunning: false, localOrigin: null }),
      ]),
    ).toEqual({
      kind: "setup",
      serverId: "local",
      label: "This computer",
      canInstall: true,
      installed: false,
      localOrigin: null,
    });
  });

  it("keeps a stopped local Hub on the first-time choice", () => {
    expect(resolveAutomationsView([host({ localRunning: false, localOrigin: null })])).toEqual({
      kind: "setup",
      serverId: "local",
      label: "This computer",
      canInstall: true,
      installed: true,
      localOrigin: null,
    });
  });

  it("waits while a status request is still pending", () => {
    expect(resolveAutomationsView([host({ relationship: "pending" })])).toEqual({
      kind: "loading",
    });
  });

  it("says the daemon is offline when nothing is online", () => {
    expect(resolveAutomationsView([host({ online: false, relationship: "unavailable" })])).toEqual({
      kind: "offline",
    });
  });
});

describe("automationsHubUrl", () => {
  it("opens the triggers page", () => {
    expect(automationsHubUrl("https://hub.example.com")).toBe("https://hub.example.com/triggers");
    expect(automationsHubUrl("https://hub.example.com/")).toBe("https://hub.example.com/triggers");
  });
});

describe("hubOriginOnPageHost", () => {
  it("opens a loopback Hub on the host that served the page", () => {
    expect(hubOriginOnPageHost("http://127.0.0.1:25000", "100.89.201.14")).toBe(
      "http://100.89.201.14:25000",
    );
    expect(hubOriginOnPageHost("http://localhost:25000", "predator.tailnet.ts.net")).toBe(
      "http://predator.tailnet.ts.net:25000",
    );
  });

  it("keeps loopback when the page itself is local", () => {
    expect(hubOriginOnPageHost("http://127.0.0.1:25000", "127.0.0.1")).toBe(
      "http://127.0.0.1:25000",
    );
    expect(hubOriginOnPageHost("http://127.0.0.1:25000", "localhost")).toBe(
      "http://127.0.0.1:25000",
    );
  });

  it("leaves a Hub that is already on another host alone", () => {
    expect(hubOriginOnPageHost("https://hub.example.com", "100.89.201.14")).toBe(
      "https://hub.example.com",
    );
  });
});
