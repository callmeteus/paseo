import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { ApiTokenSummary } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useDaemonApiTokens } from "@/hooks/use-daemon-api-tokens";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { Copy, KeyRound, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react-native";
import { formatApiTokenCreatedAt, validateApiTokenName } from "./api-tokens-model";

const ThemedCopy = withUnistyles(Copy);
const ThemedKeyRound = withUnistyles(KeyRound);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedPencil = withUnistyles(Pencil);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedSpinner = withUnistyles(LoadingSpinner);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerIconColor = (theme: Theme) => ({ color: theme.colors.statusDanger });

interface RevealedSecret {
  secret: string;
  title: string;
}

interface HostApiTokensPageProps {
  serverId: string;
}

export function HostApiTokensPage({ serverId }: HostApiTokensPageProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeature(serverId, "apiTokens");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { tokens, isLoading, isError, createToken, renameToken, rotateToken, revokeToken } =
    useDaemonApiTokens(serverId);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [renamingToken, setRenamingToken] = useState<ApiTokenSummary | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (name: string) => {
      const secret = await createToken(name);
      setCreateOpen(false);
      setRevealed({ secret, title: t("settings.host.apiTokens.createdTitle") });
    },
    [createToken, t],
  );

  const handleRename = useCallback(
    async (name: string) => {
      if (!renamingToken) return;
      try {
        await renameToken(renamingToken.id, name);
        toast.show(t("settings.host.apiTokens.renamed", { name }));
        setRenamingToken(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.errors.unableToSave"));
      }
    },
    [renamingToken, renameToken, toast, t],
  );

  const openRename = useCallback((token: ApiTokenSummary) => setRenamingToken(token), []);

  const handleRotate = useCallback(
    async (token: ApiTokenSummary) => {
      const confirmed = await confirmDialog({
        title: t("settings.host.apiTokens.rotateTitle"),
        message: t("settings.host.apiTokens.rotateMessage", { name: token.name }),
        confirmLabel: t("settings.host.apiTokens.rotateConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setBusyId(token.id);
      try {
        const secret = await rotateToken(token.id);
        setRevealed({ secret, title: t("settings.host.apiTokens.rotatedTitle") });
        toast.show(t("settings.host.apiTokens.rotated", { name: token.name }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.errors.unableToSave"));
      } finally {
        setBusyId(null);
      }
    },
    [rotateToken, toast, t],
  );

  const handleRevoke = useCallback(
    async (token: ApiTokenSummary) => {
      const confirmed = await confirmDialog({
        title: t("settings.host.apiTokens.revokeTitle"),
        message: t("settings.host.apiTokens.revokeMessage", { name: token.name }),
        confirmLabel: t("settings.host.apiTokens.revokeConfirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      setBusyId(token.id);
      try {
        await revokeToken(token.id);
        toast.show(t("settings.host.apiTokens.revoked", { name: token.name }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.errors.unableToSave"));
      } finally {
        setBusyId(null);
      }
    },
    [revokeToken, toast, t],
  );

  const handleCopy = useCallback(async () => {
    if (!revealed) return;
    try {
      await Clipboard.setStringAsync(revealed.secret);
      toast.copied(t("settings.host.apiTokens.copyLabel"));
    } catch {
      toast.error(t("settings.host.apiTokens.copyFailed"));
    }
  }, [revealed, toast, t]);

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeRename = useCallback(() => setRenamingToken(null), []);
  const closeReveal = useCallback(() => setRevealed(null), []);
  const sectionTrailing = useMemo(
    () => (
      <Button variant="outline" onPress={openCreate} testID="api-tokens-create-button">
        {t("settings.host.apiTokens.create")}
      </Button>
    ),
    [openCreate, t],
  );

  if (!supported) {
    return (
      <View style={[settingsStyles.card, styles.notice]}>
        <Text style={settingsStyles.rowHint}>{t("settings.host.apiTokens.unsupported")}</Text>
      </View>
    );
  }

  if (!isConnected) {
    return (
      <View style={[settingsStyles.card, styles.notice]}>
        <Text style={settingsStyles.rowHint}>{t("settings.remoteAccess.disconnected")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <SettingsSection
        title={t("settings.host.apiTokens.title")}
        info={t("settings.host.apiTokens.info")}
        trailing={sectionTrailing}
      >
        <View style={settingsStyles.card}>
          {isLoading ? (
            <View style={settingsStyles.row} testID="api-tokens-loading">
              <ThemedSpinner size={14} uniProps={mutedIconColor} />
            </View>
          ) : null}
          {isError ? (
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowError}>{t("settings.host.apiTokens.loadFailed")}</Text>
            </View>
          ) : null}
          {!isLoading && !isError && tokens.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowHint}>{t("settings.host.apiTokens.empty")}</Text>
            </View>
          ) : null}
          {tokens.map((token, index) => (
            <TokenRow
              key={token.id}
              token={token}
              isFirst={index === 0}
              isBusy={busyId === token.id}
              onRename={openRename}
              onRotate={handleRotate}
              onRevoke={handleRevoke}
            />
          ))}
        </View>
      </SettingsSection>

      <TokenNameSheet
        visible={isCreateOpen}
        title={t("settings.host.apiTokens.createTitle")}
        submitLabel={t("settings.host.apiTokens.create")}
        onClose={closeCreate}
        onSubmit={handleCreate}
        testID="api-token-create-sheet"
      />

      <TokenNameSheet
        visible={renamingToken !== null}
        title={t("settings.host.apiTokens.renameTitle")}
        submitLabel={t("common.actions.save")}
        initialName={renamingToken?.name ?? ""}
        onClose={closeRename}
        onSubmit={handleRename}
        testID="api-token-rename-sheet"
      />

      <RevealTokenSheet reveal={revealed} onCopy={handleCopy} onClose={closeReveal} />
    </View>
  );
}

interface TokenRowProps {
  token: ApiTokenSummary;
  isFirst: boolean;
  isBusy: boolean;
  onRename: (token: ApiTokenSummary) => void;
  onRotate: (token: ApiTokenSummary) => void;
  onRevoke: (token: ApiTokenSummary) => void;
}

function TokenRow({ token, isFirst, isBusy, onRename, onRotate, onRevoke }: TokenRowProps) {
  const { t } = useTranslation();
  const handleRename = useCallback(() => onRename(token), [onRename, token]);
  const handleRotate = useCallback(() => onRotate(token), [onRotate, token]);
  const handleRevoke = useCallback(() => onRevoke(token), [onRevoke, token]);
  const pencilLeading = useMemo(() => <ThemedPencil size={14} uniProps={mutedIconColor} />, []);
  const refreshLeading = useMemo(() => <ThemedRefreshCw size={14} uniProps={mutedIconColor} />, []);
  const trashLeading = useMemo(() => <ThemedTrash2 size={14} uniProps={dangerIconColor} />, []);

  return (
    <View
      style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}
      testID={`api-token-row-${token.id}`}
    >
      <ThemedKeyRound size={16} uniProps={mutedIconColor} />
      <View style={styles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {token.name}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.host.apiTokens.created", {
            date: formatApiTokenCreatedAt(token.createdAt),
          })}
        </Text>
        {token.rotatedAt ? (
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.apiTokens.rotatedOn", {
              date: formatApiTokenCreatedAt(token.rotatedAt),
            })}
          </Text>
        ) : null}
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isBusy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("settings.host.apiTokens.actions.menu", { name: token.name })}
          testID={`api-token-actions-${token.id}`}
        >
          <ThemedMoreHorizontal size={16} uniProps={mutedIconColor} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200}>
          <DropdownMenuItem
            leading={pencilLeading}
            onSelect={handleRename}
            testID={`api-token-rename-${token.id}`}
          >
            {t("settings.host.apiTokens.actions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            leading={refreshLeading}
            onSelect={handleRotate}
            testID={`api-token-rotate-${token.id}`}
          >
            {t("settings.host.apiTokens.actions.rotate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            destructive
            leading={trashLeading}
            onSelect={handleRevoke}
            testID={`api-token-revoke-${token.id}`}
          >
            {t("settings.host.apiTokens.actions.revoke")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface TokenNameSheetProps {
  visible: boolean;
  title: string;
  submitLabel: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
  testID: string;
}

function TokenNameSheet({
  visible,
  title,
  submitLabel,
  initialName = "",
  onClose,
  onSubmit,
  testID,
}: TokenNameSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setError(null);
    setIsPending(false);
  }, [visible, initialName]);

  const header = useMemo<SheetHeader>(() => ({ title }), [title]);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isPending) return;
    const validationError = validateApiTokenName(name, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsPending(true);
    try {
      await onSubmit(name.trim());
      setName("");
      setError(null);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : t("common.errors.unableToSave"),
      );
    } finally {
      setIsPending(false);
    }
  }, [isPending, name, onSubmit, t]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={header}
      onClose={onClose}
      testID={testID}
      desktopMaxWidth={480}
    >
      <View style={styles.sheetBody}>
        <Field
          label={t("settings.host.apiTokens.nameLabel")}
          error={error}
          testID={`${testID}-name-field`}
        >
          <FormTextInput
            ref={inputRef}
            initialValue={initialName}
            resetKey={`${visible}-${initialName}`}
            onChangeText={handleNameChange}
            placeholder={t("settings.host.apiTokens.namePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            returnKeyType="done"
            nativeID={`${testID}-name-input`}
            accessibilityLabel={t("settings.host.apiTokens.nameLabel")}
            testID={`${testID}-name-input`}
          />
        </Field>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            onPress={onClose}
            disabled={isPending}
            testID={`${testID}-cancel-button`}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            onPress={handleSubmit}
            disabled={isPending}
            testID={`${testID}-submit-button`}
          >
            {submitLabel}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface RevealTokenSheetProps {
  reveal: RevealedSecret | null;
  onCopy: () => void;
  onClose: () => void;
}

function RevealTokenSheet({ reveal, onCopy, onClose }: RevealTokenSheetProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: reveal?.title ?? t("settings.host.apiTokens.createdTitle") }),
    [reveal, t],
  );

  return (
    <AdaptiveModalSheet
      visible={reveal !== null}
      header={header}
      onClose={onClose}
      testID="api-token-reveal-sheet"
      desktopMaxWidth={480}
    >
      <View style={styles.sheetBody}>
        <Text style={settingsStyles.rowHint}>{t("settings.host.apiTokens.revealHint")}</Text>
        <View style={styles.secretBox}>
          <Text selectable style={styles.secretText} testID="api-token-secret">
            {reveal?.secret ?? ""}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button variant="secondary" onPress={onCopy} testID="api-token-copy-button">
            <ThemedCopy size={14} uniProps={mutedIconColor} />
            <Text style={styles.actionLabel}>{t("settings.host.apiTokens.copyLabel")}</Text>
          </Button>
          <Button variant="default" onPress={onClose} testID="api-token-done-button">
            {t("settings.host.apiTokens.done")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  page: {
    gap: theme.spacing[4],
  },
  notice: {
    padding: theme.spacing[4],
  },
  rowContent: {
    flex: 1,
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  sheetBody: {
    gap: theme.spacing[4],
  },
  secretBox: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  secretText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  actionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
