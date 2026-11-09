import { describe, expect, test } from "vitest";

import type { AttachmentMetadata } from "@/attachments/types";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { buildRewindComposerAttachments, mergeRewindAttachments } from "./rewind-attachments";

const image: AttachmentMetadata = {
  id: "image-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "image-1",
  createdAt: 1,
};

const uploadedFile: AgentAttachment = {
  type: "uploaded_file",
  id: "file-1",
  fileName: "notes.md",
  mimeType: "text/markdown",
  size: 12,
  path: "/tmp/notes.md",
};

const changeRequest: AgentAttachment = {
  type: "forge_change_request",
  mimeType: "application/paseo-forge-change-request",
  forge: "github",
  number: 12,
  title: "Fix the thing",
  url: "https://example.com/pull/12",
  body: "Body",
  baseRefName: "main",
  headRefName: "fix",
};

const issue: AgentAttachment = {
  type: "forge_issue",
  mimeType: "application/paseo-forge-issue",
  forge: "github",
  number: 34,
  title: "Report the thing",
  url: "https://example.com/issues/34",
  body: null,
};

describe("buildRewindComposerAttachments", () => {
  test("maps images, uploaded files and forge items back to composer attachments", () => {
    const restored = buildRewindComposerAttachments({
      images: [image],
      attachments: [uploadedFile, changeRequest, issue],
    });

    expect(restored).toHaveLength(4);
    expect(restored[0]).toEqual({ kind: "image", metadata: image });
    expect(restored[1]).toEqual({ kind: "file", attachment: uploadedFile });
    expect(restored[2]).toMatchObject({
      kind: "forge_change_request",
      item: { number: 12, title: "Fix the thing", kind: "change_request" },
    });
    expect(restored[3]).toMatchObject({
      kind: "forge_issue",
      item: { number: 34, title: "Report the thing", kind: "issue" },
    });
  });

  test("ignores text and review attachments", () => {
    const restored = buildRewindComposerAttachments({
      images: [],
      attachments: [
        { type: "text", mimeType: "text/plain", text: "context" },
        {
          type: "review",
          mimeType: "application/paseo-review",
          cwd: "/tmp/repo",
          mode: "uncommitted",
          comments: [],
        },
      ],
    });

    expect(restored).toEqual([]);
  });
});

describe("mergeRewindAttachments", () => {
  test("keeps the current draft and skips duplicates", () => {
    const existing = [{ kind: "image" as const, metadata: image }];
    const restored = buildRewindComposerAttachments({
      images: [image],
      attachments: [uploadedFile],
    });

    expect(mergeRewindAttachments(existing, restored)).toEqual([
      { kind: "image", metadata: image },
      { kind: "file", attachment: uploadedFile },
    ]);
  });

  test("dedupes repeated forge items by kind, number and url", () => {
    const restored = buildRewindComposerAttachments({
      images: [],
      attachments: [changeRequest, changeRequest],
    });

    expect(mergeRewindAttachments([], restored)).toHaveLength(1);
  });
});
