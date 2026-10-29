import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  ModelRouter,
  ModelRouterMode,
  ModelRouterTarget,
} from "@getpaseo/protocol/model-router";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import { FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { buildRouterPresets, buildRouterSummary, type RouterPreset } from "@/model-routers/presets";
import { settingsStyles } from "@/styles/settings";

interface DraftTarget {
  key: string;
  provider: string;
  model: string | null;
}

interface RouterDraft {
  id: string | null;
  name: string;
  mode: ModelRouterMode;
  targets: DraftTarget[];
}

type WizardStep = "choose" | "manual" | null;

function newKey(): string {
  return `target-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyDraft(): RouterDraft {
  return { id: null, name: "", mode: "fallback", targets: [] };
}

function newRouterId(): string {
  return `router-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RouterRowProps {
  router: ModelRouter;
  isDefault: boolean;
  disabled: boolean;
  onSetDefault: (routerId: string) => void;
  onEdit: (router: ModelRouter) => void;
  onDelete: (routerId: string) => void;
}

function RouterRow({
  router,
  isDefault,
  disabled,
  onSetDefault,
  onEdit,
  onDelete,
}: RouterRowProps) {
  const { t } = useTranslation();
  const handleSetDefault = useCallback(() => onSetDefault(router.id), [onSetDefault, router.id]);
  const handleEdit = useCallback(() => onEdit(router), [onEdit, router]);
  const handleDelete = useCallback(() => onDelete(router.id), [onDelete, router.id]);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {router.name}
          {isDefault ? ` · ${t("settings.modelRouters.defaultBadge")}` : ""}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {router.mode === "fallback"
            ? t("settings.modelRouters.modeFallback")
            : t("settings.modelRouters.modeDistribution")}
          {" · "}
          {router.summary ?? buildRouterSummary(router.targets)}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button variant="outline" size="sm" onPress={handleSetDefault} disabled={disabled}>
          {isDefault
            ? t("settings.modelRouters.unsetDefault")
            : t("settings.modelRouters.setDefault")}
        </Button>
        <Button variant="outline" size="sm" onPress={handleEdit} disabled={disabled}>
          {t("settings.modelRouters.edit")}
        </Button>
        <Button variant="destructive" size="sm" onPress={handleDelete} disabled={disabled}>
          {t("settings.modelRouters.delete")}
        </Button>
      </View>
    </View>
  );
}

function presetNameKey(preset: RouterPreset): string {
  return `settings.modelRouters.presets.${preset.id}.name`;
}

function presetSummaryKey(preset: RouterPreset): string {
  return `settings.modelRouters.presets.${preset.id}.summary`;
}

interface PresetRowProps {
  preset: RouterPreset;
  disabled: boolean;
  onApply: (preset: RouterPreset) => void;
}

function PresetRow({ preset, disabled, onApply }: PresetRowProps) {
  const { t } = useTranslation();
  const handleApply = useCallback(() => onApply(preset), [onApply, preset]);
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t(presetNameKey(preset))}</Text>
        <Text style={settingsStyles.rowHint}>{t(presetSummaryKey(preset))}</Text>
        <Text style={styles.meta}>
          {t("settings.modelRouters.targetCount", { count: preset.targets.length })}
        </Text>
      </View>
      <Button size="sm" onPress={handleApply} disabled={disabled}>
        {t("settings.modelRouters.usePreset")}
      </Button>
    </View>
  );
}

interface DraftTargetRowProps {
  target: DraftTarget;
  index: number;
  serverId: string;
  providers: ProviderSelectorProvider[];
  isLoading: boolean;
  disabled: boolean;
  onSelect: (index: number, provider: string, model: string) => void;
  onRemove: (index: number) => void;
}

function DraftTargetRow({
  target,
  index,
  serverId,
  providers,
  isLoading,
  disabled,
  onSelect,
  onRemove,
}: DraftTargetRowProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    (provider: string, model: string) => onSelect(index, provider, model),
    [index, onSelect],
  );
  const handleRemove = useCallback(() => onRemove(index), [index, onRemove]);
  return (
    <View style={styles.targetRow}>
      <View style={styles.targetSelector}>
        <CombinedModelSelector
          providers={providers}
          selectedProvider={target.provider}
          selectedModel={target.model ?? ""}
          onSelect={handleSelect}
          isLoading={isLoading}
          disabled={disabled}
          serverId={serverId}
          desktopPlacement="bottom-start"
          desktopMinWidth={360}
        />
      </View>
      <Button variant="destructive" size="sm" onPress={handleRemove}>
        {t("settings.modelRouters.removeTarget")}
      </Button>
    </View>
  );
}

export function ModelRoutersCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const presets = useMemo(() => buildRouterPresets(snapshot.entries ?? []), [snapshot.entries]);
  const routers = useMemo(
    () => config?.modelRouters?.routers ?? [],
    [config?.modelRouters?.routers],
  );
  const defaultRouterId = config?.modelRouters?.defaultRouterId ?? null;
  const [wizard, setWizard] = useState<WizardStep>(null);
  const [draft, setDraft] = useState<RouterDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const saveRouters = useCallback(
    async (next: ModelRouter[], nextDefaultRouterId?: string | null) => {
      setIsSaving(true);
      try {
        await patchConfig({
          modelRouters: {
            routers: next,
            ...(nextDefaultRouterId !== undefined ? { defaultRouterId: nextDefaultRouterId } : {}),
          },
        });
        return true;
      } catch (error) {
        Alert.alert(
          t("settings.modelRouters.saveError"),
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t],
  );

  const handleStartCreate = useCallback(() => {
    setDraft(null);
    setWizard("choose");
  }, []);
  const handleStartManual = useCallback(() => {
    setDraft(emptyDraft());
    setWizard("manual");
  }, []);
  const handleStartEdit = useCallback((router: ModelRouter) => {
    setDraft({
      id: router.id,
      name: router.name,
      mode: router.mode,
      targets: router.targets.map((target) => ({
        key: newKey(),
        provider: target.provider,
        model: target.model ?? null,
      })),
    });
    setWizard("manual");
  }, []);
  const handleCancel = useCallback(() => {
    setDraft(null);
    setWizard(null);
  }, []);
  const handleAddTarget = useCallback(() => {
    setDraft((current) =>
      current
        ? {
            ...current,
            targets: [...current.targets, { key: newKey(), provider: "", model: null }],
          }
        : current,
    );
  }, []);
  const handleRemoveTarget = useCallback((index: number) => {
    setDraft((current) =>
      current ? { ...current, targets: current.targets.filter((_, i) => i !== index) } : current,
    );
  }, []);
  const handleTargetSelect = useCallback((index: number, provider: string, model: string) => {
    setDraft((current) => {
      if (!current) return current;
      const targets = current.targets.map((target, i) =>
        i === index ? { ...target, provider, model: model || null } : target,
      );
      return { ...current, targets };
    });
  }, []);
  const handleSaveDraft = useCallback(async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const targets = draft.targets
      .filter((target) => target.provider)
      .map(({ provider, model }): ModelRouterTarget => ({ provider, model }));
    if (!name || targets.length === 0) {
      Alert.alert(t("settings.modelRouters.invalidTitle"), t("settings.modelRouters.invalidBody"));
      return;
    }
    const router: ModelRouter = {
      id: draft.id ?? newRouterId(),
      name,
      mode: draft.mode,
      targets,
    };
    const next = draft.id
      ? routers.map((entry) => (entry.id === draft.id ? router : entry))
      : [...routers, router];
    const saved = await saveRouters(
      next,
      defaultRouterId === draft.id ? draft.id : defaultRouterId,
    );
    if (saved) {
      setDraft(null);
      setWizard(null);
    }
  }, [defaultRouterId, draft, routers, saveRouters, t]);
  const handleDelete = useCallback(
    async (routerId: string) => {
      const next = routers.filter((router) => router.id !== routerId);
      await saveRouters(next, defaultRouterId === routerId ? null : defaultRouterId);
    },
    [defaultRouterId, routers, saveRouters],
  );
  const handleSetDefault = useCallback(
    async (routerId: string) => {
      await saveRouters(routers, defaultRouterId === routerId ? null : routerId);
    },
    [defaultRouterId, routers, saveRouters],
  );
  const handleApplyPreset = useCallback(
    async (preset: RouterPreset) => {
      const router: ModelRouter = {
        id: newRouterId(),
        name: t(presetNameKey(preset)),
        summary: t(presetSummaryKey(preset)),
        mode: preset.mode,
        targets: preset.targets,
      };
      const saved = await saveRouters([...routers, router], defaultRouterId);
      if (saved) setWizard(null);
    },
    [defaultRouterId, routers, saveRouters, t],
  );

  const modeOptions = useMemo(
    () => [
      { value: "fallback" as const, label: t("settings.modelRouters.modeFallback") },
      { value: "distribution" as const, label: t("settings.modelRouters.modeDistribution") },
    ],
    [t],
  );
  const handleModeChange = useCallback((mode: ModelRouterMode) => {
    setDraft((current) => (current ? { ...current, mode } : current));
  }, []);
  const handleNameChange = useCallback((name: string) => {
    setDraft((current) => (current ? { ...current, name } : current));
  }, []);

  if (isLoading || !config) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <SettingsSection
      title={t("settings.modelRouters.title")}
      info={t("settings.modelRouters.description")}
      testID="model-routers-settings"
    >
      <View style={settingsStyles.card}>
        {routers.length === 0 && wizard === null ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.modelRouters.empty")}</Text>
          </View>
        ) : null}
        {routers.map((router) => (
          <RouterRow
            key={router.id}
            router={router}
            isDefault={router.id === defaultRouterId}
            disabled={isSaving}
            onSetDefault={handleSetDefault}
            onEdit={handleStartEdit}
            onDelete={handleDelete}
          />
        ))}

        {wizard === "choose" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.wizard]}>
            <Text style={settingsStyles.rowTitle}>{t("settings.modelRouters.wizard.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.modelRouters.wizard.choose")}</Text>
            {presets.map((preset) => (
              <PresetRow
                key={preset.id}
                preset={preset}
                disabled={isSaving}
                onApply={handleApplyPreset}
              />
            ))}
            <View style={styles.manualRow}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.modelRouters.wizard.manual")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.modelRouters.wizard.manualHint")}
                </Text>
              </View>
              <Button variant="outline" size="sm" onPress={handleStartManual}>
                {t("settings.modelRouters.wizard.startManual")}
              </Button>
            </View>
            <View style={styles.actions}>
              <Button variant="outline" size="sm" onPress={handleCancel}>
                {t("settings.modelRouters.cancel")}
              </Button>
            </View>
          </View>
        ) : null}

        {wizard === "manual" && draft ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.draft]}>
            <FormTextInput
              key={draft.id ?? "new-router"}
              initialValue={draft.name}
              onChangeText={handleNameChange}
              placeholder={t("settings.modelRouters.namePlaceholder")}
              autoFocus
            />
            <View style={styles.draftMode}>
              <SegmentedControl
                options={modeOptions}
                value={draft.mode}
                onValueChange={handleModeChange}
                size="sm"
              />
            </View>
            {draft.targets.map((target, index) => (
              <DraftTargetRow
                key={target.key}
                target={target}
                index={index}
                serverId={serverId}
                providers={providers}
                isLoading={snapshot.isLoading || snapshot.isFetching}
                disabled={isSaving}
                onSelect={handleTargetSelect}
                onRemove={handleRemoveTarget}
              />
            ))}
            <View style={styles.actions}>
              <Button variant="outline" size="sm" onPress={handleAddTarget}>
                {t("settings.modelRouters.addTarget")}
              </Button>
              <Button variant="outline" size="sm" onPress={handleCancel}>
                {t("settings.modelRouters.cancel")}
              </Button>
              <Button size="sm" onPress={handleSaveDraft} disabled={isSaving}>
                {t("settings.modelRouters.save")}
              </Button>
            </View>
          </View>
        ) : null}

        {wizard === null ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.footer]}>
            <Button size="sm" onPress={handleStartCreate} disabled={isSaving}>
              {t("settings.modelRouters.create")}
            </Button>
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  footer: {
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  wizard: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  draft: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
  draftMode: {
    alignSelf: "flex-start",
  },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  targetSelector: {
    flex: 1,
  },
}));
