import { type PropsWithChildren, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Folder, GitBranch, Monitor, Server } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import { useLocalDaemonServerIdState } from "@/hooks/use-is-local-daemon";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import {
  workspaceHoverPreview,
  workspaceHoverRemoteUrl,
  type WorkspaceHoverLocality,
} from "@/components/sidebar/workspace-hover-preview";
import { useWorkspaceFields } from "@/stores/session-store-hooks";

const HOVER_CARD_WIDTH = 260;

interface WorkspaceHoverCardProps {
  workspace: SidebarWorkspaceEntry;
  isDragging: boolean;
  disabled?: boolean;
}

export function WorkspaceHoverCard({
  workspace,
  isDragging,
  disabled = false,
  children,
}: PropsWithChildren<WorkspaceHoverCardProps>): ReactNode {
  const isCompact = useIsCompactFormFactor();

  if (isCompact) {
    return children;
  }

  return (
    <HoverCard disabled={isDragging || disabled}>
      <HoverCardTrigger>{children}</HoverCardTrigger>
      <HoverCardContent
        placement="right"
        accessibilityLabel={workspace.name}
        testID="workspace-hover-card"
        style={styles.card}
      >
        <WorkspaceHoverCardContent workspace={workspace} />
      </HoverCardContent>
    </HoverCard>
  );
}

function WorkspaceHoverCardContent({
  workspace,
}: {
  workspace: SidebarWorkspaceEntry;
}): ReactElement {
  const { t } = useTranslation();
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const remoteUrl = useWorkspaceFields(workspace.serverId, workspace.workspaceId, (record) =>
    workspaceHoverRemoteUrl({
      gitRemoteUrl: record.gitRuntime?.remoteUrl,
      projectRemoteUrl: record.project?.checkout.remoteUrl,
    }),
  );
  const localDaemon = useLocalDaemonServerIdState();
  const preview = workspaceHoverPreview({
    title: resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource }),
    remoteUrl,
    branch: workspace.currentBranch,
    path: workspace.workspaceDirectoryLabel,
    serverId: workspace.serverId,
    localServerId: localDaemon.status === "resolved" ? localDaemon.serverId : null,
    localityPending: localDaemon.status === "loading",
  });

  return (
    <>
      {preview.title ? (
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={2} testID="hover-card-workspace-name">
            {preview.title}
          </Text>
        </View>
      ) : null}
      {preview.repoLine ? (
        <RepoLine repo={preview.repoLine.repo} branch={preview.repoLine.branch} />
      ) : null}
      {preview.path ? (
        <View style={styles.cardInfoRow}>
          <ThemedFolder size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.cardInfoText} numberOfLines={1} testID="hover-card-workspace-cwd">
            {preview.path}
          </Text>
        </View>
      ) : null}
      {preview.locality ? (
        <LocalityRow
          locality={preview.locality}
          label={
            preview.locality === "local"
              ? t("workspace.hoverCard.local")
              : t("workspace.hoverCard.remote")
          }
        />
      ) : null}
    </>
  );
}

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedFolder = withUnistyles(Folder);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedServer = withUnistyles(Server);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function RepoLine({ repo, branch }: { repo: string | null; branch: string | null }): ReactElement {
  return (
    <View style={styles.cardInfoRow} testID="hover-card-workspace-repo">
      <ThemedGitBranch size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
      {repo ? (
        <Text style={styles.repoName} numberOfLines={1} testID="hover-card-workspace-repo-name">
          {repo}
        </Text>
      ) : null}
      {branch ? (
        <Text
          style={repo ? [styles.branchName, styles.branchAside] : styles.branchName}
          numberOfLines={1}
          testID="hover-card-workspace-branch"
        >
          {branch}
        </Text>
      ) : null}
    </View>
  );
}

function LocalityRow({
  locality,
  label,
}: {
  locality: WorkspaceHoverLocality;
  label: string;
}): ReactElement {
  const Icon = locality === "local" ? ThemedMonitor : ThemedServer;
  return (
    <View style={styles.cardInfoRow}>
      <Icon size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.cardInfoText} numberOfLines={1} testID="hover-card-workspace-locality">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    paddingTop: theme.spacing[2],
    width: HOVER_CARD_WIDTH,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
    minWidth: 0,
  },
  cardInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  cardInfoText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  repoName: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  branchName: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  branchAside: {
    marginLeft: "auto",
  },
}));
