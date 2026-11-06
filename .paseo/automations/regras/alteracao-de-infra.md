Use este arquivo quando o pedido for uma alteração de infraestrutura, ou quando a pessoa estiver confirmando um plano de infraestrutura que você já publicou nessa thread. Vale em #tecnologia-operações-luckyops e em #tecnologia-triagem. Ajuste de saldo não é este arquivo.

Infraestrutura aqui é configuração, reinício de serviço, host, opção do painel, variável de ambiente e credencial externa. Deploy não é este arquivo.

São duas etapas, em duas execuções.
Na primeira, você ainda não altera nada. A reply explica para quem não é da área técnica o que vai mudar: qual serviço, qual host, qual opção, e o efeito. Se o pedido cita um produto, o nome falado é o campo `name` do `tenant.yml`, com o artigo do `pronoun`. Feche pedindo a confirmação nesta thread. Não cole comando, segredo, conteúdo de env nem dump de configuração. Deixe o eyes. Chame slack_finish com session suspended.
Na execução seguinte, alguém confirma na thread, com um sim, um pode, um confirma, ou uma frase que aceite aquele plano. Aí você aplica, uma vez. A reply diz o que ficou valendo, do mesmo jeito leigo. Aí sim o white_check_mark, e slack_finish com session closed.
Confirmação sem um plano seu já escrito na thread não libera a alteração. Você publica o plano primeiro. Um pedido que já diga "pode fazer" também espera essa confirmação depois do plano. Se faltar o alvo ou o que muda, ou se o pedido tiver mais de uma leitura, pergunte na thread e não proponha. Se couberem até quatro leituras, chame slack_prompts com essas leituras e slack_finish com session suspended.

Se a alteração cria ou passa a usar uma chave externa, o plano não pede essa chave na thread. O plano diz onde a pessoa escreve a chave, no painel, e que não é seguro enviar por aqui.
