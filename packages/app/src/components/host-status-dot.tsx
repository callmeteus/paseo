import { View } from "react-native";
import { CircleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

const ThemedCircleAlert = withUnistyles(CircleAlert);
const errorAlertMapping = (theme: Theme) => ({
  fill: theme.colors.statusDanger,
  color: theme.colors.surface0,
});

export const HOST_STATUS_DOT_SIZE = 8;

export function connectionLabelKey(status: HostRuntimeConnectionStatus): string {
  switch (status) {
    case "online":
      return "common.connectionStatus.online";
    case "connecting":
      return "common.connectionStatus.connecting";
    case "error":
      return "common.connectionStatus.error";
    case "offline":
      return "common.connectionStatus.offline";
    case "idle":
      return "common.connectionStatus.idle";
  }
}

/**
 * A host's connection state, at the same size everywhere it appears.
 *
 * Shape carries the distinction that color alone cannot: online and connecting
 * are filled dots, offline is a hollow ring (nothing there), and an error is an
 * alert glyph. A plain red disc used to mean both "offline" and "error", which
 * made a broken host look merely disconnected.
 */
export function HostStatusDot({
  serverId,
  status: statusOverride,
}: {
  serverId: string;
  status?: HostRuntimeConnectionStatus;
}) {
  const runtimeStatus = useHostRuntimeConnectionStatus(serverId);
  const status = statusOverride ?? runtimeStatus;
  const { t } = useTranslation();

  return (
    <View
      style={[styles.dot, statusStyle(status)]}
      accessibilityRole="image"
      accessibilityLabel={t(connectionLabelKey(status))}
    >
      {status === "error" ? (
        <ThemedCircleAlert size={11} strokeWidth={2.5} uniProps={errorAlertMapping} />
      ) : null}
    </View>
  );
}

function statusStyle(status: HostRuntimeConnectionStatus) {
  if (status === "online") return styles.dotOnline;
  if (status === "connecting") return styles.dotConnecting;
  if (status === "error") return styles.dotError;
  return styles.dotOffline;
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: HOST_STATUS_DOT_SIZE,
    height: HOST_STATUS_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  dotOnline: {
    backgroundColor: theme.colors.statusSuccess,
  },
  dotConnecting: {
    backgroundColor: theme.colors.statusWarning,
  },
  // A hollow ring reads as "not there"; a filled red disc read as "broken".
  dotOffline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.foregroundExtraMuted,
  },
  dotError: {
    backgroundColor: "transparent",
  },
}));
