-- Planejar férias (Ousado) e roteiro completo com IA (Desbravador).
-- A viagem guarda o formulário (input), o que a pessoa já marcou no checklist e o roteiro gerado. O plano (orçamento, noites, checklist) é recalculado do formulário.
CREATE TABLE app.trips (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  input         jsonb NOT NULL,
  checked       jsonb NOT NULL DEFAULT '{}'::jsonb,
  itinerary     jsonb,
  itinerary_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trips_subscriber_idx ON app.trips (subscriber_id, created_at);

-- Limite diário do roteiro com IA por pessoa (só contagem; o conteúdo fica na própria viagem).
CREATE TABLE app.trip_ai_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_ai_log_idx ON app.trip_ai_log (subscriber_id, created_at);
