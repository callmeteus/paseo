# Buscar chats passados no menu `@`

## Objetivo

Hoje o menu `@` do composer só lista arquivos e diretórios do workspace (via
`directory_suggestions_request`). O objetivo é que o mesmo menu também encontre
**chats anteriores** — por título e por conteúdo das mensagens — e que selecionar
um deles anexe o histórico daquela conversa como contexto da mensagem atual,
reutilizando o mecanismo de fork que já existe (`chat_history`).

Resultado esperado ao digitar `@`:

```
╭──────────────────────────────────────────────╮
│ 🗨  Corrigir login no app          chats     │  ← conversa anterior
│ 🗨  Buscar chats passados          chats     │
│ 📄  …/composer/index.tsx          arquivo    │
│ 📁  packages                       pasta     │
╰──────────────────────────────────────────────╯
```

## Arquivos relevantes

| Arquivo                                                         | Papel                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/app/src/hooks/use-agent-autocomplete.ts`              | monta as opções do menu `@` hoje (só arquivos)                       |
| `packages/app/src/components/ui/autocomplete.tsx`               | renderização das linhas (`kind`: command/file/directory)             |
| `packages/app/src/composer/index.tsx`                           | `ComposerAutocompleteBinding` + `autocompleteConfiguration`          |
| `packages/app/src/hooks/use-fork-agent.ts`                      | já monta um anexo `chat_history` a partir de `buildAgentForkContext` |
| `packages/app/src/attachments/workspace-attachments-store.ts`   | `addWorkspaceAttachment` (dedupe por `kind` + `id`)                  |
| `packages/app/src/utils/file-mention-autocomplete.ts`           | detecção/substituição do token `@`                                   |
| `packages/server/src/server/agent/chat-search/index.ts`         | `findChatTextMatches` (existe)                                       |
| `packages/server/src/server/agent/host-operations/index.ts:342` | `searchChats` do MCP (lógica a extrair)                              |
| `packages/server/src/server/session.ts`                         | handlers de RPC                                                      |
| `packages/protocol/src/messages.ts`                             | schemas das mensagens e `features` do `server_info`                  |
| `packages/client/src/daemon-client.ts`                          | método do cliente                                                    |
| `packages/app/src/i18n/resources/*.ts`                          | strings (9 locales)                                                  |

## Decisões que preciso confirmar

1. **Ação ao selecionar um chat** — recomendado: anexar o histórico curado como
   destino `chat_history` (bounded por `MAX_FORK_CONTEXT_CHARS`, já truncado no
   daemon). Alternativas: apenas navegar para o chat, ou inserir um texto
   `@"título"` sem conteúdo.
2. **Escopo da busca** — recomendado: mesmo host, todas as workspaces (a atual
   primeiro), incluindo arquivados. Alternativa: só o `cwd` atual.
3. **Busca por conteúdo** — recomendado incluir (é o que torna "pesquisar chats
   passados" útil), o que exige a RPC nova. Se você quiser só título, a Fase 1
   inteira cai e a Fase 2 resolve tudo no cliente.

---

## Fase 1 — Daemon: RPC `chat.search`

### 1. Protocolo

`packages/protocol/src/messages.ts`

- `ChatSearchMatchSchema`: `{ seq, role: "user" | "assistant", snippet }`.
- `ChatSearchResultSchema`: `{ agentId, title, provider, status, cwd, updatedAt, archivedAt, titleMatch, matches }`.
- `ChatSearchRequestMessageSchema` (`chat.search.request`): `requestId`, `query`,
  `cwd?`, `includeArchived?`, `sinceHours?`, `limit?`. Sem `.transform()`/`.catch()`.
- `ChatSearchResponseMessageSchema` (`chat.search.response`): `payload` com
  `requestId`, `query`, `chats`, `error`.
- Registrar os dois nos unions `SessionInboundMessageSchema` e
  `SessionOutboundMessageSchema` (o gerador zod-aot pega sozinho).
- `features.chatSearch: z.boolean().optional()` em `ServerInfoStatusPayloadSchema`,
  com comentário `// COMPAT(chatSearch): added in <versão>, remove gate after <data>`.

### 2. Busca compartilhada no servidor

Novo `packages/server/src/server/agent/chat-search/cross-chat-search.ts`:

```ts
searchChatsAcrossAgents({
  agents, // lista já filtrada/ordenada (selectAgentListItems)
  loadRows: (agentId) => Promise<AgentTimelineRow[]>,
  query,
  limit,
  matchesPerChat,
  deadlineMs,
});
```

- Reaproveita `findChatTextMatches` para o conteúdo e faz match de título
  case-insensitive (sem acento não é requisito agora).
- Cache em memória `Map<agentId, { updatedAt, text }>` (LRU ~200) para não reler
  o JSON a cada tecla; invalida quando `updatedAt` muda.
- Deadline (ex.: 250 ms) devolve o que já achou em vez de estourar; candidatos
  limitados (ex.: 60 mais recentes).
- Mover para cá a lógica que hoje vive em
  `host-operations/index.ts:342` (`searchChats`) e fazer a host operation do MCP
  chamar a mesma função (uma implementação, dois consumidores).

### 3. Leitura sem carregar o agente

`packages/server/src/server/agent/agent-manager.ts`

- Novo `getSearchableTimelineRows(agentId)`: usa `durableTimelineStore.getCommittedRows`
  quando existir, senão `timelineStore.getRows` se já estiver carregado, senão `[]`.
- **Regra:** a busca nunca chama `ensureAgentLoaded` — carregar 60 agentes para
  cada tecla é inviável. Deixar isso explícito em comentário no módulo.

### 4. Handler da RPC

`packages/server/src/server/session.ts`

- `case "chat.search.request"` em `handleMessage` → `handleChatSearchRequest`.
- Monta candidatos com `agentStorage`/`agentManager` (sem `client.fetchAgents`),
  ordena por atividade, chama `searchChatsAcrossAgents` e responde com
  `emitForSource` usando `requestId`.
- `packages/server/src/server/authorization/operation-permissions.ts`:
  `"chat.search.request": "workspace.read"` e idem para `.response`.
- `packages/server/src/server/websocket-server.ts`: `chatSearch: true` em features.

### 5. Cliente

`packages/client/src/daemon-client.ts`

```ts
async searchChats(input: { query: string; cwd?: string; includeArchived?: boolean; limit?: number })
```

segue o padrão de `searchAgentTimeline` (`sendCorrelatedSessionRequest`).

---

## Fase 2 — App: chats no menu `@`

### 6. Lógica pura + testes

Novo `packages/app/src/utils/chat-mention-autocomplete.ts`:

- `filterAndRankChatMentions({ chats, query, excludeAgentId, limit })` — título
  (prefixo > contém) > conteúdo; empate por `updatedAt`.
- `removeMentionToken({ text, mention })` — remove `@query` do texto ao escolher
  um chat (o arquivo continua usando `applyFileMentionReplacement`).
- Testes em `chat-mention-autocomplete.test.ts` (mesmo estilo de
  `file-mention-autocomplete.test.ts`).

### 7. Hook do autocomplete

`packages/app/src/hooks/use-agent-autocomplete.ts`

- `AutocompleteMode` passa a aceitar `"mention"` (arquivos + chats) — o modo
  `"file"` atual vira o mesmo caminho.
- Novos inputs: `attachmentScopeKey?: string`, `onChatSelected?: (chat) => Promise<void>`,
  `canSearchChats: boolean` (vem de `useHostFeature(serverId, "chatSearch")`).
- Dois provedores de chat:
  - **recentes (sem query)**: `useAggregatedAgents({ demand: mode === "mention" })`,
    no máximo 3, excluindo o agente atual e sem arquivados (não estão no store).
  - **busca (query ≥ 2)**: `useQuery` com `keepPreviousData`, debounce ~250 ms,
    `queryKey: ["chatSearch", serverId, debouncedQuery]`, `staleTime: 30s`.
- Merge: chats primeiro (máx. 5), depois arquivos como hoje; nunca bloquear a
  lista de arquivos enquanto a busca de chat carrega (o `isLoading` continua
  ligado só a arquivos/comandos).
- `onSelectOption` para `type: "chat"`: remover o token, chamar `onChatSelected`,
  `onAutocompleteApplied()`.
- Falha da busca de chat é silenciosa (não vira `errorMessage` do menu, que hoje
  é de arquivos).

### 8. Renders

`packages/app/src/components/ui/autocomplete.tsx`

- `AutocompleteOption.kind` ganha `"chat"` + `kindDetail` opcional.
- Linha de chat: ícone `MessageSquare` (lucide), título, `description` =
  `cwd` encurtado + sufixo `(arquivado)` quando for o caso; quando houver
  `matches`, mostrar o primeiro snippet em `description`.
- Sem novo tipo de seção/cabeçalho: os chats ficam no topo da lista (como o
  `orderAutocompleteOptions` já inverte para o popover acima do input).

### 9. Composer

- `packages/app/src/composer/index.tsx`: incluir em `autocompleteConfiguration`
  `attachmentScopeKey: attachmentScopeKeys[0]` e `onChatSelected`.
- `onChatSelected` chama `client.buildAgentForkContext(agentId)` e
  `useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({ scopeKey, attachment })`
  com `id: chat_history:mention:<agentId>` (o store já deduplica/replace).
- Extrair `buildChatHistoryAttachment` de `packages/app/src/hooks/use-fork-agent.ts`
  para `packages/app/src/composer/chat-history-attachment.ts` e reutilizar nos
  dois lugares (fork e menção), sem duplicar a montagem do anexo.
- Sem scope key ou host sem `agentForkContext`: não oferecer linhas de chat.
- Erro ao montar o contexto → `toast.error` / `sendError` do composer.

### 10. i18n

Adicionar em `packages/app/src/i18n/resources/*.ts` (en, pt-BR, es, fr, ru, ja,
ko, zh-CN, ar): `agentAutocomplete.chatsSection` ("Chats"), `searchingChats`,
`noChats`, `attachChatFailed`.

---

## Riscos e casos de borda

- **Custo**: varrer todos os chats a cada tecla lê muitos JSONs. Mitigar com
  debounce, mínimo de 2 caracteres, cache por `(agentId, updatedAt)`, teto de
  candidatos e deadline com resultado parcial.
- **Nunca carregar agentes** durante a busca (ver §3). `searchChats` do MCP hoje
  faz `fetchAgentTimeline` por chat e carrega agentes; ao extrair a função,
  garantir que a RPC use o caminho leve.
- **Anexo grande**: `buildAgentForkContextAttachment` já corta em
  `MAX_FORK_CONTEXT_CHARS`, mas anexar várias conversas grandes ainda consome
  contexto. Limitar a um chat por menção (o `id` estável já substitui o anterior)
  e mostrar o `itemCount` no pill ("Previous conversation").
- **Auto-referência**: excluir o `agentId` atual dos resultados.
- **Cross-host**: MVP só no host da sessão; chats de outro host apareceriam sem
  cliente disponível para montar o contexto. Anotar como follow-up.
- **Arquivados**: entram pela RPC (o directory-sync do app usa `scope: "active"`,
  então o store do cliente não os tem). Marcar visualmente.
- **Host antigo** (sem `chatSearch`): apenas arquivos, sem quebrar nada.
- **Compatibilidade de protocolo**: mensagens novas só são emitidas em resposta
  a uma requisição que o cliente novo faz; cliente antigo nunca recebe
  `chat.search.response`. Campos novos são opcionais.
- **Mobile**: popover acima do input, `maxHeight` já dinâmico; manter poucas
  linhas de chat para não empurrar os arquivos para fora da área visível.
- **Preview do título**: chats sem título usam `t("workspace.tabs.loading")` /
  primeiro prompt como fallback — decidir no passo 7.

## Notas de implementação (o que mudou em relação ao plano)

- **Não existe `durableTimelineStore` em produção** — só nos testes. Sem ele,
  `getSearchableTimelineRows` lê apenas o timeline em memória. Na prática:
  - **título**: busca em todos os chats salvos (inclui arquivados);
  - **conteúdo**: só em chats carregados (abertos/recentes) e em chats
    importados via `portedTimeline`.
    Acordado em não chamar `ensureAgentLoaded` no picker: retomar sessão de
    provider a cada tecla custaria segundos e acordaria chats arquivados.
- `workspace.delete.response` entrou em `operation-permissions.ts` porque a
  árvore já estava sem essa entrada (trabalho paralelo) e o typecheck do servidor
  não passava; valor igual ao do request.
- Linhas de chat também são gateadas por `agentForkContext` (o anexo depende
  dele), não só por `chatSearch`.
- i18n final: `untitledChat`, `archivedChat`, `attachChatFailed`,
  `attachChatUnavailable` (não as chaves de seção previstas no passo 10).

## Verificação

1. `npm run build:client && npm run build:server` (declarações antes de typecheck).
2. `npx vitest run packages/app/src/utils/chat-mention-autocomplete.test.ts --bail=1`
3. `npx vitest run packages/server/src/server/agent/chat-search/cross-chat-search.test.ts --bail=1`
4. `npm run typecheck` e `npm run lint`; `npm run format` antes de commitar.
5. Manual com `npm run dev` + `npm run dev:app` (sem novo listener, então nada a
   fazer no Tailscale):
   - `@` vazio → 3 chats recentes + pastas/arquivos;
   - `@busca` → chat encontrado pelo conteúdo de uma mensagem, com snippet;
   - selecionar → o `@busca` desaparece do texto e aparece o pill
     "Previous conversation";
   - enviar → o agente recebe o histórico no prompt;
   - remover o pill → o anexo sai do composer;
   - host sem a feature → nenhuma linha de chat.
6. Rodar a suíte específica do MCP `paseo-tools` se a extração do §2 tocar a
   host operation (`packages/server/src/server/agent/tools/*.test.ts`).
