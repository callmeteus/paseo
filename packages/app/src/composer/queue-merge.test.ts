import { describe, expect, it } from "vitest";
import type { QueuedComposerMessage } from "./actions";
import { mergeQueuedMessages } from "./queue-merge";

function item(id: string): QueuedComposerMessage {
  return { id, text: id, attachments: [] };
}

describe("mergeQueuedMessages", () => {
  it("restores a persisted queue over an existing local queue", () => {
    const merged = mergeQueuedMessages([item("local")], [item("one"), item("two")]);
    expect(merged.map((entry) => entry.id)).toEqual(["one", "two", "local"]);
  });

  it("keeps a local item that has the same id only once", () => {
    const merged = mergeQueuedMessages([item("one"), item("local")], [item("one")]);
    expect(merged.map((entry) => entry.id)).toEqual(["one", "local"]);
  });

  it("is idempotent when the same event arrives twice", () => {
    const first = mergeQueuedMessages([item("local")], [item("one")]);
    const second = mergeQueuedMessages(first, [item("one")]);
    expect(second).toEqual(first);
  });

  it("does not drop local items when the daemon queue is empty", () => {
    expect(mergeQueuedMessages([item("local")], [])).toEqual([item("local")]);
  });
});
