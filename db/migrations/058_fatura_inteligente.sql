-- Fatura de cartão lida do PDF sem misturar com a conta: cada compra e cada pagamento sabem de QUAL fatura são,
-- a fatura oficial (total, fechamento, vencimento) fica guardada, e o pagamento da fatura que aparece no extrato do banco
-- deixa de contar como gasto (o gasto já foi contado nas compras do cartão).

-- Lançamentos: a fatura em que a compra foi cobrada (AAAA-MM do fechamento) e a marca de "pagamento de fatura" (transferência, não é gasto).
ALTER TABLE app.ledger_entries
  ADD COLUMN invoice_key     text CHECK (invoice_key IS NULL OR invoice_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD COLUMN transfer_kind   text CHECK (transfer_kind IS NULL OR transfer_kind = 'card_payment'),
  ADD COLUMN card_payment_id uuid REFERENCES app.card_payments(id) ON DELETE SET NULL;
CREATE INDEX ledger_transfer_idx ON app.ledger_entries (subscriber_id, occurred_on) WHERE transfer_kind IS NOT NULL;
CREATE INDEX ledger_invoice_idx ON app.ledger_entries (card_id, invoice_key) WHERE invoice_key IS NOT NULL;

-- Pagamentos do cartão: a fatura que ele quitou (a fatura em PDF informa) e se é pagamento ou estorno/crédito.
ALTER TABLE app.card_payments
  ADD COLUMN invoice_key text CHECK (invoice_key IS NULL OR invoice_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD COLUMN kind        text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'credit'));

-- Faturas oficiais lidas do PDF (e o histórico "AGO, SET, OUT" que a própria fatura traz).
CREATE TABLE app.card_invoices (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id     uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  card_id           uuid NOT NULL REFERENCES app.credit_cards(id) ON DELETE CASCADE,
  invoice_key       text NOT NULL CHECK (invoice_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  period_start      date,
  closing_on        date NOT NULL,
  due_on            date,
  total_cents       bigint NOT NULL CHECK (total_cents >= 0),
  min_payment_cents bigint CHECK (min_payment_cents IS NULL OR min_payment_cents >= 0),
  previous_cents    bigint CHECK (previous_cents IS NULL OR previous_cents >= 0),
  paid_cents        bigint CHECK (paid_cents IS NULL OR paid_cents >= 0),  -- quanto da fatura já foi pago, segundo o próprio banco
  source            text NOT NULL DEFAULT 'pdf' CHECK (source IN ('pdf', 'history')),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, invoice_key)
);
CREATE INDEX card_invoices_subscriber_idx ON app.card_invoices (subscriber_id, card_id);
