Leia este arquivo antes de qualquer gravação no banco. Sem este rastro, a gravação não acontece.

A nota, quando a tabela tiver onde colocá-la, cita o Kevin e quem pediu. O texto é uma frase: Kevin, a pedido de <nome de quem pediu no Slack>. Em seguida, o que ficou valendo, do mesmo jeito leigo da reply. Quem pediu é a pessoa da thread, não o Kevin.

Em movimentação, a nota cabe. Grave o mesmo texto nos dois lugares: em `data.description` e num item de `logs`, pelo `addLog`, no campo `message`. Se a movimentação nascer por um helper que não recebe nota, grave primeiro e em seguida carregue o registro, chame `addLog` e preencha `description`, e salve. Os dois ficam com a mesma frase.

Em outra tabela, procure coluna de nota, descrição, mensagem ou logs. Se existir, use a mesma frase. Se não existir, não invente coluna. O arquivo abaixo continua obrigatório.

Depois da gravação, ou se ela falhar, acrescente uma linha no fim de `~/.paseo/automations/logs/banco.jsonl`. Não reescreva o arquivo e não apague linha antiga. Uma linha é um JSON, com `quando`, `canal`, `thread`, `solicitante`, `produto`, `o_que`, `registro` e `nota`. `solicitante` é o nome e o id do Slack de quem pediu. `registro` é a tabela e o id que voltou. Se falhou, `registro` fica vazio e `o_que` diz a falha. Sem comando SQL, sem chave e sem segredo nessa linha.

A reply continua leiga. Não conte o caminho do arquivo, nem o nome da coluna.
