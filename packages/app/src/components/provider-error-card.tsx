import { useCallback, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { PressHighlight } from "@/components/ui/press-highlight";
import { classifyProviderError } from "@/agent-stream/provider-error";
import {
  providerErrorOffersModelSwitch,
  resolveProviderErrorCopy,
} from "@/agent-stream/provider-error-copy";
import { ProviderErrorSwitchModel } from "@/agent-stream/provider-error-switch-model";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { providerDisplayName } from "@/utils/provider-display-name";

type TranslateKey = Parameters<ReturnType<typeof useTranslation>["t"]>[0];

const ACP_PROVIDER_TITLES = new Map(ACP_PROVIDER_CATALOG.map((entry) => [entry.id, entry.title]));

function providerLabel(provider: AgentProvider | undefined, fallback: string): string {
  if (!provider) return fallback;
  // Provider ids collapse multi-word names ("commandcode"); use the catalog
  // title so the card matches the rest of the UI instead of "Commandcode".
  return ACP_PROVIDER_TITLES.get(provider) ?? providerDisplayName(provider);
}

export function ProviderErrorCard({
  message,
  provider,
  modelId,
  agentId,
  readOnly = false,
  children,
}: {
  message: string;
  provider?: AgentProvider;
  modelId?: string | null;
  agentId?: string;
  readOnly?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const kind = classifyProviderError(message);
  const keys = resolveProviderErrorCopy({ provider, kind, message, modelId }) as {
    title: TranslateKey;
    description: TranslateKey;
  };
  const providerName = providerLabel(provider, t("agentStream.providerError.unknownProvider"));
  const showSwitchModel = !readOnly && Boolean(agentId) && providerErrorOffersModelSwitch(kind);
  const toggleDetails = useCallback(() => setExpanded((previous) => !previous), []);

  return (
    <View style={styles.card} testID="provider-error-card">
      <View style={styles.header}>
        <TriangleAlert size={16} color={styles.icon.color} />
        <Text style={styles.badge}>{t("agentStream.providerError.badge")}</Text>
        <Text style={styles.provider} numberOfLines={1}>
          {providerName}
        </Text>
      </View>
      <Text style={styles.title}>{t(keys.title)}</Text>
      <Text style={styles.description}>{t(keys.description, { provider: providerName })}</Text>
      {showSwitchModel && agentId ? <ProviderErrorSwitchModel agentId={agentId} /> : null}
      {children}
      <PressHighlight
        onPress={toggleDetails}
        accessibilityRole="button"
        accessibilityLabel={t(
          expanded
            ? "agentStream.providerError.hideDetails"
            : "agentStream.providerError.showDetails",
        )}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>
          {t(
            expanded
              ? "agentStream.providerError.hideDetails"
              : "agentStream.providerError.showDetails",
          )}
        </Text>
        {expanded ? (
          <ChevronUp size={14} color={styles.toggleText.color} />
        ) : (
          <ChevronDown size={14} color={styles.toggleText.color} />
        )}
      </PressHighlight>
      {expanded ? (
        <Text style={styles.details} selectable>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(245, 158, 11, 0.35)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  icon: {
    color: "#f59e0b",
  },
  badge: {
    color: "#f59e0b",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  provider: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginLeft: "auto",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    alignSelf: "flex-start",
  },
  toggleText: {
    color: "#f59e0b",
    fontSize: theme.fontSize.sm,
  },
  details: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    paddingTop: theme.spacing[1],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: "rgba(245, 158, 11, 0.2)",
  },
}));
