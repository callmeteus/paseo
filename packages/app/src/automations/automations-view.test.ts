import { describe, expect, it } from "vitest";
import {
  automationsHubUrl,
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

  it("opens the local Hub when it is running on this computer", () => {
    expect(resolveAutomationsView([host({ relationship: "not_connected" })])).toEqual({
      kind: "webview",
      origin: "http://127.0.0.1:3000",
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
    ).toEqual({ kind: "connect" });
  });

  it("offers install when Hub is not installed", () => {
    expect(
      resolveAutomationsView([
        host({ localInstalled: false, localRunning: false, localOrigin: null }),
      ]),
    ).toEqual({
      kind: "install",
      serverId: "local",
      label: "This computer",
      installed: false,
    });
  });

  it("offers start when Hub is installed and stopped", () => {
    expect(resolveAutomationsView([host({ localRunning: false, localOrigin: null })])).toEqual({
      kind: "install",
      serverId: "local",
      label: "This computer",
      installed: true,
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
