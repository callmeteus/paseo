# Portar conversa como turnos reais

## Objetivo

Ao trocar o provider de um chat, entregar a conversa anterior **turno a turno** quando o
provider aceitar inserir mensagens sem gerar resposta. Nos demais, deixar **um prompt** com
o transcript, como hoje.

A escolha é por provider, feita em tempo de criação da sessão, com queda para o prompt se a
inserção falhar.

## O que já existe

| Peça                         | Arquivo                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Port e transcript            | `packages/server/src/server/agent/agent-provider-swap.ts`                        |
| Gravação do registro portado | `swapAgentProvider` (mesmo arquivo)                                              |
| Criação/retomada de sessão   | `AgentManager.reloadAgentSession` (`agent-manager.ts:2126`) e `createAgent:1796` |
| Interface do provider        | `AgentSession` em `agent-sdk-types.ts:698`                                       |
| Schema do registro           | `agent-storage.ts`                                                               |
| Adapter OpenCode v2          | `providers/opencode/v2/session.ts`, `v2/turns.ts`                                |
| Adapter OpenCode v1          | `providers/opencode/` (mesmo SDK)                                                |

Capacidade do SDK (`@opencode-ai/sdk` 1.14.46, `dist/gen/types.gen.d.ts`):

```
SessionPromptData.body = {
  messageID?, model?, agent?, noReply?: boolean, system?, tools?,
  parts: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>
}
TextPartInput = { type: "text", text: string, synthetic?: boolean, ignored?: boolean, ... }
```

`noReply: true` grava a mensagem sem chamar o modelo. `synthetic: true` a marca como
contexto inserido pela ferramenta, não como fala do usuário.

## Limite honesto

Nenhum adapter permite injetar `role: "assistant"`. Toda mensagem inserida é do usuário.
Então "turno a turno" significa: **um turno de usuário por troca**, com o par
usuário+assistente dentro dele, marcado como sintético. Preserva a fronteira de turno e o
conteúdo; não preserva a alternância de papéis.

Providers sem `noReply` (Cursor/ACP, Claude, Codex, Pi) recebem o transcript como um prompt
no system prompt. Inventar turnos ali custaria uma resposta gerada por turno.

## Desenho

O registro portado guarda **os dois formatos**: os turnos e o transcript. Quem escolhe é a
criação da sessão, porque é a única hora em que a capacidade real do provider é conhecida e
ainda dá para cair no prompt sem perder contexto.

```
port time                →  registro: systemPrompt + portedConversation + portedContext
session creation (hoje)  →  suporta seeding?
                             ├─ sim → seedConversation(turnos); falhou? anexa portedContext
                             └─ não → anexa portedContext
```

Decisão travada: `portedConversation` guarda o texto **já renderizado** por turno (string),
não a estrutura original. Simples, estável e não exige schema de conteúdo.

## Etapas

### 1. Tipos

Em `agent-sdk-types.ts`:

```ts
export interface PortedConversationTurn {
  role: "user" | "assistant";
  text: string;
}
```

Em `AgentSession`, membro opcional:

```ts
/** Insere conversa anterior como mensagens do provider, sem gerar resposta.
 *  Devolve false quando o provider não consegue, para o chamador cair no prompt. */
seedConversation?(turns: readonly PortedConversationTurn[]): Promise<boolean>;
```

### 2. Montar os turnos (`agent-provider-swap.ts`)

Nova função `buildPortingTurns(items): PortedConversationTurn[]`, irmã de
`buildPortingTranscript` e reusando `formatToolRun` e o orçamento:

- fecha um turno a cada novo `user_message`;
- tool calls viram uma linha dentro do texto do turno (`Assistant used 3 tools (...)`);
- `assistant_message` entra no turno corrente;
- respeita `MAX_PORTED_TRANSCRIPT_CHARS`, mantendo o **primeiro turno** (a tarefa) e os mais
  recentes, com o marcador de omissão.

`buildPortingTranscript` continua existindo: é ele que produz `portedContext`.

### 3. Capacidade por provider

Flag estático no registro de providers (`provider-registry` / manifest):

```ts
supportsConversationSeeding: boolean; // true só em opencode por enquanto
```

Serve para não tentar semear em quem notoriamente não sabe. A confirmação real é o retorno
de `seedConversation`.

### 4. Persistência

`agent-storage.ts`, todos opcionais (registro antigo continua válido, sem migração; ver
docs/data-model.md):

- `portedConversation?: PortedConversationTurn[]`
- `portedContext?: string` — o transcript, para o caminho de prompt
- `portedConversationSeededAt?: string` — marca que a sessão já recebeu os turnos

`swapAgentProvider` deixa de escrever a seção portada dentro de `config.systemPrompt` e passa
a gravar `portedContext` ao lado. O system prompt fica só com o que já era dele.

### 5. Implementar `seedConversation` no OpenCode

`providers/opencode/v2/session.ts` e o equivalente v1, **um `prompt` por turno**:

```ts
async seedConversation(turns) {
  for (const turn of turns) {
    await this.client.session.prompt({
      sessionID: this.id,
      noReply: true,
      parts: [{ type: "text", text: renderTurn(turn), synthetic: true }],
    });
  }
  return true;
}
```

`renderTurn` prefixa `User:` / `Assistant:` para o par ficar legível dentro do turno.

### 6. Fiar na criação da sessão

Em `AgentManager.reloadAgentSession` (e em `createAgent` quando cria a partir de registro
portado), logo depois de `client.createSession(...)` / `resumeSession(...)`:

```ts
const record = await registry.get(agentId);
const turns = record?.portedConversation ?? [];
const context = record?.portedContext;
if (turns.length > 0 && !record.portedConversationSeededAt && supportsConversationSeeding) {
  const seeded = (await session.seedConversation?.(turns)) ?? false;
  if (seeded)
    await registry.upsert({ ...record, portedConversationSeededAt: new Date().toISOString() });
  else if (context) await this.applyPortedContext(session, context); // queda para o prompt
} else if (context && turns.length === 0) {
  await this.applyPortedContext(session, context); // provider sem seeding
}
```

`applyPortedContext` usa `session.setDaemonAppendSystemPrompt?.(base + "\n\n" + context)`
quando existir; senão entra no `launchConfig` antes do `createSession` (por isso a decisão
precisa acontecer antes da criação quando o provider não tem o setter).

### 7. Não duplicar no timeline

Risco principal, spike antes do resto: mensagens injetadas provavelmente voltam em
`streamHistory()` e virariam linhas novas, duplicando o histórico portado.

1. Se `synthetic: true` já for excluído pelo `event-translator`, só garantir o filtro lá.
2. Senão, marcar via `metadata` no part e descartar mensagens com essa marca no tradutor.

## Riscos e casos de borda

- **Duplicação de timeline** (etapa 7) — decide se a abordagem vale; testar primeiro.
- **Custo de contexto**: turnos reais ocupam contexto de verdade e são cobrados em toda
  chamada seguinte. O cap de 24k chars continua.
- **Versão do OpenCode**: `noReply` existe no SDK 1.14.46, mas quem responde é o servidor
  local. Se ele ignorar `noReply`, cada turno geraria uma resposta — por isso o
  `seedConversation` deve validar o primeiro `prompt` antes de continuar e devolver `false`
  na dúvida.
- **Sessão reaberta**: se o provider descartar mensagens sintéticas ao recarregar, o chat
  fica sem contexto e `portedConversationSeededAt` mente. Mitigação: só marcar como semeado
  depois de reler `streamHistory()` e encontrar os turnos.
- **Re-port de um chat já portado**: `previousItems` vêm do timeline do Paseo, não da sessão
  do provider, então não depende do que foi semeado.
- **Sem duplicar os dois caminhos**: nunca semear e anexar `portedContext` na mesma sessão.

## Verificação

- `npx vitest run packages/server/src/server/agent/agent-provider-swap.test.ts --bail=1` com
  casos novos: pareamento usuário+assistente, tool run colapsado, cap preservando o
  primeiro turno.
- Spike manual com o daemon dev: portar kilo→opencode, conferir em `session.messages` N
  mensagens sintéticas e **nenhuma** resposta gerada.
- Portar para um provider sem suporte (ex.: claude) e conferir que o `portedContext`
  apareceu no system prompt e que nenhum turno foi inserido.
- Contar linhas do timeline antes e depois de reabrir o chat (`fetchTimeline` com
  `limit: 0`) para garantir que não duplicou.
- `npm run typecheck` no workspace `server` e `npm run lint` nos arquivos tocados.
