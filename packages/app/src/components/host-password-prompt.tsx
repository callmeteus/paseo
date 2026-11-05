import { Eye, EyeOff } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import {
  getHostAuthFailureReason,
  useHostMutations,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import type { HostAuthFailureReason } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import type { HostConnection } from "@/types/host-connection";
import { toErrorMessage } from "@/utils/error-messages";
import { getConnectionAuthFailureReason } from "@/utils/test-daemon-connection";

const ThemedEye = withUnistyles(Eye);
const ThemedEyeOff = withUnistyles(EyeOff);
const passwordIconProps = (theme: Theme) => ({
  size: 18,
  color: theme.colors.foregroundMuted,
});

export function HostPasswordPrompt({
  serverId,
  testID = "host-password-prompt",
}: {
  serverId: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const { probeAndUpsertDirectConnection, setHostPassword } = useHostMutations();
  const host = useMemo(
    () => hosts.find((entry) => entry.serverId === serverId) ?? null,
    [hosts, serverId],
  );
  const authFailureReason: HostAuthFailureReason | null = getHostAuthFailureReason(snapshot);
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<HostAuthFailureReason | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const directConnection = useMemo(() => {
    if (!host) return null;
    const directConnections = host.connections.filter(
      (connection): connection is Extract<HostConnection, { type: "directTcp" }> =>
        connection.type === "directTcp",
    );
    return (
      directConnections.find((connection) => connection.id === host.preferredConnectionId) ??
      directConnections[0] ??
      null
    );
  }, [host]);

  const handleChangePassword = useCallback((next: string) => {
    setPassword(next);
    setFailure(null);
    setFormError(null);
  }, []);

  const handleToggleVisibility = useCallback(() => {
    setIsPasswordVisible((current) => !current);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!host || isSubmitting) return;
    if (password.length === 0) {
      setFormError(t("settings.host.password.empty"));
      return;
    }
    setIsSubmitting(true);
    setFailure(null);
    setFormError(null);
    try {
      if (directConnection) {
        await probeAndUpsertDirectConnection({
          endpoint: directConnection.endpoint,
          useTls: directConnection.useTls,
          password,
          label: host.label,
        });
      } else {
        await setHostPassword(host.serverId, password);
      }
      setPassword("");
    } catch (error) {
      const reason = getConnectionAuthFailureReason(error);
      if (reason) {
        setFailure(reason);
        setFormError(t("settings.host.password.failed"));
      } else {
        setFormError(toErrorMessage(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    directConnection,
    host,
    isSubmitting,
    password,
    probeAndUpsertDirectConnection,
    setHostPassword,
    t,
  ]);

  const handleConnectPress = useCallback(() => {
    void handleConnect();
  }, [handleConnect]);

  if (!host || !authFailureReason) {
    return null;
  }

  const reason = failure ?? authFailureReason;
  const title =
    reason === "incorrect_password"
      ? t("settings.host.password.incorrectTitle")
      : t("settings.host.password.requiredTitle");
  const PasswordIcon = isPasswordVisible ? ThemedEyeOff : ThemedEye;
  const inputStyle = [styles.input, styles.inputFlex];

  return (
    <Alert variant="error" title={title} testID={testID}>
      <View style={styles.form}>
        <Text style={styles.guidance}>{t("settings.host.password.guidance")}</Text>
        <View style={styles.passwordRow}>
          <AdaptiveTextInput
            testID={`${testID}-input`}
            accessibilityLabel={t("settings.host.password.label")}
            initialValue=""
            onChangeText={handleChangePassword}
            placeholder={t("settings.host.password.placeholder")}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!isPasswordVisible}
            editable={!isSubmitting}
            returnKeyType="go"
            onSubmitEditing={handleConnectPress}
          />
          <PressHighlight
            style={styles.iconButton}
            onPress={handleToggleVisibility}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordVisible
                ? t("settings.host.password.hide")
                : t("settings.host.password.show")
            }
            testID={`${testID}-visibility-toggle`}
          >
            <PasswordIcon uniProps={passwordIconProps} />
          </PressHighlight>
        </View>
        {formError ? (
          <Text style={styles.error} testID={`${testID}-error`}>
            {formError}
          </Text>
        ) : null}
        <Button
          variant="default"
          loading={isSubmitting}
          onPress={handleConnectPress}
          disabled={isSubmitting}
          testID={`${testID}-connect`}
          accessibilityRole="button"
          accessibilityLabel={t("settings.host.password.connect")}
        >
          {isSubmitting
            ? t("settings.host.password.connecting")
            : t("settings.host.password.connect")}
        </Button>
      </View>
    </Alert>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: {
    flex: 1,
    flexDirection: "column",
    gap: theme.spacing[2],
    width: "100%",
  },
  guidance: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: Math.round(theme.fontSize.base * 1.4),
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  inputFlex: {
    flex: 1,
    minWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
