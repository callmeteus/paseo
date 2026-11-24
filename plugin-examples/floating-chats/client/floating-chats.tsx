import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import {
  useAgent,
  useAgents,
  type AgentRef,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getOverlayBridge } from "./bridge-access";
import type { OverlayBridge, OverlayConfig } from "./bridge";
import { ChatBubble } from "./chat-bubble";
import { useNativeSkin } from "./native-skin";
import { compareRecentAgents, isVisibleAgent } from "./recent-chats";

const MAX_VISIBLE_CHATS = 8;

/**
 * Tira de chats recentes flutuantes.
 *
 * @param props Props padrão da screen do plugin.
 * @returns A tira com as bolinhas e o botão de novo chat.
 */
export function FloatingChats({ theme }: PluginScreenProps) {
  const skin = useNativeSkin();
  const [config, setConfig] = useState({
    hiddenAgentIds: [] as string[],
    animations: true,
    serverId: null as string | null,
    position: "top-right" as OverlayConfig["position"],
  });
  const bridge = useMemo<OverlayBridge | null>(() => getOverlayBridge(), []);
  const refs = useAgents({
    orderBy: (left, right) => compareRecentAgents(left, right),
  }) as readonly AgentRef[];

  useEffect(() => {
    const current = bridge?.getConfig;
    if (!current) return;
    void current().then((value) => {
      setConfig({
        hiddenAgentIds: value.hiddenAgentIds ?? [],
        animations: value.animations,
        serverId: value.serverId,
        position: value.position,
      });
      return undefined;
    });
  }, [bridge]);

  const hideAgent = useCallback(
    (agentId: string) => {
      setConfig((current) => ({
        ...current,
        hiddenAgentIds: [...current.hiddenAgentIds, agentId],
      }));
      void bridge?.setConfig?.({ hiddenAgentIds: [...config.hiddenAgentIds, agentId] });
    },
    [bridge, config.hiddenAgentIds],
  );

  const visibleRefs = useMemo(
    () => refs.filter((ref) => !config.hiddenAgentIds.includes(ref.id)).slice(0, MAX_VISIBLE_CHATS),
    [refs, config.hiddenAgentIds],
  );

  const statusColors = useMemo(
    () => ({
      statusDotWarning: theme.colors.statusDotWarning,
      statusDotDanger: theme.colors.statusDotDanger,
      statusDotRunning: theme.colors.statusDotRunning,
      statusDotSuccess: theme.colors.statusDotSuccess,
    }),
    [theme],
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        strip: {
          flexDirection:
            config.position === "top-center" || config.position === "bottom-center"
              ? "row"
              : "column",
          alignItems: "center",
          gap: 8,
          padding: 6,
          borderRadius: 999,
          backgroundColor: `${skin.surfaceColor}DE`,
          borderWidth: 1,
          borderColor: skin.borderColor,
        },
        add: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: skin.accentColor,
        },
        addText: {
          color: skin.surfaceColor,
          fontSize: 24,
          fontFamily: skin.fontFamily,
          lineHeight: 26,
        },
        empty: { color: skin.textColor, fontSize: skin.fontSize },
      }),
    [config.position, skin],
  );

  const openNewChat = useCallback(() => {
    void bridge?.openNewChat?.();
  }, [bridge]);

  const bubbleCount = visibleRefs.length;
  const stripWidth = 72;
  const stripHeight =
    12 + bubbleCount * 54 + (bubbleCount > 1 ? (bubbleCount - 1) * 8 : 0) + 8 + 44 + 6;

  useEffect(() => {
    void bridge?.resizeStrip?.({ width: stripWidth, height: stripHeight });
  }, [bridge, stripHeight]);

  return (
    <View style={styles.strip}>
      <FlatList
        data={visibleRefs}
        scrollEnabled={false}
        keyExtractor={(ref) => ref.key}
        renderItem={({ item }) => (
          <BubbleSlot
            ref={item}
            statusColors={statusColors}
            bridge={bridge}
            skin={skin}
            onHide={hideAgent}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>sem chats</Text>}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Novo chat"
        onPress={openNewChat}
        style={styles.add}
      >
        <Text style={styles.addText}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Resolve o snapshot de um agente e renderiza sua bolinha.
 *
 * @param props Ref do agente, cores, ponte e callbacks.
 * @returns A bolinha, ou null quando o agente não existe mais.
 */
function BubbleSlot({
  ref,
  statusColors,
  bridge,
  skin,
  onHide,
}: {
  ref: AgentRef;
  statusColors: Record<string, string>;
  bridge: OverlayBridge | null;
  skin: ReturnType<typeof useNativeSkin>;
  onHide: (agentId: string) => void;
}) {
  const agent = useAgent(ref) as PluginAgentSnapshot | null;
  if (!agent || !isVisibleAgent(agent)) return null;
  return (
    <ChatBubble
      agent={agent}
      statusColors={statusColors}
      bridge={bridge}
      skin={skin}
      unreadCount={0}
      onHide={() => onHide(agent.id)}
    />
  );
}
