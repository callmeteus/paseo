import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet as UnistylesStyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { ThemedNotificationInfo } from "@/components/message-shared";
import { infoColorMapping } from "@/components/message-shared";
import { useDisableOuterSpacing } from "@/components/message-shared";

interface GoalCompleteNoticeProps {
  message: string;
  disableOuterSpacing?: boolean;
}

const stylesheet = UnistylesStyleSheet.create((theme) => ({
  container: {
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  bg: {
    backgroundColor: "rgba(147, 197, 253, 0.1)",
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
    gap: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconContainer: {
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
  },
  headerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600" as const,
    lineHeight: 20,
    flex: 1,
  },
  objectiveOuter: {
    minWidth: 0,
    width: "100%",
  },
  objectiveCollapsedClip: {
    maxHeight: Math.round(theme.fontSize.base * 1.4) * 4,
    overflow: "hidden" as const,
  },
  objectiveMarkdown: {
    color: theme.colors.foreground,
  },
  toggleButton: {
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  toggleText: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.base,
    fontWeight: "500" as const,
  },
}));

export const GoalCompleteNotice = React.memo(function GoalCompleteNotice({
  message,
  disableOuterSpacing,
}: GoalCompleteNoticeProps) {
  const { t } = useTranslation();
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [expanded, setExpanded] = useState(false);

  const prefix = t("goalNotice.complete", { objective: "" });
  const objective = message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
  const header = prefix.trim();

  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);

  const containerStyle = useMemo(
    () => [
      stylesheet.container,
      !resolvedDisableOuterSpacing && stylesheet.containerSpacing,
      stylesheet.bg,
    ],
    [resolvedDisableOuterSpacing],
  );

  const objectiveOuterStyle = useMemo(
    () => [stylesheet.objectiveOuter, !expanded ? stylesheet.objectiveCollapsedClip : null],
    [expanded],
  );

  return (
    <View style={containerStyle}>
      <View style={stylesheet.content}>
        <View style={stylesheet.row}>
          <View style={stylesheet.iconContainer}>
            <ThemedNotificationInfo size={16} uniProps={infoColorMapping} />
          </View>
          <Text style={stylesheet.headerText}>{header}</Text>
        </View>
        <View style={objectiveOuterStyle}>
          <MarkdownRenderer text={objective} compact />
        </View>
        <PressHighlight
          onPress={handleToggle}
          style={stylesheet.toggleButton}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? t("composer.goal.collapseObjective") : t("composer.goal.expandObjective")
          }
        >
          <Text style={stylesheet.toggleText}>
            {expanded ? t("composer.goal.collapseObjective") : t("composer.goal.expandObjective")}
          </Text>
        </PressHighlight>
      </View>
    </View>
  );
});
