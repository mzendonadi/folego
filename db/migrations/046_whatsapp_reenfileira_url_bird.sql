-- O endereço da Bird chegava vazio ao servidor ("Failed to parse URL"): nada foi enviado e as mensagens esgotaram as tentativas.
-- Com o endereço corrigido, a última mensagem de cada conversa que falhou só por isso volta para a fila (as repetidas continuam descartadas).
UPDATE app.wa_messages m
   SET status = 'fila', attempts = 0, next_attempt_at = NULL, error = NULL
 WHERE m.direction = 'out' AND m.status = 'falhou' AND m.error LIKE '%Failed to parse URL%'
   AND NOT EXISTS (SELECT 1 FROM app.wa_messages n
                    WHERE n.thread_id = m.thread_id AND n.direction = 'out' AND n.error LIKE '%Failed to parse URL%' AND n.status = 'falhou'
                      AND (n.created_at, n.id) > (m.created_at, m.id));
