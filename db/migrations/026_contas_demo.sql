-- Contas de teste (demo): o dono liga e desliga pelo backoffice. Com a conta ligada, o Prumo vem completo (plano Desbravador)
-- e os produtos avulsos são liberados sem pagamento. Pedido de demo grava total 0 e provedor 'demo' (a receita não conta).
CREATE TABLE IF NOT EXISTS app.demo_accounts (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  email      citext NOT NULL UNIQUE,
  label      text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER demo_accounts_touch BEFORE UPDATE ON app.demo_accounts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Pagamento de demo vale 0.
ALTER TABLE app.payments DROP CONSTRAINT IF EXISTS payments_amount_cents_check;
ALTER TABLE app.payments ADD CONSTRAINT payments_amount_cents_check CHECK (amount_cents >= 0);

INSERT INTO app.demo_accounts (email, label, active) VALUES ('demo@folego.online', 'Conta de teste do dono', false) ON CONFLICT (email) DO NOTHING;
