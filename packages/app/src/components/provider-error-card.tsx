import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, TriangleAlert } from "lucide-react-native";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { PressHighlight } from "@/components/ui/press-highlight";
import { classifyProviderError, type ProviderErrorKind } from "@/agent-stream/provider-error";

type TranslateKey = Parameters<ReturnType<typeof useTranslation>["t"]>[0];
interface ProviderErrorCopy {
  title: TranslateKey;
  description: TranslateKey;
}

const KIND_KEYS = {
  usage_limit: {
    title: "agentStream.providerError.kinds.usageLimit.title",
    description: "agentStream.providerError.kinds.usageLimit.description",
  },
  auth: {
    title: "agentStream.providerError.kinds.auth.title",
    description: "agentStream.providerError.kinds.auth.description",
  },
  rate_limit: {
    title: "agentStream.providerError.kinds.rateLimit.title",
    description: "agentStream.providerError.kinds.rateLimit.description",
  },
  model_unavailable: {
    title: "agentStream.providerError.kinds.modelUnavailable.title",
    description: "agentStream.providerError.kinds.modelUnavailable.description",
  },
  crash: {
    title: "agentStream.providerError.kinds.crash.title",
    description: "agentStream.providerError.kinds.crash.description",
  },
  unknown: {
    title: "agentStream.providerError.kinds.unknown.title",
    description: "agentStream.providerError.kinds.unknown.description",
  },
} as const satisfies Record<ProviderErrorKind, ProviderErrorCopy>;

const PROVIDER_OVERRIDES: Partial<
  Record<AgentProvider, Partial<Record<ProviderErrorKind, ProviderErrorCopy>>>
> = {
  opencode: {
    usage_limit: {
      title: "agentStream.providerError.providers.opencode.usageLimit.title",
      description: "agentStream.providerError.providers.opencode.usageLimit.description",
    },
  },
  cline: {
    usage_limit: {
      title: "agentStream.providerError.providers.cline.usageLimit.title",
      description: "agentStream.providerError.providers.cline.usageLimit.description",
    },
  },
};

function providerLabel(provider: AgentProvider | undefined, fallback: string): string {
  if (!provider) return fallback;
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function ProviderErrorCard({
  message,
  provider,
}: {
  message: string;
  provider?: AgentProvider;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const kind = classifyProviderError(message);
  const override = provider ? PROVIDER_OVERRIDES[provider]?.[kind] : undefined;
  const keys = override ?? KIND_KEYS[kind];
  const providerName = providerLabel(provider, t("agentStream.providerError.unknownProvider"));
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
