import type { ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  findSkillHighlightRanges,
  type SkillHighlightRange,
} from "@/utils/agent-command-autocomplete";

export function SkillHighlightedText({
  text,
  skillNames,
  style,
  skillStyle,
  testID,
}: {
  text: string;
  skillNames: readonly string[];
  style?: StyleProp<TextStyle>;
  skillStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const ranges = findSkillHighlightRanges(text, skillNames);
  if (ranges.length === 0) {
    return (
      <Text style={style} testID={testID}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} testID={testID}>
      <SkillHighlightParts text={text} ranges={ranges} skillStyle={skillStyle} />
    </Text>
  );
}

function SkillHighlightParts({
  text,
  ranges,
  skillStyle,
}: {
  text: string;
  ranges: readonly SkillHighlightRange[];
  skillStyle?: StyleProp<TextStyle>;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <Text key={range.start} style={skillStyle}>
        {text.slice(range.start, range.end)}
      </Text>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
