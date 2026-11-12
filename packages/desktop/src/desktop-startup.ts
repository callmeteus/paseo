export interface DesktopStartupDependencies {
  hasPendingGuiLaunchRequest: boolean;
  isServiceLaunch: boolean;
  runCliPassthroughIfRequested: () => Promise<boolean>;
  inheritLoginShellEnv: () => void;
  startServices: () => Promise<void>;
  bootstrapGui: () => Promise<void>;
}

export async function runDesktopStartup(deps: DesktopStartupDependencies): Promise<void> {
  if (deps.isServiceLaunch) {
    deps.inheritLoginShellEnv();
    await deps.startServices();
    return;
  }

  if (!deps.hasPendingGuiLaunchRequest && (await deps.runCliPassthroughIfRequested())) {
    return;
  }

  deps.inheritLoginShellEnv();
  await deps.bootstrapGui();
}
