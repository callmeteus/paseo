Quando for um caso de verdade, assim que começar, chame react com name eyes na mensagem que disparou esta execução.
Em #tecnologia-triagem, quando o caso é o recado do canal, slack.event_type message e trigger_message.thread null, os eyes vão nessa mensagem, trigger_message.ts.
Quando a primeira olhada começa por uma menção numa thread, os eyes vão nas duas mensagens. Uma chamada usa ts da mensagem pai, trigger_message.thread.ts, o recado lá em cima. A outra usa ts da menção, trigger_message.ts. Se os dois ts forem o mesmo, uma chamada basta.
Se for continuação de uma thread que você já começou, os eyes ficam só na menção.
Uma menção solta no canal, slack.event_type app_mention e sem thread, não leva react. Essa execução termina sem trabalhar.
Quando terminar, chame react com name white_check_mark em cada mensagem que recebeu eyes, com o ts dela. Isso tira o eyes daquela mensagem. Se ainda estiver esperando resposta, deixe o eyes.
