-- Planejador com IA (Desbravador): só registra que houve uma pergunta, para o limite diário. O texto da pergunta NÃO é guardado.
CREATE TABLE app.planner_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('ia','regras')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planner_log_subscriber_idx ON app.planner_log (subscriber_id, created_at DESC);
