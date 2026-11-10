import { registerStructuredOutput, STRUCTURED_OUTPUT_TOOL } from "./structured-output-plugin.mjs";

function ownsMessage(sessionID, message) {
  if (!message || typeof message !== "object") return false;
  const owner = message.sessionID ?? message.sessionId;
  return typeof owner !== "string" || owner.length === 0 || owner === sessionID;
}

function asModelMessage(message) {
  if (message.role && message.content !== undefined) return message;
  let text = "";
  if (typeof message.text === "string") {
    text = message.text;
  } else if (typeof message.summary === "string") {
    text = message.summary;
  }
  if (!text) return null;
  const role = message.type === "assistant" ? "assistant" : "user";
  return { id: message.id, role, content: text };
}

function asModelMessages(messages) {
  return messages.flatMap((message) => {
    const modelMessage = asModelMessage(message);
    return modelMessage ? [modelMessage] : [];
  });
}

/**
 * The compaction request must be this session's history. A message that names
 * another session is dropped. If every id in the request belongs to some other
 * history, the canonical history for this session replaces it.
 */
export function scopeCompactionMessages(sessionID, messages, canonical) {
  const source = Array.isArray(messages) ? messages : [];
  const owned = source.filter((message) => ownsMessage(sessionID, message));
  const canonicalMessages = Array.isArray(canonical)
    ? canonical.filter((message) => ownsMessage(sessionID, message))
    : [];
  const ids = new Set(
    canonicalMessages.flatMap((message) => (typeof message?.id === "string" ? [message.id] : [])),
  );
  if (ids.size === 0) return owned;
  const identified = owned.filter((message) => typeof message?.id === "string");
  if (identified.length === 0) return owned.length > 0 ? owned : asModelMessages(canonicalMessages);
  if (!identified.some((message) => ids.has(message.id))) return asModelMessages(canonicalMessages);
  const kept = owned.filter((message) => typeof message?.id !== "string" || ids.has(message.id));
  return kept.length > 0 ? kept : asModelMessages(canonicalMessages);
}

export default {
  id: "paseo",
  async setup(context) {
    const disposeStructuredOutput = await registerStructuredOutput(context);
    const compaction = await context.session.hook("compaction", async (input) => {
      if (!input?.sessionID || !Array.isArray(input.messages)) return;
      let canonical;
      try {
        canonical = await context.session.context({ sessionID: input.sessionID });
      } catch {
        canonical = undefined;
      }
      input.messages = scopeCompactionMessages(input.sessionID, input.messages, canonical);
    });
    const disposeCompaction = () => compaction.dispose();
    const { baseUrl, token } = context.options;
    if (!baseUrl || !token) {
      return async () => {
        await disposeStructuredOutput();
        await disposeCompaction();
      };
    }
    async function request(pathname, body, allowMissing = false) {
      const response = await fetch(new URL(`/_internal/opencode${pathname}`, baseUrl), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail = formatErrorDetail(payload?.issues ?? payload?.details);
        const message =
          typeof payload?.error === "string" && payload.error
            ? payload.error
            : `Paseo tool bridge returned HTTP ${response.status}`;
        const error = new Error(detail ? `${message}: ${detail}` : message);
        error.status = response.status;
        if (detail) error.details = detail;
        throw error;
      }
      return response.json();
    }
    async function scope(sessionID) {
      const visited = new Set();
      while (sessionID && !visited.has(sessionID)) {
        visited.add(sessionID);
        const binding = await request(
          `/sessions/${encodeURIComponent(sessionID)}/context?tools`,
          undefined,
          true,
        );
        if (binding) return { ...binding, sessionID };
        const session = await context.session.get({ sessionID });
        sessionID = session.parentID;
      }
      throw new Error("OpenCode session is not bound to a Paseo agent");
    }
    const manifest = await request("/tools");
    const registration = await context.tool.transform((editor) => {
      for (const definition of manifest.tools) {
        editor.add({
          name: `paseo_${definition.name}`,
          description: definition.description,
          input: definition.inputSchema,
          options: { codemode: false },
          async execute(input, call) {
            const binding = await scope(call.sessionID);
            const result = await request(
              `/sessions/${encodeURIComponent(binding.sessionID)}/tools/${encodeURIComponent(definition.name)}`,
              input,
            );
            return {
              content: result.content.map(toOpenCodeContent),
              metadata: { paseoTool: definition.name },
            };
          },
        });
      }
    });
    const filtering = await context.session.hook("context", async (input) => {
      if (Array.isArray(input.messages)) {
        input.messages = input.messages.filter((message) => ownsMessage(input.sessionID, message));
      }
      const binding = await scope(input.sessionID);
      const allowed = new Set(binding.tools.map((name) => `paseo_${name}`));
      for (const name of Object.keys(input.tools)) {
        if (name !== STRUCTURED_OUTPUT_TOOL && name.startsWith("paseo_") && !allowed.has(name))
          delete input.tools[name];
      }
    });
    return async () => {
      await disposeStructuredOutput();
      await disposeCompaction();
      await filtering.dispose();
      await registration.dispose();
    };
  },
};

function formatErrorDetail(details) {
  if (!Array.isArray(details)) return typeof details === "string" ? details : "";
  return details
    .map((issue) => {
      const path =
        Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue?.message ?? "Invalid value"}`;
    })
    .join("; ");
}

// OpenCode tool content is text or a file; MCP images arrive as base64 data.
function toOpenCodeContent(part) {
  if (part.type === "image") {
    return { type: "file", uri: `data:${part.mimeType};base64,${part.data}`, mime: part.mimeType };
  }
  return part;
}
