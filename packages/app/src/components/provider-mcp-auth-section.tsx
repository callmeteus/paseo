import * as Clipboard from "expo-clipboard";
import { Copy, LogIn, RotateCw } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  useProviderMcpAuth,
  type ProviderMcpLoginState,
  type ProviderMcpServer,
  type ProviderMcpServerStatus,
} from "@/hooks/use-provider-mcp-auth";

const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function statusKey(status: ProviderMcpServerStatus): string {
  switch (status) {
    case "ready":
      return "settings.providers.mcp.statuses.ready";
    case "needs_auth":
      return "settings.providers.mcp.statuses.needsAuth";
    case "needs_approval":
      return "settings.providers.mcp.statuses.needsApproval";
    case "error":
      return "settings.providers.mcp.statuses.error";
    default:
      return "settings.providers.mcp.statuses.unknown";
  }
}

function needsAuthentication(status: ProviderMcpServerStatus): boolean {
  return status === "needs_auth" || status === "needs_approval";
}

function loginMessageKey(login: ProviderMcpLoginState): string {
  if (login.status === "failed") return "settings.providers.mcp.loginFailed";
  if (login.status === "authenticated") return "settings.providers.mcp.loginSucceeded";
  if (login.url) return "settings.providers.mcp.waitingForBrowser";
  return "settings.providers.mcp.waitingForHostBrowser";
}

function McpLoginNotice({
  login,
  onOpen,
  onCopy,
}: {
  login: ProviderMcpLoginState;
  onOpen: (url: string) => void;
  onCopy: (url: string) => void;
}) {
  const { t } = useTranslation();
  const pending = login.status === "starting" || login.status === "waiting";
  const url = login.url;
  const handleOpen = useCallback(() => {
    if (url) onOpen(url);
  }, [onOpen, url]);
  const handleCopy = useCallback(() => {
    if (url) onCopy(url);
  }, [onCopy, url]);

  return (
    <View style={stylesheet.loginNotice}>
      {pending ? <ThemedLoadingSpinner size={14} uniProps={foregroundMutedMapping} /> : null}
      <View style={stylesheet.loginNoticeBody}>
        <Text style={stylesheet.loginText}>{t(loginMessageKey(login))}</Text>
        {login.message ? (
          <Text style={stylesheet.loginMessage} numberOfLines={3}>
            {login.message}
          </Text>
        ) : null}
        {url ? (
          <Text style={stylesheet.loginMessage}>{t("settings.providers.mcp.hostBrowserHint")}</Text>
        ) : null}
        {url ? (
          <View style={stylesheet.loginActions}>
            <Button
              variant="secondary"
              size="xs"
              onPress={handleOpen}
              accessibilityLabel={t("settings.providers.mcp.openLink")}
            >
              {t("settings.providers.mcp.openLink")}
            </Button>
            <ToolbarButton label={t("settings.providers.mcp.copyLink")} onPress={handleCopy}>
              <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
            </ToolbarButton>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function McpServerRow({
  server,
  login,
  onAuthenticate,
  onOpen,
  onCopy,
}: {
  server: ProviderMcpServer;
  login: ProviderMcpLoginState | null;
  onAuthenticate: (server: string) => void;
  onOpen: (url: string) => void;
  onCopy: (url: string) => void;
}) {
  const { t } = useTranslation();
  const activeLogin = login?.server === server.name ? login : null;
  const showLogin = needsAuthentication(server.status);
  const handleAuthenticate = useCallback(() => {
    onAuthenticate(server.name);
  }, [onAuthenticate, server.name]);

  return (
    <View style={stylesheet.row}>
      <View style={stylesheet.rowHeader}>
        <View style={stylesheet.rowTitleGroup}>
          <Text style={stylesheet.rowTitle} numberOfLines={1}>
            {server.name}
          </Text>
          <Text style={stylesheet.status}>{t(statusKey(server.status))}</Text>
        </View>
        {showLogin ? (
          <Button
            variant="secondary"
            size="xs"
            leftIcon={LogIn}
            onPress={handleAuthenticate}
            disabled={activeLogin?.status === "starting" || activeLogin?.status === "waiting"}
          >
            {activeLogin?.status === "starting" || activeLogin?.status === "waiting"
              ? t("settings.providers.mcp.authenticating")
              : t("settings.providers.mcp.authenticate")}
          </Button>
        ) : null}
      </View>
      {server.detail ? (
        <Text style={stylesheet.detail} numberOfLines={2}>
          {server.detail}
        </Text>
      ) : null}
      {activeLogin ? <McpLoginNotice login={activeLogin} onOpen={onOpen} onCopy={onCopy} /> : null}
      {!showLogin && server.status !== "ready" ? (
        <Text style={stylesheet.detail}>{t("settings.providers.mcp.noLogin")}</Text>
      ) : null}
    </View>
  );
}

export function ProviderMcpAuthSection({
  serverId,
  provider,
  enabled,
}: {
  serverId: string;
  provider: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const { supported, servers, isLoading, error, login, refresh, authenticate } = useProviderMcpAuth(
    {
      serverId,
      provider,
      enabled,
    },
  );

  const handleOpen = useCallback((url: string) => {
    void openExternalUrl(url);
  }, []);
  const handleCopy = useCallback((url: string) => {
    void Clipboard.setStringAsync(url);
  }, []);
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  if (!supported) return null;
  if (!isLoading && servers.length === 0 && !error && provider !== "cursor") return null;

  return (
    <View style={stylesheet.section}>
      <View style={stylesheet.header}>
        <Text style={settingsStyles.sectionHeaderTitle}>{t("settings.providers.mcp.title")}</Text>
        <ToolbarButton
          label={t("settings.providers.mcp.refresh")}
          onPress={handleRefresh}
          disabled={isLoading}
        >
          {isLoading ? (
            <ThemedLoadingSpinner size={14} uniProps={foregroundMutedMapping} />
          ) : (
            <ThemedRotateCw size={ICON_SIZE.sm} uniProps={foregroundMutedMapping} />
          )}
        </ToolbarButton>
      </View>
      <View style={settingsStyles.card}>
        {error ? (
          <Text style={stylesheet.error} numberOfLines={4}>
            {error}
          </Text>
        ) : null}
        {servers.map((server) => (
          <McpServerRow
            key={server.name}
            server={server}
            login={login}
            onAuthenticate={authenticate}
            onOpen={handleOpen}
            onCopy={handleCopy}
          />
        ))}
        {servers.length === 0 && !error ? (
          <Text style={stylesheet.empty}>{t("settings.providers.mcp.empty")}</Text>
        ) : null}
      </View>
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  row: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  rowTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  rowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
  loginNotice: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.md,
  },
  loginNoticeBody: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  loginText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  loginMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize["2xs"],
  },
  loginActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
}));
