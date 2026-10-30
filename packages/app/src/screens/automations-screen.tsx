import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useTranslation } from "react-i18next";
import { Workflow } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AutomationsHubFrame } from "@/automations/automations-hub-frame";
import { HubDaemonLink } from "@/automations/hub-daemon-link";
import {
  resolveAutomationsView,
  type AutomationsHostSnapshot,
  type AutomationsView,
} from "@/automations/automations-view";
import type { HubLocalInstallPhase } from "@getpaseo/protocol/messages";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";

interface InstallProgress {
  phase: HubLocalInstallPhase;
  percent: number;
}

type InstallState =
  | { status: "idle" }
  | { status: "running"; progress: InstallProgress }
  | { status: "failed"; message: string };

export function AutomationsScreen(): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const connectionKey = serverIds
    .map((serverId) => connectionStatuses.get(serverId) ?? "connecting")
    .join("|");
  const [snapshots, setSnapshots] = useState<AutomationsHostSnapshot[] | null>(null);
  const [install, setInstall] = useState<InstallState>({ status: "idle" });
  const [chosenOrigin, setChosenOrigin] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState<"ask" | "connect" | "install">("ask");

  const reload = useCallback(async () => {
    const runtime = getHostRuntimeStore();
    const next = await Promise.all(
      hosts.map(async (host) => {
        const online = connectionStatuses.get(host.serverId) === "online";
        const base: AutomationsHostSnapshot = {
          serverId: host.serverId,
          label: host.label,
          online,
          relationship: online ? "pending" : "unavailable",
          hubOrigin: null,
          localInstalled: null,
          localRunning: false,
          localOrigin: null,
        };
        if (!online) return base;
        const client = runtime.getClient(host.serverId);
        if (client === null) return { ...base, relationship: "unavailable" as const };
        const [relationship, local] = await Promise.all([
          client.getHubStatus().then(
            (response) => response.status,
            () => null,
          ),
          client.getLocalHubStatus().then(
            (response) => response.status,
            () => null,
          ),
        ]);
        return {
          ...base,
          relationship:
            relationship?.state === "connected"
              ? ("connected" as const)
              : ("not_connected" as const),
          hubOrigin: relationship?.hubOrigin ?? null,
          localInstalled: local === null ? null : local.installed,
          localRunning: local?.running === true,
          localOrigin: local?.origin ?? null,
        };
      }),
    );
    setSnapshots(next);
  }, [connectionStatuses, hosts]);

  useEffect(() => {
    let cancelled = false;
    void reload().then(() => {
      if (cancelled) return undefined;
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [reload, connectionKey]);

  const view = useMemo(() => {
    if (chosenOrigin !== null) {
      return { kind: "webview" as const, origin: chosenOrigin };
    }
    if (snapshots === null) {
      return { kind: "loading" as const };
    }
    return resolveAutomationsView(snapshots);
  }, [chosenOrigin, snapshots]);

  const connectDaemon = useCallback(
    (token: string) => {
      if (view.kind !== "webview") {
        return Promise.reject(new Error("Hub is not open."));
      }
      const serverId = snapshots?.find((host) => host.online)?.serverId;
      const client = serverId === undefined ? null : getHostRuntimeStore().getClient(serverId);
      if (client === null) {
        return Promise.reject(new Error("Desktop daemon is not available."));
      }
      return HubDaemonLink.connect(client, view.origin, token);
    },
    [snapshots, view],
  );

  const handleInstall = useCallback(
    (serverId: string) => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (client === null) {
        setInstall({ status: "failed", message: t("sidebar.automationsPage.failed") });
        return;
      }
      setInstall({ status: "running", progress: { phase: "preparing", percent: 5 } });
      const unsubscribe = client.on("hub.local.install.progress", (message) => {
        setInstall({
          status: "running",
          progress: { phase: message.payload.phase, percent: message.payload.percent },
        });
      });
      void finishInstall(
        client,
        unsubscribe,
        reload,
        setInstall,
        setChosenOrigin,
        t("sidebar.automationsPage.failed"),
      );
    },
    [reload, t],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sidebar.sections.automations")} />
      <AutomationsBody
        view={view}
        install={install}
        setupStep={setupStep}
        onInstall={handleInstall}
        onChoose={setChosenOrigin}
        onSetupStep={setSetupStep}
        onEnrollmentToken={
          view.kind === "webview" && snapshots?.some((host) => host.online) === true
            ? connectDaemon
            : undefined
        }
      />
    </View>
  );
}

async function finishInstall(
  client: {
    installLocalHub: () => Promise<{ success: boolean; error: string | null }>;
    getLocalHubStatus: () => Promise<{ status: { origin: string | null } }>;
  },
  unsubscribe: () => void,
  reload: () => Promise<void>,
  setInstall: (state: InstallState) => void,
  setChosenOrigin: (origin: string) => void,
  failed: string,
): Promise<void> {
  try {
    const response = await client.installLocalHub();
    unsubscribe();
    if (!response.success) {
      setInstall({
        status: "failed",
        message: response.error ?? failed,
      });
      return;
    }
    setInstall({ status: "idle" });
    await reload();
    const local = await client.getLocalHubStatus().then(
      (status) => status.status,
      () => null,
    );
    if (local?.origin) {
      setChosenOrigin(local.origin);
    }
  } catch (error: unknown) {
    unsubscribe();
    setInstall({
      status: "failed",
      message: error instanceof Error ? error.message : failed,
    });
  }
}

function ChooseOriginButton({
  label,
  origin,
  onChoose,
}: {
  label: string;
  origin: string;
  onChoose: (origin: string) => void;
}): ReactElement {
  const choose = useCallback(() => {
    onChoose(origin);
  }, [onChoose, origin]);
  return (
    <Button variant="outline" onPress={choose}>
      {label}
    </Button>
  );
}

function InstallPanel({
  serverId,
  installed,
  install,
  onInstall,
}: {
  serverId: string;
  installed: boolean;
  install: InstallState;
  onInstall: (serverId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const running = install.status === "running";
  const label = installed
    ? t("sidebar.automationsPage.start")
    : t("sidebar.automationsPage.install");
  return (
    <View style={styles.emptyState} testID="automations-install">
      <Workflow size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>
          {installed
            ? t("sidebar.automationsPage.startTitle")
            : t("sidebar.automationsPage.installTitle")}
        </Text>
        <Text style={styles.emptyDescription}>
          {installed
            ? t("sidebar.automationsPage.startBody")
            : t("sidebar.automationsPage.installBody")}
        </Text>
      </View>
      {running ? (
        <InstallProgressBar progress={install.progress} />
      ) : (
        <InstallButton label={label} serverId={serverId} onInstall={onInstall} />
      )}
      {install.status === "failed" ? <Text style={styles.errorText}>{install.message}</Text> : null}
    </View>
  );
}

function SetupButton({
  label,
  testID,
  onPress,
}: {
  label: string;
  testID: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Button onPress={onPress} testID={testID}>
      {label}
    </Button>
  );
}

function ConnectExistingHub({
  initialOrigin,
  onChoose,
}: {
  initialOrigin: string;
  onChoose: (origin: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialOrigin);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(() => {
    const origin = parseHubOrigin(value);
    if (origin === null) {
      setError(t("sidebar.automationsPage.invalidOrigin"));
      return;
    }
    onChoose(origin);
  }, [onChoose, t, value]);
  return (
    <View style={styles.emptyState} testID="automations-connect-form">
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>{t("sidebar.automationsPage.connectExisting")}</Text>
        <Text style={styles.emptyDescription}>{t("sidebar.automationsPage.originHelp")}</Text>
      </View>
      <TextInput
        testID="automations-origin-input"
        accessibilityLabel={t("sidebar.automationsPage.originLabel")}
        initialValue={initialOrigin}
        onChangeText={setValue}
        placeholder={t("sidebar.automationsPage.originPlaceholder")}
        placeholderTextColor={styles.emptyDescription.color}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.originInput}
      />
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
      <Button onPress={submit} testID="automations-origin-continue">
        {t("sidebar.automationsPage.continue")}
      </Button>
    </View>
  );
}

/**
 * Keeps only an http or https origin. Credentials in the address are refused.
 *
 * @param value - What the operator typed
 * @returns Origin, or null when it is not a Hub address
 */
function parseHubOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username !== "" || url.password !== "") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function InstallButton({
  label,
  serverId,
  onInstall,
}: {
  label: string;
  serverId: string;
  onInstall: (serverId: string) => void;
}): ReactElement {
  const install = useCallback(() => {
    onInstall(serverId);
  }, [onInstall, serverId]);
  return (
    <Button onPress={install} testID="automations-install-button">
      {label}
    </Button>
  );
}

function AutomationsBody({
  view,
  install,
  setupStep,
  onInstall,
  onChoose,
  onSetupStep,
  onEnrollmentToken,
}: {
  view: AutomationsView;
  install: InstallState;
  setupStep: "ask" | "connect" | "install";
  onInstall: (serverId: string) => void;
  onChoose: (origin: string) => void;
  onSetupStep: (step: "ask" | "connect" | "install") => void;
  onEnrollmentToken?: (token: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const chooseConnect = useCallback(() => {
    onSetupStep("connect");
  }, [onSetupStep]);
  const chooseInstall = useCallback(() => {
    if (view.kind === "setup" && view.installed && view.localOrigin !== null) {
      onInstall(view.serverId);
      return;
    }
    onSetupStep("install");
  }, [onInstall, onSetupStep, view]);
  if (view.kind === "setup" && setupStep === "install") {
    return (
      <InstallPanel
        serverId={view.serverId}
        installed={view.installed}
        install={install}
        onInstall={onInstall}
      />
    );
  }
  if (view.kind === "setup" && setupStep === "connect") {
    return <ConnectExistingHub initialOrigin={view.localOrigin ?? ""} onChoose={onChoose} />;
  }
  if (view.kind === "setup") {
    return (
      <View style={styles.emptyState} testID="automations-setup">
        <Workflow size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
        <View style={styles.emptyTextStack}>
          <Text style={styles.emptyTitle}>{t("sidebar.automationsPage.setupTitle")}</Text>
          <Text style={styles.emptyDescription}>{t("sidebar.automationsPage.setupBody")}</Text>
        </View>
        <SetupButton
          label={t("sidebar.automationsPage.connectExisting")}
          testID="automations-connect-existing"
          onPress={chooseConnect}
        />
        {view.canInstall ? (
          <SetupButton
            label={
              view.installed && view.localOrigin === null
                ? t("sidebar.automationsPage.start")
                : t("sidebar.automationsPage.installChoice")
            }
            testID="automations-install-choice"
            onPress={chooseInstall}
          />
        ) : null}
      </View>
    );
  }
  if (view.kind === "loading") {
    return (
      <View style={styles.emptyState}>
        <LoadingSpinner size="small" color={styles.spinner.color} />
      </View>
    );
  }
  if (view.kind === "webview") {
    return (
      <View style={styles.frame}>
        <AutomationsHubFrame origin={view.origin} onEnrollmentToken={onEnrollmentToken} />
      </View>
    );
  }
  if (view.kind === "choose") {
    return (
      <View style={styles.emptyState} testID="automations-choose">
        <Text style={styles.emptyTitle}>{t("sidebar.automationsPage.chooseTitle")}</Text>
        {view.options.map((option) => (
          <ChooseOriginButton
            key={option.serverId}
            label={option.label}
            origin={option.origin}
            onChoose={onChoose}
          />
        ))}
      </View>
    );
  }
  if (view.kind === "install") {
    return (
      <InstallPanel
        serverId={view.serverId}
        installed={view.installed}
        install={install}
        onInstall={onInstall}
      />
    );
  }
  if (view.kind === "offline") {
    return (
      <View style={styles.emptyState} testID="automations-offline">
        <Text style={styles.emptyTitle}>{t("sidebar.automationsPage.offlineTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("sidebar.automationsPage.offlineBody")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.emptyState} testID="automations-connect">
      <Workflow size={styles.emptyIcon.width} color={styles.emptyIcon.color} />
      <View style={styles.emptyTextStack}>
        <Text style={styles.emptyTitle}>{t("sidebar.automationsPage.connectTitle")}</Text>
        <Text style={styles.emptyDescription}>{t("sidebar.automationsPage.connectBody")}</Text>
      </View>
    </View>
  );
}

function InstallProgressBar({ progress }: { progress: InstallProgress }): ReactElement {
  const { t } = useTranslation();
  const phaseLabel = t(`sidebar.automationsPage.progress.${progress.phase}`);
  return (
    <View style={styles.progressBlock} testID="automations-progress">
      <Text style={styles.emptyDescription}>{`${phaseLabel} ${String(progress.percent)}%`}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  frame: {
    flex: 1,
    minHeight: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  emptyTextStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 420,
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  originInput: {
    width: "100%",
    maxWidth: 420,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  emptyIcon: {
    color: theme.colors.foregroundMuted,
    width: theme.iconSize.lg,
  },
  progressBlock: {
    width: "100%",
    maxWidth: 360,
    gap: theme.spacing[2],
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.foreground,
  },
}));
