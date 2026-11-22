import { useCallback, useMemo, useRef, useState } from "react";
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
import { Copy, KeyRound, MoreHorizontal, Trash2 } from "lucide-react-native";
import { formatApiTokenCreatedAt, validateApiTokenName } from "./api-tokens-model";

const ThemedCopy = withUnistyles(Copy);
const ThemedKeyRound = withUnistyles(KeyRound);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedSpinner = withUnistyles(LoadingSpinner);

const mutedIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const dangerIconColor = (theme: Theme) => ({ color: theme.colors.statusDanger });

interface HostApiTokensPageProps {
  serverId: string;
}

export function HostApiTokensPage({ serverId }: HostApiTokensPageProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const supported = useHostFeature(serverId, "apiTokens");
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { tokens, isLoading, isError, createToken, revokeToken } = useDaemonApiTokens(serverId);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleCreate = useCallback(
    async (name: string) => {
      const secret = await createToken(name);
      setCreateOpen(false);
      setRevealedSecret(secret);
    },
    [createToken],
  );

  const handleCopy = useCallback(async () => {
    if (!revealedSecret) return;
    try {
      await Clipboard.setStringAsync(revealedSecret);
      toast.copied(t("settings.host.apiTokens.copyLabel"));
    } catch {
      toast.error(t("settings.host.apiTokens.copyFailed"));
    }
  }, [revealedSecret, toast, t]);

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
      setRevokingId(token.id);
      try {
        await revokeToken(token.id);
        toast.show(t("settings.host.apiTokens.revoked", { name: token.name }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("common.errors.unableToSave"));
      } finally {
        setRevokingId(null);
      }
    },
    [revokeToken, toast, t],
  );

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);
  const closeReveal = useCallback(() => setRevealedSecret(null), []);
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
              isRevoking={revokingId === token.id}
              onRevoke={handleRevoke}
            />
          ))}
        </View>
      </SettingsSection>

      <CreateTokenSheet visible={isCreateOpen} onClose={closeCreate} onSubmit={handleCreate} />

      <RevealTokenSheet secret={revealedSecret} onCopy={handleCopy} onClose={closeReveal} />
    </View>
  );
}

interface TokenRowProps {
  token: ApiTokenSummary;
  isFirst: boolean;
  isRevoking: boolean;
  onRevoke: (token: ApiTokenSummary) => void;
}

function TokenRow({ token, isFirst, isRevoking, onRevoke }: TokenRowProps) {
  const { t } = useTranslation();
  const handleRevoke = useCallback(() => onRevoke(token), [onRevoke, token]);
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
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={isRevoking}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("settings.host.apiTokens.actions.menu", { name: token.name })}
          testID={`api-token-actions-${token.id}`}
        >
          <ThemedMoreHorizontal size={16} uniProps={mutedIconColor} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200}>
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

interface CreateTokenSheetProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

function CreateTokenSheet({ visible, onClose, onSubmit }: CreateTokenSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.apiTokens.createTitle") }),
    [t],
  );

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
      testID="api-token-create-sheet"
      desktopMaxWidth={480}
    >
      <View style={styles.sheetBody}>
        <Field
          label={t("settings.host.apiTokens.nameLabel")}
          error={error}
          testID="api-token-name-field"
        >
          <FormTextInput
            ref={inputRef}
            initialValue=""
            resetKey={visible ? "open" : "closed"}
            onChangeText={handleNameChange}
            placeholder={t("settings.host.apiTokens.namePlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isPending}
            returnKeyType="done"
            nativeID="api-token-name-input"
            accessibilityLabel={t("settings.host.apiTokens.nameLabel")}
            testID="api-token-name-input"
          />
        </Field>
        <View style={styles.actions}>
          <Button
            variant="secondary"
            onPress={onClose}
            disabled={isPending}
            testID="api-token-cancel-button"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            onPress={handleSubmit}
            disabled={isPending}
            testID="api-token-submit-button"
          >
            {t("settings.host.apiTokens.create")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface RevealTokenSheetProps {
  secret: string | null;
  onCopy: () => void;
  onClose: () => void;
}

function RevealTokenSheet({ secret, onCopy, onClose }: RevealTokenSheetProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.apiTokens.createdTitle") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      visible={secret !== null}
      header={header}
      onClose={onClose}
      testID="api-token-reveal-sheet"
      desktopMaxWidth={480}
    >
      <View style={styles.sheetBody}>
        <Text style={settingsStyles.rowHint}>{t("settings.host.apiTokens.revealHint")}</Text>
        <View style={styles.secretBox}>
          <Text selectable style={styles.secretText} testID="api-token-secret">
            {secret ?? ""}
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
