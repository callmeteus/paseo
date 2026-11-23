import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Modal, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { isWeb } from "@/constants/platform";
import { useOverlayRegistration } from "@/keyboard";
import { OverlayLayerProvider, useGlobalOverlayLayer } from "@/lib/overlay-root";

/**
 * The command-center / host-chooser panel: a top-aligned surface, a borderless
 * search field, and flush rows. Searchable pickers use this instead of a titled
 * sheet with a close button and a boxed field.
 */
export interface CommandPanelSearch {
  onChangeText: (value: string) => void;
  placeholder?: string;
  testID?: string;
  resetKey?: string | number;
  autoFocus?: boolean;
}

const ThemedSearchInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

export function CommandPanel({
  visible,
  onClose,
  title,
  subtitle,
  search,
  headerTrailing,
  children,
  testID,
  fill = false,
  onKeyDown,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: ReactNode;
  search?: CommandPanelSearch;
  headerTrailing?: ReactNode;
  children: ReactNode;
  testID?: string;
  /** Gives a virtualized list a fixed viewport, the same height as the command center. */
  fill?: boolean;
  /** Return true when the key was handled. Escape still closes when this returns false. */
  onKeyDown?: (event: KeyboardEvent) => boolean;
}) {
  const modalLayer = useGlobalOverlayLayer("modal", isWeb && visible);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (onKeyDown?.(event)) return true;
      if (event.key !== "Escape") return false;
      event.preventDefault();
      onClose();
      return true;
    },
    [onClose, onKeyDown],
  );
  const setWebOverlayScope = useOverlayRegistration({
    keys: ["Escape"],
    active: isWeb && visible,
    layer: modalLayer,
    onKeyDown: handleKeyDown,
  });

  if (!visible) return null;

  const panel = (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID={testID}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View ref={setWebOverlayScope} style={[styles.panel, fill && styles.panelFill]}>
          <View style={styles.header}>
            {title ? (
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {search ? null : headerTrailing}
              </View>
            ) : null}
            {subtitle}
            {search ? (
              <View style={styles.searchRow}>
                <CommandPanelSearchField search={search} />
                {headerTrailing}
              </View>
            ) : null}
          </View>
          <View style={[styles.body, fill && styles.bodyFill]}>{children}</View>
        </View>
      </View>
    </Modal>
  );

  return <OverlayLayerProvider layer={isWeb ? modalLayer : 0}>{panel}</OverlayLayerProvider>;
}

function CommandPanelSearchField({ search }: { search: CommandPanelSearch }) {
  const inputRef = useRef<EditingTextInputHandle>(null);
  const previousResetKey = useRef(search.resetKey);
  useEffect(() => {
    if (search.resetKey === previousResetKey.current) return;
    previousResetKey.current = search.resetKey;
    inputRef.current?.replaceText("");
    if (search.autoFocus) inputRef.current?.focus();
  }, [search.autoFocus, search.resetKey]);

  return (
    <ThemedSearchInput
      ref={inputRef}
      initialValue=""
      onChangeText={search.onChangeText}
      placeholder={search.placeholder}
      style={styles.input}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={search.autoFocus}
      testID={search.testID}
    />
  );
}

export function CommandPanelRow({
  title,
  meta,
  metaLines = 1,
  trailing,
  onPress,
  disabled = false,
  testID,
  children,
}: {
  title: string;
  meta?: string;
  metaLines?: number;
  trailing?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  children?: ReactNode;
}) {
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      disabled && styles.rowDisabled,
      (hovered || pressed) && !disabled && styles.rowActive,
    ],
    [disabled],
  );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      {children}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={metaLines}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  panel: {
    width: 640,
    maxWidth: "92%",
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
    ...theme.shadow.lg,
  },
  panelFill: {
    height: 560,
  },
  header: {
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    padding: 0,
    outlineWidth: 0,
  },
  body: {
    flexShrink: 1,
    minHeight: 0,
  },
  bodyFill: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    minHeight: 56,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  rowActive: {
    backgroundColor: theme.colors.surface1,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
