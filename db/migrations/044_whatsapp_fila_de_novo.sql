-- Fila do WhatsApp: libera de novo o que ficou esperando (as mensagens seguem agora com o motivo real à vista) e mantém só a última de cada conversa.
UPDATE app.wa_messages m
   SET status = 'falhou', error = 'Repetida: só a última mensagem da conversa foi enviada'
 WHERE m.direction = 'out' AND m.status = 'fila'
   AND EXISTS (SELECT 1 FROM app.wa_messages n
                WHERE n.thread_id = m.thread_id AND n.direction = 'out' AND n.status = 'fila'
                  AND (n.created_at, n.id) > (m.created_at, m.id));
UPDATE app.wa_messages SET attempts = 0, next_attempt_at = NULL, error = NULL WHERE direction = 'out' AND status = 'fila';
