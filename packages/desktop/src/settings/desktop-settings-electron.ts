import { app } from "electron";

import { syncDaemonHubLogin } from "../daemon/service-login-electron.js";
import { createDesktopSettingsStore, type DesktopSettingsStore } from "./desktop-settings.js";

let desktopSettingsStore: DesktopSettingsStore | null = null;

export function getDesktopSettingsStore(): DesktopSettingsStore {
  if (desktopSettingsStore) return desktopSettingsStore;
  const store = createDesktopSettingsStore({
    userDataPath: app.getPath("userData"),
  });
  desktopSettingsStore = {
    get: () => store.get(),
    patch: async (patch) => {
      const next = await store.patch(patch);
      await syncDaemonHubLogin(next.daemon.manageBuiltInDaemon);
      return next;
    },
    migrateLegacyRendererSettings: async (legacySettings) => {
      const next = await store.migrateLegacyRendererSettings(legacySettings);
      await syncDaemonHubLogin(next.daemon.manageBuiltInDaemon);
      return next;
    },
  };
  return desktopSettingsStore;
}
