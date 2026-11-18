import { describe, expect, test } from "vitest";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  normalizeQuestionFormInput,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
} from "./question-form-card-core";

describe("question form card core", () => {
  test("treats optional input prompts as skippable empty answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Optional comment?",
          header: "Response",
          options: [],
          multiSelect: false,
          placeholder: "Optional comment (press Enter to skip)...",
          allowEmpty: true,
          dismissLabel: "Skip",
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    expect(areQuestionsAnswered(questions, {}, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, {})).toEqual({ Response: "" });
    expect(shouldSubmitEmptyOnDismiss(questions)).toBe(true);
    expect(resolveDismissLabel(questions)).toBe("Skip");
  });

  test("requires a selection for option-only questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick one",
          header: "Response",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(false);
    expect(areQuestionsAnswered(questions, {}, { 0: "freeform" })).toBe(false);
    expect(areQuestionsAnswered(questions, { 0: new Set([1]) }, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, { 0: new Set([1]) }, {})).toEqual({
      Response: "B",
    });
  });

  test("keeps checked options and appends the other answer for multi-select", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Which fruits do you like?",
          header: "Fruits",
          options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }],
          multiSelect: true,
          allowOther: true,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    expect(buildQuestionFormAnswers(questions, { 0: new Set([0, 2]) }, { 0: " durian " })).toEqual({
      Fruits: "Apple, Cherry, durian",
    });
    expect(buildQuestionFormAnswers(questions, { 0: new Set([0, 2]) }, {})).toEqual({
      Fruits: "Apple, Cherry",
    });
    expect(buildQuestionFormAnswers(questions, { 0: new Set() }, { 0: "durian" })).toEqual({
      Fruits: "durian",
    });
    expect(buildQuestionFormAnswers(questions, {}, { 0: "durian" })).toEqual({ Fruits: "durian" });
  });

  test("replaces the selected option with the other answer for single-select", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Which provider?",
          header: "Provider",
          options: [{ label: "Claude Code" }, { label: "Codex" }],
          multiSelect: false,
          allowOther: true,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    expect(buildQuestionFormAnswers(questions, { 0: new Set([1]) }, { 0: "OpenCode" })).toEqual({
      Provider: "OpenCode",
    });
    expect(buildQuestionFormAnswers(questions, { 0: new Set([1]) }, {})).toEqual({
      Provider: "Codex",
    });
  });

  test("shows text input for explicit other questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          isOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(areQuestionsAnswered(questions, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });

  test("shows text input for questions that allow other answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          allowOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(areQuestionsAnswered(questions, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });

  test("keeps option previews so options can be compared", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Which layout?",
          header: "Layout",
          options: [
            {
              label: "Tabs",
              description: "One tab per section",
              preview: "<Tabs>\n  <Tab />\n</Tabs>",
            },
            { label: "Single page" },
          ],
          multiSelect: false,
        },
      ],
    });

    expect(questions?.[0]?.options).toEqual([
      { label: "Tabs", description: "One tab per section", preview: "<Tabs>\n  <Tab />\n</Tabs>" },
      { label: "Single page", description: undefined, preview: undefined },
    ]);
  });

  test("parses an MCP elicitation field that has no options", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "As próximas ações do SSH não pedem confirmação por 8 horas.",
          header: "Grant do SSH por 8 horas",
          multiSelect: false,
          allowOther: false,
          allowEmpty: true,
          type: "boolean",
        },
        {
          question: "Duração do grant",
          header: "duration",
          options: [{ label: "4h" }, { label: "8h" }],
          multiSelect: false,
          allowOther: false,
          allowEmpty: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [checkbox] = questions;
    if (!checkbox) throw new Error("checkbox missing");
    expect(checkbox.type).toBe("boolean");
    expect(questionShowsTextInput(checkbox)).toBe(false);
    // Leaving the box unchecked is an answer: submitting it accepts the dialog
    // without granting anything.
    expect(areQuestionsAnswered(questions, { 1: new Set([1]) }, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, { 0: new Set([0]), 1: new Set([1]) }, {})).toEqual({
      "Grant do SSH por 8 horas": "true",
      duration: "8h",
    });
    expect(buildQuestionFormAnswers(questions, { 1: new Set([1]) }, {})).toEqual({
      duration: "8h",
    });
  });

  test("keeps a checkbox default so the card starts in the server's state", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Grant?",
          header: "grant_tool",
          multiSelect: false,
          allowOther: false,
          allowEmpty: true,
          type: "boolean",
          defaultChecked: true,
        },
      ],
    });

    expect(questions?.[0]?.defaultChecked).toBe(true);
  });

  test("dismissing an elicitation with a checkbox declines it instead of accepting", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Grant?",
          header: "grant_tool",
          multiSelect: false,
          allowOther: false,
          allowEmpty: true,
          type: "boolean",
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    expect(shouldSubmitEmptyOnDismiss(questions)).toBe(false);
  });

  test("parses an external field as a link instead of a text input", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Authorize the MCP server",
          header: "url",
          multiSelect: false,
          allowOther: false,
          allowEmpty: true,
          type: "link",
          url: "https://example.com/authorize",
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [link] = questions;
    if (!link) throw new Error("link missing");
    expect(link.type).toBe("link");
    expect(link.url).toBe("https://example.com/authorize");
    expect(questionShowsTextInput(link)).toBe(false);
    expect(buildQuestionFormAnswers(questions, {}, {})).toEqual({});
    expect(shouldSubmitEmptyOnDismiss(questions)).toBe(false);
  });

  test("parses a form with no fields so the card can still be confirmed", () => {
    const questions = parseQuestionFormQuestions({ questions: [] });

    expect(questions).toEqual([]);
    expect(areQuestionsAnswered(questions, {}, {})).toBe(true);
  });

  test("leaves Codex-style { questions: [...] } payloads unchanged", () => {
    const raw = {
      questions: [
        {
          question: "Existing shape",
          header: "answer",
          options: [{ label: "Yes" }],
          multiSelect: false,
          allowOther: false,
          allowEmpty: false,
        },
      ],
    };

    expect(normalizeQuestionFormInput(raw)).toBe(raw);
  });

  test("normalizes ACP-style flat { question, options } into questions array", () => {
    const questions = parseQuestionFormQuestions(
      normalizeQuestionFormInput({
        question: "Enter plan mode?",
        options: ["Yes (Recommended)", "No"],
      }),
    );

    if (!questions) throw new Error("questions did not parse");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.question).toBe("Enter plan mode?");
    expect(questions[0]?.options.map((o) => o.label)).toEqual(["Yes (Recommended)", "No"]);
    expect(areQuestionsAnswered(questions, { 0: new Set([0]) }, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, { 0: new Set([0]) }, {})).toEqual({
      answer: "Yes (Recommended)",
    });
  });
});
