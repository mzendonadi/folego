-- Teste do primeiro envio real (18/10/2026): a conversa de teste ganhou mensagens novas enquanto a antiga esperava até as 8h.
-- A antiga (segura para 19/10 às 8h) é descartada se a mesma conversa já tem uma mensagem de saída mais recente; as demais conversas seguem intactas.
UPDATE app.wa_messages m
   SET status = 'falhou', error = 'Repetida: só a última mensagem da conversa foi enviada'
 WHERE m.direction = 'out' AND m.status = 'fila' AND m.next_attempt_at = timestamptz '2026-10-19 08:00:00-03'
   AND EXISTS (SELECT 1 FROM app.wa_messages n WHERE n.thread_id = m.thread_id AND n.direction = 'out' AND (n.created_at, n.id) > (m.created_at, m.id));
