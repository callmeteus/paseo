import type { SessionMessageInfo } from "@opencode/client";
import type { V2Api } from "./api.js";

function declaredSessionID(message: SessionMessageInfo): string | undefined {
  const record = message as SessionMessageInfo & { sessionID?: unknown; sessionId?: unknown };
  const value = record.sessionID ?? record.sessionId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Drops a row that names another session. Rows with no session id stay. */
export function selectSessionMessages(
  sessionID: string,
  page: readonly SessionMessageInfo[],
): SessionMessageInfo[] {
  return page.filter((message) => {
    const owner = declaredSessionID(message);
    return owner === undefined || owner === sessionID;
  });
}

export async function messages(client: V2Api, sessionID: string): Promise<SessionMessageInfo[]> {
  const result: SessionMessageInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.message.list({
      sessionID,
      ...(cursor ? { cursor } : { order: "asc" }),
      limit: 100,
    });
    result.push(...selectSessionMessages(sessionID, page.data));
    cursor = page.cursor.next ?? undefined;
  } while (cursor);
  return result;
}
