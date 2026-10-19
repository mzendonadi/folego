-- Validação do primeiro envio real pela Bird: exceção ao horário de silêncio até 23:30 de 18/10/2026 (Brasília),
-- mas só a mensagem nova sai agora; o que já estava na fila espera até as 8h de 19/10/2026.
UPDATE app.wa_messages SET next_attempt_at = timestamptz '2026-10-19 08:00:00-03' WHERE direction = 'out' AND status = 'fila';
UPDATE app.wa_accounts SET quiet_override_until = timestamptz '2026-10-18 23:30:00-03';
