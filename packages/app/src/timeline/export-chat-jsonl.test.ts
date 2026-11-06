import { describe, expect, it, vi } from "vitest";
import {
  CHAT_EXPORT_MIME_TYPE,
  chatExportFileName,
  exportAgentChat,
  formatChatJsonl,
  type ChatExportFile,
  type ChatExportTimelineEntry,
} from "@/timeline/export-chat-jsonl";

function entry(
  overrides: Partial<ChatExportTimelineEntry> & Pick<ChatExportTimelineEntry, "item" | "seqEnd">,
): ChatExportTimelineEntry {
  return {
    provider: "claude",
    timestamp: "2026-11-06T21:00:00.000Z",
    seqStart: overrides.seqEnd,
    sourceSeqRanges: [{ startSeq: overrides.seqEnd, endSeq: overrides.seqEnd }],
    collapsed: ["assistant_merge"],
    ...overrides,
  };
}

describe("formatChatJsonl", () => {
  it("writes one projected line per entry and drops projection fields", () => {
    const text = formatChatJsonl([
      entry({
        seqStart: 2,
        seqEnd: 4,
        sourceSeqRanges: [{ startSeq: 2, endSeq: 4 }],
        turnId: "turn-1",
        item: { type: "assistant_message", text: 'hello "world"' },
      }),
      entry({
        timestamp: "2026-11-06T21:01:00.000Z",
        seqEnd: 5,
        item: { type: "user_message", text: "next" },
      }),
    ]);

    expect(text.endsWith("\n")).toBe(true);
    const lines = text.slice(0, -1).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-11-06T21:00:00.000Z",
      provider: "claude",
      turnId: "turn-1",
      seq: 4,
      item: { type: "assistant_message", text: 'hello "world"' },
    });
    expect(JSON.parse(lines[1])).toEqual({
      timestamp: "2026-11-06T21:01:00.000Z",
      provider: "claude",
      seq: 5,
      item: { type: "user_message", text: "next" },
    });
    expect(lines[1]).not.toContain("turnId");
    expect(text).not.toContain("collapsed");
    expect(text).not.toContain("seqStart");
    expect(text).not.toContain("sourceSeqRanges");
  });

  it("writes an empty file for a chat with no entries", () => {
    expect(formatChatJsonl([])).toBe("");
  });
});

describe("chatExportFileName", () => {
  it("uses the title and replaces characters that cannot live in a file name", () => {
    expect(chatExportFileName("Tasks Autônomas", "agent-1")).toBe("Tasks Autônomas.jsonl");
    expect(chatExportFileName("a/b\\c:d", "agent-1")).toBe("a-b-c-d.jsonl");
    expect(chatExportFileName("a\nb", "agent-1")).toBe("ab.jsonl");
  });

  it("falls back to the agent id when the title is empty", () => {
    expect(chatExportFileName(null, "agent-123")).toBe("agent-123.jsonl");
    expect(chatExportFileName("   ", "agent-123")).toBe("agent-123.jsonl");
    expect(chatExportFileName("///", "agent-123")).toBe("agent-123.jsonl");
  });
});

describe("exportAgentChat", () => {
  it("saves the formatted timeline", async () => {
    const saveFile = vi.fn(async (_file: ChatExportFile) => {});
    const result = await exportAgentChat({
      title: "Notes",
      agentId: "agent-1",
      fetchTimeline: async () => ({
        entries: [entry({ seqEnd: 1, item: { type: "user_message", text: "hi" } })],
      }),
      saveFile,
    });

    expect(result).toEqual({ fileName: "Notes.jsonl" });
    expect(saveFile).toHaveBeenCalledTimes(1);
    const saved = saveFile.mock.calls[0]?.[0];
    if (!saved) {
      throw new Error("expected a saved file");
    }
    expect(saved.fileName).toBe("Notes.jsonl");
    expect(saved.mimeType).toBe(CHAT_EXPORT_MIME_TYPE);
    expect(new TextDecoder().decode(saved.bytes)).toBe(
      `${JSON.stringify({
        timestamp: "2026-11-06T21:00:00.000Z",
        provider: "claude",
        seq: 1,
        item: { type: "user_message", text: "hi" },
      })}\n`,
    );
  });

  it("does not save a file when the timeline fetch fails", async () => {
    const saveFile = vi.fn(async () => {});
    await expect(
      exportAgentChat({
        title: "Notes",
        agentId: "agent-1",
        fetchTimeline: async () => {
          throw new Error("offline");
        },
        saveFile,
      }),
    ).rejects.toThrow("offline");
    expect(saveFile).not.toHaveBeenCalled();
  });
});
