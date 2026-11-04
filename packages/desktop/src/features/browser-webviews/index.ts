import { session, shell, webContents as allWebContents, type WebContents } from "electron";
import log from "electron-log/main";
import { PASEO_BROWSER_PROFILE_PARTITION, PASEO_HUB_PARTITION } from "../browser-profile.js";
import { createExternalUrlOpener } from "../opener.js";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  decideHubMainFrameNavigation,
  isAllowedBrowserWebviewUrl,
  PendingBrowserWindowOpenRequests,
} from "./window-open.js";
import { PaseoBrowserWebviewRegistry } from "./registry.js";

export {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  decideHubMainFrameNavigation,
  PendingBrowserWindowOpenRequests,
};

const browserRegistry = new PaseoBrowserWebviewRegistry();

interface BrowserWebContentsIdentity {
  readonly id: number;
  isDestroyed(): boolean;
}

interface RegisteredBrowserWebContents extends BrowserWebContentsIdentity {
  readonly hostWebContents: BrowserWebContentsIdentity | null;
  readonly session: object;
  once(event: "destroyed", listener: () => void): void;
}

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

interface RegisterAttachedBrowserInput extends AttachedBrowserRegistration {
  sender: BrowserWebContentsIdentity;
  profileSession: object;
  findWebContents(webContentsId: number): RegisteredBrowserWebContents | null;
}

export function isPaseoBrowserWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return (
    isAllowedBrowserWebviewUrl(input.src) && input.partition === PASEO_BROWSER_PROFILE_PARTITION
  );
}

/**
 * Hub guest. Same URL rules as the in-app browser, on the Hub partition.
 *
 * @param input - Attach params from `will-attach-webview`
 * @returns Whether this guest is the embedded Hub
 */
export function isPaseoHubWebviewAttach(input: { src?: string; partition?: string }): boolean {
  return isAllowedBrowserWebviewUrl(input.src) && input.partition === PASEO_HUB_PARTITION;
}

export function listRegisteredPaseoBrowserIds(): string[] {
  return browserRegistry.listBrowserIds();
}

export function getPaseoBrowserWebviewRegistry(): PaseoBrowserWebviewRegistry {
  return browserRegistry;
}

export function preparePaseoBrowserWebContents(contents: RegisteredBrowserWebContents): void {
  const webContentsId = contents.id;
  // Preserve Chromium throttling when the host window is hidden. Browser
  // residency and screenshot capture do not require a lifetime override.
  contents.once("destroyed", () => {
    browserRegistry.unregisterWebContents(webContentsId);
  });
}

export function registerAttachedPaseoBrowser(input: RegisterAttachedBrowserInput): boolean {
  const guest = input.findWebContents(input.webContentsId);
  if (
    !guest ||
    guest.isDestroyed() ||
    guest.hostWebContents !== input.sender ||
    guest.session !== input.profileSession
  ) {
    return false;
  }

  browserRegistry.registerWebContents({
    webContentsId: input.webContentsId,
    browserId: input.browserId,
    hostWebContentsId: input.sender.id,
  });
  browserRegistry.registerWorkspace({
    browserId: input.browserId,
    workspaceId: input.workspaceId,
  });
  return true;
}

export function getPaseoBrowserIdForWebContents(
  contents: BrowserWebContentsIdentity | null,
): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserRegistry.getBrowserIdForWebContents(contents.id);
}

export function unregisterPaseoBrowser(browserId: string): void {
  browserRegistry.unregisterBrowser(browserId);
}

export function unregisterPaseoBrowserFromHost(hostWebContentsId: number, browserId: string): void {
  browserRegistry.unregisterBrowserFromHost(hostWebContentsId, browserId);
}

export function unregisterPaseoBrowserHost(hostWebContentsId: number): void {
  browserRegistry.unregisterHostWebContents(hostWebContentsId);
}

export function getPaseoBrowserWorkspaceId(browserId: string): string | null {
  return browserRegistry.getWorkspaceId(browserId);
}

export function listRegisteredPaseoBrowserIdsForWorkspace(workspaceId: string): string[] {
  return browserRegistry.listBrowserIdsForWorkspace(workspaceId);
}

export function setWorkspaceActivePaseoBrowserId(input: {
  hostWebContentsId: number;
  workspaceId: string;
  browserId: string | null;
}): void {
  browserRegistry.setWorkspaceActiveBrowser(input);
}

export function getWorkspaceActivePaseoBrowserId(workspaceId: string): string | null {
  return browserRegistry.getMostRecentActiveBrowserIdForWorkspace(workspaceId);
}

export function getWorkspaceActivePaseoBrowserIdForHostWindow(
  workspaceId: string,
  hostWebContentsId: number,
): string | null {
  return browserRegistry.getActiveBrowserIdForWorkspaceInHostWindow(hostWebContentsId, workspaceId);
}

export function getPaseoBrowserWebContentsForHostWindow(
  browserId: string,
  hostWebContentsId: number,
): WebContents | null {
  const contentsId = browserRegistry.getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId,
    browserId,
  );
  if (contentsId === null) {
    return null;
  }
  const contents = allWebContents.fromId(contentsId);
  if (contents && !contents.isDestroyed()) {
    return contents;
  }
  browserRegistry.unregisterWebContents(contentsId);
  return null;
}

export function getActivePaseoBrowserWebContentsForHostWindow(
  hostWebContentsId: number,
): WebContents | null {
  const browserId = browserRegistry.getActiveBrowserIdForHostWindow(hostWebContentsId);
  if (!browserId) {
    return null;
  }
  const contentsId = browserRegistry.getWebContentsIdForBrowserInHostWindow(
    hostWebContentsId,
    browserId,
  );
  if (contentsId === null) {
    return null;
  }
  const contents = allWebContents.fromId(contentsId);
  if (contents && !contents.isDestroyed()) {
    return contents;
  }
  browserRegistry.unregisterWebContents(contentsId);
  return null;
}

function preventUnsafeBrowserWebviewNavigation(
  event: { preventDefault: () => void },
  url: string | undefined,
): void {
  if (!isAllowedBrowserWebviewUrl(url)) {
    event.preventDefault();
  }
}

const HUB_EXTERNAL_OPEN_DEDUPE_MS = 1000;

/**
 * Keeps Hub inside its own origin.
 *
 * `will-navigate` and `will-frame-navigate` both fire for the main frame, so
 * the same URL is opened at most once. A subframe can load another origin
 * without sending the user to the system browser. The in-app browser is not
 * Hub, and its navigations stay in the webview.
 *
 * @param contents - Guest that just attached.
 * @returns Nothing.
 */
export function registerBrowserWebviewNavigationGuards(contents: WebContents): void {
  const openHubExternalUrl = createExternalUrlOpener({ open: shell.openExternal });
  const embeddedHub = contents.session === session.fromPartition(PASEO_HUB_PARTITION);
  let lastExternalUrl = "";
  let lastExternalAt = 0;

  const openExternalOnce = (url: string): void => {
    const now = Date.now();
    if (url === lastExternalUrl && now - lastExternalAt < HUB_EXTERNAL_OPEN_DEDUPE_MS) {
      return;
    }
    lastExternalUrl = url;
    lastExternalAt = now;
    void openHubExternalUrl(url).catch((error: unknown) => {
      log.error("failed to open Hub link: %O", error);
    });
  };

  const handleNavigation = (
    event: { preventDefault: () => void },
    url: string | undefined,
    isMainFrame: boolean,
  ): void => {
    if (!embeddedHub || !isMainFrame || contents.isDestroyed()) {
      preventUnsafeBrowserWebviewNavigation(event, url);
      return;
    }

    const decision = decideHubMainFrameNavigation(contents.getURL(), url);
    if (decision.kind === "block") {
      event.preventDefault();
      return;
    }
    if (decision.kind === "external") {
      event.preventDefault();
      openExternalOnce(decision.url);
    }
  };

  contents.on("will-navigate", (event) => {
    handleNavigation(event, event.url, true);
  });
  contents.on("will-frame-navigate", (event) => {
    handleNavigation(event, event.url, event.isMainFrame);
  });
  contents.on("will-redirect", (event) => {
    handleNavigation(event, event.url, event.isMainFrame);
  });
}
