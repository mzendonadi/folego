-- Assinatura: carteiras (dinheiro, conta, cartão...) e lembretes de contas e prazos.
CREATE TABLE app.wallets (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'conta' CHECK (kind IN ('dinheiro','conta','cartao','poupanca','outra')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallets_subscriber_idx ON app.wallets (subscriber_id);

-- Lançamento sem carteira continua valendo (é o que existia antes); apagar a carteira só solta os lançamentos dela.
ALTER TABLE app.ledger_entries ADD COLUMN wallet_id uuid REFERENCES app.wallets(id) ON DELETE SET NULL;
CREATE INDEX ledger_wallet_idx ON app.ledger_entries (wallet_id) WHERE wallet_id IS NOT NULL;

-- Lembretes que a PESSOA cria (conta de luz, parcela, prazo de meta). O e-mail é mensagem de conta (ela mesma pediu).
CREATE TABLE app.reminders (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id    uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  title            text NOT NULL,
  due_on           date NOT NULL,
  amount_cents     bigint CHECK (amount_cents IS NULL OR amount_cents > 0),
  repeat_monthly   boolean NOT NULL DEFAULT false,
  email_days_before integer NOT NULL DEFAULT 1 CHECK (email_days_before BETWEEN 0 AND 10),
  done_at          timestamptz,
  notified_for     date,            -- para qual vencimento o e-mail já foi enviado (evita repetir)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reminders_subscriber_idx ON app.reminders (subscriber_id, due_on);
CREATE INDEX reminders_due_idx ON app.reminders (due_on) WHERE done_at IS NULL;
