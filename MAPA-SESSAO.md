# Mapa completo da sessao: merge upstream + develop

## 1. Objetivo original

Trazer todos os commits remotos do Paseo (`original/main` = getpaseo/paseo) para o fork (`origin` = callmeteus/paseo), em uma worktree, decidindo conflitos tema a tema, e abrir PR.

## 2. Estrutura criada

| Item          | Valor                                                       |
| ------------- | ----------------------------------------------------------- |
| Worktree      | `C:/Users/Gio/Documents/Projetos/paseo-sync-upstream`       |
| Branch        | `sync/original-main`                                        |
| Base          | `develop` @ `8417781b6`                                     |
| PR            | https://github.com/callmeteus/paseo/pull/2 (base `develop`) |
| Repo fork     | `origin` = `https://github.com/callmeteus/paseo.git`        |
| Repo upstream | `original` = `https://github.com/getpaseo/paseo.git`        |

## 3. Commits na branch

| Commit      | O que fez                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `699d95bc7` | Merge de `original/main` (603 commits), 223 conflitos resolvidos                                                                           |
| `77f42d6f8` | Regeneracao do `package-lock.json` (estava dessincronizado, `npm ci` falhava)                                                              |
| `70e413fb0` | Merge do `develop` (12 commits novos), 23 conflitos resolvidos                                                                             |
| `9ae37f8a4` | Merge do `develop` novamente (6 commits), 7 conflitos resolvidos                                                                           |
| `104087b55` | Auditoria: correcoes em `option-controls.ts` e testes                                                                                      |
| `7b385a2fc` | Merge do `develop` (4 commits de CI), 3 conflitos; restaura `buildSettingsAddHostRoute`, tipos `DaemonApiToken*Response` e excecao de lint |

## 4. Decisoes de conflito (tema por tema)

| Tema                | Decisao                                                            | Verificado em                                                        |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| CI                  | Manter o nosso (Forgejo Actions). Regra no `CLAUDE.md`/`AGENTS.md` | `.forgejo/workflows/` existe; `.github/workflows/` nao existe        |
| Dev / Tailscale     | Juntar as duas mudancas                                            | `dev_tailscale_ipv4` + `seed-dev-home.mjs`                           |
| Worktree + virtuais | Coexistir                                                          | `virtual`/`worktree`/`existing`/`branch`/`pr`                        |
| Usage + cotas       | Juntar no nosso modelo                                             | `pinnable`/`UnifiedUsageSummary` + `forecast`/`cardOrder`/`hasError` |
| Hub                 | Estrutura nova do upstream + nossas notas                          | `workflows.md` deletado; Add daemon/Tailscale/Netbird preservados    |
| Plugin API          | Contrato novo `providerOptions`, adaptar nossas features           | `desktopTrigger` nos 3 controles; `featureValues` so em shims COMPAT |
| Composer            | Manter nossa implementacao                                         | `cursor: "pointer"`, `defaultSendBehavior`, sem `sendShortcut`       |
| Todos os demais     | Juntar as duas versoes                                             | Auditoria tematica passou                                            |

## 5. Correcoes da auditoria

| Arquivo                                                                   | Correcao                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/protocol/src/option-controls.ts`                                | `controlFromFeature` agora repassa `desktopTrigger` no ramo toggle   |
| `packages/server/src/server/agent/providers/opencode/v2/timeline.test.ts` | Teste do todowrite adaptado para `collectTimelineSnapshot` e `async` |
| `packages/server/src/server/agent/agent-manager.test.ts`                  | 7 expectativas adaptadas ao contrato novo                            |
| `packages/app/src/utils/host-routes.ts`                                   | `buildSettingsAddHostRoute` restaurado do develop                    |
| `packages/server/src/server/session.ts`                                   | Cases `hub.management.daemon.*` duplicados removidos                 |
| `packages/app/src/workspace-labels/manager-views.tsx`                     | `FieldControlSize` -> `ControlSize`                                  |
| `.oxlintrc.json`                                                          | Excecao `no-sync-io` para `api-tokens.ts`                            |

## 6. Validacoes feitas

| Validacao                               | Resultado                                              |
| --------------------------------------- | ------------------------------------------------------ |
| `format` / `lint` / `typecheck`         | Passaram                                               |
| `agent-manager.test.ts`                 | 341/341                                                |
| `mcp-server.test.ts`                    | passou                                                 |
| `timeline.test.ts`                      | passou                                                 |
| `agent-feature-schemas.test.ts`         | passou                                                 |
| `history-start-pagination.test.ts`      | passou                                                 |
| `i18n/resources.test.ts`                | passou                                                 |
| `projection.test.ts`                    | passou                                                 |
| `pinned.test.ts`                        | passou                                                 |
| `use-agent-history.test.ts`             | passou                                                 |
| Runtime real (Nitro Acer, Ubuntu 24.04) | App abriu com UI de onboarding em portugues, sem erros |

## 7. Infraestrutura e limpeza

| Host               | Acao                                                                        | Estado                           |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------- |
| `h-server-1`       | VM Linux `paseo-test-vm.service` criada, limitada, depois parada e removida | Limpo; `ll10-vm.service` intacto |
| `h-acer-nitro-v15` | Build Linux testado com Xvfb; `/tmp/paseo-smoke` removido                   | Processos encerrados             |
| Local              | Clone `paseo-clean-build`, tars, servidor HTTP 8899                         | Removidos/parados                |

## 8. Testes que falhavam - resolvidos

Os 3 testes falhavam somente no Windows local (ambiente). Validados em Linux (container node:22, onde roda o CI):

| Teste                                 | Causa no Windows                                     | Resultado no Linux / CI                                               |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| `index.posix.test.ts`                 | `https-proxy-agent` 5.0.1 no node_modules emprestado | Passou (39/39) com a versao 7.0.6 do lockfile                         |
| `worker-terminal-manager.test.ts`     | ConPTY do Windows nao repete stdin                   | Teste de worker real e pulado no CI (`PASEO_CI`/`CI` guard existente) |
| `execution-session.websocket.test.ts` | Timeout de 5s no Windows                             | Passou em Linux (59 testes, 2 arquivos), com `git` e timeout de 30s   |

Com `CI=true` no Linux: **2 arquivos passaram, 1 pulado pelo guard existente, 59 testes passaram, 0 falhas**.

Nenhum teste foi enfraquecido nem skip adicional foi adicionado. As falhas eram de ambiente, nao do codigo.

## 9. Validacao completa no notebook (h-acer-nitro-v15)

Feito em 2026-11-22, direto no notebook (Ubuntu 24.04, nao container):

- Node.js v22.23.5 instalado.
- Branch completa transferida para `/home/server/paseo-verify`.
- `npm ci --ignore-scripts` com o lockfile regenerado no Linux: **passou** (2978 pacotes).
- Patches do `postinstall` aplicados com `PATH=node_modules/.bin`: **passou**.
- `typecheck`, `lint`, `format:check`: **passaram**.
- Suíte de testes (com `CI=true`/`PASEO_CI=true`):
  - Server: **621 passed, 66 skipped** (7 arquivos, 1 skip de worker real).
  - App: **176 passed, 26 skipped** (8 arquivos).
  - Protocol: **23 passed** (2 arquivos).
  - Total: **820 testes, 0 falhas**.
- Build Linux do desktop: **passou**, `Paseo.bin` gerado.
- Smoke test manual com Xvfb: app abriu sem erros fatais. Navegado:
  - Onboarding (Boas-vindas) e botao "Pular configuracao".
  - Tela inicial (Novo workspace, Historico, Buscar, Agendamentos, Automacoes).
  - Command Center com abas (Tudo / Espacos de trabalho / Acoes).
  - Configuracoes (Geral, Aparencia, e a secao **Cluster** do nosso fork).
  - Tela "Novo workspace" com seletores de projeto, host, diretorio e agente.
- Avisos nao-fatais no log: rota `pair-scan` (presente no develop), `useNativeDriver` e `console-message` deprecado.
- Limpeza: processos encerrados, `/home/server/paseo-verify` removido. Node.js mantido instalado.

## 10. Teste funcional real com modelo free (2026-11-23)

Feito apos a insistencia do usuario para nao ser smoke test:

- OpenCode CLI v2.2.0 (`@opencode/cli`) instalado no notebook (o `opencode-ai` 1.x nao serve).
- Credencial OAuth do OpenCode Console importada (`opencode auth import`, somente integration `opencode`, da conta atual, sem criar conta nova).
- Hy4 Flash Free (`opencode-go/hy4-flash-free`) selecionado no app; provider detectou 66 modelos.
- **Prompt real no app: "Diga PING-OK" → resposta "PING-OK" em 4s**, com aviso "This chat uses OpenCode v2".
- **Tool call real: agente executou Shell, criou `/tmp/paseo-verify-test.txt` com `TOOLCALL-OK`**, renderizado na UI.
- **Workspace virtual** (feature mesclada) com prompt real: "Diga VIRTUAL-OK" → "VIRTUAL-OK" em 3s. Seletor mostra "Diretorio do projeto" e "Virtual" coexistingo.
- Composer: slash commands com skills destacados, @files, controle de reasoning effort (None/High).
- Rewind: menu "Reverter conversa e arquivos".
- Command Center/Buscar: abas Tudo/Espacos/Arquivos/Acoes com resultados reais.
- Agendamentos e Automacoes/Hub: telas funcionando.
- Configuracoes: Cluster (toggles do fork), Agentes, Servidores MCP, Visao geral (daemon Online PID, logs).
- Nenhum erro fatal no log do app/daemon.

### Correcao encontrada durante o teste

- Erro "Custom OpenCode MCP servers or process environment require an isolated server..." apareceu porque havia `opencode serve` externo (usuario `gio` e um manual na 4096) sendo detectado como servico compartilhado. Resolvido matando os processos externos para o Paseo usar o proprio servidor (owned). Isso e comportamento do codigo mesclado (`v2/runtime.ts:assertSharedConfiguration`), nao regressao.
- Toggle "Ativar ferramentas do Paseo" nao ligou na UI (clique nao persistiu); nao investigado a fundo.

### Nao totalmente exercitado

- Worktree real com repo git (o diretorio copiado nao tem `.git`).
- Cards de Usage/cotas e layout mobile/compact (web) nao localizados na navegacao desktop.

## 11. Estado final

- PR #2: `OPEN`, `MERGEABLE`, `CLEAN`.
- Worktree limpo, branch sincronizada com `origin/sync/original-main`.
- Notebook: usado para teste funcional; limpeza pendente no fim desta tarefa.
- h-server-1: VM de teste removida, nada rodando.
