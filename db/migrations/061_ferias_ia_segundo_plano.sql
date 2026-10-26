-- O roteiro completo por IA leva mais de um minuto: roda em segundo plano e a tela consulta o andamento.
ALTER TABLE app.trips
  ADD COLUMN ai_status     text CHECK (ai_status IS NULL OR ai_status IN ('running', 'failed')),
  ADD COLUMN ai_error      text,
  ADD COLUMN ai_started_at timestamptz;
