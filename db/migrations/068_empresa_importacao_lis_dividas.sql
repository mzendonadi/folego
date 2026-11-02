-- Empresa (PJ), parte 2: a empresa passa a ter os mesmos recursos do pessoal, sempre em tabelas próprias.
--  - cheque especial (LIS) nas contas da empresa;
--  - origem do lançamento (manual, import = extrato/fatura/foto, whatsapp);
--  - dívidas da empresa (separadas das pessoais) com histórico de pagamentos;
--  - o assistente do WhatsApp lembra se a pessoa está lançando no pessoal ou na empresa.

ALTER TABLE app.biz_wallets
  ADD COLUMN IF NOT EXISTS overdraft_limit_cents bigint   NOT NULL DEFAULT 0   CHECK (overdraft_limit_cents BETWEEN 0 AND 100000000000),
  ADD COLUMN IF NOT EXISTS overdraft_rate_bps    integer  NOT NULL DEFAULT 800 CHECK (overdraft_rate_bps BETWEEN 0 AND 100000),
  ADD COLUMN IF NOT EXISTS overdraft_free_days   smallint CHECK (overdraft_free_days IS NULL OR overdraft_free_days BETWEEN 1 AND 365);

ALTER TABLE app.biz_entries
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS invoice_key text;

CREATE TABLE IF NOT EXISTS app.biz_debts (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id     uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  initial_cents     bigint NOT NULL CHECK (initial_cents >= 0),
  balance_cents     bigint NOT NULL CHECK (balance_cents >= 0),
  monthly_rate_bps  integer NOT NULL DEFAULT 0 CHECK (monthly_rate_bps BETWEEN 0 AND 100000),
  min_payment_cents bigint NOT NULL DEFAULT 0 CHECK (min_payment_cents >= 0),
  due_day           smallint CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  paid_off_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_debts_subscriber_idx ON app.biz_debts (subscriber_id);

CREATE TABLE IF NOT EXISTS app.biz_debt_payments (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  debt_id       uuid NOT NULL REFERENCES app.biz_debts(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  paid_on       date NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_debt_payments_debt_idx ON app.biz_debt_payments (debt_id);

ALTER TABLE app.assistant_links ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'pf' CHECK (scope IN ('pf', 'pj'));
