import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Alert, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy as CopyIcon,
  MoreVertical,
  Pencil,
  Plus,
  Share2,
  Trash2,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  McpBridge,
  McpBridgeServer,
  McpServerConfig,
  McpShare,
} from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { PressHighlight } from "@/components/ui/press-highlight";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useMcpServers, type CopyMcpServersMode } from "../internal/use-mcp-servers";
import { McpServerWizard } from "./mcp-server-wizard";
import type { McpServerDraft } from "../internal/mcp-server-form-model";

const MENU_ICON_SIZE = 14;

const ThemedPlus = withUnistyles(Plus);
const ThemedKebab = withUnistyles(MoreVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCopy = withUnistyles(CopyIcon);
const ThemedShare = withUnistyles(Share2);
const ThemedTrash = withUnistyles(Trash2);
const ThemedCheck = withUnistyles(Check);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const checkColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const editLeading = <ThemedPencil size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const copyLeading = <ThemedCopy size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const shareLeading = <ThemedShare size={MENU_ICON_SIZE} uniProps={mutedColorMapping} />;
const deleteLeading = <ThemedTrash size={MENU_ICON_SIZE} uniProps={destructiveColorMapping} />;

type WizardState = { mode: "create" } | { mode: "edit"; name: string; config: McpServerConfig };

interface McpServerRowProps {
  isFirst: boolean;
  serverName: string;
  type: string;
  canCopy: boolean;
  canShare: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onShare: () => void;
  onDelete: () => void;
}

function McpServerRow({
  isFirst,
  serverName,
  type,
  canCopy,
  canShare,
  onEdit,
  onCopy,
  onShare,
  onDelete,
}: McpServerRowProps): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      isHovered && !isCompact && styles.rowHovered,
    ],
    [isFirst, isHovered, isCompact],
  );

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <PressHighlight
        style={rowStyle}
        highlightStyle={styles.rowHighlight}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t("settings.host.mcp.servers.editAccessibility", { name: serverName })}
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {serverName}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={1}>
            {type}
          </Text>
        </View>
        <McpServerMenu
          serverName={serverName}
          canCopy={canCopy}
          canShare={canShare}
          onEdit={onEdit}
          onCopy={onCopy}
          onShare={onShare}
          onDelete={onDelete}
        />
      </PressHighlight>
    </View>
  );
}

function McpServerMenu({
  serverName,
  canCopy,
  canShare,
  onEdit,
  onCopy,
  onShare,
  onDelete,
}: Omit<McpServerRowProps, "isFirst" | "type">): ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        hitSlop={8}
        style={kebabTriggerStyle}
        accessibilityRole={isNative ? "button" : undefined}
        accessibilityLabel={t("settings.host.mcp.servers.actions", { name: serverName })}
      >
        {renderKebabTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem leading={editLeading} onSelect={onEdit}>
          {t("settings.host.mcp.servers.edit")}
        </DropdownMenuItem>
        {canCopy ? (
          <DropdownMenuItem leading={copyLeading} onSelect={onCopy}>
            {t("settings.host.mcp.servers.copy")}
          </DropdownMenuItem>
        ) : null}
        {canShare ? (
          <DropdownMenuItem leading={shareLeading} onSelect={onShare}>
            {t("settings.host.mcp.servers.share")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem leading={deleteLeading} destructive onSelect={onDelete}>
          {t("settings.host.mcp.servers.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BridgeRowProps {
  isFirst: boolean;
  bridgeName: string;
  bridge: McpBridge;
  hostLabel: string;
  viaLabel: string | null;
  onRemove: () => void;
}

function BridgeRow({
  isFirst,
  bridgeName,
  bridge,
  hostLabel,
  viaLabel,
  onRemove,
}: BridgeRowProps): ReactElement {
  const { t } = useTranslation();
  const meta = viaLabel
    ? t("settings.host.mcp.bridges.metaVia", {
        server: bridge.server,
        host: hostLabel,
        via: viaLabel,
      })
    : t("settings.host.mcp.bridges.meta", { server: bridge.server, host: hostLabel });
  return (
    <View style={[settingsStyles.row, !isFirst && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {bridgeName}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          hitSlop={8}
          style={kebabTriggerStyle}
          accessibilityRole={isNative ? "button" : undefined}
          accessibilityLabel={t("settings.host.mcp.bridges.actions", { name: bridgeName })}
        >
          {renderKebabTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={220}>
          <DropdownMenuItem leading={deleteLeading} destructive onSelect={onRemove}>
            {t("settings.host.mcp.bridges.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

interface HostOptionRowProps {
  serverId: string;
  label: string;
  selected: boolean;
  onToggle: (serverId: string) => void;
}

function HostOptionRow({ serverId, label, selected, onToggle }: HostOptionRowProps): ReactElement {
  const handleToggle = useCallback(() => onToggle(serverId), [onToggle, serverId]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const optionStyle = useMemo(
    () => [styles.optionRow, selected && styles.optionRowSelected],
    [selected],
  );
  return (
    <PressHighlight
      onPress={handleToggle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={optionStyle}
      highlightStyle={styles.optionRowHighlight}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {serverId}
        </Text>
      </View>
      <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
        {selected ? <ThemedCheck size={14} uniProps={checkColorMapping} /> : null}
      </View>
    </PressHighlight>
  );
}

interface DiscoveredServerRowProps {
  serverName: string;
  onSelect: (name: string) => void;
}

function DiscoveredServerRow({ serverName, onSelect }: DiscoveredServerRowProps): ReactElement {
  const handleSelect = useCallback(() => onSelect(serverName), [onSelect, serverName]);
  return (
    <Button variant="ghost" size="sm" onPress={handleSelect}>
      {serverName}
    </Button>
  );
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return (
    <ThemedKebab
      size={MENU_ICON_SIZE}
      uniProps={hovered ? foregroundColorMapping : mutedColorMapping}
    />
  );
}

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabTrigger, hovered && styles.kebabTriggerHovered];
}

interface McpServerListItemProps {
  serverName: string;
  type: string;
  isFirst: boolean;
  canCopy: boolean;
  canShare: boolean;
  onEdit: (name: string) => void;
  onCopy: (name: string) => void;
  onShare: (name: string) => void;
  onDelete: (name: string) => Promise<void>;
}

function McpServerListItem({
  serverName,
  type,
  isFirst,
  canCopy,
  canShare,
  onEdit,
  onCopy,
  onShare,
  onDelete,
}: McpServerListItemProps): ReactElement {
  const handleEdit = useCallback(() => onEdit(serverName), [onEdit, serverName]);
  const handleCopy = useCallback(() => onCopy(serverName), [onCopy, serverName]);
  const handleShare = useCallback(() => onShare(serverName), [onShare, serverName]);
  const handleDelete = useCallback(() => {
    void onDelete(serverName);
  }, [onDelete, serverName]);
  return (
    <McpServerRow
      isFirst={isFirst}
      serverName={serverName}
      type={type}
      canCopy={canCopy}
      canShare={canShare}
      onEdit={handleEdit}
      onCopy={handleCopy}
      onShare={handleShare}
      onDelete={handleDelete}
    />
  );
}

interface BridgeListItemProps {
  bridgeName: string;
  bridge: McpBridge;
  isFirst: boolean;
  hostLabel: string;
  viaLabel: string | null;
  onRemove: (name: string) => Promise<void>;
}

function BridgeListItem({
  bridgeName,
  bridge,
  isFirst,
  hostLabel,
  viaLabel,
  onRemove,
}: BridgeListItemProps): ReactElement {
  const handleRemove = useCallback(() => {
    void onRemove(bridgeName);
  }, [bridgeName, onRemove]);
  return (
    <BridgeRow
      isFirst={isFirst}
      bridgeName={bridgeName}
      bridge={bridge}
      hostLabel={hostLabel}
      viaLabel={viaLabel}
      onRemove={handleRemove}
    />
  );
}

export function McpServersSection({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hosts = useHosts();
  const {
    servers,
    shares,
    bridges,
    isSupported,
    isBridgeSupported,
    isMultiHopSupported,
    isCatalogSupported,
    saveServers,
    saveShares,
    saveBridges,
    copyToHost,
    discoverServers,
    scanCatalog,
    importCatalog,
    testServer,
  } = useMcpServers(serverId);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [saving, setSaving] = useState(false);
  const takenNames = useMemo(
    () =>
      Object.keys(servers ?? {}).filter(
        (name) => !(wizard?.mode === "edit" && wizard.name === name),
      ),
    [servers, wizard],
  );
  const [copySource, setCopySource] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<string>("");
  const [shareSource, setShareSource] = useState<string | null>(null);
  const [shareHosts, setShareHosts] = useState<string[]>([]);
  const [shareTools, setShareTools] = useState("");
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [bridgeName, setBridgeName] = useState("");
  const [bridgeHost, setBridgeHost] = useState("");
  const [bridgeVia, setBridgeVia] = useState("");
  const [bridgeServer, setBridgeServer] = useState("");
  const [discoveredServers, setDiscoveredServers] = useState<McpBridgeServer[]>([]);

  const otherHosts = useMemo(
    () => hosts.filter((host) => host.serverId !== serverId),
    [hosts, serverId],
  );
  const hostLabel = useCallback(
    (id: string) => hosts.find((host) => host.serverId === id)?.label ?? id,
    [hosts],
  );

  const openCreate = useCallback(() => {
    setWizard({ mode: "create" });
  }, []);

  const openEdit = useCallback(
    (serverName: string) => {
      const entry = servers?.[serverName];
      if (!entry) return;
      setWizard({ mode: "edit", name: serverName, config: entry });
    },
    [servers],
  );

  const closeWizard = useCallback(() => setWizard(null), []);

  const handleWizardSubmit = useCallback(
    async (
      config: McpServerConfig,
      draft: McpServerDraft,
      mode: "create" | "edit",
      editName?: string,
    ) => {
      const trimmed = draft.name.trim();
      if (!trimmed) return;
      const current = servers ?? {};
      const next: Record<string, McpServerConfig> = { ...current };
      if (mode === "edit" && editName && editName !== trimmed) {
        delete next[editName];
      }
      next[trimmed] = config;
      setSaving(true);
      try {
        await saveServers(next);
        closeWizard();
      } catch (error) {
        Alert.alert(
          t("settings.host.mcp.servers.errors.saveFailedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setSaving(false);
      }
    },
    [closeWizard, saveServers, servers, t],
  );

  const handleDelete = useCallback(
    async (serverName: string) => {
      const confirmed = await confirmDialog({
        title: t("settings.host.mcp.servers.removeConfirmTitle"),
        message: t("settings.host.mcp.servers.removeConfirmMessage", { name: serverName }),
        confirmLabel: t("settings.host.mcp.servers.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      const current = servers ?? {};
      const next = { ...current };
      delete next[serverName];
      try {
        await saveServers(next);
      } catch (error) {
        Alert.alert(
          t("settings.host.mcp.servers.errors.removeFailedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [saveServers, servers, t],
  );

  const openCopy = useCallback((serverName: string) => {
    setCopySource(serverName);
    setCopyTarget("");
  }, []);

  const closeCopy = useCallback(() => setCopySource(null), []);

  const handleCopy = useCallback(
    async (mode: CopyMcpServersMode) => {
      if (!copyTarget) {
        Alert.alert(
          t("settings.host.mcp.copy.selectHostTitle"),
          t("settings.host.mcp.copy.selectHostMessage"),
        );
        return;
      }
      try {
        await copyToHost(copyTarget, mode);
        setCopySource(null);
      } catch (error) {
        Alert.alert(
          t("settings.host.mcp.copy.failedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [copyTarget, copyToHost, t],
  );

  const openShare = useCallback(
    (serverName: string) => {
      const share = shares?.[serverName];
      setShareSource(serverName);
      setShareHosts(share?.hosts ?? []);
      setShareTools(share?.tools?.join(", ") ?? "");
    },
    [shares],
  );

  const closeShare = useCallback(() => setShareSource(null), []);

  const toggleShareHost = useCallback((targetId: string) => {
    setShareHosts((current) =>
      current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId],
    );
  }, []);

  const handleSaveShare = useCallback(async () => {
    if (!shareSource) return;
    const tools = shareTools
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const currentShares = shares ?? {};
    const next: Record<string, McpShare> = { ...currentShares };
    if (shareHosts.length === 0) {
      delete next[shareSource];
    } else {
      next[shareSource] = { hosts: shareHosts, ...(tools.length > 0 ? { tools } : {}) };
    }
    try {
      await saveShares(next);
      setShareSource(null);
    } catch (error) {
      Alert.alert(
        t("settings.host.mcp.share.failedTitle"),
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [saveShares, shareHosts, shareSource, shareTools, shares, t]);

  const openBridge = useCallback(() => {
    setBridgeOpen(true);
    setBridgeName("");
    setBridgeHost(otherHosts[0]?.serverId ?? "");
    setBridgeVia("");
    setBridgeServer("");
    setDiscoveredServers([]);
  }, [otherHosts]);

  const closeBridge = useCallback(() => setBridgeOpen(false), []);
  const selectBridgeHost = useCallback((id: string) => setBridgeHost(id), []);
  const toggleBridgeVia = useCallback((id: string) => {
    setBridgeVia((current) => (current === id ? "" : id));
  }, []);

  const handleDiscover = useCallback(async () => {
    if (!bridgeHost) {
      Alert.alert(
        t("settings.host.mcp.bridge.selectHostTitle"),
        t("settings.host.mcp.bridge.selectHostMessage"),
      );
      return;
    }
    try {
      setDiscoveredServers(await discoverServers(bridgeHost));
    } catch (error) {
      Alert.alert(
        t("settings.host.mcp.bridge.discoverFailedTitle"),
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [bridgeHost, discoverServers, t]);

  const handleSaveBridge = useCallback(async () => {
    if (!bridgeName.trim() || !bridgeHost || !bridgeServer.trim()) {
      Alert.alert(
        t("settings.host.mcp.bridge.missingFieldsTitle"),
        t("settings.host.mcp.bridge.missingFieldsMessage"),
      );
      return;
    }
    const currentBridges = bridges ?? {};
    const next: Record<string, McpBridge> = { ...currentBridges };
    next[bridgeName.trim()] = {
      host: bridgeHost,
      ...(bridgeVia ? { via: bridgeVia } : {}),
      server: bridgeServer.trim(),
    };
    try {
      await saveBridges(next);
      setBridgeOpen(false);
    } catch (error) {
      Alert.alert(
        t("settings.host.mcp.bridge.failedTitle"),
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [bridgeHost, bridgeName, bridgeServer, bridgeVia, bridges, saveBridges, t]);

  const removeBridge = useCallback(
    async (targetName: string) => {
      const confirmed = await confirmDialog({
        title: t("settings.host.mcp.bridges.removeConfirmTitle"),
        message: t("settings.host.mcp.bridges.removeConfirmMessage", { name: targetName }),
        confirmLabel: t("settings.host.mcp.bridges.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      });
      if (!confirmed) return;
      const currentBridges = bridges ?? {};
      const next = { ...currentBridges };
      delete next[targetName];
      try {
        await saveBridges(next);
      } catch (error) {
        Alert.alert(
          t("settings.host.mcp.servers.errors.removeFailedTitle"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [bridges, saveBridges, t],
  );

  const handleCopyMerge = useCallback(() => {
    void handleCopy("merge");
  }, [handleCopy]);
  const handleCopyReplace = useCallback(() => {
    void handleCopy("replace");
  }, [handleCopy]);
  const handleShareSavePress = useCallback(() => {
    void handleSaveShare();
  }, [handleSaveShare]);
  const handleDiscoverPress = useCallback(() => {
    void handleDiscover();
  }, [handleDiscover]);
  const handleBridgeSavePress = useCallback(() => {
    void handleSaveBridge();
  }, [handleSaveBridge]);

  const addServerButton = useMemo(
    () => (
      <Button
        size="sm"
        variant="ghost"
        leftIcon={addIcon}
        onPress={openCreate}
        accessibilityLabel={t("settings.host.mcp.servers.add")}
      />
    ),
    [openCreate, t],
  );
  const addBridgeButton = useMemo(
    () => (
      <Button
        size="sm"
        variant="ghost"
        leftIcon={addIcon}
        onPress={openBridge}
        accessibilityLabel={t("settings.host.mcp.bridges.add")}
      />
    ),
    [openBridge, t],
  );

  const copyHeader = useMemo(
    () => ({
      title: copySource
        ? t("settings.host.mcp.copy.titleNamed", { name: copySource })
        : t("settings.host.mcp.copy.title"),
    }),
    [copySource, t],
  );
  const shareHeader = useMemo(
    () => ({
      title: shareSource
        ? t("settings.host.mcp.share.titleNamed", { name: shareSource })
        : t("settings.host.mcp.share.title"),
    }),
    [shareSource, t],
  );
  const bridgeHeader = useMemo(() => ({ title: t("settings.host.mcp.bridge.addTitle") }), [t]);

  if (!isConnected) {
    return (
      <SettingsSection title={t("settings.host.mcp.servers.title")}>
        <View style={settingsStyles.card}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t("settings.host.mcp.servers.unavailable")}</Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  if (!isSupported) {
    return (
      <SettingsSection title={t("settings.host.mcp.servers.title")}>
        <View style={settingsStyles.card}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t("settings.host.mcp.servers.unsupported")}</Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  const entries = Object.entries(servers ?? {});
  const bridgeEntries = Object.entries(bridges ?? {});
  const canCopy = otherHosts.length > 0;

  return (
    <View>
      <SettingsSection
        title={t("settings.host.mcp.servers.title")}
        info={t("settings.host.mcp.servers.info")}
        trailing={addServerButton}
      >
        <View style={settingsStyles.card}>
          {entries.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyTextGroup}>
                <Text style={styles.emptyTitle}>{t("settings.host.mcp.servers.emptyTitle")}</Text>
                <Text style={styles.emptyText}>
                  {t("settings.host.mcp.servers.emptyDescription")}
                </Text>
              </View>
              <Button size="sm" leftIcon={addIcon} onPress={openCreate}>
                {t("settings.host.mcp.servers.add")}
              </Button>
            </View>
          ) : (
            entries.map(([serverName, entry], index) => (
              <McpServerListItem
                key={serverName}
                serverName={serverName}
                type={entry.type}
                isFirst={index === 0}
                canCopy={canCopy}
                canShare={isBridgeSupported}
                onEdit={openEdit}
                onCopy={openCopy}
                onShare={openShare}
                onDelete={handleDelete}
              />
            ))
          )}
        </View>
      </SettingsSection>

      {isBridgeSupported ? (
        <SettingsSection
          title={t("settings.host.mcp.bridges.title")}
          info={t("settings.host.mcp.bridges.info")}
          trailing={addBridgeButton}
        >
          <View style={settingsStyles.card}>
            {bridgeEntries.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyTextGroup}>
                  <Text style={styles.emptyTitle}>{t("settings.host.mcp.bridges.emptyTitle")}</Text>
                  <Text style={styles.emptyText}>
                    {t("settings.host.mcp.bridges.emptyDescription")}
                  </Text>
                </View>
                <Button size="sm" leftIcon={addIcon} onPress={openBridge}>
                  {t("settings.host.mcp.bridges.add")}
                </Button>
              </View>
            ) : (
              bridgeEntries.map(([bridgeNameValue, bridge], index) => (
                <BridgeListItem
                  key={bridgeNameValue}
                  bridgeName={bridgeNameValue}
                  bridge={bridge}
                  isFirst={index === 0}
                  hostLabel={hostLabel(bridge.host)}
                  viaLabel={bridge.via ? hostLabel(bridge.via) : null}
                  onRemove={removeBridge}
                />
              ))
            )}
          </View>
        </SettingsSection>
      ) : null}

      <McpServerWizard
        visible={wizard !== null}
        mode={wizard?.mode ?? "create"}
        {...(wizard?.mode === "edit" ? { editName: wizard.name, editConfig: wizard.config } : {})}
        takenNames={takenNames}
        isCatalogSupported={isCatalogSupported}
        isSaving={saving}
        onClose={closeWizard}
        onSubmit={handleWizardSubmit}
        onScan={scanCatalog}
        onImport={importCatalog}
        onTest={testServer}
      />

      <AdaptiveModalSheet visible={copySource !== null} onClose={closeCopy} header={copyHeader}>
        <View style={styles.modalBody}>
          <Text style={styles.modalHint}>{t("settings.host.mcp.copy.description")}</Text>
          {otherHosts.map((host) => (
            <HostOptionRow
              key={host.serverId}
              serverId={host.serverId}
              label={host.label}
              selected={copyTarget === host.serverId}
              onToggle={setCopyTarget}
            />
          ))}
          <View style={styles.modalActions}>
            <Button variant="ghost" onPress={closeCopy}>
              {t("settings.host.mcp.copy.cancel")}
            </Button>
            <Button variant="secondary" onPress={handleCopyMerge}>
              {t("settings.host.mcp.copy.merge")}
            </Button>
            <Button onPress={handleCopyReplace}>{t("settings.host.mcp.copy.replace")}</Button>
          </View>
        </View>
      </AdaptiveModalSheet>

      <AdaptiveModalSheet visible={shareSource !== null} onClose={closeShare} header={shareHeader}>
        <View style={styles.modalBody} key={shareSource ?? "none"}>
          <Text style={styles.modalHint}>{t("settings.host.mcp.share.description")}</Text>
          {otherHosts.map((host) => (
            <HostOptionRow
              key={host.serverId}
              serverId={host.serverId}
              label={host.label}
              selected={shareHosts.includes(host.serverId)}
              onToggle={toggleShareHost}
            />
          ))}
          <Field label={t("settings.host.mcp.share.tools")}>
            <FormTextInput initialValue={shareTools} onChangeText={setShareTools} />
          </Field>
          <View style={styles.modalActions}>
            <Button variant="ghost" onPress={closeShare}>
              {t("settings.host.mcp.share.cancel")}
            </Button>
            <Button onPress={handleShareSavePress}>{t("settings.host.mcp.share.save")}</Button>
          </View>
        </View>
      </AdaptiveModalSheet>

      <AdaptiveModalSheet visible={bridgeOpen} onClose={closeBridge} header={bridgeHeader}>
        <View style={styles.modalBody} key={bridgeOpen ? "open" : "closed"}>
          <Field label={t("settings.host.mcp.bridge.name")}>
            <FormTextInput initialValue={bridgeName} onChangeText={setBridgeName} />
          </Field>
          <Text style={styles.modalHint}>{t("settings.host.mcp.bridge.owner")}</Text>
          {otherHosts.map((host) => (
            <HostOptionRow
              key={host.serverId}
              serverId={host.serverId}
              label={host.label}
              selected={bridgeHost === host.serverId}
              onToggle={selectBridgeHost}
            />
          ))}
          <Text style={styles.modalHint}>{t("settings.host.mcp.bridge.via")}</Text>
          {otherHosts.map((host) => (
            <HostOptionRow
              key={host.serverId}
              serverId={host.serverId}
              label={host.label}
              selected={bridgeVia === host.serverId}
              onToggle={toggleBridgeVia}
            />
          ))}
          <Field label={t("settings.host.mcp.bridge.server")}>
            <FormTextInput initialValue={bridgeServer} onChangeText={setBridgeServer} />
          </Field>
          <Button variant="secondary" onPress={handleDiscoverPress}>
            {t("settings.host.mcp.bridge.discover")}
          </Button>
          {discoveredServers.map((server) => (
            <DiscoveredServerRow
              key={server.server}
              serverName={server.server}
              onSelect={setBridgeServer}
            />
          ))}
          {!isMultiHopSupported && bridgeVia ? (
            <Text style={styles.warning}>{t("settings.host.mcp.bridge.multiHopUnsupported")}</Text>
          ) : null}
          <View style={styles.modalActions}>
            <Button variant="ghost" onPress={closeBridge}>
              {t("settings.host.mcp.bridge.cancel")}
            </Button>
            <Button onPress={handleBridgeSavePress}>{t("settings.host.mcp.bridge.save")}</Button>
          </View>
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    alignItems: "flex-start",
  },
  emptyTextGroup: {
    gap: theme.spacing[1],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowHighlight: {
    backgroundColor: theme.colors.surface3,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
  },
  optionRowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  optionRowHighlight: {
    backgroundColor: theme.colors.surface3,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleSelected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  modalBody: {
    gap: theme.spacing[3],
  },
  modalHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));
