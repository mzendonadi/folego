-- Assinatura: dívidas da conta (com pagamentos), orçamento por mês e resumo semanal.
CREATE TABLE app.account_debts (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id    uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name             text NOT NULL,
  initial_cents    bigint NOT NULL CHECK (initial_cents > 0),
  balance_cents    bigint NOT NULL CHECK (balance_cents >= 0),
  monthly_rate_bps integer NOT NULL DEFAULT 0 CHECK (monthly_rate_bps BETWEEN 0 AND 10000),
  min_payment_cents bigint NOT NULL DEFAULT 0 CHECK (min_payment_cents >= 0),
  due_day          integer CHECK (due_day BETWEEN 1 AND 31),
  created_at       timestamptz NOT NULL DEFAULT now(),
  paid_off_at      timestamptz
);
CREATE INDEX account_debts_subscriber_idx ON app.account_debts (subscriber_id);

CREATE TABLE app.account_debt_payments (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  debt_id       uuid NOT NULL REFERENCES app.account_debts(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  paid_on       date NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_debt_payments_debt_idx ON app.account_debt_payments (debt_id);

-- Limite por categoria que vale só num mês (o limite de budget_limits continua sendo o padrão de todos os meses).
CREATE TABLE app.budget_months (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  month         text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  category      text NOT NULL,
  limit_cents   bigint NOT NULL CHECK (limit_cents > 0),
  PRIMARY KEY (subscriber_id, month, category)
);

ALTER TABLE app.subscribers ADD COLUMN weekly_digest_at timestamptz;
