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

## 8. Testes com falha conhecida

| Teste                                 | Situacao                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `index.posix.test.ts`                 | Falha so na branch (plugin subprocess "exited during initialization"), causa raiz nao diagnosticada |
| `worker-terminal-manager.test.ts`     | Falha tambem no baseline develop (preexistente)                                                     |
| `execution-session.websocket.test.ts` | Falha tambem no baseline develop (preexistente)                                                     |

## 9. Estado final

- PR #2: `OPEN`, `MERGEABLE`, `CLEAN`.
- Worktree limpo, branch sincronizada com `origin/sync/original-main`.
- Nitro Acer: processos encerrados, `/tmp/paseo-smoke` removido.
- h-server-1: VM de teste removida, nada rodando.
