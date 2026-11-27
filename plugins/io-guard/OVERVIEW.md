# IO Guard

Plugin do Paseo que detecta saturação de I/O antes que ela encha o disco. Ele verifica periodicamente os arquivos `.out` escritos pelos shells do OpenCode em `~/.local/share/opencode/shell/**` e o espaço livre das unidades configuradas (por padrão C: e G:).

## Como funciona

A cada intervalo configurável (60 segundos por padrão), o plugin lê o tamanho e a data de modificação dos arquivos de log de shell, consulta o espaço livre das unidades e compara com os limites configurados. Também acompanha o crescimento entre verificações, para avisar cedo quando um processo entra em loop mesmo antes de atingir o limite de tamanho.

Os limites padrão são 500 MB por arquivo, 50 MB de crescimento entre verificações e 20 GB de espaço livre mínimo. Todos eles podem ser alterados na tela de configurações do plugin.

## Alertas e limpeza

Quando há um alerta, o plugin adiciona uma linha própria no chat dos agentes ativos do Paseo, com os arquivos e unidades afetados. A linha é atualizada nas verificações seguintes e desaparece quando o problema é resolvido. Nada é removido automaticamente.

A tela de configurações do plugin mostra o estado atual e permite remover um arquivo específico. A remoção exige uma segunda confirmação e só aceita arquivos `sh_*.out` dentro do diretório de shells do OpenCode.

## Limitações

O plugin detecta e alerta. Ele não encerra processos, não trunca logs em uso e não substitui a rotação de logs do próprio OpenCode. Em sistemas onde o arquivo está aberto por outro processo, a remoção pode falhar e o erro é exibido na tela de configurações.

O canal de alertas é registrado quando o app Paseo está conectado, e as linhas aparecem nos chats dos agentes que tiveram turnos recentes. O monitoramento e o registro em log continuam mesmo com o app desconectado, mas não há chat para receber o aviso nesse caso.
