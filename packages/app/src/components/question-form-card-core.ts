export interface QuestionOption {
  label: string;
  description?: string;
  preview?: string;
}

export interface QuestionFormQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
  /**
   * A checkbox (`boolean`) or a link the user opens in the browser (`link`) reads
   * differently from a text field or a list of options. Providers that send an MCP
   * elicitation mark it; anything else is a text question.
   */
  type: "text" | "boolean" | "link" | "fact";
  url?: string;
  /** A checkbox the server already considers checked. */
  defaultChecked?: boolean;
}

export type QuestionSelections = Record<number, ReadonlySet<number>>;
export type QuestionOtherTexts = Record<number, string>;

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function mapStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : null;
}

/**
 * Some ACP providers (Command Code) send AskUserQuestion payloads as a single JSON object
 * `{ question, options[] }` instead of Codex-style `{ questions: [...] }`. Normalize to the
 * latter so the UI stays one path.
 */
export function normalizeQuestionFormInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const record = input as Record<string, unknown>;
  if (Array.isArray(record.questions)) {
    return input;
  }
  const questionText = record.question;
  const optionStrings = mapStringArray(record.options);
  if (typeof questionText !== "string" || !optionStrings || optionStrings.length === 0) {
    return input;
  }
  return {
    questions: [
      {
        question: questionText,
        header: "answer",
        options: optionStrings.map((label) => ({ label })),
        multiSelect: false,
        allowOther: false,
        allowEmpty: false,
      },
    ],
  };
}

export function parseQuestionFormQuestions(input: unknown): QuestionFormQuestion[] | null {
  const normalized = normalizeQuestionFormInput(input);
  if (typeof normalized !== "object" || normalized === null) return null;
  if (!("questions" in normalized)) return null;
  const raw = (normalized as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return null;
  const questions: QuestionFormQuestion[] = [];
  for (const item of raw) {
    const parsed = parseQuestion(item);
    if (!parsed) return null;
    questions.push(parsed);
  }
  return questions;
}

function parseQuestionOptions(raw: unknown): QuestionOption[] | null {
  if (!Array.isArray(raw)) return null;
  const options: QuestionOption[] = [];
  for (const opt of raw as unknown[]) {
    if (typeof opt !== "object" || opt === null) return null;
    const o = opt as Record<string, unknown>;
    if (typeof o.label !== "string") return null;
    options.push({
      label: o.label,
      description: typeof o.description === "string" ? o.description : undefined,
      preview: readOptionalString(o, "preview"),
    });
  }
  return options;
}

function questionType(value: unknown): QuestionFormQuestion["type"] {
  if (value === "boolean") return "boolean";
  if (value === "link") return "link";
  if (value === "fact") return "fact";
  return "text";
}

function parseQuestion(item: unknown): QuestionFormQuestion | null {
  if (typeof item !== "object" || item === null) return null;
  const q = item as Record<string, unknown>;
  if (typeof q.question !== "string" || typeof q.header !== "string") return null;
  // A field with no choices (a checkbox, a free-text answer, a link) arrives
  // without `options`. Reading it as a broken question made the whole card
  // disappear, which is how an MCP elicitation turned into a hung turn.
  const options = parseQuestionOptions(q.options ?? []);
  if (!options) return null;
  const type = questionType(q.type);
  const question: QuestionFormQuestion = {
    question: q.question,
    header: q.header,
    options,
    multiSelect: q.multiSelect === true,
    allowOther: q.allowOther === true || q.isOther === true,
    allowEmpty: q.allowEmpty === true || type === "boolean" || type === "link",
    placeholder: readOptionalString(q, "placeholder"),
    dismissLabel: readOptionalString(q, "dismissLabel"),
    type,
  };
  if (type === "link") {
    const url = readOptionalString(q, "url");
    return url ? { ...question, url } : question;
  }
  if (type === "boolean" && q.defaultChecked === true) {
    return { ...question, defaultChecked: true };
  }
  return question;
}

export function questionShowsTextInput(question: QuestionFormQuestion): boolean {
  if (question.type !== "text") return false;
  return question.options.length === 0 || question.allowOther;
}

export function isQuestionAnswered(
  question: QuestionFormQuestion,
  qIndex: number,
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): boolean {
  // A checkbox and a link are never blocking: leaving the box unchecked and
  // submitting is the answer, the way the MCP client itself treats them.
  if (question.type === "boolean" || question.type === "link" || question.type === "fact") {
    return true;
  }

  const selected = selections[qIndex];
  if (selected && selected.size > 0) {
    return true;
  }

  if (!questionShowsTextInput(question)) {
    return false;
  }

  const otherText = otherTexts[qIndex]?.trim();
  if (otherText && otherText.length > 0) {
    return true;
  }

  return question.allowEmpty;
}

export function areQuestionsAnswered(
  questions: QuestionFormQuestion[] | null,
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): boolean {
  return (
    questions?.every((question, qIndex) =>
      isQuestionAnswered(question, qIndex, selections, otherTexts),
    ) ?? false
  );
}

export function buildQuestionFormAnswers(
  questions: QuestionFormQuestion[],
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const selected = selections[i];
    const otherText = otherTexts[i]?.trim();

    if (q.type === "boolean") {
      if (selected && selected.size > 0) {
        answers[q.header] = "true";
      }
      continue;
    }
    if (q.type === "link") {
      continue;
    }

    const labels = selected
      ? Array.from(selected).flatMap((idx) => {
          const option = q.options[idx];
          return option ? [option.label] : [];
        })
      : [];

    if (questionShowsTextInput(q)) {
      if (otherText && otherText.length > 0) {
        // Multi-select keeps the checked options and appends the custom answer, the way
        // Claude Code's own AskUserQuestion UI does. Single-select replaces the option.
        answers[q.header] = q.multiSelect ? [...labels, otherText].join(", ") : otherText;
        continue;
      }
      if (q.allowEmpty && q.options.length === 0) {
        answers[q.header] = "";
        continue;
      }
    }

    if (labels.length > 0) {
      answers[q.header] = labels.join(", ");
    }
  }
  return answers;
}

export function shouldSubmitEmptyOnDismiss(questions: QuestionFormQuestion[]): boolean {
  return (
    questions.length > 0 &&
    questions.every(
      (question) =>
        question.allowEmpty && question.options.length === 0 && question.type === "text",
    )
  );
}

export function resolveDismissLabel(
  questions: QuestionFormQuestion[],
  fallbackLabel = "Dismiss",
): string {
  return questions.find((question) => question.dismissLabel)?.dismissLabel ?? fallbackLabel;
}
