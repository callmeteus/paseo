import { describe, expect, it } from "vitest";
import {
  getMaestroScope,
  isMaestroChat,
  maestroChatLabels,
  maestroLedgerRelativePath,
} from "./maestro.js";

describe("maestro labels", () => {
  it("reads the mode and scope from chat labels", () => {
    const labels = maestroChatLabels("all");
    expect(isMaestroChat(labels)).toBe(true);
    expect(getMaestroScope(labels)).toBe("all");
    expect(isMaestroChat({})).toBe(false);
    expect(getMaestroScope({})).toBe("workspace");
  });

  it("keeps one ledger directory per chat", () => {
    expect(maestroLedgerRelativePath("agent-1")).toBe("maestro/chats/agent-1");
  });
});
