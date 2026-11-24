import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { OverlayBridge } from "./bridge";
import type { NativeSkin } from "./native-skin";
import { initialsFor, needsInput, statusColorKey } from "./recent-chats";
import { RunningArc } from "./running-arc";
import { usePingAnimation } from "./use-ping-animation";

const BUBBLE_SIZE = 54;

/**
 * Bolinha de um chat recente com ping, anel de status, selos e hover.
 *
 * @param props Agente, cores de status, ponte IPC e pele.
 * @returns A bolinha renderizada na tira.
 */
export function ChatBubble({
  agent,
  statusColors,
  bridge,
  skin,
  unreadCount,
  onHide,
}: {
  agent: PluginAgentSnapshot;
  statusColors: Record<string, string>;
  bridge: OverlayBridge | null;
  skin: NativeSkin;
  unreadCount: number;
  onHide: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const bubbleRef = useRef<View>(null);
  const ping = usePingAnimation(agent.lastActivityAt, true);
  const colorKey = statusColorKey(agent);
  const color = colorKey ? (statusColors[colorKey] ?? skin.accentColor) : null;
  const awaiting = needsInput(agent);
  let badgeText = String(unreadCount);
  if (awaiting) badgeText = "?";
  else if (unreadCount > 9) badgeText = "9+";

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrapper: { position: "relative", width: BUBBLE_SIZE, height: BUBBLE_SIZE },
        ripple: {
          position: "absolute",
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          borderRadius: BUBBLE_SIZE / 2,
          backgroundColor: color ?? skin.accentColor,
          zIndex: -1,
        },
        bubble: {
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
          borderRadius: BUBBLE_SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: skin.surfaceColor,
          borderWidth: 3,
          borderColor: color ?? skin.borderColor,
        },
        initials: {
          color: skin.textColor,
          fontSize: 18,
          fontFamily: skin.fontFamily,
          fontWeight: "600",
        },
        badge: {
          position: "absolute",
          right: -2,
          bottom: -2,
          minWidth: 20,
          height: 20,
          borderRadius: 10,
          paddingHorizontal: 4,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: awaiting ? statusColors.statusDotWarning : skin.unreadColor,
          borderWidth: 2,
          borderColor: skin.surfaceColor,
        },
        badgeText: {
          color: skin.surfaceColor,
          fontSize: 11,
          fontFamily: skin.fontFamily,
          fontWeight: "700",
        },
        close: {
          position: "absolute",
          top: -8,
          ...(skin.closeOnLeft ? { left: -8 } : { right: -8 }),
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: skin.borderColor,
          opacity: hovered ? 1 : 0,
        },
        closeText: { color: skin.textColor, fontSize: 13, fontFamily: skin.fontFamily },
      }),
    [awaiting, color, hovered, skin, statusColors],
  );

  const openAgent = () => {
    void bridge?.openAgent?.({ serverId: agent.hostId, agentId: agent.id });
  };

  const showTooltip = useCallback(() => {
    if (!bridge?.openPopover) return;
    bubbleRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
      void bridge.openPopover({
        kind: "tooltip",
        agentId: agent.id,
        anchor: { x: pageX, y: pageY, width, height },
        size: { width: 320, height: 200 },
      });
    });
  }, [bridge, agent.id]);

  useEffect(() => {
    const node = bubbleRef.current as unknown as {
      addEventListener(type: string, listener: () => void): void;
      removeEventListener(type: string, listener: () => void): void;
    } | null;
    if (!node?.addEventListener) return;
    const enter = () => {
      setHovered(true);
      showTooltip();
    };
    const leave = () => {
      setHovered(false);
      void bridge?.closePopover?.();
    };
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    return () => {
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
    };
  }, [bridge, showTooltip]);

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[
          styles.ripple,
          { opacity: ping.rippleOpacity, transform: [{ scale: ping.rippleScale }] },
        ]}
      />
      <View
        ref={bubbleRef}
        onPointerEnter={() => {
          setHovered(true);
          showTooltip();
        }}
        onPointerLeave={() => {
          setHovered(false);
          void bridge?.closePopover?.();
        }}
        style={styles.wrapper}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={agent.title ?? agent.id}
          onPress={openAgent}
          onLongPress={showTooltip}
          style={styles.bubble}
        >
          <Animated.View style={{ transform: [{ scale: ping.scale }] }}>
            {agent.status === "running" && !ping.reducedMotion ? (
              <RunningArc
                size={BUBBLE_SIZE}
                color={color ?? skin.accentColor}
                trackColor={color ?? skin.accentColor}
                reducedMotion={ping.reducedMotion}
              />
            ) : null}
            <Text style={styles.initials}>{initialsFor(agent.title)}</Text>
          </Animated.View>
        </Pressable>
      </View>
      {awaiting || unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Esconder chat"
        onPress={onHide}
        style={styles.close}
      >
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </View>
  );
}
