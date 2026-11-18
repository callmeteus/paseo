import type { FormInfo, FormValue } from "@opencode/client";
import type { V2Api } from "./api.js";

import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../../../agent-sdk-types.js";
import { splitMultiSelectAnswer } from "../../question-card-answer.js";

export class SessionPermissions {
  private readonly pending = new Map<string, AgentPermissionRequest>();
  private readonly permissionOwners = new Map<string, string>();
  private readonly forms = new Map<string, FormInfo>();
  constructor(
    private readonly getClient: () => V2Api,
    private readonly id: string,
    private readonly config: AgentSessionConfig,
    private readonly emit: (event: AgentStreamEvent) => void,
  ) {}
  observe(event: import("@opencode/client").OpenCodeEvent) {
    if (event.type === "permission.replied") {
      this.resolvePending(event.data.requestID, {
        behavior: event.data.reply === "reject" ? "deny" : "allow",
      });
    }
    if (event.type === "form.replied" || event.type === "form.cancelled") {
      this.resolvePending(event.data.id, {
        behavior: event.type === "form.cancelled" ? "deny" : "allow",
      });
    }
  }
  list() {
    return [...this.pending.values()];
  }
  isOwnedBy(requestId: string, sessionID: string) {
    return (
      this.forms.get(requestId)?.sessionID === sessionID ||
      this.permissionOwners.get(requestId) === sessionID
    );
  }
  async respondToPermission(requestId: string, response: AgentPermissionResponse) {
    const form = this.forms.get(requestId);
    if (form) {
      if (response.behavior === "deny")
        await this.getClient().session.form.cancel({ sessionID: form.sessionID, formID: form.id });
      else {
        const raw = response.updatedInput?.answers;
        const answer: Record<string, FormValue> = {};
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error("OpenCode question response requires answers");
        for (const field of form.fields) {
          const value: unknown =
            Reflect.get(raw, field.key) ?? Reflect.get(raw, field.title ?? field.key);
          const normalized = formAnswer(field, value);
          if (normalized !== undefined) answer[field.key] = normalized;
        }
        await this.getClient().session.form.reply({
          sessionID: form.sessionID,
          formID: form.id,
          answer,
        });
      }
      this.forms.delete(requestId);
    } else {
      await this.getClient().permission.reply({
        sessionID: this.permissionOwners.get(requestId) ?? this.id,
        requestID: requestId,
        decision: permissionReply(response),
      });
    }
    this.resolvePending(requestId, response);
  }
  async reconcile(sessionID: string) {
    const [permissions, forms] = await Promise.all([
      this.getClient().permission.list({ sessionID }),
      this.getClient().session.form.list({ sessionID }),
    ]);
    for (const request of permissions) {
      if (this.pending.has(request.id)) continue;
      const pending: AgentPermissionRequest = {
        id: request.id,
        provider: "opencode",
        kind: "tool",
        name: request.action,
        description: request.message ?? request.resources.join("\n"),
        actions: [
          { id: "once", label: "Allow once", behavior: "allow" },
          { id: "always", label: "Always allow", behavior: "allow" },
          { id: "reject", label: "Deny", behavior: "deny" },
        ],
      };
      this.pending.set(request.id, pending);
      this.permissionOwners.set(request.id, sessionID);
      if (!this.config.toolPolicy && this.config.featureValues?.["auto_accept"] === true)
        await this.respondToPermission(request.id, { behavior: "allow" });
      else this.emit({ type: "permission_requested", provider: "opencode", request: pending });
    }
    for (const form of forms) {
      if (this.pending.has(form.id)) continue;
      const message = formMessage(form);
      const pending: AgentPermissionRequest = {
        id: form.id,
        provider: "opencode",
        name: "question",
        kind: "question",
        title: form.title,
        ...(message ? { description: message } : {}),
        input: {
          // An MCP elicitation reaches OpenCode as a form whose fields are the
          // confirmation choices (checkboxes, a duration select) while the action
          // facts ride along in the form message. The card needs every field
          // rendered, including the ones with no options, so none of them turn into
          // a blank question the user cannot answer.
          questions: form.fields
            .filter((field) => !("hidden" in field) || field.hidden !== true)
            .map(toQuestion),
        },
      };
      this.forms.set(form.id, form);
      this.pending.set(form.id, pending);
      this.emit({ type: "permission_requested", provider: "opencode", request: pending });
    }
  }
  resolvePending(requestId: string, resolution: AgentPermissionResponse) {
    if (!this.pending.delete(requestId)) return;
    this.forms.delete(requestId);
    this.permissionOwners.delete(requestId);
    this.emit({ type: "permission_resolved", provider: "opencode", requestId, resolution });
  }
}
function permissionReply(response: AgentPermissionResponse): "reject" | "once" | "always" {
  if (response.behavior === "deny") return "reject";
  return response.selectedActionId === "always" ? "always" : "once";
}

interface QuestionPayload {
  header: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  type?: "text" | "boolean" | "link";
  url?: string;
  placeholder?: string;
  defaultChecked?: boolean;
}

/**
 * Renders one OpenCode form field as a card question.
 *
 * Booleans become a checkbox and `external` fields a link: without an explicit
 * type the card falls back to a text input, which leaves the grants dialog and
 * the MCP authorization prompt impossible to answer.
 */
function toQuestion(field: FormInfo["fields"][number]): QuestionPayload {
  const header = field.title?.trim() || field.key;
  const text = field.description?.trim() || field.title?.trim() || field.key;
  const optional = !("required" in field) || field.required !== true;
  const base = {
    header,
    question: text,
    multiSelect: false,
    allowOther: false,
    allowEmpty: optional,
  };
  if (field.type === "boolean") {
    return {
      ...base,
      options: [],
      type: "boolean",
      allowEmpty: true,
      ...(field.default === true ? { defaultChecked: true } : {}),
    };
  }
  if (field.type === "external") {
    return { ...base, options: [], type: "link", url: field.url, allowEmpty: true };
  }
  if (field.type === "multiselect") {
    return {
      ...base,
      options: field.options.map(toFormOption),
      multiSelect: true,
      allowOther: field.custom === true,
    };
  }
  if (field.type === "string") {
    const options = field.options ?? [];
    return {
      ...base,
      options: options.map(toFormOption),
      allowOther: options.length > 0 && field.custom === true,
      allowEmpty: optional && options.length === 0,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    };
  }
  return { ...base, options: [], allowEmpty: optional };
}

function toFormOption(option: { label: string; description?: string }) {
  return option.description
    ? { label: option.label, description: option.description }
    : { label: option.label };
}

/** Fact lines an MCP elicitation carries next to its fields. */
function formMessage(form: FormInfo): string | undefined {
  const message = form.metadata?.message;
  return typeof message === "string" && message.trim().length > 0 ? message : undefined;
}

function formAnswer(field: FormInfo["fields"][number], value: unknown): FormValue | undefined {
  if (value === undefined) return undefined;
  if (field.type === "external") return undefined;
  // An optional field left untouched ships as an empty string; sending it would
  // overwrite the server-side default with "".
  if (typeof value === "string" && value.trim().length === 0) return undefined;
  if (field.type === "multiselect") {
    const selected = multiSelectAnswer(field, value);
    if (selected) return selected.map((label) => formOptionValue(field, label));
  } else if (field.type === "string") {
    if (typeof value === "string") return formOptionValue(field, value);
  } else if (field.type === "boolean") {
    const parsed = booleanAnswer(value);
    if (parsed !== undefined) return parsed;
  } else {
    const parsed = numericAnswer(field, value);
    if (parsed !== undefined) return parsed;
  }
  throw new Error(`Invalid answer for OpenCode question ${field.key}`);
}

/** Maps a picked label back to the native option value OpenCode sent. */
function formOptionValue(field: FormInfo["fields"][number], label: string): string {
  const options = "options" in field ? field.options : undefined;
  return (
    options?.find((option) => option.value === label)?.value ??
    options?.find((option) => option.label === label)?.value ??
    label
  );
}

function booleanAnswer(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

type NumericField = Extract<FormInfo["fields"][number], { type: "number" | "integer" }>;

function numericAnswer(field: NumericField, value: unknown): number | undefined {
  const numeric = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return undefined;
  if (field.type === "integer" && !Number.isInteger(numeric)) return undefined;
  return numeric;
}

type MultiSelectField = Extract<FormInfo["fields"][number], { type: "multiselect" }>;

function multiSelectAnswer(field: MultiSelectField, value: unknown): string[] | undefined {
  if (Array.isArray(value) && value.every((item: unknown) => typeof item === "string"))
    return value;
  if (typeof value !== "string") return undefined;
  const { selected, custom } = splitMultiSelectAnswer(
    value,
    field.options.map((option) => option.label),
  );
  if (custom === null) return selected;
  return field.custom === true ? [...selected, custom] : undefined;
}
