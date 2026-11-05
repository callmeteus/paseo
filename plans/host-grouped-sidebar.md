# Sidebar: agrupamento opcional por host + exclusão permanente de chats e workspaces

## Objetivo

Duas mudanças na sidebar:

1. **Agrupamento opcional por host** em árvore `Host > workspaces`, com cada host colapsável. O padrão continua o modo atual (`project`). A unidade de linha é **workspace** (não repositório): cada host lista seus workspaces direto, com ícone/nome do projeto como contexto.
2. **Exclusão permanente** (não só arquivar) de:
   - **um chat** — um agente/tab de workspace;
   - **um workspace inteiro** — com todos os seus agentes e abas.

As duas ações exigem confirmação destrutiva.

## Arquivos relevantes

### Host grouping

- `packages/app/src/stores/sidebar-view-store.ts`
- `packages/app/src/stores/sidebar-collapsed-sections-store/state.ts` + `index.ts`
- `packages/app/src/components/sidebar/sidebar-labels.ts`
- `packages/app/src/components/sidebar/sidebar-projection.ts`
- `packages/app/src/components/sidebar/sidebar-model.tsx`
- `packages/app/src/components/sidebar/sidebar-status-list.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/display-preferences/menu.tsx` + `model.ts`
- `packages/app/src/components/left-sidebar.tsx`
- `packages/app/src/i18n/resources/*.ts`

### Exclusão permanente

- `packages/protocol/src/messages.ts`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/workspace-archive-service.ts` (helpers de teardown)
- novo `packages/server/src/server/workspace-delete-service.ts`
- `packages/server/src/server/authorization/operation-permissions.ts`
- `packages/client/src/daemon-client.ts`
- `packages/app/src/hooks/use-archive-agent.ts` (ou novo `use-delete-agent.ts`)
- `packages/app/src/runtime/host-runtime.ts` / `runtime/directory-sync/index.ts`
- `packages/app/src/screens/workspace/workspace-tab-menu.ts`
- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx`
- `packages/app/src/screens/workspace/compact-workspace-header/tab-switcher.tsx`
- `packages/app/src/screens/workspace/explorer-sidebar.tsx`
- `packages/app/src/screens/workspace/workspace-screen.tsx`
- `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/sidebar-status-list.tsx`
- novo `packages/app/src/workspace/use-delete-workspace.ts`

---

# Parte 1 — Agrupamento por host

## Etapas

1. **Tipo e persistência**
   - `SidebarGroupMode` vira `"project" | "status" | "host"`.
   - `PersistedSidebarGroupModeSchema` aceita `"host"`; `migrateSidebarViewState` mapeia `"host"` explicitamente e mantém `"project"` como fallback.

2. **Colapso**
   - Reutilizar `collapsedWorkspaceGroupKeys` com chave `host:<serverId>` (helper `hostGroupKey(serverId)` em `sidebar-collapsed-sections-store/state.ts`), sem novo campo nem bump de schema.

3. **Modelo do grupo**
   - `SidebarWorkspaceGroup["leading"]` ganha `{ kind: "host"; serverId: string; label: string }`.
   - `sidebar-projection.ts`: `buildHostWorkspaceGroups(workspaces, hostById, t)` agrupa por `serverId`, ordena hosts (local primeiro, depois label) e linhas por `projectName`/`name`. `key = hostGroupKey(serverId)`.
   - `buildWorkspaceGroups` ganha `case "host"`; o switch exaustivo transforma esquecimentos em erro de compilação.
   - `SidebarProjectionInput` ganha `hostById`; `sidebar-model.tsx` monta a partir de `useHosts()`.

4. **Renderização**
   - `sidebar-status-list.tsx`: `StatusGroupHeader`/`StatusGroupLeadingVisual` passam a renderizar `HostStatusDot` + label + chevron quando `leading.kind === "host"`.
   - Linhas continuam sendo `StatusWorkspaceRow`; em modo host não passar `hostBadge` (redundante).

5. **Seleção do modo e reveal**
   - `groupMode !== "project"` já cobre `host`. No efeito de reveal, adicionar o caso: expandir `host:<serverId>` antes de rolar até a linha.

6. **Botões de ativação**
   - `display-preferences/menu.tsx`: terceira opção `host` com ícone `Server` e chave `sidebar.display.grouping.host`.
   - `WorkspacesSectionHeader` em `left-sidebar.tsx`: botão de alternância rápida ao lado do menu, estado ativo e `testID="sidebar-toggle-host-grouping"`.
   - i18n em todos os locales.

## Riscos (parte 1)

- Workspace pertence a exatamente um host, então não há duplicação de projeto; linhas de projeto com workspaces em hosts diferentes aparecem distribuídas. Confirmar que esse é o comportamento esperado.
- Decidir: host sem workspaces visíveis some ou aparece com estado vazio (recomendo sumir).
- `manual` sort não se aplica ao modo host; sem drag entre hosts nesta iteração.

---

# Parte 2 — Exclusão permanente de um chat

O daemon **já** tem `delete_agent_request` (`client.deleteAgent`, `handleDeleteAgentRequest`, `agent_deleted`), mas o app não expõe isso com confirmação. A exclusão é o agente em si, não o fechamento da aba (fechar continua arquivando).

## Etapas

1. **Estado otimista do host**
   - Adicionar `HostRuntimeStore.removeAgentSnapshot(serverId, agentId)` delegando a `DirectorySync.removeAgent`.

2. **Hook de exclusão**
   - Em `use-archive-agent.ts` (ou novo `use-delete-agent.ts`), exportar `useDeleteAgent()`: mutation chama `client.deleteAgent(agentId)`, remove o agente via `removeAgentSnapshot`, invalida `agentHistoryQueryKey` e `allAgentHistoryQueryRootKey`, limpa o pending de arquivamento.

3. **Confirmação**
   - `confirmDialog` destrutivo: título "Excluir chat permanentemente", mensagem deixando claro que a conversa/histórico não pode ser recuperada. Se o agente estiver `running`, mensagem extra avisando que ele será encerrado.

4. **Ação no menu da aba**
   - `WorkspaceTabMenuLabels` ganha `deletePermanently`; união de ícones ganha `"trash-2"`.
   - `BuildWorkspaceTabMenuEntriesInput` ganha `onDeleteAgent(agentId)`.
   - Renderizar o item destrutivo **somente para `tab.target.kind === "agent"`**, depois de um separador, antes ou depois de "Close".
   - Propagar por `buildWorkspaceDesktopTabActions`, `workspace-desktop-tabs-row.tsx`, `compact-workspace-header/tab-switcher.tsx` e `explorer-sidebar.tsx`.

5. **Handler em `workspace-screen.tsx`**
   - `handleDeleteAgentTab`: confirmar → fechar a tab via `closeWorkspaceTabWithCleanup` + `hideWorkspaceAgent` → chamar `deleteAgent` → se era a aba ativa, redirecionar para a aba vizinha/raiz do workspace (reutilizar o padrão de `redirectIfArchivingActiveWorkspace` ou criar um `redirectIfDeletingActiveTab`).

6. **Fora de escopo**
   - Exclusão de chats arquivados na tela de histórico pode reutilizar o mesmo hook numa etapa futura; o pedido cobre as abas do workspace.

## Riscos (parte 2)

- Irreversível: o servidor apaga registro e timeline. A confirmação precisa deixar isso explícito.
- Excluir um agente pai pode deixar subagentes órfãos; decidir se a UI bloqueia quando `agent.parentAgentId` existe ou exclui em cascata.
- Outros clientes veem a remoção via directory sync; chamar `removeAgentSnapshot` localmente evita atraso na UI que iniciou.

---

# Parte 3 — Exclusão permanente de um workspace

Não existe RPC de exclusão de workspace; só `archive_workspace_request`. É preciso adicionar um RPC novo, aditivo e compatível.

## Etapas

1. **Protocolo** (`packages/protocol/src/messages.ts`)
   - `WorkspaceDeleteRequestSchema`: `type: "workspace.delete.request"`, `workspaceId`, `requestId`, `deleteFiles?: boolean`.
   - `WorkspaceDeleteResponseMessageSchema`: `type: "workspace.delete.response"`, payload `{ requestId, workspaceId, error }`.
   - Registrar nos unions de entrada/saída e na geração zod-aot.
   - Adicionar feature opcional `workspaceDelete: z.boolean().optional()` em `server_info.features` com tag `COMPAT(workspaceDelete)`.

2. **Servidor**
   - `session.ts`: dispatch `case "workspace.delete.request"` → `handleWorkspaceDeleteRequest`.
   - Novo `packages/server/src/server/workspace-delete-service.ts` com `deleteWorkspacePermanently({ deps, workspaceId, deleteFiles })`:
     - para o setup do workspace e mata terminais;
     - para cada agente do workspace: `closeAgentCommand`, `agentStorage.remove`, `agentManager.deleteAgentState`;
     - remove o registro via `workspaceRegistry.remove(workspaceId)`;
     - emite updates de workspace e deltas de agente removidos;
     - `deleteFiles === true` só remove diretório quando for worktree **Paseo-owned** — nunca um checkout do usuário. Reaproveitar/exportar `resolveWorkspaceBackingDirectory` e `maybeRemoveDirectory` de `workspace-archive-service.ts`.
   - Permissão: `workspace.delete.request: ["workspace.manage", "hub.execute"]` em `operation-permissions.ts`.
   - Responder `workspace.delete.response` com `error` em caso de falha, sem remover o registro parcialmente.

3. **Cliente**
   - `DaemonClient.deleteWorkspace(workspaceId, options?: { deleteFiles?: boolean })` seguindo o padrão de `archiveWorkspace`.

4. **App**
   - Novo `useDeleteWorkspace` em `packages/app/src/workspace/`:
     - `confirmDialog` destrutivo; quando `workspaceKind === "worktree"` e Paseo-owned, oferecer/decidir sobre apagar o diretório (`deleteFiles`);
     - chama `client.deleteWorkspace`, remove otimisticamente via `removeWorkspaceSnapshot`, limpa `useWorkspaceLayoutStore.purgeWorkspace(workspaceKey)`, invalida caches de histórico dos agentes do workspace;
     - se o workspace era o ativo, redireciona para a tela inicial/lista antes de remover.
   - Confirmar com o usuário se "apagar workspace" deve também apagar o worktree Paseo-owned do disco (recomendo sim, com checkbox default ligado para worktrees e desligado para checkouts).

5. **Menu da sidebar**
   - `SidebarWorkspaceMenuItems` ganha `onDelete?: () => void` e renderiza um item destrutivo "Excluir permanentemente" com ícone `Trash2`, após um separador abaixo de Arquivar.
   - Propagar por `SidebarWorkspaceMenu`, `SidebarWorkspaceContextMenu`, `WorkspaceRowWithMenu` (`sidebar-workspace-list.tsx`) e `StatusWorkspaceRowWithMenu` (`sidebar-status-list.tsx`).
   - Gate por `useHostFeature(serverId, "workspaceDelete")`: host antigo não mostra a ação, sem fallback.

6. **i18n**
   - Novas chaves em `en`, `pt-BR`, `es`, `fr`, `ja`, `ko`, `ru`, `zh-CN`, `ar`:
     - `sidebar.workspace.actions.deletePermanently`
     - `sidebar.workspace.confirmations.deleteTitle` / `deleteMessage` / `deleteConfirm`
     - `sidebar.workspace.toasts.deleteFailed`
     - `workspace.tabs.menu.deletePermanently`
     - `workspace.tabs.confirmations.deleteAgentTitle` / `deleteAgentMessage` / `deleteAgentRunningMessage`

## Riscos e decisões (parte 3)

- **Irreversível e amplo**: apagar workspace remove histórico de todos os agentes. A confirmação deve nomear o workspace e a contagem de chats.
- **Arquivos em disco**: decidir explicitamente se `deleteFiles` apaga o worktree Paseo-owned. Checkouts normais nunca são apagados.
- **Agentes rodando**: decidir entre bloquear a exclusão com um agente ativo ou encerrá-los após confirmação (recomendo encerrar, avisando na confirmação).
- **Falha parcial**: se um agente não puder ser removido, abortar antes de remover o registro do workspace, ou reportar estado parcial; preferir abortar.
- **Compatibilidade**: RPC aditivo + feature flag; clientes antigos continuam arquivando normalmente.

---

# Verificação

1. Testes unitários:
   - `sidebar-projection.test.ts`: modo `host` gera um grupo por host, chave `host:<serverId>`, ordem de hosts e linhas.
   - `sidebar-view-store.test.ts`: migração aceita/persiste `"host"`.
   - `sidebar-collapsed-sections-store/state.test.ts`: toggle de chave `host:*` persiste.
   - `workspace-tab-menu.test.ts`: item de exclusão só em abas de agente, destrutivo, chama `onDeleteAgent`.
   - `workspace-delete-service.test.ts` + teste de sessão (`session.workspaces.test.ts`) para `workspace.delete.request`.
2. `npm run typecheck`, `npm run lint`, `npm run format`.
3. Manual:
   - Ativar/desativar agrupamento por host pelos dois botões; colapsar hosts; recarregar e confirmar persistência.
   - Excluir um chat pela aba: confirmação aparece, aba fecha, agente some da lista, histórico não volta após reload.
   - Excluir um workspace pela sidebar: confirmação aparece, workspace e seus chats somem, app redireciona se era o ativo.
   - Host antigo (sem a feature) não mostra a opção de excluir workspace.
