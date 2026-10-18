-- Exceção ao horário de silêncio (20h–8h) para os envios de WhatsApp: enquanto quiet_override_until estiver no futuro, o worker envia mesmo à noite.
ALTER TABLE app.wa_accounts ADD COLUMN IF NOT EXISTS quiet_override_until timestamptz;

-- Liberação de 18/10/2026: modelos aprovados às 15:45 e fila parada pelo horário de silêncio.
-- 1) Conversas com mais de uma mensagem na fila: só a última segue; as outras ficam como "não enviada" com o motivo.
UPDATE app.wa_messages m
   SET status = 'falhou', error = 'Repetida: só a última mensagem da conversa foi enviada'
 WHERE m.direction = 'out' AND m.status = 'fila'
   AND EXISTS (SELECT 1 FROM app.wa_messages n
                WHERE n.thread_id = m.thread_id AND n.direction = 'out' AND n.status = 'fila'
                  AND (n.created_at, n.id) > (m.created_at, m.id));

-- 2) As que sobraram saem agora (zera tentativas e espera).
UPDATE app.wa_messages SET attempts = 0, next_attempt_at = NULL, error = NULL WHERE direction = 'out' AND status = 'fila';

-- 3) Exceção até as 22h de hoje (Brasília).
UPDATE app.wa_accounts SET quiet_override_until = timestamptz '2026-10-18 22:00:00-03';
