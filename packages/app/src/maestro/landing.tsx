import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Sparkles, Workflow } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { MAESTRO_CONTEXT_RECOMMENDATION } from "@getpaseo/protocol/maestro";

const ThemedSparkles = withUnistyles(Sparkles);
const ThemedWorkflow = withUnistyles(Workflow);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The first thing a user sees when they open a Maestro chat: its own visual
 * language, a clear statement of what it does, and the scope choice.
 */
export function MaestroLanding({
  serverId,
  agentId,
  scope,
}: {
  serverId: string;
  agentId: string;
  scope: "workspace" | "all";
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  const chooseScope = useCallback(
    (next: "workspace" | "all") => {
      if (!client || next === scope) return;
      void client.setAgentChatMode(agentId, "maestro", { scope: next }).catch((error: unknown) => {
        console.warn("[MaestroLanding] Failed to set scope", error);
        toast.error(t("composer.maestroControl.failed"));
      });
    },
    [agentId, client, scope, t, toast],
  );

  const chooseWorkspace = useCallback(() => chooseScope("workspace"), [chooseScope]);
  const chooseAll = useCallback(() => chooseScope("all"), [chooseScope]);

  return (
    <View testID="maestro-landing" style={styles.container}>
      <View style={styles.mark}>
        <ThemedSparkles size={22} uniProps={mutedIcon} />
      </View>
      <Text style={styles.title}>{t("composer.maestroControl.landingTitle")}</Text>
      <Text style={styles.subtitle}>{t("composer.maestroControl.landingSubtitle")}</Text>
      <Text style={styles.body}>{t("composer.maestroControl.landingBody")}</Text>
      <View style={styles.recommendation}>
        <Text style={styles.recommendationText}>{MAESTRO_CONTEXT_RECOMMENDATION}</Text>
        <Text style={styles.recommendationCopy}>{t("composer.maestroControl.recommendation")}</Text>
      </View>
      <Text style={styles.scopeTitle}>{t("composer.maestroControl.label")}</Text>
      <View style={styles.scopes}>
        <PressHighlight
          testID="maestro-landing-scope-workspace"
          onPress={chooseWorkspace}
          style={[styles.scope, scope === "workspace" && styles.scopeSelected]}
          highlightStyle={styles.scopePressed}
        >
          <ThemedWorkflow size={16} uniProps={mutedIcon} />
          <Text style={styles.scopeLabel}>{t("composer.maestroControl.workspace")}</Text>
        </PressHighlight>
        <PressHighlight
          testID="maestro-landing-scope-all"
          onPress={chooseAll}
          style={[styles.scope, scope === "all" && styles.scopeSelected]}
          highlightStyle={styles.scopePressed}
        >
          <ThemedSparkles size={16} uniProps={mutedIcon} />
          <Text style={styles.scopeLabel}>{t("composer.maestroControl.all")}</Text>
        </PressHighlight>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "stretch",
    maxWidth: 520,
    marginHorizontal: "auto",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[2],
  },
  mark: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  title: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
  },
  body: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
    color: theme.colors.foreground,
  },
  recommendation: {
    marginTop: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  recommendationText: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  recommendationCopy: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  scopeTitle: {
    marginTop: theme.spacing[3],
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  scopes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  scope: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  scopeSelected: {
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface2,
  },
  scopePressed: {
    backgroundColor: theme.colors.surface3,
  },
  scopeLabel: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
}));
