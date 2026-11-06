import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import type { AgentProfilePicker, AgentProfileSeed } from "@/agent-profiles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Combobox, type ComboboxOption, type ComboboxProps } from "@/components/ui/combobox";
import { ModelBrowser, ModelProviderGlyph, useModelBrowser } from "@/components/model-browser";
import { resolveModelBrowserScrolling } from "@/components/model-browser-view";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { ModelIconGlyph } from "@/model-icons/glyph";
import type { ModelIconId } from "@/model-icons/icons";
import { resolveChoiceIconId, shouldHideRedundantModelGlyph } from "@/model-icons/resolve";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import { useActiveRouter } from "@/model-routers/use-router-picker";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function noop() {}

interface CombinedModelSelectorProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  onSelect: (provider: AgentProvider, modelId: string, serverId?: string | null) => void;
  isLoading: boolean;
  profiles?: AgentProfilePicker | null;
  onApplyProfile?: (profileId: string) => void;
  onEditProfiles?: () => void;
  onCreateProfile?: (seed: AgentProfileSeed) => void;
  onEditProfile?: (profileId: string) => void;
  renderTrigger?: (input: {
    selectedModelLabel: string;
    onPress: () => void;
    disabled: boolean;
    isOpen: boolean;
    hovered: boolean;
    pressed: boolean;
  }) => React.ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
  desktopPlacement?: ComboboxProps["desktopPlacement"];
  desktopMinWidth?: number;
  /**
   * Render the custom trigger as a full-width form field: the outer Pressable
   * becomes a transparent passthrough that stretches its child edge-to-edge and
   * stops painting its own hover/pressed background and rounded corners. The
   * trigger itself owns the field visuals and reads hovered/pressed to show its
   * active state. Without this the trigger stays a content-width toolbar chip
   * (the composer's layout).
   */
  triggerFill?: boolean;
  toolbar?: {
    glyphSize: number;
    showCaret: boolean;
  };
  /** Called after the user picks (or clears) a router in the browser. */
  onRouterPicked?: (routerId: string | null) => void;
  /** Replaces the default "selected model" label when this selector is not the chat's model. */
  accessibilityLabel?: string;
  /** Short explanation shown above the trigger. */
  tooltip?: string;
  /** Router bound to the chat (or staged); undefined uses the default router. */
  activeRouterId?: string | null;
}

/**
 * The closed list hides its hint. Focus inside the open search is not the trigger,
 * and the hint would cover the rows.
 */
function withModelSelectorTooltip(
  trigger: ReactElement,
  tooltip: string | undefined,
  isOpen: boolean,
): ReactElement {
  if (!tooltip || isOpen) return trigger;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        {trigger}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function DefaultModelSelectorTrigger({
  anchorRef,
  disabled,
  onPress,
  style,
  accessibilityLabel,
  toolbar,
  selectedProvider,
  serverId,
  label,
  activeRouterName,
  iconId,
}: {
  anchorRef: RefObject<View | null>;
  disabled: boolean;
  onPress: () => void;
  style: (state: { pressed: boolean; hovered: boolean; focused: boolean }) => StyleProp<ViewStyle>;
  accessibilityLabel: string;
  toolbar?: { glyphSize: number; showCaret: boolean };
  selectedProvider: string;
  serverId: string | null;
  label: string;
  activeRouterName: string | null;
  iconId: ModelIconId | null;
}): ReactElement {
  const glyphSize = toolbar?.glyphSize ?? ICON_SIZE.md;
  const hasProvider = selectedProvider.trim().length > 0;
  const showModelGlyph =
    iconId !== null && !shouldHideRedundantModelGlyph(selectedProvider, iconId);
  const showGlyph = showModelGlyph || hasProvider;
  const glyphBoxStyle = toolbar?.glyphSize === 20 ? styles.toolbarGlyph20 : styles.toolbarGlyph16;
  return (
    <ComboboxTrigger
      ref={anchorRef}
      collapsable={false}
      disabled={disabled}
      onPress={onPress}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="combined-model-selector"
      chevron={toolbar?.showCaret === false ? null : undefined}
    >
      {showGlyph ? (
        <View style={styles.toolbarGlyphRow}>
          {hasProvider ? (
            <View style={glyphBoxStyle}>
              <ModelProviderGlyph
                provider={selectedProvider}
                serverId={serverId}
                size={glyphSize}
              />
            </View>
          ) : null}
          {showModelGlyph && iconId ? (
            <View style={glyphBoxStyle}>
              <ModelIconGlyph id={iconId} size={glyphSize} color={styles.mark.color} />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.triggerTextColumn}>
        <Text style={styles.triggerText} numberOfLines={1} ellipsizeMode="tail">
          {label}
        </Text>
        {activeRouterName ? (
          <Text style={styles.triggerRouter} numberOfLines={1} ellipsizeMode="tail">
            {activeRouterName}
          </Text>
        ) : null}
      </View>
    </ComboboxTrigger>
  );
}

export function CombinedModelSelector({
  providers,
  selectedProvider,
  selectedModel,
  onSelect,
  isLoading,
  profiles = null,
  onApplyProfile,
  onEditProfiles,
  onCreateProfile,
  onEditProfile,
  renderTrigger,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
  desktopPlacement,
  desktopMinWidth,
  triggerFill = false,
  toolbar,
  onRouterPicked,
  activeRouterId,
  accessibilityLabel: accessibilityLabelProp,
  tooltip,
}: CombinedModelSelectorProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const activeRouter = useActiveRouter(serverId, activeRouterId);
  const activeRouterName = activeRouter?.name ?? null;
  const modelBrowserScrolling = resolveModelBrowserScrolling({ isNative, isCompact });
  const anchorRef = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isContentReady, setIsContentReady] = useState(isWeb);
  const browser = useModelBrowser({
    providers,
    selectedProvider,
    selectedModel,
    isLoading,
    profiles,
    serverId,
  });
  const { prepareToOpen, reset } = browser;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (open) {
        prepareToOpen();
        onOpen?.();
        return;
      }
      reset();
      onClose?.();
    },
    [onClose, onOpen, prepareToOpen, reset],
  );

  const handleSelect = useCallback(
    (provider: string, modelId: string, targetServerId?: string | null) => {
      onSelect(provider, modelId, targetServerId);
      handleOpenChange(false);
    },
    [handleOpenChange, onSelect],
  );

  useEffect(() => {
    if (isWeb) return () => {};
    if (!isOpen) {
      setIsContentReady(false);
      return () => {};
    }
    const frame = requestAnimationFrame(() => {
      setIsContentReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleTriggerPress = useCallback(() => {
    handleOpenChange(!isOpen);
  }, [handleOpenChange, isOpen]);

  const triggerStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (triggerFill) {
        return [
          styles.trigger,
          styles.customTriggerWrapper,
          styles.triggerFill,
          disabled && styles.triggerDisabled,
        ];
      }
      return [
        styles.trigger,
        Boolean(hovered) && styles.triggerHovered,
        (pressed || isOpen) && styles.triggerPressed,
        disabled && styles.triggerDisabled,
        renderTrigger ? styles.customTriggerWrapper : null,
      ];
    },
    [disabled, isOpen, renderTrigger, triggerFill],
  );

  const handleApplyProfile = useCallback(
    (profileId: string) => {
      onApplyProfile?.(profileId);
      handleOpenChange(false);
    },
    [handleOpenChange, onApplyProfile],
  );

  const handleEditProfiles = useCallback(() => {
    handleOpenChange(false);
    onEditProfiles?.();
  }, [handleOpenChange, onEditProfiles]);

  const handleCreateProfile = useCallback(
    (seed: AgentProfileSeed) => {
      handleOpenChange(false);
      onCreateProfile?.(seed);
    },
    [handleOpenChange, onCreateProfile],
  );

  const handleEditProfile = useCallback(
    (profileId: string) => {
      handleOpenChange(false);
      onEditProfile?.(profileId);
    },
    [handleOpenChange, onEditProfile],
  );

  const selectorBody = isContentReady ? (
    <ModelBrowser
      state={browser}
      onSelect={handleSelect}
      onApplyProfile={handleApplyProfile}
      onEditProfiles={onEditProfiles ? handleEditProfiles : undefined}
      onCreateProfile={onCreateProfile ? handleCreateProfile : undefined}
      onEditProfile={onEditProfile ? handleEditProfile : undefined}
      onRetryProvider={onRetryProvider}
      isRetryingProvider={isRetryingProvider}
      scrolling={modelBrowserScrolling}
      onRouterPicked={onRouterPicked}
      selectedRouterId={activeRouterId}
    />
  ) : (
    <View style={styles.sheetLoadingState}>
      <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
      <Text style={styles.sheetLoadingText}>{t("modelSelector.loadingSelector")}</Text>
    </View>
  );

  const accessibilityLabel =
    accessibilityLabelProp ??
    t("modelSelector.selectedModel", {
      model: browser.selectedModelLabel,
    });
  const trigger = renderTrigger ? (
    <Pressable
      ref={anchorRef}
      collapsable={false}
      disabled={disabled}
      onPress={handleTriggerPress}
      style={triggerStyle}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID="combined-model-selector"
    >
      {({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
        renderTrigger({
          selectedModelLabel: browser.triggerLabel,
          onPress: handleTriggerPress,
          disabled,
          isOpen,
          hovered: Boolean(hovered),
          pressed,
        })
      }
    </Pressable>
  ) : (
    <DefaultModelSelectorTrigger
      anchorRef={anchorRef}
      disabled={disabled}
      onPress={handleTriggerPress}
      style={triggerStyle}
      accessibilityLabel={accessibilityLabel}
      {...(toolbar === undefined ? {} : { toolbar })}
      selectedProvider={selectedProvider}
      serverId={serverId}
      label={browser.triggerLabel}
      activeRouterName={activeRouterName}
      iconId={resolveChoiceIconId({
        modelId: selectedModel,
        modelLabel: browser.selectedModelLabel,
        router: activeRouter,
      })}
    />
  );
  const triggerWithTooltip = withModelSelectorTooltip(trigger, tooltip, isOpen);

  return (
    <>
      {triggerWithTooltip}
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement={desktopPlacement}
        desktopMinWidth={desktopMinWidth}
        desktopLockWidth
        desktopFixedHeight={browser.desktopFixedHeight}
        desktopChildrenScrollEnabled={false}
        header={browser.header}
        mobileChildrenScrollEnabled={!browser.isDrillDownView || !isNative}
        mobileChildrenContentContainerStyle={styles.mobileBrowserContent}
      >
        {selectorBody}
      </Combobox>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  mobileBrowserContent: {
    paddingHorizontal: 0,
  },
  trigger: {
    minHeight: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius["2xl"],
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  mark: {
    color: theme.colors.foregroundMuted,
  },
  toolbarGlyphRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  toolbarGlyph16: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  toolbarGlyph20: {
    width: 20,
    height: 20,
    flexShrink: 0,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface0,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  triggerTextColumn: {
    minWidth: 0,
    flexShrink: 1,
  },
  triggerRouter: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize["2xs"],
    fontWeight: theme.fontWeight.normal,
  },
  customTriggerWrapper: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    height: "auto",
  },
  triggerFill: {
    alignSelf: "stretch",
    flexShrink: 0,
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "transparent",
    borderRadius: 0,
  },
  sheetLoadingState: {
    minHeight: 160,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sheetLoadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
