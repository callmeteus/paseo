import type { ComponentRef, Ref } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { findSkillHighlightRanges } from "@/utils/agent-command-autocomplete";
import { composeComposerMirrorPieces, type ComposerMirrorPiece } from "./list-format";

interface ComposerMirrorTextProps {
  text: string;
  skillNames: readonly string[];
  style?: StyleProp<TextStyle>;
  skillStyle?: StyleProp<TextStyle>;
  testID?: string;
  /** The rendered text node, so a web mirror can copy the textarea's computed styles. */
  textRef?: Ref<ComponentRef<typeof Text>>;
}

/**
 * The visible composer text while a list or skill is on screen.
 * On web the bullet is drawn on top of the source marker, which stays in the
 * layout, so the caret in the transparent textarea remains on that glyph.
 */
export function ComposerMirrorText({
  text,
  skillNames,
  style,
  skillStyle,
  testID,
  textRef,
}: ComposerMirrorTextProps) {
  const pieces = composeComposerMirrorPieces(text, findSkillHighlightRanges(text, skillNames));
  return (
    <Text ref={textRef} style={style} testID={testID}>
      {pieces.map((piece) => renderPiece(piece, skillStyle))}
    </Text>
  );
}

function renderPiece(piece: ComposerMirrorPiece, skillStyle: StyleProp<TextStyle> | undefined) {
  if (piece.kind === "plain") return piece.text;
  if (piece.kind === "skill") {
    return (
      <Text key={piece.start} style={skillStyle}>
        {piece.text}
      </Text>
    );
  }
  if (piece.kind === "ordered") {
    return (
      <Text key={piece.start} style={styles.marker}>
        {piece.text}
      </Text>
    );
  }
  return <BulletMarker key={piece.start} source={piece.text} />;
}

function BulletMarker({ source }: { source: string }) {
  if (!isWeb) return <Text style={styles.marker}>{source}</Text>;
  return (
    <Text>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.hidden}>{source}</Text>
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  marker: {
    color: theme.colors.foregroundMuted,
  },
  hidden: {
    color: "transparent",
  },
  // Out of flow, sitting on the transparent source glyph.
  bullet: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 0,
    overflow: "visible",
    color: theme.colors.foregroundMuted,
  },
}));
