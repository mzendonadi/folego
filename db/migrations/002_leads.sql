-- Entrega de leads: controle de tentativas com espera crescente.
ALTER TABLE app.lead_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
CREATE INDEX IF NOT EXISTS deliveries_next_attempt_idx ON app.lead_deliveries (next_attempt_at) WHERE status IN ('queued','failed');
