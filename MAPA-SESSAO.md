# Mapa completo da sessão: merge upstream + develop

## 1. Objetivo original

Trazer **todos os commits remotos do Paseo** (`original/main` = getpaseo/paseo) para o fork (`origin` = callmeteus/paseo), em uma worktree, decidindo conflitos tema a tema, e abrir PR.

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

| Commit      | O que fez                                                                     |
| ----------- | ----------------------------------------------------------------------------- |
| `699d95bc7` | Merge de `original/main` (603 commits), 223 conflitos resolvidos              |
| `77f42d6f8` | Regeneração do `package-lock.json` (estava dessincronizado, `npm ci` falhava) |
| `70e413fb0` | Merge do `develop` (12 commits novos), 23 conflitos resolvidos                |
| `9ae37f8a4` | Merge do `develop` novamente (6 commits), 7 conflitos resolvidos              |
| `104087b55` | Auditoria: correções em `option-controls.ts` e testes                         |

## 4. Decisões de conflito (tema por tema)

| Tema                | Decisão                                                            | Verificado em                                                        |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| CI                  | Manter o nosso (Forgejo Actions). Regra no `CLAUDE.md`/`AGENTS.md` | `.forgejo/workflows/` existe; `.github/workflows/` não existe        |
| Dev / Tailscale     | Juntar as duas mudanças                                            | `dev_tailscale_ipv4` + `seed-dev-home.mjs`                           |
| Worktree + virtuais | Coexistir                                                          | `virtual`/`worktree`/`existing`/`branch`/`pr`                        |
| Usage + cotas       | Juntar no nosso modelo                                             | `pinnable`/`UnifiedUsageSummary` + `forecast`/`cardOrder`/`hasError` |
| Hub                 | Estrutura nova do upstream + nossas notas                          | `workflows.md` deletado; Add daemon/Tailscale/Netbird preservados    |
| Plugin API          | Contrato novo `providerOptions`, adaptar nossas features           | `desktopTrigger` nos 3 controles; `featureValues` só em shims COMPAT |
| Composer            | Manter nossa implementação                                         | `cursor: "pointer"`, `defaultSendBehavior`, sem `sendShortcut`       |
| Todos os demais     | Juntar as duas versões                                             | Auditoria temática passou                                            |

## 5. Correções da auditoria

| Arquivo                                                                   | Correção                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/option-controls.ts`                                | `controlFromFeature` agora repassa `desktopTrigger` no ramo toggle (simetria com `featureFromControl`)                                                |
| `packages/server/src/server/agent/providers/opencode/v2/timeline.test.ts` | Teste do todowrite adaptado para API `collectTimelineSnapshot` e `async`                                                                              |
| `packages/server/src/server/agent/agent-manager.test.ts`                  | 7 expectativas adaptadas: instrução do Hub, Cursor Fast toggle, idle clock probes, `disposition.started`, `daemonAppendSystemPrompt` fora do metadata |

## 6. Validações já feitas

| Validação                               | Resultado                                                            |
| --------------------------------------- | -------------------------------------------------------------------- |
| `format` / `lint` / `typecheck`         | Passaram                                                             |
| `agent-manager.test.ts`                 | 341/341                                                              |
| `mcp-server.test.ts`                    | 198/198                                                              |
| `timeline.test.ts`                      | 6/6                                                                  |
| `agent-feature-schemas.test.ts`         | 12/12                                                                |
| `history-start-pagination.test.ts`      | 32/32                                                                |
| `i18n/resources.test.ts`                | 40/40                                                                |
| `projection.test.ts`                    | 32/32                                                                |
| `pinned.test.ts`                        | 19/19                                                                |
| `use-agent-history.test.ts`             | 17/17                                                                |
| Runtime real (Nitro Acer, Ubuntu 24.04) | App abriu com UI de onboarding em português, sem erros               |
| `index.posix.test.ts`                   | Falha só na branch (plugin subprocess), causa raiz não diagnosticada |
| `worker-terminal-manager.test.ts`       | Falha também no baseline develop (preexistente)                      |
| `execution-session.websocket.test.ts`   | Falha também no baseline develop (preexistente)                      |

## 7. Infraestrutura e limpeza

| Host                                            | Ação                                                                        | Estado                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| `h-server-1` (`srv_84WekR7LxCiN`)               | VM Linux `paseo-test-vm.service` criada, limitada, depois parada e removida | Limpo; `ll10-vm.service` intacto (parado)               |
| `h-acer-nitro-v15` (`100.74.184.19`, SSH local) | Build Linux testado com Xvfb; `/tmp/paseo-smoke` removido                   | **2 processos Paseo ainda vivos** - precisam ser mortos |
| Local                                           | Clone `paseo-clean-build`, tars, servidor HTTP 8899                         | Removidos/parados                                       |

## 8. Pendências

1. **PR voltou a CONFLICTING**: `develop` remoto avançou para `b428f35a9`; precisa novo merge e push.
2. **2 processos Paseo no Nitro**: matar.
3. **Testes não rodados desde a auditoria**: precisa revalidar após o próximo merge.
4. **`index.posix.test.ts`**: investigar falha do plugin subprocess.
5. **`docs/daemon-restart-continuity.md`** e **`docs/keyboard-shortcuts.md`**: novos docs do upstream; verificar se estão referenciados no índice do `CLAUDE.md`.
