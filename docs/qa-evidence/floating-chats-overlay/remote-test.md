# Teste funcional remoto: floating chats overlay

Máquina: `h-acer-nitro-v15` (Ubuntu 24.04, amd64, Tailscale `100.74.184.19`). Acesso via SSH como `server` com a chave `C:\Users\Gio\Documents\key`. Sessão gráfica GNOME, Xwayland no display `:0`, usuário `gio`.

## Resultado

O overlay foi validado no hardware remoto: a janela da tira aparece no canto superior direito da área útil (`72x186+1824+96`), com `SKIP_TASKBAR` e empilhada acima da janela principal do Paseo. O tamanho é calculado pelo plugin a partir do número de chats (12 px de padding + 54 px por bolinha + 8 px de gap + 8 + 44 px do botão `+` + 6), enviado ao daemon pelo IPC `paseo:overlay:resizeStrip`. A tira renderiza as bolinhas dos chats recentes, o arco laranja de "running", o selo amarelo `?` de aguardando resposta e o botão `+` para novo chat. Não há decorações de janela: os controles de minimizar/maximizar/fechar são suprimidos no root layout quando a URL tem `?overlay=`. Confirmado via CDP que o bridge `paseoDesktop.overlay` está presente.

## VM Windows no Acer (h-acer-nitro-v15)

O overlay também foi validado dentro de uma VM Windows no próprio Acer, sem tocar no PC do usuário. O método segue o padrão do repositório `C:\Users\Gio\VMs\long-live-10`:

- VM QEMU/KVM (8 CPUs, 16 GB) com Windows Server 2025 Standard (Desktop Experience), instalada de forma autônoma com `autounattend.xml` empacotado num ISO pequeno via `pycdlib` (Joliet + Rock Ridge).
- QMP em TCP `127.0.0.1:4444` (comandos `screendump`, `send-key`, `input-send-event`) e VNC em `127.0.0.1:5901` (protocolo RFB direto para cliques de mouse). `qmp.py`, `type.py` e `vnc_sendkey.py` são os mesmos helpers do `long-live-10`.
- WinRM configurado no `FirstLogonCommands` (porta 55985 no host, Basic/unencrypted), acessado por `pywinrm` com a conta `paseo`.
- Paseo 0.17.0-beta.1 instalado na VM; plugin `floating-chats` instalado em `C:\Users\paseo\floating-chats` e com status `running` no daemon.
- CDP do Paseo na porta 9222, conectado por `websocket-client` com `suppress_origin=True` (o app rejeita `--remote-allow-origins`).
- `paseoDesktop.overlay.show()` executado via CDP, com o daemon conectado em `localhost:17000`.

**Resultado:** a janela nativa do overlay apareceu flutuando sobre o Microsoft Edge na VM (`vm-windows-overlay.png`). O conteúdo da tira ainda não exibe as bolinhas porque a VM não tem projetos/agentes recentes; nela aparece o estado vazio do app. O importante validado é que a janela nativa do Electron é criada e permanece acima do navegador em Windows.

## Auditoria de estados e o scrollbar (24/11/2026)

O overlay foi revisado para manter o visual 1:1 e checar todos os estados. Nenhum arquivo de design foi alterado nesta revisão.

### Causa do scrollbar

O scrollbar visível não vinha do desenho do plugin. A janela da tira tinha carregado a rota errada: `/h/local/plugin/floating-chats/...?overlay=strip`. O `serverId` da config persistida (`desktop-settings.json`) estava vazio, então `overlay-manager.ts` usou o fallback `settings.serverId ?? "local"` e o app, sem um host `local` válido, caiu na tela "Add a project". Essa tela, comprimida na largura de 72 px da tira, gerava quebra de texto ("A d d") e barra de rolagem.

O plugin nunca produz scroll: a `FlatList` da tira usa `scrollEnabled={false}` (`floating-chats.tsx`) e a altura da janela é calculada a partir do número de bolinhas. Com a rota correta, o DOM reporta `document.body.scrollHeight === clientHeight` (70 px no estado vazio).

### Correção aplicada na VM

`overlay.serverId` foi preenchido com `srv_-qSNeaHVrwKH` via `paseoDesktop.overlay.setConfig` pelo CDP. Isso atualiza a memória e persiste em disco sem reiniciar o Paseo. A janela da tira foi navegada para a rota correta. Resultado: "sem chats" renderiza sem scrollbar (`scrollbar-before.png`, `scrollbar-after.png`, `vm-overlay-no-scrollbar.png`).

### Mapa de estados auditados

| Estado                                     | Onde                                                               | Verificação                                                     |
| ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Vazio (`sem chats`)                        | `floating-chats.tsx` `ListEmptyComponent`                          | Visual na VM, sem scroll                                        |
| Iniciais                                   | `recent-chats.ts` `initialsFor`                                    | Código: 1-2 letras maiúsculas, `?` quando sem título            |
| Anel warning/danger/running/success/neutro | `recent-chats.ts` `statusColorKey`                                 | Código: prioridade atenção > erro > running > sucesso           |
| Arco girando                               | `running-arc.tsx`                                                  | Código: só em `status === "running"` e sem reduced motion       |
| Ping                                       | `use-ping-animation.ts`                                            | Código: disparo em mudança de `lastActivityAt`, pulso + gota    |
| Selo `?` / número / `9+` / ausente         | `chat-bubble.tsx`                                                  | Código: `?` em atenção, `9+` acima de 9, oculto em zero         |
| Botão fechar no hover                      | `chat-bubble.tsx`                                                  | Código: `opacity` 0→1 em `mouseenter`/`onPointerEnter`          |
| Tooltip no hover                           | `chat-bubble.tsx` `openPopover`                                    | Código: `measure()` + `openPopover({kind:"tooltip"})`           |
| Botão `+`                                  | `floating-chats.tsx`                                               | Visual na VM                                                    |
| 6 posições                                 | `settings.tsx` `POSITIONS` + `overlay-window.ts` `OVERLAY_PRESETS` | Código: mesma lista nos dois lados                              |
| Peles macOS/Windows/Linux/neutro           | `native-skin.ts` `skinFor`                                         | Código: tokens por plataforma, accent vindo da aparência nativa |
| Popover tooltip/mensagem/aguardando        | `popover-screen.tsx`                                               | Código: `kind` seleciona o cartão                               |
| Reduced motion / animações off             | `use-ping-animation.ts`, config `animations`                       | Código: pulso e arco desligados                                 |
| Agentes ocultos                            | `floating-chats.tsx` `hiddenAgentIds`                              | Código: filtro antes do `slice(0,8)`                            |

Estado não verificável visualmente na VM: nenhum provider está autenticado (`paseo status` mostra `available: false` para todos), então não há agentes reais para renderizar as bolinhas. Esses estados foram checados pela lógica de render, não por screenshot.

## Correções de fundo opaco e tooltip vazio (24/11/2026)

Você reportou que no Acer o overlay ainda tinha fundo e o tooltip abria vazio. Ambos confirmados e corrigidos:

**Fundo opaco.** O `app.asar` do teste Linux era de 23/11 03:37, mas o CSS de transparência do `_layout.tsx` entrou em 24/11 10:57. O build estava desatualizado, então `#paseo-overlay-transparency` não existia no DOM e `html`/`body` ficavam em `rgb(24,27,26)`. Rebuildado, transferido e validado: `hasStyle: true` e `rgba(0,0,0,0)` em toda a cadeia (strip e popover). Também garanti `transparent: true` no popover em plataformas sem material nativo (`overlay-popover-window.ts`).

**Tooltip vazio.** A URL do popover era montada com `&kind=...&agentId=...`, mas o app lê screen params com o prefixo `param.` (`SCREEN_PARAM_PREFIX` em `plugins/routes.ts`). Sem o prefixo, `pluginScreenParamsFromRoute` descartava os dois, `PopoverScreen` recebia `agentId=""` e `useAgent("")` retornava null. Corrigido para `&param.kind=...&param.agentId=...` em `overlay-manager.ts`. Unifiquei a montagem da URL em `buildOverlayUrl()` (`overlay-window.ts`) para a comparação de URL usar exatamente a mesma string carregada, e adicionei 3 testes unitários.

Validação no Acer após rebuild: o popover abre com `?overlay=popover&param.kind=tooltip&param.agentId=...` e renderiza o cartão completo (`Overlay Demo`, Branch, Repo, Local, Host), com fundo transparente. Evidência: `tooltip-fixed.png`.

## Correções de fundo e tooltip (24/11/2026)

Duas falhas reais apareceram no teste Linux do Acer após o rebuild:

- **Fundo opaco:** o CSS de transparência do `_layout.tsx` (#paseo-overlay-transparency) não existia no DOM (`hasStyle: false`) porque o `app.asar` do teste era de 23/11, anterior à correção. Depois do rebuild e deploy, `hasStyle: true` e `html/body/#root` reportam `rgba(0, 0, 0, 0)`. A janela do popover também passou a usar `transparent: true` em plataformas sem material nativo (Linux). Even with that, a captura CDP ainda mostrava canto `rgb(24,27,26)` alpha 255. A causa real estava no `window-manager.ts`: o renderer chama `paseo:window:updateChrome` com a cor do tema (`#181b1a` = rgb(24,27,26)) e `win.setBackgroundColor()` repintava **todas** as janelas, inclusive as do overlay, tornando-as opacas. Corrigido para ignorar janelas cuja URL contém `overlay=`. Também removido o `backgroundColor: "#00000000"` explícito das janelas overlay, que competia com `transparent: true`. Prova final via CDP `Page.captureScreenshot` com `omitBackground`: canto `(0,0,0,0)` alpha 0 na strip e no popover (`strip-transparent.png`).
- **Tooltip vazio:** `overlay-manager.ts` montava a URL do popover com `&kind=...&agentId=...`, mas `pluginScreenParamsFromRoute` só aceita chaves com o prefixo `param.`. Os parâmetros eram descartados, `params.agentId` chegava vazio, `useAgent("")` retornava null e o cartão renderizava vazio. Corrigido para `&param.kind=...&param.agentId=...`. Também unifiquei a montagem da URL em `buildOverlayUrl` para que a comparação `webContents.getURL()` use exatamente a mesma URL carregada.

**Validação no Acer:** com um agente real (`Overlay Demo`), o popover agora mostra título, Branch, Repo, Local, Host e labels (`tooltip-fixed.png`). A URL do target contém `?overlay=popover&param.kind=tooltip&param.agentId=...`. Testes unitários de `buildOverlayUrl` passam (10 testes). Typecheck e lint passaram localmente.

## Como foi montado

- Build Linux gerado no checkout com `npm run build:desktop -- --linux --dir` em `packages/desktop/release/linux-unpacked/`.
- Artefato tar de 442 MB transferido via `scp` pela tailnet e extraído em `/home/gio/paseo-overlay-test/`.
- Launchers Electron e wrapper do CLI com CRLF convertidos para LF no destino.
- App iniciado no display `:0` com `PASEO_HOME` isolado e `pluginsEnabled: true`, usando `--no-sandbox --remote-debugging-port=9222`.
- Um segundo daemon (agente) foi iniciado em `127.0.0.1:6768` com workspace local e um agente `opencode` ativo, e registrado como host no daemon do app. Isso deu agentes recentes para a tira mostrar.

## Correções necessárias no ambiente de teste

- O pacote Linux foi cross-compilado no Windows e trazia apenas o esbuild `win32-x64`. Instalei `@esbuild/linux-x64@0.25.12` (versão igual à do host embutido) em `app.asar.unpacked/node_modules/@esbuild/linux-x64/bin/esbuild` e dei permissão de execução ao usuário `gio`.
- O daemon agente herdou o cwd `/home/server` (acesso restrito ao usuário `server`), o que causava `EACCES` ao spawnar o esbuild como `gio`. Reiniciei o daemon com `cwd=/home/gio`, após o que o plugin passou a `running`.
- O host é conectado via "Conexão direta" (`localhost:6768`) usando CDP para preencher os campos e clicar em "Conectar", já que `xdotool` não injeta eventos confiáveis sob Wayland.
- O overlay é ativado via `window.paseoDesktop.overlay.show()` no renderer, também via CDP.

## Correções de código

- O handler IPC `paseo:overlay:resizeStrip` usava `readRectangle`, que exige `x` e `y`. O plugin envia somente `{ width, height }`, então o resize era descartado e a tira ficava presa no tamanho padrão. Criado o helper `readSize` em `overlay-manager.ts` e aplicado a `resizeStrip` e `resizePopover`.
- As janelas do overlay eram criadas com `resizable: false`, o que impedia `setBounds` no Linux. Alterado para `resizable: true` em `overlay-window.ts` e `overlay-popover-window.ts`.
- O `<DesktopWindowControls />` do root layout renderizava minimizar/maximizar/fechar em todas as janelas, inclusive no overlay. Agora é suprimido quando `window.location.search` contém `overlay=strip|popover|1`.
- O plugin mede o tamanho da tira de forma determinística (número de chats + gaps + botão) e chama `resizeStrip` num `useEffect`.
- A URL do popover não passava `kind`/`agentId` para `loadOverlayRoute`, e quando passava, usava chaves sem o prefixo `param.` exigido por `pluginScreenParamsFromRoute`. Corrigido em `overlay-manager.ts` e centralizado em `buildOverlayUrl` (`overlay-window.ts`), com testes unitários.
- O popover não era transparente em plataformas sem material nativo. Adicionado `transparent: true` no分支 Linux em `overlay-popover-window.ts`.
- O `window-manager.ts` repintava todas as janelas com a cor do tema via `setBackgroundColor` ao receber `paseo:window:updateChrome`, incluindo as janelas do overlay. Agora janelas com `overlay=` na URL são ignoradas. Também removido o `backgroundColor` explícito das janelas overlay, que competia com `transparent: true`.

## Evidência

- `remote-linux-start.png`: janela principal do Paseo no notebook remoto.
- `remote-overlay-strip.png`: janela da tira (72x186) com a bolinha `CA`, arco de running, selo `?` e botão `+`, sem decorações de janela.
- `vm-windows-overlay.png`: janela nativa do overlay flutuando sobre o Microsoft Edge dentro da VM Windows Server 2025 no Acer.
- `scrollbar-before.png`: ampliação da tira com a rota inválida, texto "A d d" quebrado e seta de scroll.
- `scrollbar-after.png`: mesma ampliação após corrigir `serverId`, com "sem chats" e sem scroll.
- `vm-overlay-no-scrollbar.png`: tela da VM com a tira correta flutuando sobre o Edge.
- `tooltip-fixed.png`: cartão do tooltip no Acer após corrigir o prefixo `param.`, com `Overlay Demo`, Branch, Repo, Local, Host e labels.
- `strip-transparent.png`: captura CDP com `omitBackground` mostrando canto `(0,0,0,0)` (fundo transparente de verdade) na tira.
- `tooltip-fixed.png`: cartão do tooltip com conteúdo real (título, branch, repo, local, host e labels) e fundo transparente, após o rebuild no Acer.

## Estado

- O app e os daemons de teste ficam rodando no notebook para inspeção. Nenhuma configuração de produção foi alterada.
- Localmente o plugin está `running` no daemon de desenvolvimento e os testes unitários passam.
- Na VM, `overlay.serverId` foi persistido como `srv_-qSNeaHVrwKH` via bridge, sem reiniciar o Paseo. O PC do usuário não foi tocado em nenhum ponto desta auditoria.
