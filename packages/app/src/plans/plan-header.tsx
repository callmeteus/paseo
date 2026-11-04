import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import { usePlan } from "@/plans/store";
import { PlanBuildButton } from "@/plans/build-button";

/** Header shown above a plan file preview: title, Plan badge, and Build action. */
export function PlanHeader({ path }: { path: string }) {
  const { serverId, workspaceId } = usePaneContext();
  const plan = usePlan({ serverId, workspaceId, path });
  if (!plan) return null;
  return (
    <View style={styles.header} testID="plan-header">
      <View style={styles.titleRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>PLAN</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {plan.title}
        </Text>
      </View>
      <PlanBuildButton path={path} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  titleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  badge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  badgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
}));
