import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  DetectedMcpServer,
  McpCatalogImportTarget,
  McpServerConfig,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { settingsStyles } from "@/styles/settings";
import { McpImportSheet, serverId } from "./mcp-import-sheet";
import { McpPresetPicker } from "./mcp-preset-picker";
import { McpServerForm } from "./mcp-server-form";
import {
  draftFromPresetVariant,
  fromMcpServerConfig,
  type McpServerDraft,
} from "../internal/mcp-server-form-model";
import type {
  McpServerPreset,
  McpServerPresetVariant,
  PresetField,
} from "../internal/mcp-server-presets";

type WizardStep = "source" | "presets" | "variant" | "import" | "form";

interface McpServerWizardProps {
  visible: boolean;
  mode: "create" | "edit";
  editName?: string;
  editConfig?: McpServerConfig;
  takenNames?: readonly string[];
  isCatalogSupported: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (
    config: McpServerConfig,
    draft: McpServerDraft,
    mode: "create" | "edit",
    editName?: string,
  ) => Promise<void>;
  onScan: () => Promise<{ servers: DetectedMcpServer[]; errors: string[] }>;
  onImport: (
    entries: McpCatalogImportTarget[],
  ) => Promise<{ imported: string[]; skipped: string[]; errors: string[] }>;
  onTest: (config: McpServerConfig) => Promise<{
    ok: boolean;
    tools: string[];
    error: string | null;
  }>;
}

export function McpServerWizard({
  visible,
  mode,
  editName,
  editConfig,
  takenNames = [],
  isCatalogSupported,
  isSaving,
  onClose,
  onSubmit,
  onScan,
  onImport,
  onTest,
}: McpServerWizardProps): ReactElement {
  const { t } = useTranslation();
  const [step, setStep] = useState<WizardStep>(mode === "edit" ? "form" : "source");
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<McpServerPreset | null>(null);
  const [draft, setDraft] = useState<McpServerDraft>(() =>
    initialDraft(mode, editName, editConfig),
  );
  const [fields, setFields] = useState<readonly PresetField[]>([]);
  const [presetNotes, setPresetNotes] = useState<string | null>(null);
  const [scan, setScan] = useState<{ servers: DetectedMcpServer[]; errors: string[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setStep(mode === "edit" ? "form" : "source");
    setQuery("");
    setPreset(null);
    setDraft(initialDraft(mode, editName, editConfig));
    setFields([]);
    setPresetNotes(null);
    setScan(null);
    setSelectedImports(new Set());
    setImportErrors([]);
  }, [visible, mode, editName, editConfig]);

  useEffect(() => {
    if (!visible || step !== "import" || scan || scanning) return;
    setScanning(true);
    void onScan()
      .then((result) => setScan(result))
      .catch((error) => setScan({ servers: [], errors: [toMessage(error)] }))
      .finally(() => setScanning(false));
  }, [onScan, scan, scanning, step, visible]);

  const startPreset = useCallback(
    (selectedPreset: McpServerPreset, variant: McpServerPresetVariant) => {
      const presetFields = variant.fields ?? [];
      const oauthNote =
        variant.auth === "oauth" && presetFields.length === 0
          ? t("settings.host.mcp.presets.oauthNote")
          : null;
      setDraft(draftFromPresetVariant(selectedPreset.id, variant, presetFields));
      setFields(presetFields);
      setPresetNotes(variant.notes ?? oauthNote);
      setStep("form");
    },
    [t],
  );

  const handleSelectPreset = useCallback(
    (selectedPreset: McpServerPreset) => {
      if (selectedPreset.variants.length === 1) {
        startPreset(selectedPreset, selectedPreset.variants[0]!);
        return;
      }
      setPreset(selectedPreset);
      setStep("variant");
    },
    [startPreset],
  );

  const handleToggleImport = useCallback((server: DetectedMcpServer) => {
    setSelectedImports((current) => {
      const next = new Set(current);
      const id = serverId(server);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!scan) return;
    const entries = scan.servers
      .filter((server) => selectedImports.has(serverId(server)))
      .map((server) => ({
        source: server.source,
        name: server.name,
        sourcePath: server.sourcePath,
      }));
    if (entries.length === 0) return;
    setImporting(true);
    setImportErrors([]);
    try {
      const result = await onImport(entries);
      if (result.imported.length > 0) {
        const importedIds = new Set(
          scan.servers
            .filter((server) => result.imported.includes(server.name))
            .map((server) => serverId(server)),
        );
        setScan({
          ...scan,
          servers: scan.servers.map((server) =>
            importedIds.has(serverId(server)) ? { ...server, alreadyConfigured: true } : server,
          ),
        });
        setSelectedImports(new Set());
      }
      const skippedMessage =
        result.skipped.length > 0
          ? t("settings.host.mcp.import.skipped", { names: result.skipped.join(", ") })
          : null;
      if (result.errors.length > 0 || skippedMessage) {
        setImportErrors([...result.errors, ...(skippedMessage ? [skippedMessage] : [])]);
      } else {
        onClose();
      }
    } catch (error) {
      setImportErrors([toMessage(error)]);
    } finally {
      setImporting(false);
    }
  }, [onClose, onImport, scan, selectedImports, t]);

  const handleManual = useCallback(() => {
    setDraft(initialDraft("create"));
    setFields([]);
    setPresetNotes(null);
    setStep("form");
  }, []);

  const handleBack = useCallback(() => {
    setStep("source");
    setPreset(null);
  }, []);

  const handleOpenPresets = useCallback(() => setStep("presets"), []);
  const handleOpenImportStep = useCallback(() => setStep("import"), []);
  const handleImportPress = useCallback(() => {
    void handleImport();
  }, [handleImport]);
  const handleFormSave = useCallback(
    async (config: McpServerConfig, savedDraft: McpServerDraft) => {
      await onSubmit(config, savedDraft, mode, editName);
    },
    [editName, mode, onSubmit],
  );

  const header = useMemo(() => {
    if (step === "form") {
      return {
        title:
          mode === "edit"
            ? t("settings.host.mcp.form.editTitle")
            : t("settings.host.mcp.form.createTitle"),
      };
    }
    if (step === "presets") return { title: t("settings.host.mcp.presets.title") };
    if (step === "variant") return { title: t("settings.host.mcp.presets.chooseConnection") };
    if (step === "import") return { title: t("settings.host.mcp.import.title") };
    return { title: t("settings.host.mcp.wizard.title") };
  }, [mode, step, t]);

  return (
    <AdaptiveModalSheet visible={visible} onClose={onClose} header={header}>
      <View style={styles.container}>
        {step === "source" ? (
          <View style={styles.sourceList}>
            <Text style={styles.hint}>{t("settings.host.mcp.wizard.description")}</Text>
            <WizardSourceRow
              title={t("settings.host.mcp.wizard.presetsTitle")}
              description={t("settings.host.mcp.wizard.presetsDescription")}
              onPress={handleOpenPresets}
            />
            {isCatalogSupported ? (
              <WizardSourceRow
                title={t("settings.host.mcp.wizard.importTitle")}
                description={t("settings.host.mcp.wizard.importDescription")}
                onPress={handleOpenImportStep}
              />
            ) : null}
            <WizardSourceRow
              title={t("settings.host.mcp.wizard.manualTitle")}
              description={t("settings.host.mcp.wizard.manualDescription")}
              onPress={handleManual}
            />
          </View>
        ) : null}

        {step === "presets" ? (
          <View style={styles.step}>
            <McpPresetPicker query={query} onQueryChange={setQuery} onSelect={handleSelectPreset} />
            <Button variant="ghost" onPress={handleBack}>
              {t("common.actions.back")}
            </Button>
          </View>
        ) : null}

        {step === "variant" && preset ? (
          <View style={styles.step}>
            <Text style={styles.hint}>{preset.description}</Text>
            <View style={settingsStyles.card}>
              {preset.variants.map((variant, index) => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  preset={preset}
                  isFirst={index === 0}
                  onSelect={startPreset}
                />
              ))}
            </View>
            <Button variant="ghost" onPress={handleOpenPresets}>
              {t("common.actions.back")}
            </Button>
          </View>
        ) : null}

        {step === "import" ? (
          <View style={styles.step}>
            {scanning || !scan ? (
              <Text style={styles.hint}>{t("settings.host.mcp.import.scanning")}</Text>
            ) : (
              <>
                <McpImportSheet
                  servers={scan.servers}
                  errors={[...scan.errors, ...importErrors]}
                  selected={selectedImports}
                  isImporting={importing}
                  onToggle={handleToggleImport}
                  onImport={handleImportPress}
                />
                <Button variant="ghost" onPress={handleBack}>
                  {t("common.actions.back")}
                </Button>
              </>
            )}
          </View>
        ) : null}

        {step === "form" ? (
          <McpServerForm
            key={`${mode}:${editName ?? ""}:${fields.length}:${presetNotes ?? ""}`}
            initialDraft={draft}
            presetFields={fields}
            presetNotes={presetNotes}
            takenNames={takenNames}
            canTest={isCatalogSupported}
            isSaving={isSaving}
            onCancel={onClose}
            onTest={onTest}
            onSave={handleFormSave}
          />
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function WizardSourceRow({
  title,
  description,
  onPress,
}: {
  title: string;
  description: string;
  onPress: () => void;
}): ReactElement {
  return (
    <PressHighlight
      onPress={onPress}
      style={[settingsStyles.card, styles.sourceRow]}
      highlightStyle={styles.rowHighlight}
    >
      <Text style={styles.sourceTitle}>{title}</Text>
      <Text style={styles.hint}>{description}</Text>
    </PressHighlight>
  );
}

function VariantRow({
  variant,
  preset,
  isFirst,
  onSelect,
}: {
  variant: McpServerPresetVariant;
  preset: McpServerPreset;
  isFirst: boolean;
  onSelect: (preset: McpServerPreset, variant: McpServerPresetVariant) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onSelect(preset, variant), [onSelect, preset, variant]);
  return (
    <PressHighlight
      onPress={handleSelect}
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
      highlightStyle={styles.rowHighlight}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{variant.label}</Text>
        {variant.notes ? (
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {variant.notes}
          </Text>
        ) : null}
      </View>
      <Text style={styles.auth}>{t(`settings.host.mcp.presets.auth.${variant.auth}`)}</Text>
    </PressHighlight>
  );
}

function initialDraft(
  mode: "create" | "edit",
  editName?: string,
  editConfig?: McpServerConfig,
): McpServerDraft {
  if (mode === "edit" && editConfig) {
    return { ...fromMcpServerConfig(editConfig), name: editName ?? "" };
  }
  return {
    name: "",
    type: "stdio",
    command: "",
    args: [],
    env: [],
    cwd: "",
    url: "",
    headers: [],
    alwaysLoad: false,
    variables: {},
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[4],
  },
  step: {
    gap: theme.spacing[3],
  },
  sourceList: {
    gap: theme.spacing[3],
  },
  sourceRow: {
    padding: theme.spacing[4],
    gap: theme.spacing[1],
  },
  sourceTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowHighlight: {
    backgroundColor: theme.colors.surface3,
  },
  auth: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
}));
