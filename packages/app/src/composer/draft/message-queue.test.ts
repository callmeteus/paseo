import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDraftQueueKey,
  createDraftQueueWriter,
  moveDraftQueueToAgent,
  restoreDraftQueueToComposer,
} from "./message-queue";
import { useDraftMessageQueueStore } from "./message-queue-store";
import { queueComposerMessage } from "@/composer/actions";
import { useSessionStore } from "@/stores/session-store";

const KEY = buildDraftQueueKey({ serverId: "server-1", draftId: "draft-1" });
const AGENT_ID = "draft-1";

function enqueue(text: string) {
  return queueComposerMessage({
    agentId: AGENT_ID,
    text,
    attachments: [],
    queue: createDraftQueueWriter({ key: KEY, agentId: AGENT_ID }),
  }).queued;
}

describe("draft message queue", () => {
  beforeEach(() => {
    useDraftMessageQueueStore.setState({ byKey: new Map() });
    useSessionStore.getState().clearSession("server-1");
    useSessionStore.getState().initializeSession("server-1", null);
  });

  it("queues sends made while the agent is being created, in order", () => {
    enqueue("first");
    enqueue("second");

    const items = useSessionStore.getState().sessions["server-1"]?.queuedMessages.get(AGENT_ID);
    expect(items).toBeUndefined();

    const moved = moveDraftQueueToAgent({
      key: KEY,
      serverId: "server-1",
      agentId: "agent-1",
    });
    expect(moved.map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("hands the queue to the created agent and keeps messages already there", () => {
    useSessionStore.getState().setQueuedMessages("server-1", (previous) => {
      const next = new Map(previous);
      next.set("agent-1", [{ id: "existing", text: "existing", attachments: [] }]);
      return next;
    });
    enqueue("queued during creation");

    moveDraftQueueToAgent({
      key: KEY,
      serverId: "server-1",
      agentId: "agent-1",
    });

    const items = useSessionStore.getState().sessions["server-1"]?.queuedMessages.get("agent-1");
    expect(items?.map((item) => item.text)).toEqual(["existing", "queued during creation"]);
  });

  it("drains the draft queue exactly once", () => {
    enqueue("only");

    expect(
      moveDraftQueueToAgent({ key: KEY, serverId: "server-1", agentId: "agent-1" }),
    ).toHaveLength(1);
    expect(
      moveDraftQueueToAgent({ key: KEY, serverId: "server-1", agentId: "agent-2" }),
    ).toHaveLength(0);
  });

  it("puts queued messages back in the composer when creation fails", () => {
    enqueue("while creating");

    const restored = restoreDraftQueueToComposer({
      key: KEY,
      currentText: "retry me",
      currentAttachments: [],
    });

    expect(restored?.text).toBe("retry me\n\nwhile creating");
    expect(restoreDraftQueueToComposer({ key: KEY, currentText: "", currentAttachments: [] })).toBe(
      null,
    );
  });
});
