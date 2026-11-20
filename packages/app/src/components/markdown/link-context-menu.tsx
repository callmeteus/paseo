import { useCallback, useEffect, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Link2 } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import type { Theme } from "@/styles/theme";
import { MenuItem, MenuRoot, MenuSurface, useMenuContext } from "@/components/ui/menu";
import { openExternalUrl } from "@/utils/open-external-url";
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
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const globeIcon = <ThemedGlobe size={15} uniProps={mutedMapping} />;
const externalIcon = <ThemedExternalLink size={15} uniProps={mutedMapping} />;
const linkIcon = <ThemedLink2 size={15} uniProps={mutedMapping} />;

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
          <LinkMenuItems url={request.url} />
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

function LinkMenuItems({ url }: { url: string }): ReactElement {
  const { t } = useTranslation();
  const openInPaseo = useCallback(() => openLinkInPaseo(url), [url]);
  const openExternal = useCallback(() => void openExternalUrl(url), [url]);
  const copyLink = useCallback(() => void Clipboard.setStringAsync(url), [url]);

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
      <MenuItem leading={linkIcon} onSelect={copyLink} testID="link-context-menu-copy">
        {t("linkMenu.copy")}
      </MenuItem>
    </>
  );
}
