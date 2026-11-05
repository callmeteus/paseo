# Agrupamento de steps estilo Cursor

## Objetivo

Trazer para o Paseo o agrupamento que o Cursor usa no chat: thinking, texto curto e
tool calls consecutivas viram um único bloco rotulado por verbo + partes
(`Explored 8 files, 8 searches, 1 tool`, `Edited 8 files, explored 34 files, ran 3 commands`),
com `Thought 2s` como linha própria de raciocínio e o detalhe expandido em rail indentado.

O Paseo já tem a mecânica de agrupar tool calls consecutivas; falta fundir o thinking,
enriquecer o vocabulário do resumo e melhorar a linha de raciocínio.

## Origem: o que o Cursor faz

Extraído do bundle instalado (`C:\Users\Gio\AppData\Local\Programs\cursor\resources\app`),
que traz a lógica duplicada em `out/vs/workbench/workbench.glass.main.js` (UI nova) e
`out/vs/workbench/workbench.desktop.main.js` (UI antiga). Nomes de módulo sobreviveram à
minificação e estão citados abaixo.

### Configuração (`hAb`, módulo `step-grouping.ts`)

```
groupThinking: true   groupText: true
textMaxLength: 100    textMaxLines: 2
minGroupSize: 1       separateShellGroups: false
```

Texto do assistente só entra no grupo se passar em `Tff`: ≤ 100 chars, ≤ 2 linhas, e sem
` ` ```, heading, item de lista ou tabela.

Whitelist de tools agrupáveis (`xff`): read, grep, glob, ls, semSearch,
searchConversations, readLints, readTodos, fetch, webFetch, webSearch, getMcpTools,
generateImage. Providers de browser (`cursor-ide-browser`, `cursor-browser-extension`)
formam grupo próprio.

### Passada de agrupamento (`hAb`)

1. `awaitToolCall` fecha o grupo atual, cria _waiting-group_, costura o thinking
   imediatamente anterior.
2. Última mensagem do turno concluído e é `assistant-message` → flush + item solto.
3. Tool de browser → _browser-group_, só se ≥ 2 tool calls.
4. Senão `nAb` decide: thinking se `groupThinking`; texto se `groupText` e `Tff`; tool se
   `isToolGroupable` e não for edit/delete com aprovação pendente.
5. `aAb` quebra o grupo quando o tipo muda: edit/delete vs resto, e shell vs resto quando
   `separateShellGroups`.

Materialização (`xki`): grupo só de texto exige mínimo 3 itens; só thinking usa
`minGroupSize`; resto conta tool calls. Abaixo do mínimo, os itens viram linhas soltas.

### Resumo (`dAb`)

Uma passada acumula `files[]` (reads, dedup por basename), `directories[]` (ls),
`searches`, `fetches`, `lints`, `commands`, `mcpToolCalls`, `mcpServers[{id,count}]`
ordenados desc, `browserActions`, `taskCalls`, `images`, edits/deletes com
before/after/linesAdded/linesRemoved, e soma `thinkingDurationMs`.

### Rótulo (`SSf`, módulo `step-group-display.ts`)

```
SSf = _Fb ?? yFb ?? bFb ?? SFb ?? IFb
```

| Etapa | Condição         | Saída                                                |
| ----- | ---------------- | ---------------------------------------------------- |
| `_Fb` | só thinking      | ação `Thought`, detalhe = título extraído ou duração |
| `yFb` | tudo browser     | `Ran N browser actions`                              |
| `bFb` | background/await | `Monitored N background tasks, X complete, Y active` |
| `SFb` | só edit/delete   | `Edited N files`, ou `Skipped` se tudo rejeitado     |
| `IFb` | resto            | ver abaixo                                           |

`IFb` escolhe o verbo: tudo shell → `Ran N commands`; tudo imagem → `Generated N images`;
tem edit → `Edited N files`; senão `Explored`. Enquanto streama, `Exploring`.

O detalhe (`lFb` + `TFb`) é a parte que dá o visual característico. Ordem das partes,
todas pluralizadas, juntadas por `", "`:

```
[edits] [directories] [arquivos lidos] [searches] [fetches] [lints]
[mcp tools] [browser actions] [images] [commands] [agents]
```

Sufixo `+12 -3` quando há diff. Quando existe parte de edição, a primeira parte recebe o
prefixo minúsculo `explored `, produzindo `Edited 8 files, explored 34 files, ran 3 commands`.

### Thinking (`ThinkingLine.tsx`)

- Título em `FLa`: primeira linha que casa `/^\*\*(.+?)\*\*$/` ou `/^#{1,6}\s+(.+)$/`.
- Um header só e sem corpo → `isHeaderOnly`, não expansível, header é o rótulo inteiro.
- `oFb` remove a linha do header do corpo renderizado.
- Duração `fSf`: `< 500 ms` → `briefly`; senão `N s` (arredondado); com header a duração
  some.
- Sem título → `Thought 2s`.

## Estado atual do Paseo

| Peça                                 | Arquivo                                                      |
| ------------------------------------ | ------------------------------------------------------------ |
| Runs de tool calls consecutivas      | `packages/app/src/tool-calls/detail-level/grouping.ts`       |
| Resumo por run                       | `packages/app/src/tool-calls/detail-level/overview/model.ts` |
| Rótulo i18n do resumo                | `packages/app/src/tool-calls/detail-level/overview/label.ts` |
| Render do grupo                      | `packages/app/src/tool-calls/detail-level/overview/view.tsx` |
| Pipeline de apresentação             | `packages/app/src/agent-stream/presentation.ts`              |
| Render do timeline                   | `packages/app/src/agent-stream/view.tsx`                     |
| Badge expansível                     | `packages/app/src/components/message.tsx`                    |
| Configuração `ChatDisplay`           | `packages/app/src/hooks/use-settings/storage.ts`             |
| Sequência visual (já inclui thought) | `packages/app/src/agent-stream/layout.ts`                    |

Lacunas:

1. `isGroupableToolCall` só aceita `kind === "tool_call"`; `thought` quebra o run.
2. Resumo não conta arquivos lidos como lista, MCP por servidor, nem `+X -Y`.
3. `ThoughtSlot` renderiza como tool call `"Thinking"`, sem duração e sem extração de header.
4. Texto curto não dobra em nada.
5. `ExpandableBadge` aceita só 1 ícone; o Cursor põe partes com ícones inline.
6. `ThoughtItem` não guarda início, então não há como medir duração.

## Decisão pendente

Qual `ChatDisplay` recebe isso:

- **A** — enriquece `collapseToolCalls`, padrão continua `collapseTurns`.
- **B** — enriquece `collapseToolCalls` e troca o padrão para ele (visual Cursor por padrão).
- **C** — quarta opção no menu, as três atuais intactas.

O plano abaixo assume o modo `collapseToolCalls`; só o passo 8 muda entre A/B/C.

## Etapas

### 1. Modelo do run (`tool-calls/detail-level/grouping.ts`)

Renomear `ToolCallRun` para `StepRun` com `steps: readonly GroupableStep[]`, onde
`GroupableStep = ToolCallItem | ThoughtItem`. Manter `calls` como campo derivado só com
tool calls, para `turn-collapse` e o sheet continuarem funcionando. Trocar
`isGroupableToolCall` por `isGroupableStep` preservando a exclusão de `plan` e `speak`.

### 2. Duração de thinking (`types/stream.ts`)

Adicionar `startedAt?: Date` em `ThoughtItem`. Setar em `appendThoughtChunk` quando nasce
um thought novo, preservar no merge e em `markThoughtReady`. Estado derivado no cliente,
sem mudança de protocolo.

### 3. Resumo (`overview/model.ts`)

Expandir `OverviewSummary` para o formato do `dAb`: `files`, `directories`, `searches`,
`fetches`, `lints`, `commands`, `mcpToolCalls`, `mcpServers`, `browserActions`,
`taskCalls`, `images`, `editedFiles`, `fileChangeStats`, `thinkingDurationMs`, `hasText`.
`summarizeToolCalls` passa a receber `GroupableStep[]`.

### 4. Rótulo (novo `overview/step-label.ts`)

Portar a cadeia `_Fb → yFb → bFb → SFb → IFb` como funções puras devolvendo
`{ loadingAction, completedAction, details, parts, isHeaderOnly, expandable }`.
`useOverviewSummaryLabel` passa a consumir. Chaves novas em `i18n/resources/en.ts` e nos
outros 9 locales:

```
toolCallGroup.exploredFiles / exploredDirectories / searches / fetches
toolCallGroup.lints / mcpTools / browserActions / images / agents
toolCallGroup.thought / thoughtBriefly / thoughtFor
```

### 5. Linha com partes (`components/message.tsx`)

Novo prop opcional `parts?: ReactNode` em `ExpandableBadge`, mantendo
`label`/`secondaryLabel` para os outros 34 usos. É o que permite `⚙ 1 tool` inline. Se
mexer no badge parecer arriscado, criar `StepGroupBadge` ao lado e usar só no grupo.

### 6. Header de thinking (novo `utils/thought-header.ts`)

`parseThoughtHeader(text)` → `{ title, hasBody, headerCount }` e
`stripThoughtHeader(text)`, com os regex do `FLa`/`oFb`. `ThoughtSlot` passa a usar
`displayName = title ?? "Thought"` e `summary = formatThoughtDuration(ms)`.

### 7. Fiação (`agent-stream/presentation.ts`, `agent-stream/view.tsx`)

`prepareToolCallHistory` e `projectToolCallDetailLevel` passam a levar thought junto do
run. Em `renderToolCallItem`, o `children` do `IndentRail` itera `group.run.steps` e
renderiza thought com `renderThoughtItem` em vez de só `group.run.calls`.

### 8. Modo (`hooks/use-settings/storage.ts`)

- **A**: nada muda; só o comportamento de `collapseToolCalls` melhora.
- **B**: `chatDisplay: "collapseTurns"` → `"collapseToolCalls"` em `DEFAULT_CLIENT_SETTINGS`.
- **C**: estender a union e o enum do zod, mais uma opção no menu de Settings.

### 9. Texto curto (opcional, depois do resto)

`foldShortText(text)` com as regras do `Tff`. Só vale se você quiser o comportamento
completo do Cursor; sem isso o resultado já fica bem próximo do print.

## Riscos e casos de borda

- **`turn-collapse` lê `group.run.calls`** (`presentation.ts:113`). Thought dentro do run
  mudaria a contagem do resumo do turno. Por isso `calls` continua só com tool calls e
  `steps` é campo separado.
- **Perf.** `groupLiveToolCalls` roda a cada tick e o texto do thought muda a cada chunk.
  Memoizar por texto do último thought e por duração, senão `stream-tick.bench.ts` regride.
- **i18n.** Plural e concordância não cabem num `one/other` genérico em pt/ru/ar. Usar
  chaves separadas por parte e testar `pt-BR`, `ru`, `ar`.
- **`displayName: "Thinking"`** vem de `packages/protocol/src/tool-call-display.ts:138` e é
  usado também pelo `tool-call-sheet`. Avaliar se a mudança fica no app ou no protocolo.
- **Compacto.** A linha com partes precisa truncar em 1 linha no mobile; o sheet já existe.
- **Grupos de 1 item.** Com `minGroupSize: 1` um único read vira grupo de 1, igual ao
  Cursor. Confirmar que isso não deixa o chat mais verboso do que hoje no modo `full`.

## Verificação

- `npx vitest run packages/app/src/tool-calls/detail-level/projection.test.ts --bail=1`
- Novo `step-label.test.ts` com fixtures: 8 reads + 8 greps + 1 MCP → `Explored 8 files,
8 searches, 1 tool`; com edits → `Edited N files, explored M files, ran K commands`;
  só thinking → `Thought 2s`; thinking < 500 ms → `Thought briefly`.
- `npx vitest run packages/app/src/agent-stream/stream-tick.bench.ts` para regressão de tick.
- `npm run typecheck` e `npm run lint` ao fim de cada etapa.
- Visual: `npm run dev:app`, rodar um agente com trabalho longo, alternar as três opções de
  Chat display e conferir mobile + desktop.
