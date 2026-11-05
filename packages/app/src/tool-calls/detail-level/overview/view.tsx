import React, { memo, useCallback, useRef, useState, type ReactNode } from "react";
import {
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { Plug, Wrench } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { IndentRail } from "@/components/indent-rail";
import { ExpandableBadge, type ExpandableBadgeLabelContext } from "@/components/message";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { useOverviewSummaryDisplay } from "./label";
import type { OverviewToolCallGroup } from "./model";
import { OverviewToolCallGroupSheet } from "./sheet";

interface OverviewGroupProps {
  group: OverviewToolCallGroup;
  expanded: boolean;
  isLastInSequence: boolean;
  onExpandedChange: (groupId: string, expanded: boolean) => void;
  children: ReactNode;
}

const TOOL_CALL_GROUP_MAX_HEIGHT = 400;

const ThemedPlug = withUnistyles(Plug);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const LabelSegmentText = memo(function LabelSegmentText({
  index,
  text,
  textStyle,
  shimmerStyle,
  isLast,
  onMeasure,
}: {
  index: number;
  text: string;
  textStyle: StyleProp<TextStyle>;
  shimmerStyle: object | null;
  isLast: boolean;
  onMeasure: (index: number, event: LayoutChangeEvent) => void;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onMeasure(index, event),
    [index, onMeasure],
  );
  const baseStyle: StyleProp<TextStyle> = isLast
    ? [textStyle, styles.labelTrailingSegment]
    : textStyle;
  return (
    <Text
      style={shimmerStyle ? ([baseStyle, shimmerStyle] as StyleProp<TextStyle>) : baseStyle}
      numberOfLines={1}
      onLayout={handleLayout}
    >
      {text}
    </Text>
  );
});

export const OverviewToolCallGroupView = memo(function OverviewToolCallGroupView({
  group,
  expanded,
  isLastInSequence,
  onExpandedChange,
  children,
}: OverviewGroupProps) {
  const scrollRef = useRef<ScrollView>(null);
  const isCompact = useIsCompactFormFactor();
  const label = useOverviewSummaryDisplay(group.summary);
  const [segmentOffsets, setSegmentOffsets] = useState<readonly number[]>([]);

  const handleSegmentLayout = useCallback((index: number, event: LayoutChangeEvent) => {
    const x = event.nativeEvent.layout.x;
    setSegmentOffsets((previous) => {
      if (previous[index] === x) {
        return previous;
      }
      const next = [...previous];
      next[index] = x;
      return next;
    });
  }, []);

  const renderLabel = useCallback(
    ({ pass, textStyle, onFlowLayout, buildSegmentShimmer }: ExpandableBadgeLabelContext) => {
      return (
        <View style={styles.labelFlow} onLayout={onFlowLayout}>
          {label.segments.map((segment, index) => {
            const isLast = index === label.segments.length - 1;
            // Each segment carries its own slice of one gradient, so the shine crosses the
            // whole sentence instead of restarting inside every part.
            const shimmer = buildSegmentShimmer?.(segmentOffsets[index] ?? 0) ?? null;
            const textNode = (
              <LabelSegmentText
                index={index}
                text={segment.text}
                textStyle={textStyle}
                shimmerStyle={shimmer}
                isLast={isLast}
                onMeasure={handleSegmentLayout}
              />
            );
            const key = `${segment.text}-${index}`;
            if (!segment.icon) {
              return <React.Fragment key={key}>{textNode}</React.Fragment>;
            }
            return (
              <View key={key} style={styles.labelSegmentWithIcon}>
                {pass === "mask" ? (
                  // The native mask is a MaskedView element, which does not take an Svg.
                  // A block of the same size keeps the masked text on the real glyphs.
                  <View style={styles.labelIconPlaceholder} />
                ) : (
                  <ThemedPlug size={11} uniProps={mutedColorMapping} />
                )}
                {textNode}
              </View>
            );
          })}
        </View>
      );
    },
    [handleSegmentLayout, label, segmentOffsets],
  );

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, []);
  const toggle = useCallback(() => {
    onExpandedChange(group.run.id, !expanded);
  }, [expanded, group.run.id, onExpandedChange]);
  const close = useCallback(() => {
    onExpandedChange(group.run.id, false);
  }, [group.run.id, onExpandedChange]);
  const renderDetails = useCallback(
    () => (
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        onContentSizeChange={scrollToLatest}
      >
        <IndentRail>{children}</IndentRail>
      </ScrollView>
    ),
    [children, scrollToLatest],
  );

  if (isCompact) {
    return (
      <>
        <ExpandableBadge
          testID="tool-call-group"
          label={label.text}
          renderLabel={renderLabel}
          icon={Wrench}
          isLoading={group.isLoading}
          isExpanded={false}
          isLastInSequence={isLastInSequence}
          onToggle={toggle}
        />
        <OverviewToolCallGroupSheet visible={expanded} summary={label.text} onClose={close}>
          {children}
        </OverviewToolCallGroupSheet>
      </>
    );
  }

  return (
    <ExpandableBadge
      testID="tool-call-group"
      label={label.text}
      renderLabel={renderLabel}
      icon={Wrench}
      isLoading={group.isLoading}
      isExpanded={expanded}
      isLastInSequence={isLastInSequence}
      onToggle={toggle}
      renderDetails={renderDetails}
      borderlessWhenExpanded
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  scroll: {
    maxHeight: TOOL_CALL_GROUP_MAX_HEIGHT,
  },
  content: {
    paddingTop: theme.spacing[1],
    paddingHorizontal: 13,
  },
  // Segments flow as one sentence. Only the trailing one may shrink, so overflow ellipsizes
  // at the end of the summary instead of truncating a part in the middle.
  labelFlow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    overflow: "hidden",
  },
  labelSegmentWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  labelIconPlaceholder: {
    width: 11,
    height: 11,
  },
  labelTrailingSegment: {
    flexShrink: 1,
  },
}));
