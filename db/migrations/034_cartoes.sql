-- Prumo: cartões de crédito (vários por pessoa). Ousado: cadastro, limite, fatura, vencimento e parcelas. Desbravador: tudo isso mais fatura em PDF e estratégias.
-- A compra no cartão é um lançamento normal (conta como gasto no mês da compra, em qualquer relatório) com card_id.
-- O pagamento da fatura NÃO é gasto novo: fica em card_payments (reduz a dívida do cartão e, se a pessoa escolher uma conta, o saldo dela).
CREATE TABLE app.credit_cards (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id      uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  brand              text NOT NULL DEFAULT 'outra' CHECK (brand IN ('visa','mastercard','elo','amex','hipercard','outra')),
  last4              text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  limit_cents        bigint NOT NULL DEFAULT 0 CHECK (limit_cents >= 0 AND limit_cents <= 100000000000),
  closing_day        smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day            smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  revolving_rate_bps integer NOT NULL DEFAULT 1400 CHECK (revolving_rate_bps BETWEEN 0 AND 3000),
  external_id        text,
  connection_id      uuid REFERENCES app.of_connections(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_cards_subscriber_idx ON app.credit_cards (subscriber_id);
CREATE UNIQUE INDEX credit_cards_external_idx ON app.credit_cards (subscriber_id, external_id) WHERE external_id IS NOT NULL;

-- Compra parcelada: guarda o plano e lança uma parcela por mês (as futuras entram no mês certo, nunca antes).
CREATE TABLE app.card_installments (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  card_id       uuid NOT NULL REFERENCES app.credit_cards(id) ON DELETE CASCADE,
  note          text NOT NULL,
  category      text NOT NULL,
  per_cents     bigint NOT NULL CHECK (per_cents > 0),
  total_n       smallint NOT NULL CHECK (total_n BETWEEN 2 AND 60),
  posted_n      smallint NOT NULL DEFAULT 0 CHECK (posted_n BETWEEN 0 AND 60),
  first_on      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_installments_card_idx ON app.card_installments (card_id);
CREATE INDEX card_installments_due_idx ON app.card_installments (subscriber_id) WHERE posted_n < total_n;

ALTER TABLE app.ledger_entries ADD COLUMN card_id uuid REFERENCES app.credit_cards(id) ON DELETE SET NULL;
ALTER TABLE app.ledger_entries ADD COLUMN installment_no smallint;
ALTER TABLE app.ledger_entries ADD COLUMN installment_total smallint;
ALTER TABLE app.ledger_entries ADD COLUMN installment_plan uuid REFERENCES app.card_installments(id) ON DELETE SET NULL;
CREATE INDEX ledger_card_idx ON app.ledger_entries (card_id, occurred_on) WHERE card_id IS NOT NULL;

CREATE TABLE app.card_payments (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  card_id       uuid NOT NULL REFERENCES app.credit_cards(id) ON DELETE CASCADE,
  paid_on       date NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  wallet_id     uuid REFERENCES app.wallets(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '',
  external_id   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_payments_card_idx ON app.card_payments (card_id, paid_on);
CREATE UNIQUE INDEX card_payments_external_idx ON app.card_payments (subscriber_id, external_id) WHERE external_id IS NOT NULL;
