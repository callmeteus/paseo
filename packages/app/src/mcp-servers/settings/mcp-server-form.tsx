import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { McpServerConfig } from "@getpaseo/protocol/messages";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { PresetField } from "../internal/mcp-server-presets";
import {
  createKeyValueEntry,
  parseArgs,
  toMcpServerConfig,
  type KeyValueEntry,
  type McpServerDraft,
  type ValidationError,
} from "../internal/mcp-server-form-model";

const ThemedPlus = withUnistyles(Plus);
const ThemedTrash = withUnistyles(Trash2);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

const TRANSPORT_OPTIONS = [
  { value: "stdio", label: "stdio" },
  { value: "http", label: "HTTP" },
  { value: "sse", label: "SSE" },
] as const;

interface McpServerFormProps {
  initialDraft: McpServerDraft;
  presetFields?: readonly PresetField[];
  presetNotes?: string | null;
  takenNames?: readonly string[];
  canTest: boolean;
  isSaving: boolean;
  onSave: (config: McpServerConfig, draft: McpServerDraft) => Promise<void>;
  onCancel: () => void;
  onTest: (config: McpServerConfig) => Promise<{
    ok: boolean;
    tools: string[];
    error: string | null;
  }>;
}

function errorLabel(
  error: ValidationError,
  fields: readonly PresetField[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (error.code === "fieldRequired") {
    return fields.find((field) => field.key === error.field)?.label ?? error.field;
  }
  return t(`settings.host.mcp.form.errors.${error.code}`);
}

export function McpServerForm({
  initialDraft,
  presetFields = [],
  presetNotes,
  takenNames = [],
  canTest,
  isSaving,
  onSave,
  onCancel,
  onTest,
}: McpServerFormProps): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [testState, setTestState] = useState<
    | { status: "idle" }
    | { status: "testing" }
    | { status: "ok"; tools: string[] }
    | { status: "error"; error: string }
  >({ status: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const update = useCallback((patch: Partial<McpServerDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors([]);
    setTestState({ status: "idle" });
  }, []);

  const updatePresetVariable = useCallback((key: string, value: string) => {
    setDraft((current) => ({
      ...current,
      variables: { ...current.variables, [key]: value },
    }));
    setErrors([]);
    setTestState({ status: "idle" });
  }, []);

  const handleNameChange = useCallback((value: string) => update({ name: value }), [update]);
  const handleTransportChange = useCallback(
    (value: McpServerDraft["type"]) => update({ type: value }),
    [update],
  );
  const handleCommandChange = useCallback((value: string) => update({ command: value }), [update]);
  const handleArgsChange = useCallback(
    (value: string) => update({ args: parseArgs(value) }),
    [update],
  );
  const handleEnvChange = useCallback((env: KeyValueEntry[]) => update({ env }), [update]);
  const handleCwdChange = useCallback((value: string) => update({ cwd: value }), [update]);
  const handleUrlChange = useCallback((value: string) => update({ url: value }), [update]);
  const handleHeadersChange = useCallback(
    (headers: KeyValueEntry[]) => update({ headers }),
    [update],
  );
  const handleAlwaysLoadChange = useCallback(
    (value: boolean) => update({ alwaysLoad: value }),
    [update],
  );

  const handleTest = useCallback(async () => {
    const result = toMcpServerConfig(draft, presetFields, takenNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setTestState({ status: "testing" });
    try {
      const tested = await onTest(result.config);
      setTestState(
        tested.ok
          ? { status: "ok", tools: tested.tools }
          : { status: "error", error: tested.error ?? t("settings.host.mcp.form.testFailed") },
      );
    } catch (error) {
      setTestState({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [draft, onTest, presetFields, t, takenNames]);

  const handleSave = useCallback(async () => {
    const result = toMcpServerConfig(draft, presetFields, takenNames);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    await onSave(result.config, draft);
  }, [draft, onSave, presetFields, takenNames]);

  const handleTestPress = useCallback(() => {
    void handleTest();
  }, [handleTest]);
  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);
  const handleToggleAdvanced = useCallback(() => setShowAdvanced((value) => !value), []);
  const handleToggleJson = useCallback(() => setShowJson((value) => !value), []);

  const json = useMemo(() => {
    const result = toMcpServerConfig(draft, presetFields, takenNames);
    return result.ok ? JSON.stringify(result.config, null, 2) : "";
  }, [draft, presetFields, takenNames]);

  return (
    <View style={styles.container}>
      <Field label={t("settings.host.mcp.form.name")}>
        <FormTextInput
          initialValue={draft.name}
          onChangeText={handleNameChange}
          placeholder={t("settings.host.mcp.form.namePlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <Field label={t("settings.host.mcp.form.transport")}>
        <SegmentedControl
          options={[...TRANSPORT_OPTIONS]}
          value={draft.type}
          onValueChange={handleTransportChange}
        />
      </Field>

      {presetFields.length > 0 ? (
        <View style={styles.presetFields}>
          <Text style={styles.presetHint}>{t("settings.host.mcp.form.presetFieldsHint")}</Text>
          {presetFields.map((field) => (
            <Field key={field.key} label={field.label}>
              <PresetFieldInput
                field={field}
                value={draft.variables[field.key] ?? ""}
                onChange={updatePresetVariable}
              />
            </Field>
          ))}
          {presetNotes ? <Text style={styles.note}>{presetNotes}</Text> : null}
        </View>
      ) : null}

      {draft.type === "stdio" ? (
        <>
          <Field label={t("settings.host.mcp.form.command")}>
            <FormTextInput
              initialValue={draft.command}
              onChangeText={handleCommandChange}
              placeholder={t("settings.host.mcp.form.commandPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={t("settings.host.mcp.form.args")}>
            <FormTextInput
              initialValue={draft.args.join(" ")}
              onChangeText={handleArgsChange}
              placeholder={t("settings.host.mcp.form.argsPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={t("settings.host.mcp.form.env")}>
            <McpKeyValueEditor
              entries={draft.env}
              onChange={handleEnvChange}
              keyPlaceholder="ENV_NAME"
              valuePlaceholder={t("settings.host.mcp.form.valuePlaceholder")}
              addLabel={t("settings.host.mcp.form.addEnv")}
            />
          </Field>
          <Field label={t("settings.host.mcp.form.cwd")}>
            <FormTextInput
              initialValue={draft.cwd}
              onChangeText={handleCwdChange}
              placeholder={t("settings.host.mcp.form.cwdPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("settings.host.mcp.form.url")}>
            <FormTextInput
              initialValue={draft.url}
              onChangeText={handleUrlChange}
              placeholder={t("settings.host.mcp.form.urlPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label={t("settings.host.mcp.form.headers")}>
            <McpKeyValueEditor
              entries={draft.headers}
              onChange={handleHeadersChange}
              keyPlaceholder="Header"
              valuePlaceholder={t("settings.host.mcp.form.valuePlaceholder")}
              addLabel={t("settings.host.mcp.form.addHeader")}
              secretValues
            />
          </Field>
        </>
      )}

      <View style={styles.advancedRow}>
        <Text style={styles.advancedLabel}>{t("settings.host.mcp.form.alwaysLoad")}</Text>
        <Switch
          value={draft.alwaysLoad}
          onValueChange={handleAlwaysLoadChange}
          accessibilityLabel={t("settings.host.mcp.form.alwaysLoad")}
        />
      </View>

      <Button variant="ghost" size="sm" onPress={handleToggleAdvanced}>
        {t("settings.host.mcp.form.advanced")}
      </Button>
      {showAdvanced ? (
        <View style={styles.advancedPanel}>
          <Button variant="ghost" size="sm" onPress={handleToggleJson}>
            {showJson ? t("settings.host.mcp.form.hideJson") : t("settings.host.mcp.form.showJson")}
          </Button>
          {showJson ? (
            <FormTextInput initialValue={json} editable={false} multiline style={styles.json} />
          ) : null}
        </View>
      ) : null}

      {errors.length > 0 ? (
        <Text style={styles.error}>
          {t("settings.host.mcp.form.validationError", {
            fields: errors.map((error) => errorLabel(error, presetFields, t)).join(", "),
          })}
        </Text>
      ) : null}
      {testState.status === "testing" ? (
        <Text style={styles.note}>{t("settings.host.mcp.form.testing")}</Text>
      ) : null}
      {testState.status === "ok" ? (
        <Text style={styles.success}>
          {t("settings.host.mcp.form.testOk", { count: testState.tools.length })}
        </Text>
      ) : null}
      {testState.status === "error" ? <Text style={styles.error}>{testState.error}</Text> : null}

      <View style={styles.actions}>
        <Button variant="ghost" onPress={onCancel}>
          {t("common.actions.cancel")}
        </Button>
        {canTest ? (
          <Button variant="secondary" onPress={handleTestPress} disabled={isSaving}>
            {t("settings.host.mcp.form.test")}
          </Button>
        ) : null}
        <Button onPress={handleSavePress} disabled={isSaving}>
          {isSaving ? t("settings.host.mcp.form.saving") : t("settings.host.mcp.form.save")}
        </Button>
      </View>
    </View>
  );
}

interface McpKeyValueEditorProps {
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  secretValues?: boolean;
}

function PresetFieldInput({
  field,
  value,
  onChange,
}: {
  field: PresetField;
  value: string;
  onChange: (key: string, value: string) => void;
}): ReactElement {
  const handleChange = useCallback(
    (next: string) => onChange(field.key, next),
    [field.key, onChange],
  );
  const handleBooleanChange = useCallback(
    (next: boolean) => handleChange(next ? "true" : ""),
    [handleChange],
  );
  if (field.kind === "boolean") {
    return (
      <Switch
        value={value === "true"}
        onValueChange={handleBooleanChange}
        accessibilityLabel={field.label}
      />
    );
  }
  return (
    <FormTextInput
      initialValue={value}
      onChangeText={handleChange}
      placeholder={field.placeholder}
      secureTextEntry={field.secret}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

function McpKeyValueEditor({
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  secretValues = false,
}: McpKeyValueEditorProps): ReactElement {
  const { t } = useTranslation();
  const handleAdd = useCallback(() => {
    onChange([...entries, createKeyValueEntry()]);
  }, [entries, onChange]);
  const handleChange = useCallback(
    (index: number, next: KeyValueEntry) => {
      onChange(entries.map((entry, entryIndex) => (entryIndex === index ? next : entry)));
    },
    [entries, onChange],
  );
  const handleRemove = useCallback(
    (index: number) => {
      onChange(entries.filter((_, entryIndex) => entryIndex !== index));
    },
    [entries, onChange],
  );

  return (
    <View style={styles.kvEditor}>
      {entries.map((entry, index) => (
        <KeyValueRow
          key={entry.id}
          index={index}
          entry={entry}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder={valuePlaceholder}
          secret={secretValues}
          onChange={handleChange}
          onRemove={handleRemove}
        />
      ))}
      <Button size="sm" variant="ghost" leftIcon={addIcon} onPress={handleAdd}>
        {addLabel}
      </Button>
      {entries.length === 0 ? (
        <Text style={styles.note}>{t("settings.host.mcp.form.noEntries")}</Text>
      ) : null}
    </View>
  );
}

function KeyValueRow({
  index,
  entry,
  keyPlaceholder,
  valuePlaceholder,
  secret,
  onChange,
  onRemove,
}: {
  index: number;
  entry: KeyValueEntry;
  keyPlaceholder: string;
  valuePlaceholder: string;
  secret: boolean;
  onChange: (index: number, next: KeyValueEntry) => void;
  onRemove: (index: number) => void;
}): ReactElement {
  const handleKey = useCallback(
    (key: string) => onChange(index, { ...entry, key }),
    [entry, index, onChange],
  );
  const handleValue = useCallback(
    (value: string) => onChange(index, { ...entry, value }),
    [entry, index, onChange],
  );
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <View style={styles.kvRow}>
      <View style={styles.kvKey}>
        <FormTextInput
          initialValue={entry.key}
          onChangeText={handleKey}
          placeholder={keyPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <View style={styles.kvValue}>
        <FormTextInput
          initialValue={entry.value}
          onChangeText={handleValue}
          placeholder={valuePlaceholder}
          secureTextEntry={secret}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <Button size="sm" variant="ghost" onPress={handleRemove}>
        <ThemedTrash size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  presetFields: {
    gap: theme.spacing[2],
  },
  presetHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  note: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  success: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  advancedLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  advancedPanel: {
    gap: theme.spacing[2],
  },
  json: {
    minHeight: 160,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  kvEditor: {
    gap: theme.spacing[2],
  },
  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  kvKey: {
    flex: 1,
  },
  kvValue: {
    flex: 1.4,
  },
}));
