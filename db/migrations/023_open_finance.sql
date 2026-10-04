-- Contas conectadas (Open Finance), plano Desbravador. Só leitura de saldos e extrato; guarda o consentimento (versão e data).
CREATE TABLE app.of_connections (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id   uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  item_id         text NOT NULL,
  institution     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  consent_version text NOT NULL,
  consent_at      timestamptz NOT NULL DEFAULT now(),
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, item_id)
);
CREATE INDEX of_connections_subscriber_idx ON app.of_connections (subscriber_id);

-- Lançamento vindo do banco: o identificador do agregador evita duplicar a cada sincronização.
ALTER TABLE app.ledger_entries ADD COLUMN external_id text;
CREATE UNIQUE INDEX ledger_external_idx ON app.ledger_entries (subscriber_id, external_id) WHERE external_id IS NOT NULL;
ALTER TABLE app.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_source_check;
ALTER TABLE app.ledger_entries ADD CONSTRAINT ledger_entries_source_check CHECK (source IN ('manual','import','openfinance'));

ALTER TABLE app.wallets ADD COLUMN external_id text;
ALTER TABLE app.wallets ADD COLUMN connection_id uuid REFERENCES app.of_connections(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX wallets_external_idx ON app.wallets (subscriber_id, external_id) WHERE external_id IS NOT NULL;
