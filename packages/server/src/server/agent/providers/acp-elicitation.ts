/**
 * ACP `session/elicitation` asks the client to render a form. Paseo renders it
 * with the same question card the other providers use, so an ACP agent's MCP
 * prompts reach the user instead of being auto-declined.
 *
 * The card only knows header/options/type. Keep the schema keys and enum values
 * here: the app answers with the labels it showed, and the agent needs the
 * original values back in the elicitation response.
 */

export interface ACPCardQuestion {
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

type SchemaType = "string" | "number" | "integer" | "boolean" | "array";

interface ElicitationField {
  key: string;
  header: string;
  type: SchemaType;
  /** Enum label -> schema value, for fields the card shows as options. */
  values?: Record<string, string>;
}

export interface ACPElicitationForm {
  questions: ACPCardQuestion[];
  fields: ElicitationField[];
  urlMode: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function descriptionOf(property: Record<string, unknown>, fallback: string): string {
  const description = property.description;
  return typeof description === "string" && description.trim().length > 0 ? description : fallback;
}

function enumOptions(property: Record<string, unknown>): Array<{ label: string; value: string }> {
  const values: string[] = [];
  if (Array.isArray(property.enum)) {
    for (const value of property.enum) {
      if (typeof value === "string") values.push(value);
    }
  }
  const oneOf = Array.isArray(property.oneOf) ? property.oneOf : [];
  for (const entry of oneOf) {
    const option = record(entry);
    const value = option?.const ?? option?.enum;
    if (typeof value === "string") values.push(value);
  }
  return [...new Set(values)].map((value) => {
    const option = oneOf
      .map(record)
      .find((entry) => entry && (entry.const === value || entry.enum === value));
    let label = value;
    if (typeof option?.title === "string") label = option.title;
    else if (typeof option?.description === "string") label = option.description;
    return { label, value };
  });
}

function fieldFromProperty(
  key: string,
  raw: unknown,
  required: boolean,
): { question: ACPCardQuestion; field: ElicitationField } | null {
  const property = record(raw);
  if (!property) return null;
  const type = (typeof property.type === "string" ? property.type : "string") as SchemaType;
  const header = typeof property.title === "string" && property.title.trim() ? property.title : key;
  const base = {
    header,
    question: descriptionOf(property, header),
    allowOther: false,
    allowEmpty: !required,
  };

  if (type === "boolean") {
    return {
      question: {
        ...base,
        options: [],
        multiSelect: false,
        type: "boolean",
        allowEmpty: true,
        ...(property.default === true ? { defaultChecked: true } : {}),
      },
      field: { key, header, type },
    };
  }

  if (type === "array") {
    const items = record(property.items);
    const options = items ? enumOptions(items) : [];
    return {
      question: {
        ...base,
        options: options.map((option) => ({ label: option.label })),
        multiSelect: true,
      },
      field: {
        key,
        header,
        type,
        ...(options.length > 0
          ? { values: Object.fromEntries(options.map((option) => [option.label, option.value])) }
          : {}),
      },
    };
  }

  const options = enumOptions(property);
  return {
    question: {
      ...base,
      options: options.map((option) => {
        const optionRecord = (Array.isArray(property.oneOf) ? property.oneOf : [])
          .map(record)
          .find((entry) => entry && (entry.const === option.value || entry.enum === option.value));
        const description =
          typeof optionRecord?.description === "string" ? optionRecord.description : undefined;
        return description ? { label: option.label, description } : { label: option.label };
      }),
      multiSelect: false,
      type: "text",
      ...(typeof property.placeholder === "string" ? { placeholder: property.placeholder } : {}),
    },
    field: {
      key,
      header,
      type,
      ...(options.length > 0
        ? { values: Object.fromEntries(options.map((option) => [option.label, option.value])) }
        : {}),
    },
  };
}

/** Turn an ACP elicitation request into the card's questions and the answer map. */
export function readACPElicitation(params: unknown): ACPElicitationForm | null {
  const request = record(params);
  if (!request) return null;
  const message = typeof request.message === "string" ? request.message.trim() : "";
  if (!message) return null;

  if (request.mode === "url" && typeof request.url === "string" && request.url.length > 0) {
    return {
      questions: [
        {
          header: "Open link",
          question: message,
          options: [],
          multiSelect: false,
          allowOther: false,
          allowEmpty: true,
          type: "link",
          url: request.url,
        },
      ],
      fields: [],
      urlMode: typeof request.elicitationId === "string" ? request.elicitationId : null,
    };
  }

  // MCP's `elicitation/create` omits `mode` for form requests; ACP sends it explicitly.
  if (request.mode !== undefined && request.mode !== "form") return null;
  const schema = record(request.requestedSchema);
  const properties = record(schema?.properties);
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const questions: ACPCardQuestion[] = [];
  const fields: ElicitationField[] = [];
  for (const [key, raw] of Object.entries(properties ?? {})) {
    const parsed = fieldFromProperty(key, raw, required.includes(key));
    if (!parsed) continue;
    questions.push(parsed.question);
    fields.push(parsed.field);
  }
  if (questions.length === 0) {
    // A schema with no fields is a confirmation: the card renders a button.
    questions.push({
      header: message,
      question: message,
      options: [],
      multiSelect: false,
      allowOther: false,
      allowEmpty: true,
    });
  }
  return { questions, fields, urlMode: null };
}

/** Map the card's string answers back to the schema values the agent expects. */
export function acpElicitationContent(
  form: ACPElicitationForm,
  answers: unknown,
): Record<string, string | number | boolean | string[]> {
  const raw = record(answers);
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of form.fields) {
    const answer = raw?.[field.header];
    if (field.type === "boolean") {
      content[field.key] = answer === "true" || answer === true;
      continue;
    }
    if (typeof answer !== "string" || answer.length === 0) continue;
    if (field.type === "number" || field.type === "integer") {
      const number = Number(answer);
      if (Number.isFinite(number)) content[field.key] = number;
      continue;
    }
    const values = field.values;
    if (!values) {
      content[field.key] = answer;
      continue;
    }
    const labels = field.type === "array" ? answer.split(", ") : [answer];
    const mapped = labels.map((label) => values[label] ?? label);
    content[field.key] = field.type === "array" ? mapped : (mapped[0] ?? answer);
  }
  return content;
}
