-- Assinatura (Controle, Ousado, Desbravador): conta por e-mail (sem senha, código de 6 dígitos), pedidos sem caso,
-- lançamentos, limites por categoria e metas. Os avulsos continuam sem cadastro.
CREATE TABLE app.subscribers (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         citext NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  deleted_at    timestamptz
);

ALTER TABLE app.sessions ADD COLUMN subscriber_id uuid REFERENCES app.subscribers(id);

CREATE TABLE app.login_codes (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  email      citext NOT NULL,
  code_hash  bytea  NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_email_idx ON app.login_codes (email, created_at DESC);

CREATE TABLE app.subscriptions (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id        uuid NOT NULL UNIQUE REFERENCES app.subscribers(id),
  plan                 text NOT NULL CHECK (plan IN ('controle','ousado','desbravador')),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  reminded_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON app.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Pedidos de assinatura não têm caso.
ALTER TABLE app.orders ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE app.orders ADD COLUMN subscriber_id uuid REFERENCES app.subscribers(id);
ALTER TABLE app.orders ADD CONSTRAINT orders_owner_chk CHECK (case_id IS NOT NULL OR subscriber_id IS NOT NULL);
CREATE INDEX orders_subscriber_idx ON app.orders (subscriber_id) WHERE subscriber_id IS NOT NULL;

INSERT INTO app.products(code, name, price_cents, kind, access_days) VALUES
  ('sub_controle',    'Fôlego Controle',    1999, 'subscription', 30),
  ('sub_ousado',      'Fôlego Ousado',      3999, 'subscription', 30),
  ('sub_desbravador', 'Fôlego Desbravador', 5999, 'subscription', 30)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE app.ledger_entries (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid   NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  occurred_on   date   NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents <> 0),   -- negativo = gasto, positivo = entrada
  category      text   NOT NULL,
  note          text   NOT NULL DEFAULT '',
  source        text   NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_subscriber_day_idx ON app.ledger_entries (subscriber_id, occurred_on);

CREATE TABLE app.budget_limits (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  category      text NOT NULL,
  limit_cents   bigint NOT NULL CHECK (limit_cents > 0),
  PRIMARY KEY (subscriber_id, category)
);

CREATE TABLE app.goals (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid   NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name          text   NOT NULL,
  target_cents  bigint NOT NULL CHECK (target_cents > 0),
  saved_cents   bigint NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
  due_on        date,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goals_subscriber_idx ON app.goals (subscriber_id);
