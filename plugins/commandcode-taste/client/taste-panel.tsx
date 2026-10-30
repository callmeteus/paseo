import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import {
  useRpc,
  useSettings,
  useWorkspace,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import {
  Markdown,
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { listTasteRpc, previewTasteRpc, type TasteFile } from "../shared/rpc.js";
import { tastePreferences } from "../shared/settings.js";

type PreferencePatch = Partial<{
  applyToOtherProviders: boolean;
  includeGlobal: boolean;
  maxChars: number;
}>;

interface PanelStyles {
  screen: ViewStyle;
  content: ViewStyle;
  header: ViewStyle;
  title: TextStyle;
  muted: TextStyle;
  paddedHint: TextStyle;
  error: TextStyle;
}

const SIZE_OPTIONS: readonly { label: string; value: string }[] = [
  { label: "16k", value: "16000" },
  { label: "32k", value: "32000" },
  { label: "64k", value: "64000" },
  { label: "128k", value: "128000" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : value;
}

function buildStyles(theme: PluginWorkspacePanelProps["theme"], compact: boolean): PanelStyles {
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: compact ? 16 : 24, gap: 16 },
    header: { gap: 4 },
    title: { color: theme.colors.foreground, fontSize: 18, fontWeight: "600" },
    muted: { color: theme.colors.foregroundMuted, lineHeight: 20 },
    paddedHint: { color: theme.colors.foregroundMuted, lineHeight: 20, paddingHorizontal: 4 },
    error: { color: theme.colors.statusDanger },
  };
}

function FileRows({ files }: { files: TasteFile[] }) {
  return (
    <SettingsCard>
      {files.map((file) => (
        <SettingsRow
          key={file.path}
          label={file.relativePath}
          hint={`${formatBytes(file.bytes)} · ${formatDate(file.modifiedAt)}`}
        />
      ))}
    </SettingsCard>
  );
}

function PackagesSection({
  title,
  files,
  emptyLabel,
  emptyHint,
}: {
  title: string;
  files: TasteFile[];
  emptyLabel: string;
  emptyHint: string;
}) {
  return (
    <SettingsSection title={title}>
      {files.length > 0 ? (
        <FileRows files={files} />
      ) : (
        <SettingsCard>
          <SettingsRow label={emptyLabel} hint={emptyHint} />
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function LearningSection({
  learning,
  styles,
  onRefresh,
}: {
  learning: { enabled: boolean; source: string | null };
  styles: PanelStyles;
  onRefresh(): void;
}) {
  const hint = learning.source
    ? `Set by ${learning.source}. Change it with /taste in Command Code.`
    : "Nothing overrides it. Command Code learns preferences in every project.";
  return (
    <SettingsSection title="Learning">
      <SettingsCard>
        <SettingsRow
          label={learning.enabled ? "Taste learning is on" : "Taste learning is off"}
          hint={hint}
        />
        <SettingsAction label="Reload files" actionLabel="Refresh" onPress={onRefresh} />
      </SettingsCard>
      <Text style={styles.paddedHint}>
        Command Code reads these files in its own sessions. This panel never changes them.
      </Text>
    </SettingsSection>
  );
}

function ProvidersSection({
  data,
  saving,
  settingsError,
  saveError,
  styles,
  onToggleApply,
  onToggleGlobal,
  onSelectSize,
}: {
  data: { applyToOtherProviders: boolean; includeGlobal: boolean; maxChars: number };
  saving: boolean;
  settingsError: string | null;
  saveError: string | null;
  styles: PanelStyles;
  onToggleApply(value: boolean): void;
  onToggleGlobal(value: boolean): void;
  onSelectSize(value: string): void;
}) {
  return (
    <SettingsSection title="Other providers">
      <SettingsCard>
        <SettingsSwitch
          label="Apply taste to new chats"
          hint="New chats on Claude, Codex, OpenCode, Pi, and Oh My Pi start with these preferences. Command Code and other ACP providers read their own prompts."
          value={data.applyToOtherProviders}
          disabled={saving}
          onValueChange={onToggleApply}
        />
        <SettingsSwitch
          label="Include global packages"
          hint="Adds ~/.commandcode/taste to the project packages."
          value={data.includeGlobal}
          disabled={saving}
          onValueChange={onToggleGlobal}
        />
        <SettingsSelect
          label="Prompt size limit"
          hint="The injected block is cut past this many characters."
          value={String(data.maxChars)}
          options={SIZE_OPTIONS}
          disabled={saving}
          onValueChange={onSelectSize}
        />
      </SettingsCard>
      <Text style={styles.paddedHint}>
        Existing chats keep the prompt they started with. Start a new chat after changing the
        preference.
      </Text>
      {settingsError ? <Text style={styles.error}>{settingsError}</Text> : null}
      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
    </SettingsSection>
  );
}

function PreviewBody({
  pending,
  error,
  data,
  styles,
}: {
  pending: boolean;
  error: unknown;
  data: { block: string; files: string[]; truncated: boolean } | undefined;
  styles: PanelStyles;
}) {
  if (pending) return <Text style={styles.muted}>Building the block…</Text>;
  if (error) {
    return (
      <Text style={styles.error}>
        {error instanceof Error ? error.message : "Couldn't build the block."}
      </Text>
    );
  }
  if (!data) return null;
  return (
    <SettingsCard>
      <SettingsRow
        label={`${data.files.length} file(s)`}
        hint={
          data.truncated
            ? "The block is truncated at the prompt size limit."
            : "The full profile fits under the prompt size limit."
        }
      />
      {data.block ? (
        <Markdown>{`\`\`\`\`text\n${data.block}\n\`\`\`\``}</Markdown>
      ) : (
        <Text style={styles.muted}>There is no taste to inject yet.</Text>
      )}
    </SettingsCard>
  );
}

function PreviewSection({ cwd, styles }: { cwd: string; styles: PanelStyles }) {
  const callPreview = useRpc(previewTasteRpc);
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["commandcode-taste", "preview", cwd],
    queryFn: () => callPreview({ cwd }),
    enabled: open,
  });
  const handleToggle = useCallback(() => setOpen((value) => !value), []);

  return (
    <SettingsSection title="Prompt preview">
      <SettingsCard>
        <SettingsAction
          label={open ? "Hide the injected block" : "Show the injected block"}
          actionLabel={open ? "Hide" : "Show"}
          onPress={handleToggle}
        />
      </SettingsCard>
      {open ? (
        <PreviewBody
          pending={preview.isPending}
          error={preview.error}
          data={preview.data}
          styles={styles}
        />
      ) : null}
    </SettingsSection>
  );
}

export function TastePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, ({ directory, name }) => ({ directory, name }));
  const cwd = workspace?.directory ?? null;
  const callList = useRpc(listTasteRpc);
  const settings = useSettings(tastePreferences);
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ["commandcode-taste", "list", cwd],
    queryFn: () => callList({ cwd: cwd ?? "" }),
    enabled: Boolean(cwd),
  });

  const styles = useMemo(() => buildStyles(theme, layout.compact), [theme, layout.compact]);
  const ready = settings.status === "ready" ? settings : null;

  const save = useCallback(
    async (patch: PreferencePatch) => {
      if (!ready) return;
      const saved = await ready.save({ ...ready.values, ...patch }, ready.revision);
      if (saved) await queryClient.invalidateQueries({ queryKey: ["commandcode-taste"] });
    },
    [ready, queryClient],
  );

  const refetchList = list.refetch;
  const handleRefresh = useCallback(() => {
    void refetchList();
  }, [refetchList]);
  const handleToggleApply = useCallback(
    (value: boolean) => void save({ applyToOtherProviders: value }),
    [save],
  );
  const handleToggleGlobal = useCallback(
    (value: boolean) => void save({ includeGlobal: value }),
    [save],
  );
  const handleSelectSize = useCallback(
    (value: string) => void save({ maxChars: Number(value) }),
    [save],
  );

  if (!cwd) {
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Open a workspace to inspect Command Code taste.</Text>
      </View>
    );
  }

  if (list.isPending) {
    return (
      <View style={styles.content}>
        <Text style={styles.muted}>Reading Command Code taste…</Text>
      </View>
    );
  }

  if (list.isError || !list.data) {
    return (
      <View style={styles.content}>
        <Text style={styles.error}>
          {list.error instanceof Error ? list.error.message : "Couldn't read taste files."}
        </Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={handleRefresh} />
      </View>
    );
  }

  const data = list.data;
  const none = data.project.length === 0 && data.global.length === 0;
  const projectEmptyHint = data.projectRoot
    ? `Looked in ${data.projectRoot}/.commandcode/taste.`
    : "No .commandcode/taste directory in this workspace.";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Taste</Text>
        <Text style={styles.muted}>
          Learnings from Command Code for {workspace?.name ?? "this workspace"}.
        </Text>
      </View>

      {none ? (
        <SettingsSection title="No packages yet">
          <SettingsCard>
            <SettingsRow
              label="Command Code hasn't learned taste here"
              hint="Run a Command Code session in this workspace. Preferences it learns appear here and can be applied to other providers."
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <LearningSection learning={data.learning} styles={styles} onRefresh={handleRefresh} />

      <ProvidersSection
        data={data}
        saving={ready?.saving ?? false}
        settingsError={settings.status === "error" ? settings.error : null}
        saveError={ready?.saveError ?? null}
        styles={styles}
        onToggleApply={handleToggleApply}
        onToggleGlobal={handleToggleGlobal}
        onSelectSize={handleSelectSize}
      />

      <PackagesSection
        title="Project packages"
        files={data.project}
        emptyLabel="No project taste"
        emptyHint={projectEmptyHint}
      />

      {data.includeGlobal ? (
        <PackagesSection
          title="Global packages"
          files={data.global}
          emptyLabel="No global taste"
          emptyHint="Nothing in ~/.commandcode/taste yet."
        />
      ) : null}

      <PreviewSection cwd={cwd} styles={styles} />
    </ScrollView>
  );
}
