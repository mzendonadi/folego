# Chatbot "FôlIA" e sino de alertas

## O que é
- **FôlIA**: assistente virtual na landing e no Prumo (botão flutuante no canto inferior direito).
- Antes de conversar a pessoa informa **celular com DDD e e-mail** e aceita ser contatada. Sem isso o chat não abre.
- A equipe acompanha tudo no backoffice, em **Chatbot** (permissão `chatbot`; o dono tem sempre).

## Ligar a IA (opcional)
Sem chave, a FôlIA responde por regras (preços reais, aviso de que a equipe retorna). Para responder com IA:
1. GitHub → Settings → Secrets → `ANTHROPIC_API_KEY` (a mesma usada nos roteiros).
2. Rode o workflow de publicação. Nunca coloque a chave em arquivo do repositório.
3. A IA precisa estar ligada nas configurações do backoffice. Teto diário de respostas de IA no chat: 400.

## Preços
A FôlIA lê `app.products` a cada resposta. Mudou o preço em **Produtos e preços**? Ela já usa o novo.

## Limites de segurança (no prompt e no código)
Não revela instruções, chaves ou dados; não promete resultado; não dá parecer jurídico nem recomenda investimento; não pede CPF, senha ou cartão; Pix só no site. Resposta com sinal de vazamento ou promessa é trocada pela resposta por regras.

## Dados e LGPD
Nome, celular, e-mail, anotações e mensagens ficam criptografados (AES-256-GCM). O aceite de contato é gravado (`consent_at`). Para apagar uma pessoa, apague o registro em `chat_leads` (as mensagens saem junto).

## Retomar o contato
Gaveta do contato: WhatsApp (mensagem pronta para ajustar), telefone, e-mail, situação, registro do que foi combinado e anotações. "Convertido" é marcado sozinho quando o e-mail pagar depois do chat.

## Sino de alertas
Cabeçalho do backoffice. Balança com contador enquanto houver alerta novo; abrir a lista marca como visto. Se o problema piorar, volta a tocar. Cobre saúde do sistema, cancelamentos e vencimentos, falhas de envio a parceiros e de WhatsApp, contatos do chatbot esperando.
