import {
  useMemo,
  useCallback,
  type ComponentProps,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { View, type GestureResponderEvent, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Archive,
  Circle,
  CircleCheck,
  Copy,
  FolderInput,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  Tag,
  Trash2,
} from "lucide-react-native";
import { getIsElectron, isWeb } from "@/constants/platform";
import {
  isWorkspaceMenuSeparator,
  workspaceMenuRows,
  workspacePinAction,
  type WorkspaceMenuAction,
} from "@/components/sidebar/workspace-menu-model";
import { openMoveWorkspaceToFolder } from "@/screens/workspace/move-workspace-to-folder-store";
import { getForgePresentation, normalizeForge } from "@/git/forge";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { Shortcut } from "@/components/ui/shortcut";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { resolveSidebarWorkspaceAccessibilityLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceServiceLabelKey,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import {
  useWorkspaceLabelMenuPages,
  WORKSPACE_LABEL_PAGE_ID,
  type WorkspaceLabelTarget,
} from "@/workspace-labels/picker";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedArchive = withUnistyles(Archive);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedCircle = withUnistyles(Circle);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedTag = withUnistyles(Tag);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const moveToFolderLeadingIcon = (
  <ThemedFolderInput size={14} uniProps={foregroundMutedColorMapping} />
);
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const markAsUnreadLeadingIcon = <ThemedCircle size={14} uniProps={foregroundMutedColorMapping} />;
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const deleteLeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;

function stopRowPress(event: GestureResponderEvent): void {
  event.stopPropagation();
}

/** Pin and archive sit beside the workspace menu while that menu is showing. */
export function SidebarWorkspaceHoverActions({
  workspaceKey,
  isPinned,
  onTogglePin,
  onArchive,
  archiveLabel,
  archiveStatus,
  children,
}: {
  workspaceKey: string;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const pinAction = workspacePinAction(isPinned === true);
  const pinLabel = t(`sidebar.workspace.actions.${pinAction}`);
  const archiveAccessibilityLabel = archiveLabel ?? t("sidebar.workspace.actions.archive");
  const handlePin = useCallback(
    (event: GestureResponderEvent) => {
      stopRowPress(event);
      onTogglePin?.();
    },
    [onTogglePin],
  );
  const handleArchive = useCallback(
    (event: GestureResponderEvent) => {
      stopRowPress(event);
      onArchive?.();
    },
    [onArchive],
  );
  return (
    <View style={styles.hoverActions}>
      {onTogglePin ? (
        <ToolbarButton
          label={pinLabel}
          onPress={handlePin}
          style={styles.hoverIconButton}
          testID={`sidebar-workspace-pin-${workspaceKey}`}
        >
          {pinAction === "unpin" ? (
            <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />
          ) : (
            <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />
          )}
        </ToolbarButton>
      ) : null}
      {onArchive ? (
        <ToolbarButton
          label={archiveAccessibilityLabel}
          disabled={archiveStatus === "pending"}
          onPress={handleArchive}
          style={styles.hoverIconButton}
          testID={`sidebar-workspace-archive-${workspaceKey}`}
        >
          <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />
        </ToolbarButton>
      ) : null}
      {children}
    </View>
  );
}

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

export interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  serverId?: string;
  workspaceId?: string;
  workspaceLabels?: readonly string[];
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onMarkAsUnread?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  onDelete?: () => void;
  isPinned?: boolean;
  onTogglePin?: () => void;
  openInFileManagerPath?: string | null;
  /**
   * Lifted so the row that reveals the kebab can keep it mounted while its menu is up. See
   * `useOpenKebabMenuVisibility`.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface SidebarWorkspaceMenuItemsProps extends Omit<
  SidebarWorkspaceMenuProps,
  "onArchive" | "open" | "onOpenChange"
> {
  onArchive?: () => void;
}

type MenuSurface = "context" | "dropdown";

function WorkspaceMenuItem({
  surface,
  children,
  ...props
}: PropsWithChildren<
  Omit<ComponentProps<typeof DropdownMenuItem>, "children"> & { surface: MenuSurface }
>) {
  if (surface === "context") {
    return <ContextMenuItem {...props}>{children}</ContextMenuItem>;
  }
  return <DropdownMenuItem {...props}>{children}</DropdownMenuItem>;
}

function MoveWorkspaceToFolderMenuItem({
  surface,
  workspaceKey,
  serverId,
  workspaceId,
}: {
  surface: MenuSurface;
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
}): ReactNode {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    openMoveWorkspaceToFolder({ serverId, workspaceId });
  }, [serverId, workspaceId]);

  return (
    <WorkspaceMenuItem
      surface={surface}
      testID={`sidebar-workspace-menu-move-to-folder-${workspaceKey}`}
      leading={moveToFolderLeadingIcon}
      onSelect={handleSelect}
    >
      {t("sidebar.workspace.actions.moveToFolder")}
    </WorkspaceMenuItem>
  );
}

function WorkspaceMenuSeparator({ surface }: { surface: MenuSurface }): ReactNode {
  return surface === "context" ? <ContextMenuSeparator /> : <DropdownMenuSeparator />;
}

function SidebarWorkspaceMenuItems({
  surface,
  workspaceKey,
  serverId,
  workspaceId,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onDelete,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
}: SidebarWorkspaceMenuItemsProps & { surface: MenuSurface }): ReactNode {
  const { t } = useTranslation();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const labelLeading = useMemo(
    () => <ThemedTag size={14} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const pinAction = workspacePinAction(isPinned === true);
  const rows = workspaceMenuRows({
    archive: Boolean(onArchive),
    pin: Boolean(onTogglePin),
    rename: Boolean(onRename),
    labels: Boolean(serverId && workspaceId),
    "mark-as-read": Boolean(onMarkAsRead),
    "mark-as-unread": Boolean(onMarkAsUnread),
    move: Boolean(serverId && workspaceId),
    "copy-path": Boolean(onCopyPath),
    "copy-branch": Boolean(onCopyBranchName),
    "open-folder": getIsElectron() && Boolean(openInFileManagerPath?.trim()),
    delete: Boolean(onDelete),
  });

  function renderChatAction(action: WorkspaceMenuAction): ReactNode {
    switch (action) {
      case "archive":
        return onArchive ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
            leading={archiveLeadingIcon}
            trailing={archiveTrailing}
            status={archiveStatus}
            pendingLabel={archivePendingLabel}
            onSelect={onArchive}
          >
            {archiveLabel ?? t("sidebar.workspace.actions.archive")}
          </WorkspaceMenuItem>
        ) : null;
      case "pin":
        return onTogglePin ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-pin-${workspaceKey}`}
            leading={pinAction === "unpin" ? unpinLeadingIcon : pinLeadingIcon}
            onSelect={onTogglePin}
          >
            {t(`sidebar.workspace.actions.${pinAction}`)}
          </WorkspaceMenuItem>
        ) : null;
      case "rename":
        return onRename ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
            leading={renameLeadingIcon}
            onSelect={onRename}
          >
            {t("sidebar.workspace.actions.rename")}
          </WorkspaceMenuItem>
        ) : null;
      case "labels":
        return serverId && workspaceId ? (
          <DropdownMenuSubTrigger
            key={action}
            id={WORKSPACE_LABEL_PAGE_ID}
            leading={labelLeading}
            testID={`sidebar-workspace-menu-labels-${workspaceKey}`}
          >
            {t("workspaceLabels.title")}
          </DropdownMenuSubTrigger>
        ) : null;
      case "mark-as-read":
        return onMarkAsRead ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
            leading={markAsReadLeadingIcon}
            onSelect={onMarkAsRead}
          >
            Mark as read
          </WorkspaceMenuItem>
        ) : null;
      case "mark-as-unread":
        return onMarkAsUnread ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-mark-as-unread-${workspaceKey}`}
            leading={markAsUnreadLeadingIcon}
            onSelect={onMarkAsUnread}
          >
            Mark as unread
          </WorkspaceMenuItem>
        ) : null;
      default:
        return null;
    }
  }

  function renderFileAction(action: WorkspaceMenuAction): ReactNode {
    switch (action) {
      case "move":
        return serverId && workspaceId ? (
          <MoveWorkspaceToFolderMenuItem
            key={action}
            surface={surface}
            workspaceKey={workspaceKey}
            serverId={serverId}
            workspaceId={workspaceId}
          />
        ) : null;
      case "copy-path":
        return onCopyPath ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyPath}
          >
            {t("sidebar.workspace.actions.copyPath")}
          </WorkspaceMenuItem>
        ) : null;
      case "copy-branch":
        return onCopyBranchName ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyBranchName}
          >
            {t("sidebar.workspace.actions.copyBranchName")}
          </WorkspaceMenuItem>
        ) : null;
      case "open-folder":
        return (
          <OpenInFileManagerMenuItem
            key={action}
            surface={surface}
            path={openInFileManagerPath}
            testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
          />
        );
      case "delete":
        return onDelete ? (
          <WorkspaceMenuItem
            key={action}
            surface={surface}
            testID={`sidebar-workspace-menu-delete-${workspaceKey}`}
            leading={deleteLeadingIcon}
            destructive
            onSelect={onDelete}
          >
            {t("sidebar.workspace.actions.deletePermanently")}
          </WorkspaceMenuItem>
        ) : null;
      default:
        return null;
    }
  }

  function renderAction(action: WorkspaceMenuAction): ReactNode {
    if (
      action === "move" ||
      action === "copy-path" ||
      action === "copy-branch" ||
      action === "open-folder" ||
      action === "delete"
    ) {
      return renderFileAction(action);
    }
    return renderChatAction(action);
  }

  return (
    <>
      {rows.map((row) =>
        isWorkspaceMenuSeparator(row) ? (
          <WorkspaceMenuSeparator key={row} surface={surface} />
        ) : (
          renderAction(row)
        ),
      )}
    </>
  );
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  serverId,
  workspaceId,
  workspaceLabels,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onDelete,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  open,
  onOpenChange,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const workspaceTarget = useMemo<WorkspaceLabelTarget | null>(
    () =>
      serverId && workspaceId ? { serverId, workspaceId, labels: workspaceLabels ?? [] } : null,
    [serverId, workspaceId, workspaceLabels],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);
  return (
    <DropdownMenu compactMode="sheet" open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        width={260}
        pages={pages}
        sheetTitle={t("sidebar.workspace.actions.menu")}
      >
        <SidebarWorkspaceMenuItems
          surface="dropdown"
          workspaceKey={workspaceKey}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceLabels={workspaceLabels}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          onDelete={onDelete}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ContextTriggerProps = Omit<
  ComponentProps<typeof ContextMenuTrigger>,
  "children" | "enabledOnMobile" | "highlightStyle"
>;

export function SidebarWorkspaceContextMenu({
  children,
  contextMenuOpen,
  onContextMenuOpenChange,
  workspace,
  leadingProjectName,
  hostBadgeLabel,
  serviceSummary,
  workspaceKey,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onMarkAsUnread,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onDelete,
  isPinned,
  onTogglePin,
  openInFileManagerPath,
  accessibilityLabel,
  highlightStyle,
  ...triggerProps
}: PropsWithChildren<
  SidebarWorkspaceMenuItemsProps &
    ContextTriggerProps & {
      contextMenuOpen: boolean;
      onContextMenuOpenChange: (open: boolean) => void;
      workspace: SidebarWorkspaceEntry;
      leadingProjectName?: string | null;
      hostBadgeLabel?: string | null;
      serviceSummary?: WorkspaceServiceSummary | null;
      highlightStyle: ComponentProps<typeof ContextMenuTrigger>["highlightStyle"];
    }
>) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const { t } = useTranslation();
  const pullRequestLabel = workspace.prHint
    ? t("workspace.git.pr.accessibility.pullRequest", {
        number: workspace.prHint.number,
        context: getForgePresentation(normalizeForge(workspace.prHint.forge)).changeRequestContext,
      })
    : null;
  const rowAccessibilityLabel = resolveSidebarWorkspaceAccessibilityLabel({
    workspace,
    workspaceTitleSource,
    leadingProjectName,
    hostBadgeLabel,
    pullRequestLabel,
    serviceLabel: serviceSummary
      ? t(workspaceServiceLabelKey(serviceSummary), { name: serviceSummary.name })
      : null,
    t,
  });
  const workspaceTarget = useMemo<WorkspaceLabelTarget>(
    () => ({
      serverId: workspace.serverId,
      workspaceId: workspace.workspaceId,
      labels: workspace.labels ?? [],
    }),
    [workspace],
  );
  const pages = useWorkspaceLabelMenuPages(workspaceTarget);

  return (
    <ContextMenu open={contextMenuOpen} onOpenChange={onContextMenuOpenChange}>
      <ContextMenuTrigger
        {...triggerProps}
        enabledOnMobile={false}
        accessibilityLabel={accessibilityLabel ?? rowAccessibilityLabel}
        highlightStyle={highlightStyle}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        align="start"
        width={260}
        testID={`sidebar-workspace-context-menu-${workspaceKey}`}
        pages={pages}
      >
        <SidebarWorkspaceMenuItems
          surface="context"
          workspaceKey={workspaceKey}
          serverId={workspaceTarget.serverId}
          workspaceId={workspaceTarget.workspaceId}
          workspaceLabels={workspaceTarget.labels}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onMarkAsRead={onMarkAsRead}
          onMarkAsUnread={onMarkAsUnread}
          onArchive={onArchive}
          onDelete={onDelete}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          openInFileManagerPath={openInFileManagerPath}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
    // MoreVertical paints only around the center of its SVG. Keep the padded hit box, but
    // pull the painted dots through that unused view-box space onto the trailing-content rail.
    marginRight: -7,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  hoverActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  hoverIconButton: {
    width: 24,
    height: 24,
  },
}));
