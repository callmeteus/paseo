import type { ComponentRef, ReactNode, Ref } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  findSkillHighlightRanges,
  type SkillHighlightRange,
} from "@/utils/agent-command-autocomplete";

interface SkillHighlightedTextProps {
  text: string;
  skillNames: readonly string[];
  style?: StyleProp<TextStyle>;
  skillStyle?: StyleProp<TextStyle>;
  testID?: string;
  /** The rendered text node, so a web mirror can copy the textarea's computed styles. */
  textRef?: Ref<ComponentRef<typeof Text>>;
}

export function SkillHighlightedText({
  text,
  skillNames,
  style,
  skillStyle,
  testID,
  textRef,
}: SkillHighlightedTextProps) {
  const ranges = findSkillHighlightRanges(text, skillNames);
  if (ranges.length === 0) {
    return (
      <Text ref={textRef} style={style} testID={testID}>
        {text}
      </Text>
    );
  }
  return (
    <Text ref={textRef} style={style} testID={testID}>
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
