import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useSessionStore } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { Theme } from "@/styles/theme";

const ThemedArrow = withUnistyles(ArrowUpRight);
const ThemedSparkles = withUnistyles(Sparkles);
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface WorkerRow {
  id: string;
  title: string;
  status: string;
  provider: string;
  model: string | null;
  detail: string | null;
  attention: boolean;
}

function MaestroWorkerBlock({
  worker,
  onOpen,
}: {
  worker: WorkerRow;
  onOpen: (id: string) => void;
}) {
  const handlePress = useCallback(() => onOpen(worker.id), [onOpen, worker.id]);
  return (
    <PressHighlight
      testID={`maestro-worker-${worker.id}`}
      onPress={handlePress}
      style={styles.block}
      highlightStyle={styles.blockPressed}
    >
      <View style={styles.icon}>
        {worker.attention ? (
          <ThemedSparkles size={14} uniProps={mutedIcon} />
        ) : (
          <ThemedArrow size={14} uniProps={mutedIcon} />
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {worker.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {worker.provider}
          {worker.model ? ` · ${worker.model}` : ""} · {worker.status}
        </Text>
        {worker.detail ? (
          <Text style={styles.detail} numberOfLines={2}>
            {worker.detail}
          </Text>
        ) : null}
      </View>
    </PressHighlight>
  );
}

/** Small live worker cards that live inside the Maestro assistant bubble. */
export function MaestroWorkerBlocks({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}) {
  const { t } = useTranslation();
  const workers = useSessionStore(
    useShallow((state): WorkerRow[] => {
      const agents = state.sessions[serverId]?.agents;
      if (!agents) return [];
      const rows: WorkerRow[] = [];
      for (const agent of agents.values()) {
        if (agent.archivedAt) continue;
        if (getParentAgentIdFromLabels(agent.labels) !== parentAgentId) continue;
        const detail =
          agent.lastError?.trim() ||
          (agent.turn.phase === "open" ? t("composer.maestroControl.thinking") : null) ||
          (agent.attentionReason ? agent.attentionReason : null);
        rows.push({
          id: agent.id,
          title: agent.title?.trim() || t("agentList.untitled"),
          status: agent.status,
          provider: agent.provider,
          model: agent.model,
          detail,
          attention: agent.requiresAttention === true,
        });
      }
      return rows.sort((a, b) => a.title.localeCompare(b.title));
    }),
  );

  const onOpen = useCallback(
    (id: string) => {
      navigateToAgent({ serverId, agentId: id });
    },
    [serverId],
  );

  const content = useMemo(() => {
    if (workers.length === 0) {
      return <Text style={styles.empty}>{t("composer.maestroControl.noWorkers")}</Text>;
    }
    return workers.map((worker) => (
      <MaestroWorkerBlock key={worker.id} worker={worker} onOpen={onOpen} />
    ));
  }, [onOpen, t, workers]);

  return (
    <View testID="maestro-worker-blocks" style={styles.container}>
      <Text style={styles.heading}>{t("composer.maestroControl.workers")}</Text>
      <View style={styles.blocks}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginTop: theme.spacing[3],
    gap: theme.spacing[2],
  },
  heading: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  blocks: {
    gap: theme.spacing[2],
  },
  block: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  blockPressed: {
    backgroundColor: theme.colors.surface2,
  },
  icon: {
    paddingTop: 2,
  },
  copy: {
    flex: 1,
    gap: theme.spacing[0.5],
  },
  title: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  detail: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  empty: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
