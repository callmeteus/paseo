import { describe, expect, it } from "vitest";
import {
  finishPortingActivity,
  getPortingActivity,
  startPortingActivity,
} from "./porting-activity";

describe("porting activity store", () => {
  it("reports the destination provider while a port runs", () => {
    startPortingActivity("srv_a", "agent_1", { toProvider: "opencode" });

    expect(getPortingActivity("srv_a", "agent_1")).toEqual({ toProvider: "opencode" });
  });

  it("clears the marker when the port finishes or fails", () => {
    startPortingActivity("srv_a", "agent_1", { toProvider: "opencode" });

    finishPortingActivity("srv_a", "agent_1");

    expect(getPortingActivity("srv_a", "agent_1")).toBeNull();
  });

  it("keeps activity isolated per source agent", () => {
    startPortingActivity("srv_a", "agent_1", { toProvider: "opencode" });

    expect(getPortingActivity("srv_a", "agent_2")).toBeNull();
  });
});
