import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { StyleSheet, View } from "react-native";

import { FloatingChats } from "./floating-chats";
import { PopoverScreen } from "./popover-screen";

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
});

/**
 * Raiz da screen do overlay, escolhida pelo parâmetro `overlay`.
 *
 * @param props Props da screen do plugin.
 * @returns A tira ou o popover.
 */
export function OverlayRoot(props: PluginScreenProps) {
  if (props.params.overlay === "popover") {
    return <PopoverScreen {...props} />;
  }
  return (
    <View style={styles.root}>
      <FloatingChats {...props} />
    </View>
  );
}
