import { applyCursorRules } from "./cursor-rules.mjs";
import { registerStructuredOutput, STRUCTURED_OUTPUT_TOOL } from "./structured-output-plugin.mjs";
import { registerSharedBridge } from "./shared-bridge-plugin.mjs";

function ownsMessage(sessionID, message) {
  if (!message || typeof message !== "object") return false;
  const owner = message.sessionID ?? message.sessionId;
  return typeof owner !== "string" || owner.length === 0 || owner === sessionID;
}

// OpenCode's LLM media sanitizer calls `content.map` without guarding the type.
// A string here crashes the turn with "i.content.map is not a function", so
// every synthesized message must carry content as an array of text parts.
function asTextParts(text) {
  return [{ type: "text", text }];
}

function asModelMessage(message) {
  if (message.role && message.content !== undefined) {
    return typeof message.content === "string"
      ? { ...message, content: asTextParts(message.content) }
      : message;
  }
  let text = "";
  if (typeof message.text === "string") {
    text = message.text;
  } else if (typeof message.summary === "string") {
    text = message.summary;
  }
  if (!text) return null;
  const role = message.type === "assistant" ? "assistant" : "user";
  return { id: message.id, role, content: asTextParts(text) };
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

// OpenCode's own tools carry no server prefix and must survive every budget.
const PROTECTED_TOOLS = new Set([
  "bash",
  "edit",
  "glob",
  "grep",
  "list",
  "multiedit",
  "patch",
  "read",
  "task",
  "todo",
  "todoread",
  "todowrite",
  "webfetch",
  "write",
]);

const PASEO_SERVER = "paseo";

/**
 * OpenCode names an MCP tool `<server>_<tool>`, the same convention the bridge
 * uses for permission actions. Groups therefore come from the name, and the
 * Paseo catalog is recognised separately so it can be dropped last.
 */
function groupOfTool(name) {
  if (name === STRUCTURED_OUTPUT_TOOL) return null;
  if (name.startsWith(`${PASEO_SERVER}_`)) return { server: PASEO_SERVER, priority: 2 };
  if (PROTECTED_TOOLS.has(name)) return null;
  const separator = name.indexOf("_");
  return { server: separator > 0 ? name.slice(0, separator) : name, priority: 1 };
}

/**
 * A model that rejects more than N tools fails the whole turn, so the request
 * has to fit before it is sent. Drop MCP surfaces whole — never half a server —
 * largest first, then the Paseo catalog, and never touch OpenCode builtins.
 */
export function budgetToolSurface({ tools, maxTools }) {
  const names = Object.keys(tools ?? {});
  if (!Number.isFinite(maxTools) || maxTools <= 0 || names.length <= maxTools) {
    return { removed: [], hiddenServers: [], kept: names.length };
  }
  const groups = new Map();
  for (const name of names) {
    const group = groupOfTool(name);
    if (!group) continue;
    const key = `${group.priority}:${group.server}`;
    const entry = groups.get(key);
    if (entry) entry.names.push(name);
    else groups.set(key, { ...group, names: [name] });
  }
  const ordered = [...groups.values()].sort(
    (left, right) =>
      left.priority - right.priority ||
      right.names.length - left.names.length ||
      left.server.localeCompare(right.server),
  );
  let remaining = names.length;
  const removed = [];
  const hiddenServers = [];
  for (const group of ordered) {
    if (remaining <= maxTools) break;
    for (const name of group.names) {
      delete tools[name];
      removed.push(name);
    }
    remaining -= group.names.length;
    hiddenServers.push(group.server);
  }
  return { removed, hiddenServers, kept: remaining };
}

export default {
  id: "paseo",
  async setup(context) {
    const disposeStructuredOutput = await registerStructuredOutput(context);
    // Session scoping and prompt rules do not depend on the tool bridge, so they
    // are installed even when no bridge is configured.
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
    // OpenCode inlines root rules once, when it builds the prompt. Glob rules
    // and a nested .cursor/rules stay out until a tool path falls in that
    // directory, so this hook attaches them on the request itself.
    const cursorRules = await context.session.hook("context", async (input) => {
      if (!input?.sessionID || !Array.isArray(input.messages)) return;
      let directory;
      try {
        const session = await context.session.get({ sessionID: input.sessionID });
        directory = session?.location?.directory;
      } catch {
        return;
      }
      if (typeof directory !== "string" || directory.length === 0) return;
      try {
        applyCursorRules(input.messages, directory);
      } catch (error) {
        console.warn("[paseo] cursor rules skipped", error);
      }
    });
    const disposeCursorRules = () => cursorRules.dispose();

    // A structured-only plugin has no tool surface to bridge.
    if (context.options.mode === "structured-only") {
      return async () => {
        await disposeStructuredOutput();
        await disposeCompaction();
        await disposeCursorRules();
      };
    }

    // The daemon can supply bridge credentials directly as plugin options. In
    // that mode tools are installed against this bridge, keeping session
    // scoping and the model's tool ceiling on the request.
    let disposeInlineBridge = async () => undefined;
    const { baseUrl, token } = context.options;
    if (baseUrl && token) {
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
          input.messages = input.messages.filter((message) =>
            ownsMessage(input.sessionID, message),
          );
        }
        const binding = await scope(input.sessionID);
        const allowed = new Set(binding.tools.map((name) => `paseo_${name}`));
        for (const name of Object.keys(input.tools)) {
          if (name !== STRUCTURED_OUTPUT_TOOL && name.startsWith("paseo_") && !allowed.has(name))
            delete input.tools[name];
        }
        const budget = budgetToolSurface({ tools: input.tools, maxTools: binding.maxTools });
        if (budget.hiddenServers.length > 0) {
          console.warn(
            `[paseo] model accepts ${binding.maxTools} tools; hid ${budget.removed.length} from ${budget.hiddenServers.join(", ")}`,
          );
        }
      });
      disposeInlineBridge = async () => {
        await filtering.dispose();
        await registration.dispose();
      };
    }

    // A reused OpenCode service installs tools through the paseo.bridge RPC so
    // several Paseo runtimes can share one server.
    let disposeBridge = async () => undefined;
    if (context.rpc && context.location) {
      disposeBridge = await registerSharedBridge(context);
    }

    return async () => {
      await disposeBridge();
      await disposeInlineBridge();
      await disposeStructuredOutput();
      await disposeCompaction();
      await disposeCursorRules();
    };
  },
};
