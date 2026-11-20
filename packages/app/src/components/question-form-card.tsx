import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useState, useCallback, useMemo, useRef, type RefObject } from "react";
import {
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { PendingPermission } from "@/types/shared";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { isWeb } from "@/constants/platform";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { EditingTextInputHandle } from "@/components/ui/text-input/types";
import { ScrollableCodeSurface } from "@/components/ui/scrollable-code-surface";
import { ExternalLink } from "@/components/ui/external-link";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import {
  areQuestionsAnswered,
  buildQuestionFormAnswers,
  isQuestionAnswered,
  parseQuestionFormQuestions,
  questionShowsTextInput,
  resolveDismissLabel,
  shouldSubmitEmptyOnDismiss,
  type QuestionFormQuestion,
  type QuestionOption,
} from "./question-form-card-core";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
  responseError: string | null;
}

const IS_WEB = isWeb;
// Native previews are uncapped: inside the option's Pressable, Android never hands a
// drag to the preview's nested scroll, so lines past a cap would be unreachable.
const OPTION_PREVIEW_MAX_HEIGHT = IS_WEB ? 240 : undefined;

// Web clicks that must not answer: a link in the label, the second click of a double-click
// (which would otherwise land on the next question's options), and the release of a drag that
// selected text inside the row. A plain click anywhere else in the row answers, description
// included — the whole box is the control, not just the label.
function isNonAnsweringClick(event: GestureResponderEvent): boolean {
  if (!IS_WEB) return false;
  const click = event.nativeEvent as unknown as MouseEvent;
  if (click.detail > 1) return true;
  if ((click.target as Element | null)?.closest("a")) return true;
  return hasTextSelection();
}

function hasTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0);
}

// The description is selectable text, so a touch on it belongs to the text, not the option.
// Web answers through the row's click handler instead (see isNonAnsweringClick).
const claimResponder = () => true;

function getQuestionInputPlaceholder({
  question,
  answerPlaceholder,
  otherPlaceholder,
}: {
  question: QuestionFormQuestion;
  answerPlaceholder: string;
  otherPlaceholder: string;
}): string {
  return (
    question.placeholder ?? (question.options.length === 0 ? answerPlaceholder : otherPlaceholder)
  );
}

interface QuestionOptionRowProps {
  qIndex: number;
  optIndex: number;
  option: QuestionOption;
  isSelected: boolean;
  multiSelect: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}

function QuestionOptionRow({
  qIndex,
  optIndex,
  option,
  isSelected,
  multiSelect,
  isResponding,
  onToggle,
}: QuestionOptionRowProps) {
  const { theme } = useUnistyles();

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (isNonAnsweringClick(event)) return;
      onToggle(qIndex, optIndex, multiSelect);
    },
    [onToggle, qIndex, optIndex, multiSelect],
  );

  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.optionItem,
      (Boolean(hovered) || isSelected) && {
        backgroundColor: theme.colors.surface2,
      },
      pressed && styles.optionItemPressed,
    ],
    [isSelected, theme.colors.surface2],
  );

  const accessibilityState = useMemo(() => ({ checked: isSelected }), [isSelected]);

  // Static left-side control: square for multi-select, circle for single-select.
  // Always rendered so toggling only swaps fill/border — the row never reflows.
  const controlStyle = useMemo(
    () => [
      styles.selectionControl,
      multiSelect ? styles.selectionControlCheckbox : styles.selectionControlRadio,
      {
        borderColor: isSelected ? theme.colors.accent : theme.colors.foregroundExtraMuted,
        backgroundColor: isSelected && multiSelect ? theme.colors.accent : "transparent",
      },
    ],
    [isSelected, multiSelect, theme.colors.accent, theme.colors.foregroundExtraMuted],
  );
  const radioDotStyle = useMemo(
    () => [styles.selectionRadioDot, { backgroundColor: theme.colors.accent }],
    [theme.colors.accent],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
      accessibilityRole={multiSelect ? "checkbox" : "radio"}
      accessibilityLabel={option.label}
      accessibilityState={accessibilityState}
      aria-checked={isSelected}
    >
      <View style={styles.optionItemContent}>
        <View style={controlStyle}>
          {isSelected && multiSelect ? (
            <Check size={12} color={theme.colors.accentForeground} />
          ) : null}
          {isSelected && !multiSelect ? <View style={radioDotStyle} /> : null}
        </View>
        <View style={styles.optionTextBlock}>
          <MarkdownRenderer text={option.label} compact muted={!isSelected} selectable={false} />
          {option.description ? (
            <View
              testID="question-form-option-description"
              onStartShouldSetResponder={claimResponder}
            >
              <MarkdownRenderer text={option.description} compact muted />
            </View>
          ) : null}
          {option.preview ? (
            // Shown for every option at once so they can be compared before picking.
            // Long lines wrap, as in Claude Code, since most previews are prose.
            <ScrollableCodeSurface
              tone="surface0"
              maxHeight={OPTION_PREVIEW_MAX_HEIGHT}
              horizontal={false}
              selectable={false}
              textStyle={styles.optionPreviewText}
              testID="question-form-option-preview"
            >
              {option.preview}
            </ScrollableCodeSurface>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

interface QuestionNavButtonProps {
  index: number;
  total: number;
  header: string;
  isActive: boolean;
  isAnswered: boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

function QuestionNavButton({
  index,
  total,
  header,
  isActive,
  isAnswered,
  isResponding,
  onSelect,
}: QuestionNavButtonProps) {
  const { theme } = useUnistyles();
  const accessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const handlePress = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);
  const pressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      return [
        styles.questionNavButton,
        {
          backgroundColor:
            isActive || Boolean(hovered) ? theme.colors.surface2 : theme.colors.surface1,
          borderColor: isActive ? theme.colors.foregroundMuted : theme.colors.border,
        },
        pressed && styles.optionItemPressed,
      ];
    },
    [
      isActive,
      theme.colors.border,
      theme.colors.foregroundMuted,
      theme.colors.surface1,
      theme.colors.surface2,
    ],
  );
  const textStyle = useMemo(
    () => [
      styles.questionNavText,
      { color: isActive ? theme.colors.foreground : theme.colors.foregroundMuted },
    ],
    [isActive, theme.colors.foreground, theme.colors.foregroundMuted],
  );

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`Question ${index + 1} of ${total}`}
      accessibilityState={accessibilityState}
      aria-selected={isActive}
      testID={`question-form-question-nav-${index + 1}`}
      style={pressableStyle}
      onPress={handlePress}
      disabled={isResponding}
    >
      {isAnswered ? (
        <Check
          size={12}
          color={isActive ? theme.colors.foreground : theme.colors.foregroundMuted}
        />
      ) : null}
      <Text style={textStyle} numberOfLines={1}>
        {header}
      </Text>
    </Pressable>
  );
}

interface QuestionNavProps {
  questions: QuestionFormQuestion[];
  activeIndex: number;
  isAnswered: (qIndex: number) => boolean;
  isResponding: boolean;
  onSelect: (index: number) => void;
}

// Titled tabs (one per question header) with a check on answered ones. Hidden for
// a lone question — a single "1 of 1" tab carries no information.
function QuestionNav({
  questions,
  activeIndex,
  isAnswered,
  isResponding,
  onSelect,
}: QuestionNavProps) {
  if (questions.length <= 1) {
    return null;
  }
  return (
    <View
      style={styles.questionNav}
      testID="question-form-question-nav"
      accessibilityRole="tablist"
    >
      {questions.map((question, qIndex) => (
        <QuestionNavButton
          key={question.header}
          index={qIndex}
          total={questions.length}
          header={question.header}
          isActive={qIndex === activeIndex}
          isAnswered={isAnswered(qIndex)}
          isResponding={isResponding}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

interface QuestionOtherInputProps {
  qIndex: number;
  inputRef: RefObject<EditingTextInputHandle | null>;
  accessibilityLabel: string;
  value: string;
  placeholder: string;
  isResponding: boolean;
  onChange: (qIndex: number, text: string) => void;
  onSubmit: () => void;
}

function QuestionOtherInput({
  qIndex,
  inputRef,
  accessibilityLabel,
  value,
  placeholder,
  isResponding,
  onChange,
  onSubmit,
}: QuestionOtherInputProps) {
  const { theme } = useUnistyles();
  const handleChange = useCallback(
    (text: string) => {
      onChange(qIndex, text);
    },
    [onChange, qIndex],
  );
  const otherInputStyle = useMemo(
    () =>
      [
        styles.otherInput,
        {
          borderColor: value.length > 0 ? theme.colors.borderAccent : theme.colors.border,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
        },
        IS_WEB ? { outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } : null,
      ] as const,
    [
      value.length,
      theme.colors.borderAccent,
      theme.colors.border,
      theme.colors.foreground,
      theme.colors.surface2,
    ],
  );
  return (
    <TextInput
      ref={inputRef}
      // @ts-expect-error - outlineStyle is web-only
      style={otherInputStyle}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      initialValue={value}
      onChangeText={handleChange}
      onSubmitEditing={onSubmit}
      editable={!isResponding}
      blurOnSubmit={false}
    />
  );
}

const NO_GROUP_PROPS = {} as const;

function isElicitationInput(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Record<string, unknown>).elicitation === true
  );
}

interface QuestionFormMessageProps {
  title?: string;
  message?: string;
}

// An MCP elicitation keeps the action facts in the form message, which reaches
// the card as the request description. Without it the dialog is a row of
// checkboxes with nothing to judge.
function QuestionFormMessage({ title, message }: QuestionFormMessageProps) {
  const text = message?.trim();
  if (!text) return null;
  const heading = title?.trim();
  return (
    <View style={styles.messageBlock} testID="question-form-message">
      {heading ? <Text style={styles.messageTitle}>{heading}</Text> : null}
      <MarkdownRenderer text={text} compact />
    </View>
  );
}

interface QuestionCheckboxRowProps {
  qIndex: number;
  label: string;
  description?: string;
  isSelected: boolean;
  isResponding: boolean;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
}

// A `boolean` form field: one checkbox with its own explanation. The option
// object is memoized because QuestionOptionRow is compared by props.
function QuestionCheckboxRow({
  qIndex,
  label,
  description,
  isSelected,
  isResponding,
  onToggle,
}: QuestionCheckboxRowProps) {
  const option = useMemo<QuestionOption>(() => ({ label, description }), [label, description]);
  return (
    <QuestionOptionRow
      qIndex={qIndex}
      optIndex={0}
      option={option}
      isSelected={isSelected}
      multiSelect
      isResponding={isResponding}
      onToggle={onToggle}
    />
  );
}

interface QuestionFieldProps {
  question: QuestionFormQuestion | undefined;
  qIndex: number;
  selected: ReadonlySet<number>;
  otherText: string;
  isResponding: boolean;
  inputRef: RefObject<EditingTextInputHandle | null>;
  groupProps: { accessibilityRole?: "radiogroup"; accessibilityLabel?: string };
  answerPlaceholder: string;
  otherPlaceholder: string;
  onToggle: (qIndex: number, optIndex: number, multiSelect: boolean) => void;
  onChangeOther: (qIndex: number, text: string) => void;
  onSubmit: () => void;
}

function QuestionField({
  question,
  qIndex,
  selected,
  otherText,
  isResponding,
  inputRef,
  groupProps,
  answerPlaceholder,
  otherPlaceholder,
  onToggle,
  onChangeOther,
  onSubmit,
}: QuestionFieldProps) {
  const { t } = useTranslation();
  if (!question) return null;
  return (
    <View key={question.header} style={styles.questionBlock}>
      {question.type === "text" ? (
        <View style={styles.questionHeader}>
          <View testID="question-form-current-question" style={styles.questionText}>
            <MarkdownRenderer text={question.question} compact />
          </View>
        </View>
      ) : null}
      {question.type === "boolean" ? (
        <View style={styles.optionsWrap}>
          <QuestionCheckboxRow
            qIndex={qIndex}
            label={question.header}
            description={question.question === question.header ? undefined : question.question}
            isSelected={selected.has(0)}
            isResponding={isResponding}
            onToggle={onToggle}
          />
        </View>
      ) : null}
      {question.type === "link" && question.url ? (
        <View style={styles.optionsWrap}>
          <ExternalLink
            href={question.url}
            label={t("message.question.openLink")}
            testID="question-form-open-link"
          />
        </View>
      ) : null}
      {question.options.length > 0 ? (
        <View style={styles.optionsWrap} {...groupProps}>
          {question.options.map((opt, optIndex) => (
            <QuestionOptionRow
              key={opt.label}
              qIndex={qIndex}
              optIndex={optIndex}
              option={opt}
              isSelected={selected.has(optIndex)}
              multiSelect={question.multiSelect}
              isResponding={isResponding}
              onToggle={onToggle}
            />
          ))}
        </View>
      ) : null}
      {questionShowsTextInput(question) ? (
        <QuestionOtherInput
          qIndex={qIndex}
          inputRef={inputRef}
          accessibilityLabel={question.question}
          value={otherText}
          placeholder={getQuestionInputPlaceholder({
            question,
            answerPlaceholder,
            otherPlaceholder,
          })}
          isResponding={isResponding}
          onChange={onChangeOther}
          onSubmit={onSubmit}
        />
      ) : null}
    </View>
  );
}

interface QuestionFormActionsProps {
  isResponding: boolean;
  pendingAction: "submit" | "dismiss" | null;
  primaryDisabled: boolean;
  primaryLabel: string;
  dismissLabel: string;
  onDismiss: () => void;
  onPrimary: () => void;
}

function QuestionFormActions({
  isResponding,
  pendingAction,
  primaryDisabled,
  primaryLabel,
  dismissLabel,
  onDismiss,
  onPrimary,
}: QuestionFormActionsProps) {
  const { theme } = useUnistyles();
  const isMobile = useIsCompactFormFactor();
  const actionsContainerStyle = useMemo(
    () => [styles.actionsContainer, !isMobile && styles.actionsContainerDesktop],
    [isMobile],
  );
  const dismissButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
        borderColor: theme.colors.border,
      },
      pressed && styles.optionItemPressed,
    ],
    [theme.colors.surface2, theme.colors.surface1, theme.colors.border],
  );
  const submitButtonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.actionButton,
      {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
        opacity: primaryDisabled ? 0.5 : 1,
      },
      pressed && !primaryDisabled ? styles.optionItemPressed : null,
    ],
    [primaryDisabled, theme.colors.accent],
  );
  const dismissActionTextStyle = useMemo(
    () => [styles.actionText, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );
  const submitActionTextStyle = useMemo(
    () => [styles.actionText, { color: theme.colors.accentForeground }],
    [theme.colors.accentForeground],
  );

  return (
    <View style={actionsContainerStyle}>
      <Pressable
        style={dismissButtonStyle}
        onPress={onDismiss}
        disabled={isResponding}
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        testID="question-form-dismiss"
      >
        {pendingAction === "dismiss" ? (
          <LoadingSpinner size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <View style={styles.actionContent}>
            <X size={14} color={theme.colors.foregroundMuted} />
            <Text style={dismissActionTextStyle}>{dismissLabel}</Text>
          </View>
        )}
      </Pressable>

      <Pressable
        style={submitButtonStyle}
        onPress={onPrimary}
        disabled={primaryDisabled}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
        testID="question-form-primary-action"
      >
        {pendingAction === "submit" ? (
          <LoadingSpinner size="small" color={theme.colors.accentForeground} />
        ) : (
          <View style={styles.actionContent}>
            <Check size={14} color={theme.colors.accentForeground} />
            <Text style={submitActionTextStyle}>{primaryLabel}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function QuestionFormCard({
  permission,
  onRespond,
  isResponding,
  responseError,
}: QuestionFormCardProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const questions = useMemo(
    () => parseQuestionFormQuestions(permission.request.input),
    [permission.request.input],
  );

  const [selections, setSelections] = useState<Record<number, Set<number>>>(() => {
    // An MCP elicitation checkbox arrives with a default; render the state the
    // server already considers true, so submitting without touching it is not a
    // silent "false".
    const initial: Record<number, Set<number>> = {};
    questions?.forEach((question, qIndex) => {
      if (question.type === "boolean" && question.defaultChecked) {
        initial[qIndex] = new Set([0]);
      }
    });
    return initial;
  });
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({});
  const otherInputRef = useRef<EditingTextInputHandle | null>(null);
  const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const toggleOption = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      const current = selections[qIndex] ?? new Set<number>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(optIndex)) {
          next.delete(optIndex);
        } else {
          next.add(optIndex);
        }
      } else if (next.has(optIndex)) {
        next.clear();
      } else {
        next.clear();
        next.add(optIndex);
      }

      setSelections((prev) => ({ ...prev, [qIndex]: next }));

      // Single-select: an option and a custom answer replace each other, as in Claude Code.
      // Multi-select keeps both. The editing surface owns its text and never replays state
      // (docs/forms.md), so clearing state alone would leave stale text on screen that
      // submit ignores; clear the surface explicitly.
      if (!multiSelect && otherTexts[qIndex]) {
        setOtherTexts((prev) => {
          const nextTexts = { ...prev };
          delete nextTexts[qIndex];
          return nextTexts;
        });
        otherInputRef.current?.replaceText("");
      }

      if (!multiSelect && next.size > 0 && qIndex === activeQuestionIndex && questions) {
        setActiveQuestionIndex(Math.min(qIndex + 1, questions.length - 1));
      }
    },
    [activeQuestionIndex, otherTexts, questions, selections],
  );

  const setOtherText = useCallback(
    (qIndex: number, text: string) => {
      setOtherTexts((prev) => ({ ...prev, [qIndex]: text }));
      const multiSelect = questions?.[qIndex]?.multiSelect ?? false;
      if (!multiSelect && text.length > 0) {
        setSelections((prev) => {
          if (!prev[qIndex] || prev[qIndex].size === 0) return prev;
          return { ...prev, [qIndex]: new Set<number>() };
        });
      }
    },
    [questions],
  );

  const allAnswered = areQuestionsAnswered(questions, selections, otherTexts);
  const resolvedActiveQuestionIndex = questions
    ? Math.min(activeQuestionIndex, questions.length - 1)
    : 0;
  const activeQuestion = questions?.[resolvedActiveQuestionIndex];
  const activeQuestionAnswered = activeQuestion
    ? isQuestionAnswered(activeQuestion, resolvedActiveQuestionIndex, selections, otherTexts)
    : false;
  // An MCP elicitation is a form, not a conversation: show every field at once
  // and submit once, the way the IDE renders it.
  const isForm =
    isElicitationInput(permission.request.input) ||
    (questions?.some((question) => question.type === "boolean" || question.type === "link") ??
      false);
  const isLastQuestion =
    isForm || (questions ? resolvedActiveQuestionIndex === questions.length - 1 : true);

  const handleSubmit = useCallback(() => {
    if (!questions || !allAnswered || isResponding) return;
    setRespondingAction("submit");
    onRespond({
      behavior: "allow",
      updatedInput: {
        ...permission.request.input,
        answers: buildQuestionFormAnswers(questions, selections, otherTexts),
      },
    });
  }, [
    questions,
    allAnswered,
    isResponding,
    selections,
    otherTexts,
    onRespond,
    permission.request.input,
  ]);

  const handleDeny = useCallback(() => {
    if (!questions || isResponding) return;
    setRespondingAction("dismiss");
    if (shouldSubmitEmptyOnDismiss(questions)) {
      onRespond({
        behavior: "allow",
        updatedInput: {
          ...permission.request.input,
          answers: buildQuestionFormAnswers(questions, selections, otherTexts),
        },
      });
      return;
    }
    onRespond({
      behavior: "deny",
      message: "Dismissed by user",
    });
  }, [questions, isResponding, onRespond, otherTexts, permission.request.input, selections]);

  const handleSelectQuestion = useCallback((index: number) => {
    setActiveQuestionIndex(index);
  }, []);

  const navIsAnswered = useCallback(
    (qIndex: number) =>
      questions ? isQuestionAnswered(questions[qIndex], qIndex, selections, otherTexts) : false,
    [questions, selections, otherTexts],
  );

  const handlePrimaryAction = useCallback(() => {
    if (!isLastQuestion) {
      if (!activeQuestionAnswered || isResponding) return;
      setActiveQuestionIndex((index) => Math.min(index + 1, (questions?.length ?? 1) - 1));
      return;
    }
    handleSubmit();
  }, [activeQuestionAnswered, handleSubmit, isLastQuestion, isResponding, questions?.length]);

  const pendingAction = isResponding ? respondingAction : null;
  const primaryDisabled = isResponding || (isLastQuestion ? !allAnswered : !activeQuestionAnswered);
  const primaryActionLabel = isLastQuestion
    ? t("message.question.submit")
    : t("message.question.next");

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
      },
    ],
    [theme.colors.surface1, theme.colors.border],
  );
  // Single-select radios need a group; checkboxes are valid standalone.
  const optionsGroupAccessibility = useMemo(
    () =>
      activeQuestion && !activeQuestion.multiSelect
        ? ({
            accessibilityRole: "radiogroup",
            accessibilityLabel: activeQuestion.question,
          } as const)
        : {},
    [activeQuestion],
  );

  if (!questions) {
    return null;
  }

  const dismissLabel = resolveDismissLabel(questions, t("common.actions.dismiss"));
  const selected = selections[resolvedActiveQuestionIndex] ?? new Set<number>();
  const otherText = otherTexts[resolvedActiveQuestionIndex] ?? "";

  return (
    <View style={containerStyle} testID="question-form-card">
      <View style={styles.questionContent}>
        <QuestionFormMessage
          title={permission.request.title}
          message={permission.request.description}
        />
        {isForm ? null : (
          <QuestionNav
            questions={questions}
            activeIndex={resolvedActiveQuestionIndex}
            isAnswered={navIsAnswered}
            isResponding={isResponding}
            onSelect={handleSelectQuestion}
          />
        )}
        {isForm ? (
          questions.map((question, qIndex) => (
            <QuestionField
              key={question.header}
              question={question}
              qIndex={qIndex}
              selected={selections[qIndex] ?? new Set<number>()}
              otherText={otherTexts[qIndex] ?? ""}
              isResponding={isResponding}
              inputRef={otherInputRef}
              groupProps={NO_GROUP_PROPS}
              answerPlaceholder={t("message.question.answerPlaceholder")}
              otherPlaceholder={t("message.question.otherPlaceholder")}
              onToggle={toggleOption}
              onChangeOther={setOtherText}
              onSubmit={handlePrimaryAction}
            />
          ))
        ) : (
          <QuestionField
            question={activeQuestion}
            qIndex={resolvedActiveQuestionIndex}
            selected={selected}
            otherText={otherText}
            isResponding={isResponding}
            inputRef={otherInputRef}
            groupProps={optionsGroupAccessibility}
            answerPlaceholder={t("message.question.answerPlaceholder")}
            otherPlaceholder={t("message.question.otherPlaceholder")}
            onToggle={toggleOption}
            onChangeOther={setOtherText}
            onSubmit={handlePrimaryAction}
          />
        )}
      </View>

      {responseError ? <Alert variant="error" description={responseError} size="sm" /> : null}

      <QuestionFormActions
        isResponding={isResponding}
        pendingAction={pendingAction}
        primaryDisabled={primaryDisabled}
        primaryLabel={primaryActionLabel}
        dismissLabel={dismissLabel}
        onDismiss={handleDeny}
        onPrimary={handlePrimaryAction}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    gap: theme.spacing[3],
  },
  questionContent: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  messageBlock: {
    gap: theme.spacing[1],
  },
  messageTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  questionText: {
    flex: 1,
  },
  optionsWrap: {
    gap: theme.spacing[1],
  },
  questionNav: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  questionNavButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
  },
  questionNavText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionItemPressed: {
    opacity: 0.9,
  },
  optionItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  optionTextBlock: {
    flex: 1,
    gap: theme.spacing[1],
  },
  optionPreviewText: {
    lineHeight: 20,
    ...(isWeb ? { whiteSpace: "pre-wrap", overflowWrap: "break-word" } : null),
  },
  selectionControl: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    marginTop: 2, // optical-align 18px control to the 22px label first line
  },
  selectionControlCheckbox: {
    borderRadius: theme.borderRadius.base,
  },
  selectionControlRadio: {
    borderRadius: 999,
  },
  selectionRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  otherInput: {
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    fontSize: theme.fontSize.base,
  },
  actionsContainer: {
    gap: theme.spacing[2],
  },
  actionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.fontSize.base,
  },
}));
