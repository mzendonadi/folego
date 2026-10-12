-- Troca de plano no meio do mês (upgrade/downgrade) com pró-rata por dia.
-- Upgrade: a pessoa paga agora só a diferença proporcional dos dias que faltam; o plano novo vale na hora e nas próximas faturas segue o preço cheio.
-- Downgrade: o plano novo vale na hora e a diferença proporcional dos dias que faltam vira crédito na PRÓXIMA fatura (uma vez só).

-- Crédito de downgrade a abater na próxima fatura (zera quando essa fatura é paga).
ALTER TABLE app.billing_profiles ADD COLUMN plan_credit_cents integer NOT NULL DEFAULT 0 CHECK (plan_credit_cents >= 0);

CREATE TABLE app.plan_changes (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id       uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  from_plan           text NOT NULL,
  to_plan             text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('upgrade','downgrade')),
  from_price_cents    integer NOT NULL,
  to_price_cents      integer NOT NULL,
  prorata_cents       integer NOT NULL CHECK (prorata_cents >= 0),   -- diferença proporcional (cobrada no upgrade, creditada no downgrade)
  days_left           integer NOT NULL,
  period_days         integer NOT NULL,
  waived              boolean NOT NULL DEFAULT false,                 -- upgrade abaixo do mínimo do provedor: liberado sem cobrança extra
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','canceled')),
  order_id            uuid REFERENCES app.orders(id),
  provider_payment_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  applied_at          timestamptz
);
CREATE INDEX plan_changes_subscriber_idx ON app.plan_changes (subscriber_id, created_at DESC);
CREATE INDEX plan_changes_order_idx ON app.plan_changes (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX plan_changes_one_pending_idx ON app.plan_changes (subscriber_id) WHERE status = 'pending';
