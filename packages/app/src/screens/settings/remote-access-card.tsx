import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { RemoteAccessScope, RemoteDirection } from "@getpaseo/protocol/remote-access";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import type { HostProfile } from "@/types/host-connection";
import {
  createRemoteAccessPatch,
  formatAllowlist,
  parseAllowlist,
  readRemoteAccess,
  toggleRemotePeer,
} from "./remote-access-config";

interface RemoteAccessSectionProps {
  serverId: string;
}

export function RemoteAccessSection({ serverId }: RemoteAccessSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const remote = readRemoteAccess(config);
  const mutation = useMutation({
    mutationFn: async (input: {
      direction: RemoteDirection;
      patch: Partial<RemoteAccessScope>;
    }) => {
      const result = await patchConfig(
        createRemoteAccessPatch(readRemoteAccess(config), input.direction, input.patch),
      );
      if (!result) throw new Error(t("workspace.terminal.hostDisconnected"));
      return result;
    },
  });
  const { mutate } = mutation;

  const patchInbound = useCallback(
    (patch: Partial<RemoteAccessScope>) => mutate({ direction: "inbound", patch }),
    [mutate],
  );
  const patchOutbound = useCallback(
    (patch: Partial<RemoteAccessScope>) => mutate({ direction: "outbound", patch }),
    [mutate],
  );

  if (!isConnected) {
    return <DisconnectedNotice />;
  }

  return (
    <View>
      <DirectionCard
        direction="inbound"
        serverId={serverId}
        scope={remote.inbound}
        onPatch={patchInbound}
        isPending={mutation.isPending}
        error={mutation.error}
      />
      <DirectionCard
        direction="outbound"
        serverId={serverId}
        scope={remote.outbound}
        onPatch={patchOutbound}
        isPending={mutation.isPending}
        error={mutation.error}
      />
    </View>
  );
}

function DisconnectedNotice() {
  const { t } = useTranslation();
  return (
    <View style={[settingsStyles.card, styles.notice]}>
      <Text style={settingsStyles.rowHint}>{t("settings.remoteAccess.disconnected")}</Text>
    </View>
  );
}

function DirectionCard(input: {
  direction: RemoteDirection;
  serverId: string;
  scope: RemoteAccessScope;
  onPatch: (patch: Partial<RemoteAccessScope>) => void;
  isPending: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const allHosts = useHosts();
  const hosts = useMemo(
    () => allHosts.filter((host) => host.serverId !== input.serverId),
    [allHosts, input.serverId],
  );
  const [confirmAny, setConfirmAny] = useState(false);
  const [allowlistDraft, setAllowlistDraft] = useState(
    formatAllowlist(input.scope.commands.allowlist),
  );
  const { onPatch, scope } = input;

  useEffect(() => {
    setAllowlistDraft(formatAllowlist(scope.commands.allowlist));
  }, [scope.commands.allowlist]);

  const prefix = input.direction === "inbound" ? "inbound" : "outbound";

  const handleToggleEnabled = useCallback((enabled: boolean) => onPatch({ enabled }), [onPatch]);
  const handleFilesOff = useCallback(() => onPatch({ files: "off" }), [onPatch]);
  const handleFilesRead = useCallback(() => onPatch({ files: "read" }), [onPatch]);
  const handleFilesWrite = useCallback(() => onPatch({ files: "write" }), [onPatch]);

  function setCommandMode(mode: RemoteAccessScope["commands"]["mode"]) {
    if (mode === "any" && !confirmAny) {
      setConfirmAny(true);
      return;
    }
    setConfirmAny(false);
    onPatch({
      commands: {
        ...scope.commands,
        mode,
        ...(mode === "allowlist" ? { allowlist: parseAllowlist(allowlistDraft) } : {}),
      },
    });
  }
  // Stable identity for the command-mode callbacks below without depending on
  // the render-scoped `setCommandMode` function.
  const setCommandModeSafe = useCallback(setCommandMode, [
    confirmAny,
    allowlistDraft,
    onPatch,
    scope.commands,
  ]);
  const handleCommandsOff = useCallback(() => setCommandModeSafe("off"), [setCommandModeSafe]);
  const handleCommandsAllowlist = useCallback(
    () => setCommandModeSafe("allowlist"),
    [setCommandModeSafe],
  );
  const handleCommandsAny = useCallback(() => setCommandModeSafe("any"), [setCommandModeSafe]);
  const handleConfirmAny = useCallback(() => {
    setConfirmAny(false);
    onPatch({ commands: { ...scope.commands, mode: "any" } });
  }, [onPatch, scope.commands]);
  const handleCancelAny = useCallback(() => setConfirmAny(false), []);
  const handleApplyAllowlist = useCallback(() => {
    onPatch({
      commands: { ...scope.commands, allowlist: parseAllowlist(allowlistDraft) },
    });
  }, [allowlistDraft, onPatch, scope.commands]);
  const handleToggleChats = useCallback((chats: boolean) => onPatch({ chats }), [onPatch]);
  const handleToggleAgents = useCallback((agents: boolean) => onPatch({ agents }), [onPatch]);
  const handleToggleRestrict = useCallback(
    (restrictToWorkspaces: boolean) => onPatch({ restrictToWorkspaces }),
    [onPatch],
  );
  const handleTogglePeer = useCallback(
    (serverId: string) => onPatch({ peers: toggleRemotePeer(scope, serverId).peers }),
    [onPatch, scope],
  );

  return (
    <View style={styles.card}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t(`settings.remoteAccess.${prefix}Title`)}</Text>
          <Text style={settingsStyles.rowHint}>{t(`settings.remoteAccess.${prefix}Hint`)}</Text>
        </View>
        <Switch
          value={scope.enabled}
          disabled={input.isPending}
          onValueChange={handleToggleEnabled}
          accessibilityLabel={t(`settings.remoteAccess.${prefix}Title`)}
          testID={`remote-access-${prefix}-switch`}
        />
      </View>

      {scope.enabled ? (
        <View style={styles.body}>
          <FieldLabel text={t("settings.remoteAccess.peers")} />
          {hosts.length === 0 ? (
            <Text style={settingsStyles.rowHint}>{t("settings.remoteAccess.peersEmpty")}</Text>
          ) : (
            hosts.map((host) => (
              <PeerRow
                key={host.serverId}
                host={host}
                selected={scope.peers.includes(host.serverId)}
                onToggle={handleTogglePeer}
                testID={`remote-access-${prefix}-peer-${host.serverId}`}
              />
            ))
          )}

          <FieldLabel text={t("settings.remoteAccess.files")} />
          <View style={styles.segments}>
            <Segment
              label={t("settings.remoteAccess.filesOff")}
              active={scope.files === "off"}
              onPress={handleFilesOff}
            />
            <Segment
              label={t("settings.remoteAccess.filesRead")}
              active={scope.files === "read"}
              onPress={handleFilesRead}
            />
            <Segment
              label={t("settings.remoteAccess.filesWrite")}
              active={scope.files === "write"}
              onPress={handleFilesWrite}
            />
          </View>

          <FieldLabel text={t("settings.remoteAccess.commands")} />
          <View style={styles.segments}>
            <Segment
              label={t("settings.remoteAccess.commandsOff")}
              active={scope.commands.mode === "off"}
              onPress={handleCommandsOff}
            />
            <Segment
              label={t("settings.remoteAccess.commandsAllowlist")}
              active={scope.commands.mode === "allowlist"}
              onPress={handleCommandsAllowlist}
            />
            <Segment
              label={t("settings.remoteAccess.commandsAny")}
              active={scope.commands.mode === "any"}
              onPress={handleCommandsAny}
            />
          </View>
          {confirmAny ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>{t("settings.remoteAccess.anyWarning")}</Text>
              <View style={styles.segments}>
                <Segment
                  label={t("settings.remoteAccess.confirm")}
                  active
                  onPress={handleConfirmAny}
                />
                <Segment
                  label={t("settings.remoteAccess.cancel")}
                  active={false}
                  onPress={handleCancelAny}
                />
              </View>
            </View>
          ) : null}
          {scope.commands.mode === "allowlist" ? (
            <View>
              <AdaptiveTextInput
                initialValue={allowlistDraft}
                resetKey={formatAllowlist(scope.commands.allowlist)}
                onChangeText={setAllowlistDraft}
                placeholder={t("settings.remoteAccess.allowlistHint")}
                multiline
                style={styles.input}
                testID={`remote-access-${prefix}-allowlist`}
              />
              <Button variant="secondary" size="sm" onPress={handleApplyAllowlist}>
                {t("settings.remoteAccess.apply")}
              </Button>
            </View>
          ) : null}

          <Row
            title={t("settings.remoteAccess.chats")}
            hint={t("settings.remoteAccess.chatsHint")}
            value={scope.chats}
            disabled={input.isPending}
            onChange={handleToggleChats}
          />
          <Row
            title={t("settings.remoteAccess.agents")}
            hint={t("settings.remoteAccess.agentsHint")}
            value={scope.agents}
            disabled={input.isPending}
            onChange={handleToggleAgents}
          />
          <Row
            title={t("settings.remoteAccess.restrictToWorkspaces")}
            hint={t("settings.remoteAccess.restrictHint")}
            value={scope.restrictToWorkspaces}
            disabled={input.isPending}
            onChange={handleToggleRestrict}
          />
        </View>
      ) : null}

      {input.error ? (
        <Text style={[settingsStyles.rowError, styles.error]}>
          {input.error instanceof Error ? input.error.message : String(input.error)}
        </Text>
      ) : null}
    </View>
  );
}

function PeerRow(input: {
  host: HostProfile;
  selected: boolean;
  onToggle: (serverId: string) => void;
  testID: string;
}) {
  const { host, selected, onToggle, testID } = input;
  const handlePress = useCallback(() => onToggle(host.serverId), [host.serverId, onToggle]);
  const accessibleState = useMemo(() => ({ checked: selected }), [selected]);
  const checkboxStyle = useMemo(
    () => [styles.checkbox, selected && styles.checkboxChecked],
    [selected],
  );
  return (
    <PressHighlight
      accessibilityRole="checkbox"
      accessibilityState={accessibleState}
      onPress={handlePress}
      style={styles.peerRow}
      testID={testID}
    >
      <View style={checkboxStyle}>{selected ? <Text style={styles.checkmark}>✓</Text> : null}</View>
      <Text style={styles.peerLabel} numberOfLines={1}>
        {host.label} · {host.serverId}
      </Text>
    </PressHighlight>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function Segment(input: { label: string; active: boolean; onPress: () => void }) {
  const { label, active, onPress } = input;
  const handlePress = useCallback(() => onPress(), [onPress]);
  const accessibleState = useMemo(() => ({ selected: active }), [active]);
  const segmentStyle = useMemo(() => [styles.segment, active && styles.segmentActive], [active]);
  const textStyle = useMemo(
    () => [styles.segmentText, active && styles.segmentTextActive],
    [active],
  );
  return (
    <PressHighlight
      accessibilityRole="button"
      accessibilityState={accessibleState}
      onPress={handlePress}
      style={segmentStyle}
    >
      <Text style={textStyle}>{label}</Text>
    </PressHighlight>
  );
}

function Row(input: {
  title: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{input.title}</Text>
        <Text style={settingsStyles.rowHint}>{input.hint}</Text>
      </View>
      <Switch value={input.value} disabled={input.disabled} onValueChange={input.onChange} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[3],
    overflow: "hidden",
  },
  body: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  notice: { padding: theme.spacing[4] },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  peerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  peerLabel: { color: theme.colors.foreground, flex: 1, fontSize: theme.fontSize.sm },
  checkbox: {
    alignItems: "center",
    borderColor: theme.colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  checkboxChecked: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  checkmark: { color: theme.colors.foreground, fontSize: 12 },
  segments: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  segment: {
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  segmentActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  segmentText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  segmentTextActive: { color: theme.colors.foreground },
  input: {
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
    marginTop: theme.spacing[2],
    minHeight: 64,
    padding: theme.spacing[2],
    textAlignVertical: "top",
  },
  confirmBox: {
    borderColor: theme.colors.statusDanger,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    gap: theme.spacing[2],
    padding: theme.spacing[2],
  },
  confirmText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  row: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: theme.spacing[2],
  },
  error: { paddingHorizontal: theme.spacing[4], paddingBottom: theme.spacing[3] },
}));
