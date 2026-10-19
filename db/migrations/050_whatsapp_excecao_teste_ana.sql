-- Teste do primeiro envio real pela Bird clássica (19/10/2026): exceção ao horário de silêncio até 01:30 (Brasília).
-- As demais conversas seguem seguras até as 8h (next_attempt_at da migration 047).
UPDATE app.wa_accounts SET quiet_override_until = timestamptz '2026-10-19 01:30:00-03';
