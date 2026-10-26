-- Parcelamento da fatura: o que sobrou depois do pagamento vira parcelas nas próximas faturas.
-- A fatura mostra "parcelada" (não "vencida"), as parcelas entram nas faturas seguintes e não contam como gasto de novo
-- (a compra já foi contada); só os juros do parcelamento entram como gasto.
ALTER TABLE app.card_invoices
  ADD COLUMN financed_cents bigint CHECK (financed_cents IS NULL OR financed_cents >= 0),
  ADD COLUMN financed_plan  uuid REFERENCES app.card_installments(id) ON DELETE SET NULL;

-- Plano de parcelas que nasceu do parcelamento de uma fatura (a fatura de origem, AAAA-MM).
ALTER TABLE app.card_installments
  ADD COLUMN invoice_key text CHECK (invoice_key IS NULL OR invoice_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

ALTER TABLE app.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_transfer_kind_check;
ALTER TABLE app.ledger_entries ADD CONSTRAINT ledger_entries_transfer_kind_check CHECK (transfer_kind IS NULL OR transfer_kind IN ('card_payment', 'invoice_financing'));
