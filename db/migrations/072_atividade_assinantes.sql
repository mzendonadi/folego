-- Uso do Prumo por dia (indicadores do backoffice: usuários ativos por dia, semana e mês, retorno e uso por plano).
-- Uma linha por assinante, dia (horário de Brasília) e canal. Guarda só "esteve aqui neste dia": nada do que a pessoa fez, nenhum IP.
-- Apagar a conta apaga as linhas (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS app.subscriber_activity (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  day           date NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('app', 'whatsapp')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, day, channel)
);
CREATE INDEX IF NOT EXISTS subscriber_activity_day_idx ON app.subscriber_activity (day);
