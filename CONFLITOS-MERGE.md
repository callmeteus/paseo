# Merge de `original/main` em `sync/original-main`

## Resultado

Merge concluído e commitado em `2cc128583`. Dois pais: `8417781b6` (nosso `develop`) e `1bd9b4673` (`original/main`). 603 commits do upstream entraram no histórico da branch.

Os 223 conflitos originais foram todos resolvidos. Typecheck, lint e format passaram nos hooks de pre-commit.

## Decisões aplicadas

| Tema                           | Decisão                                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                             | Manter o nosso (Forgejo Actions). Virou regra no `CLAUDE.md`/`AGENTS.md`.                                                                                                                           |
| Dev / Tailscale                | Juntar as duas mudanças em `scripts/dev-home.sh`.                                                                                                                                                   |
| Worktree / workspaces virtuais | Coexistir.                                                                                                                                                                                          |
| Usage / cotas                  | Juntar no nosso modelo.                                                                                                                                                                             |
| Hub                            | Manter a estrutura nova do upstream e reinserir nossas notas de deploy.                                                                                                                             |
| Plugin API                     | Adotar `providerOptions` + `AgentOptionControl`; reexpressar nossas features nos controles. `desktopTrigger` foi adicionado como campo opcional ao protocolo para preservar o auto-accept rotulado. |
| Composer                       | Manter a nossa implementação nos arquivos de `src/composer/`; juntar as duas no restante.                                                                                                           |
| Todos os demais temas          | Juntar as duas versões, preservando as features dos dois lados.                                                                                                                                     |

## Como cada resolução foi feita

Cada conflito foi resolvido combinando os corpos das duas versões, com validação de tipo ou de intent quando os dois caminhos coexistiam. Onde o mesmo símbolo existia nos dois lados, ele foi unificado num único nome.

Algumas features do nosso fork precisaram ser adaptadas ao contrato novo: `featureValues` deixou de ser estado primário e passou a ser lido apenas por shims de compatibilidade; `desktopTrigger` entrou no schema de toggle do protocolo; `inAppRecipientIndex` foi temporariamente representado por `presentClientIndices` com comentário `COMPAT`.

Os arquivos gerados (`html.gen.ts`, validadores AOT do protocolo) foram mantidos na versão do upstream por serem saídas de build.

## Observação

`PENDENTES-DECISAO.md` foi removido: não há mais conflitos pendentes.
