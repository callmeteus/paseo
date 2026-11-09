import type { UserComposerAttachment } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment, ForgeSearchItem } from "@getpaseo/protocol/messages";

type ForgeAttachment = Extract<
  AgentAttachment,
  { type: "forge_change_request" | "github_pr" | "forge_issue" | "github_issue" }
>;

function buildForgeItem(attachment: ForgeAttachment): ForgeSearchItem {
  const isIssue = attachment.type === "forge_issue" || attachment.type === "github_issue";
  return {
    kind: isIssue ? "issue" : "change_request",
    forge: "forge" in attachment && attachment.forge ? attachment.forge : "github",
    number: attachment.number,
    title: attachment.title,
    url: attachment.url,
    // The pill only renders title/number/url; state and labels are cosmetic here.
    state: "",
    body: attachment.body ?? null,
    labels: [],
    ...("baseRefName" in attachment
      ? { baseRefName: attachment.baseRefName, headRefName: attachment.headRefName }
      : {}),
  };
}

/** Rebuild composer attachments from a rewound message's images and attachments. */
export function buildRewindComposerAttachments(input: {
  images: readonly UserMessageImageAttachment[];
  attachments: readonly AgentAttachment[];
}): UserComposerAttachment[] {
  const restored: UserComposerAttachment[] = [];
  for (const image of input.images) {
    restored.push({ kind: "image", metadata: image });
  }
  for (const attachment of input.attachments) {
    switch (attachment.type) {
      case "uploaded_file":
        // The daemon already holds the file; restoring the reference avoids a re-upload.
        restored.push({ kind: "file", attachment });
        break;
      case "forge_change_request":
        restored.push({ kind: "forge_change_request", item: buildForgeItem(attachment) });
        break;
      case "forge_issue":
        restored.push({ kind: "forge_issue", item: buildForgeItem(attachment) });
        break;
      case "github_pr":
        restored.push({ kind: "github_pr", item: buildForgeItem(attachment) });
        break;
      case "github_issue":
        restored.push({ kind: "github_issue", item: buildForgeItem(attachment) });
        break;
      // `text` is already carried by the inline chip in the message; `review` has no
      // composer representation, so neither comes back as an attachment.
      default:
        break;
    }
  }
  return restored;
}

function attachmentIdentity(attachment: UserComposerAttachment): string | null {
  switch (attachment.kind) {
    case "image":
      return `image:${attachment.metadata.id}`;
    case "file":
      return `file:${attachment.attachment.id}`;
    case "forge_issue":
    case "forge_change_request":
    case "github_issue":
    case "github_pr":
      return `${attachment.kind}:${attachment.item.number}:${attachment.item.url}`;
    default:
      return null;
  }
}

/** Append restored attachments, skipping ones the draft already holds. */
export function mergeRewindAttachments(
  existing: readonly UserComposerAttachment[],
  restored: readonly UserComposerAttachment[],
): UserComposerAttachment[] {
  const seen = new Set<string>();
  for (const attachment of existing) {
    const identity = attachmentIdentity(attachment);
    if (identity) seen.add(identity);
  }
  const merged = [...existing];
  for (const attachment of restored) {
    const identity = attachmentIdentity(attachment);
    if (identity) {
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    merged.push(attachment);
  }
  return merged;
}
