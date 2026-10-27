-- Resgate de aplicação: o dinheiro entra a crédito na conta escolhida, mas não é receita (não entra em "Entrou" do mês nem nas análises).
ALTER TABLE app.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_transfer_kind_check;
ALTER TABLE app.ledger_entries ADD CONSTRAINT ledger_entries_transfer_kind_check CHECK (transfer_kind IS NULL OR transfer_kind IN ('card_payment', 'invoice_financing', 'investment_redeem'));
