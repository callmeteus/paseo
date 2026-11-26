import { useCallback, useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FolderOpen, Globe, Link2 } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import type { Theme } from "@/styles/theme";
import { MenuItem, MenuRoot, MenuSurface, useMenuContext } from "@/components/ui/menu";
import { openExternalUrl } from "@/utils/open-external-url";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { resolveMarkdownFileDirectory } from "./image-source";
import { isLocalFileHref, localFileHrefToPath } from "./file-link-href";
import {
  canOpenLinkInPaseo,
  closeLinkContextMenu,
  openLinkInPaseo,
  useLinkContextMenuRequest,
  type LinkContextMenuRequest,
} from "./link-context-menu-store";

const ThemedGlobe = withUnistyles(Globe);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedLink2 = withUnistyles(Link2);
const ThemedFolderOpen = withUnistyles(FolderOpen);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const globeIcon = <ThemedGlobe size={15} uniProps={mutedMapping} />;
const externalIcon = <ThemedExternalLink size={15} uniProps={mutedMapping} />;
const linkIcon = <ThemedLink2 size={15} uniProps={mutedMapping} />;
const folderIcon = <ThemedFolderOpen size={15} uniProps={mutedMapping} />;

/**
 * Right-click menu for links in assistant prose. Electron's own menu only knows
 * about absolute http/file hrefs, so it cannot offer the in-app browser. Keeping
 * the menu in JS lets every link expose the same three actions.
 */
export function LinkContextMenu(): ReactElement {
  const request = useLinkContextMenuRequest();
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) closeLinkContextMenu();
  }, []);

  return (
    <MenuRoot open={request !== null} onOpenChange={onOpenChange} compactMode="popover">
      <LinkMenuAnchor request={request} />
      {request ? (
        <MenuSurface testID="link-context-menu">
          <LinkMenuItems request={request} />
        </MenuSurface>
      ) : null}
    </MenuRoot>
  );
}

function LinkMenuAnchor({ request }: { request: LinkContextMenuRequest | null }): null {
  const { setAnchorRect, setOpen } = useMenuContext("LinkContextMenu");
  useEffect(() => {
    if (!request) return;
    setAnchorRect({ x: request.x, y: request.y, width: 0, height: 0 });
    setOpen(true);
  }, [request, setAnchorRect, setOpen]);
  return null;
}

function LinkMenuItems({ request }: { request: LinkContextMenuRequest }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const isFile = isLocalFileHref(request.url);
  const localPath = request.localPath ?? (isFile ? localFileHrefToPath(request.url) : null);
  const directory = localPath ? resolveMarkdownFileDirectory({ markdownPath: localPath }) : null;
  const isLocalDaemon = useIsLocalDaemon(request.serverId ?? "");
  const { targets } = useDesktopOpenTargets({
    isLocalExecution: isLocalDaemon && Boolean(directory),
  });
  const fileManagerTarget = targets.find((target) => target.kind === "file-manager");
  const copyValue = isFile ? (localPath ?? request.url) : request.url;
  const openInPaseo = useCallback(() => openLinkInPaseo(request.url), [request.url]);
  const openExternal = useCallback(() => void openExternalUrl(request.url), [request.url]);
  const copy = useCallback(() => void Clipboard.setStringAsync(copyValue), [copyValue]);
  const openDirectory = useCallback(() => {
    if (!fileManagerTarget || !directory) return;
    void openDesktopTarget({
      editorId: fileManagerTarget.id,
      workspacePath: directory,
    }).catch((error) => {
      console.warn("[link-context-menu] open directory failed", error);
      toast.error(t("sidebar.project.actions.openFolderFailed"));
    });
  }, [directory, fileManagerTarget, t, toast]);

  if (isFile) {
    return (
      <>
        {directory && fileManagerTarget ? (
          <MenuItem
            leading={folderIcon}
            onSelect={openDirectory}
            testID="link-context-menu-open-directory"
          >
            {t("workspace.tabs.menu.openContainingDirectory")}
          </MenuItem>
        ) : null}
        <MenuItem leading={linkIcon} onSelect={copy} testID="link-context-menu-copy">
          {t("linkMenu.copyPath")}
        </MenuItem>
      </>
    );
  }

  return (
    <>
      {canOpenLinkInPaseo() ? (
        <MenuItem leading={globeIcon} onSelect={openInPaseo} testID="link-context-menu-paseo">
          {t("linkMenu.inPaseo")}
        </MenuItem>
      ) : null}
      <MenuItem leading={externalIcon} onSelect={openExternal} testID="link-context-menu-external">
        {t("linkMenu.external")}
      </MenuItem>
      <MenuItem leading={linkIcon} onSelect={copy} testID="link-context-menu-copy">
        {t("linkMenu.copy")}
      </MenuItem>
    </>
  );
}
