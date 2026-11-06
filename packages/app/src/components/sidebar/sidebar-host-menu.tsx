import {
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MenuSubTrigger, type MenuPageDefinition } from "@/components/ui/menu";
import { useToast } from "@/contexts/toast-context";
import { startDesktopDaemon, stopDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import type { HostColor } from "@/hosts/appearance";
import {
  HOST_REMOVE_REMOVES_WORKSPACES,
  formatHostRemoveMessage,
  hostContextMenuRows,
  hostMenuColors,
  hostRemoveConfirmation,
  nextHostLabel,
  type HostContextMenuRow,
} from "@/hosts/host-menu";
import { removeSavedHost } from "@/hosts/remove-saved-host";
import { useHostMutations } from "@/runtime/host-runtime";
import { identityColor } from "@/styles/identity-colors";
import { ICON_SIZE } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";

const COLOR_PAGE_ID = "color";

type HostMenuTriggerProps = Omit<ComponentProps<typeof ContextMenuTrigger>, "children">;

/**
 * Right click on a host header. The trigger is the row, so the browser's
 * Copy/Paste/Select All menu does not open on that row. Workspace rows keep
 * their own menu; this one is only the host.
 */
export function SidebarHostContextMenu({
  serverId,
  label,
  color,
  children,
  ...triggerProps
}: PropsWithChildren<
  HostMenuTriggerProps & {
    serverId: string;
    label: string;
    color: HostColor;
  }
>) {
  const { t } = useTranslation();
  const toast = useToast();
  const { renameHost, setHostColor, removeHost } = useHostMutations();
  const { updateSettings } = useDesktopSettings();
  const { data: daemonStatusData, setStatus } = useDaemonStatus();
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const [isRenaming, setIsRenaming] = useState(false);

  const openRename = useCallback(() => setIsRenaming(true), []);
  const closeRename = useCallback(() => setIsRenaming(false), []);

  const handleRename = useCallback(
    async (value: string) => {
      const next = nextHostLabel(label, value);
      if (next === null) return;
      await renameHost(serverId, next);
    },
    [label, renameHost, serverId],
  );

  const handleColor = useCallback(
    (next: HostColor) => {
      if (next === color) return;
      void setHostColor(serverId, next).catch(() => {
        toast.error(t("common.errors.unableToSave"));
      });
    },
    [color, serverId, setHostColor, t, toast],
  );

  const handleRemove = useCallback(() => {
    const daemon = daemonStatusData?.status ?? null;
    const confirmation = hostRemoveConfirmation({
      name: label,
      stopsOwnedDaemon: isLocalDaemon && daemon?.ownedByDesktop === true,
      removesWorkspaces: HOST_REMOVE_REMOVES_WORKSPACES,
    });
    const message = formatHostRemoveMessage({
      connectionMessage: t(confirmation.messageKey, { name: confirmation.name }),
      workspaceSentence: confirmation.workspaceSentenceKey
        ? t(confirmation.workspaceSentenceKey)
        : null,
    });
    void confirmDialog({
      title: t("sidebar.host.confirmations.removeTitle"),
      message,
      confirmLabel: t("sidebar.host.confirmations.removeConfirm"),
      cancelLabel: t("sidebar.host.confirmations.cancel"),
      destructive: true,
    }).then((confirmed) => {
      if (!confirmed) return undefined;
      void removeSavedHost(
        { serverId, isLocalDaemon, daemon },
        {
          removeHost,
          updateSettings,
          stopDaemon: () => stopDesktopDaemon("host_remove"),
          startDaemon: startDesktopDaemon,
          setDaemonStatus: setStatus,
        },
      ).catch((error) => {
        console.error("[Sidebar] Failed to remove host", error);
        toast.error(
          isLocalDaemon
            ? t("settings.host.daemon.remove.localErrorMessage")
            : t("settings.host.daemon.remove.errorMessage"),
        );
      });
      return undefined;
    });
  }, [
    daemonStatusData?.status,
    isLocalDaemon,
    label,
    removeHost,
    serverId,
    setStatus,
    t,
    toast,
    updateSettings,
  ]);

  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: COLOR_PAGE_ID,
        title: t("sidebar.host.actions.color"),
        content: <HostColorPage serverId={serverId} color={color} onChange={handleColor} />,
      },
    ],
    [color, handleColor, serverId, t],
  );

  const colorLabel = t(`settings.host.appearance.color.options.${color}`);

  function renderRow(row: HostContextMenuRow): ReactElement {
    switch (row) {
      case "separator":
        return <ContextMenuSeparator key={row} />;
      case "rename":
        return (
          <ContextMenuItem
            key={row}
            testID={`sidebar-host-menu-rename-${serverId}`}
            onSelect={openRename}
          >
            {t("sidebar.host.actions.rename")}
          </ContextMenuItem>
        );
      case "color":
        return (
          <MenuSubTrigger
            key={row}
            id={COLOR_PAGE_ID}
            value={colorLabel}
            testID={`sidebar-host-menu-color-${serverId}`}
          >
            {t("sidebar.host.actions.color")}
          </MenuSubTrigger>
        );
      case "remove":
        return (
          <ContextMenuItem
            key={row}
            testID={`sidebar-host-menu-remove-${serverId}`}
            destructive
            onSelect={handleRemove}
          >
            {t("sidebar.host.actions.remove")}
          </ContextMenuItem>
        );
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger {...triggerProps}>{children}</ContextMenuTrigger>
        <ContextMenuContent
          align="start"
          width={240}
          pages={pages}
          sheetTitle={t("sidebar.host.actions.menu")}
          testID={`sidebar-host-context-menu-${serverId}`}
        >
          {hostContextMenuRows().map((row) => renderRow(row))}
        </ContextMenuContent>
      </ContextMenu>
      <AdaptiveRenameModal
        visible={isRenaming}
        title={t("settings.host.daemon.rename.title")}
        initialValue={label}
        placeholder={t("settings.host.daemon.rename.placeholder")}
        submitLabel={t("settings.host.daemon.rename.submit")}
        onClose={closeRename}
        onSubmit={handleRename}
        testID={`sidebar-host-rename-modal-${serverId}`}
      />
    </>
  );
}

function HostColorPage({
  serverId,
  color,
  onChange,
}: {
  serverId: string;
  color: HostColor;
  onChange: (color: HostColor) => void;
}): ReactElement {
  return (
    <>
      {hostMenuColors().map((option) => (
        <HostColorMenuItem
          key={option}
          serverId={serverId}
          color={option}
          selected={option === color}
          onChange={onChange}
        />
      ))}
    </>
  );
}

function HostColorMenuItem({
  serverId,
  color,
  selected,
  onChange,
}: {
  serverId: string;
  color: HostColor;
  selected: boolean;
  onChange: (color: HostColor) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => onChange(color), [color, onChange]);
  const leading = useMemo(() => <HostColorSwatch color={color} />, [color]);
  return (
    <ContextMenuItem
      testID={`sidebar-host-menu-color-${serverId}-${color}`}
      selected={selected}
      leading={leading}
      onSelect={handleSelect}
    >
      {t(`settings.host.appearance.color.options.${color}`)}
    </ContextMenuItem>
  );
}

function HostColorSwatch({ color }: { color: HostColor }): ReactElement {
  const swatchStyle = useMemo(
    (): StyleProp<ViewStyle> => [
      styles.swatch,
      color === "none" ? null : { backgroundColor: identityColor(color) },
    ],
    [color],
  );
  return <View style={swatchStyle} />;
}

const styles = StyleSheet.create((theme) => ({
  swatch: {
    width: ICON_SIZE.sm,
    height: ICON_SIZE.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
}));
