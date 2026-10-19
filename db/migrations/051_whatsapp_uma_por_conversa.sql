-- Conversa com mais de uma mensagem de saída esperando na fila (teste de 19/10/2026): só a mais recente segue; as anteriores viram "não enviada".
UPDATE app.wa_messages m
   SET status = 'falhou', error = 'Repetida: só a última mensagem da conversa foi enviada'
 WHERE m.direction = 'out' AND m.status = 'fila'
   AND EXISTS (SELECT 1 FROM app.wa_messages n
                WHERE n.thread_id = m.thread_id AND n.direction = 'out' AND n.status = 'fila'
                  AND (n.created_at, n.id) > (m.created_at, m.id));
