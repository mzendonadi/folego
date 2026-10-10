-- Open Finance completo: conexão que precisa de ação da pessoa (reconectar), validade do consentimento (até 12 meses, com aviso antes de vencer)
-- e avisos do agregador (webhook) sem processar duas vezes o mesmo evento.
ALTER TABLE app.of_connections DROP CONSTRAINT IF EXISTS of_connections_status_check;
ALTER TABLE app.of_connections ADD CONSTRAINT of_connections_status_check CHECK (status IN ('active','needs_action','revoked'));
ALTER TABLE app.of_connections ADD COLUMN consent_expires_at timestamptz;
ALTER TABLE app.of_connections ADD COLUMN renew_notified_at timestamptz;
ALTER TABLE app.of_connections ADD COLUMN provider_status text;
ALTER TABLE app.of_connections ADD COLUMN status_changed_at timestamptz;
UPDATE app.of_connections SET consent_expires_at = consent_at + interval '12 months' WHERE consent_expires_at IS NULL;

-- Cartão que vem do banco: o limite disponível informado pelo banco vale mais que a nossa conta (o PDF/extrato cobre só uma janela de tempo).
ALTER TABLE app.credit_cards ADD COLUMN available_cents bigint CHECK (available_cents IS NULL OR available_cents >= 0);
ALTER TABLE app.credit_cards ADD COLUMN bank_synced_at timestamptz;

CREATE TABLE app.of_events (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  provider     text NOT NULL,
  event_id     text NOT NULL,
  event        text NOT NULL,
  item_id      text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, event_id)
);
