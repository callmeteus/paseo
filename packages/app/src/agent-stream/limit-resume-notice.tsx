import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { Alert } from "@/components/ui/alert";
import { useUsageHostReports } from "@/usage/queries";
import { useSessionStore } from "@/stores/session-store";
import { sessionLimitWarning } from "./session-limit";
import { limitResumeIsOffered, resolveLimitResumeAt, usageResetWindows } from "./limit-resume";
import { useLimitResumeStore } from "./limit-resume-store";

/**
 * The session-limit warning, with a checkbox for this chat only.
 * The box is absent when a router is bound or the reset time is unknown.
 */
export function SessionLimitNotice({
  text,
  agentId,
  serverId,
  provider,
  offer,
}: {
  text: string;
  agentId: string;
  serverId: string;
  provider?: AgentProvider;
  /** False for an older limit still visible in the transcript. */
  offer: boolean;
}) {
  const { t } = useTranslation();
  const warning = sessionLimitWarning(text, t);
  if (!warning) return null;
  return (
    <Alert variant="warning" size="sm" title={warning} testID="session-limit-warning">
      {offer ? (
        <LimitResumeOffer agentId={agentId} serverId={serverId} provider={provider} text={text} />
      ) : null}
    </Alert>
  );
}

/** The checkbox, or nothing when this chat should not resume itself. */
export function LimitResumeOffer({
  agentId,
  serverId,
  provider,
  text,
}: {
  agentId: string;
  serverId: string;
  provider?: AgentProvider;
  text: string;
}) {
  const { t } = useTranslation();
  const reports = useUsageHostReports(serverId);
  const routerId = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      session?.agents.get(agentId)?.modelRouterId ??
      session?.agentDetails.get(agentId)?.modelRouterId ??
      null
    );
  });
  const armed = useLimitResumeStore((state) => state.byAgentId[agentId]);
  const arm = useLimitResumeStore((state) => state.arm);
  const disarm = useLimitResumeStore((state) => state.disarm);
  const now = Date.now();
  const resetAt = resolveLimitResumeAt({
    text,
    windows: usageResetWindows(reports, provider),
    now,
  });
  const checked = armed != null;
  const toggle = useCallback(() => {
    if (checked) {
      disarm(agentId);
      return;
    }
    if (resetAt == null) return;
    arm(agentId, { serverId, resetAt });
  }, [agentId, arm, checked, disarm, resetAt, serverId]);

  const accessibilityState = useMemo(() => ({ checked }), [checked]);
  if (!limitResumeIsOffered({ routerId, resetAt: armed?.resetAt ?? resetAt, now })) return null;

  return (
    <PressHighlight
      onPress={toggle}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      accessibilityLabel={t("agentStream.sessionLimit.resume")}
      testID="session-limit-resume"
      style={styles.row}
    >
      <View style={[styles.box, checked ? styles.boxChecked : null]}>
        {checked ? <Check size={12} color={styles.check.color} /> : null}
      </View>
      <Text style={styles.label}>{t("agentStream.sessionLimit.resume")}</Text>
    </PressHighlight>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  box: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
  },
  boxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  check: {
    color: theme.colors.accentForeground,
  },
  label: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
