/**
 * MCP authentication copy. English is the fallback for every locale until the
 * settings surface is translated; pt-BR ships translated because the feature
 * was requested from the Portuguese UI.
 */
export const providerMcp = {
  title: "MCP servers",
  refresh: "Refresh MCP servers",
  empty: "No MCP servers configured for this provider",
  authenticate: "Authenticate",
  authenticating: "Authenticating...",
  loginSucceeded: "Authenticated. Refreshing the server list...",
  loginFailed: "Authentication failed",
  waitingForBrowser: "Complete the authorization in your browser.",
  waitingForHostBrowser: "Waiting for authorization in the browser on the host.",
  hostBrowserHint:
    "Open this link in a browser on the host that runs the daemon; the OAuth callback is local to that machine.",
  openLink: "Open link",
  copyLink: "Copy link",
  noLogin: "This server cannot be authenticated from Paseo.",
  statuses: {
    ready: "Ready",
    needsAuth: "Authentication required",
    needsApproval: "Approval required",
    error: "Error",
    unknown: "Unknown",
  },
} as const;

export const providerMcpPtBR = {
  title: "Servidores MCP",
  refresh: "Atualizar servidores MCP",
  empty: "Nenhum servidor MCP configurado para este provedor",
  authenticate: "Autenticar",
  authenticating: "Autenticando...",
  loginSucceeded: "Autenticado. Atualizando a lista de servidores...",
  loginFailed: "Falha na autenticação",
  waitingForBrowser: "Conclua a autorização no seu navegador.",
  waitingForHostBrowser: "Aguardando a autorização no navegador do host.",
  hostBrowserHint:
    "Abra este link em um navegador no computador que hospeda o daemon; o callback OAuth é local a essa máquina.",
  openLink: "Abrir link",
  copyLink: "Copiar link",
  noLogin: "Este servidor não pode ser autenticado pelo Paseo.",
  statuses: {
    ready: "Pronto",
    needsAuth: "Autenticação necessária",
    needsApproval: "Aprovação necessária",
    error: "Erro",
    unknown: "Desconhecido",
  },
} as const;
