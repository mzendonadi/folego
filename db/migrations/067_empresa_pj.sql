-- Empresa (PJ) no Prumo. Tabelas PRÓPRIAS: nenhuma conta, cartão ou lançamento da empresa entra em uma soma pessoal (PF), porque
-- as consultas pessoais nunca leem estas tabelas. Os investimentos da empresa usam a mesma tabela dos pessoais, separados por "scope".

CREATE TABLE app.biz_wallets (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id         uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  kind                  text NOT NULL DEFAULT 'conta' CHECK (kind IN ('conta', 'caixa', 'poupanca', 'outra')),
  opening_balance_cents bigint NOT NULL DEFAULT 0 CHECK (opening_balance_cents BETWEEN -100000000000 AND 100000000000),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX biz_wallets_subscriber_idx ON app.biz_wallets (subscriber_id);

CREATE TABLE app.biz_cards (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  brand         text NOT NULL DEFAULT 'outra' CHECK (brand IN ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra')),
  last4         text CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  limit_cents   bigint NOT NULL DEFAULT 0 CHECK (limit_cents >= 0 AND limit_cents <= 100000000000),
  closing_day   smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day       smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX biz_cards_subscriber_idx ON app.biz_cards (subscriber_id);

-- Lançamento da empresa: negativo = saída, positivo = entrada. Compra no cartão da empresa tem card_id e não mexe no saldo da conta;
-- pagar a fatura sai da conta (wallet_id + card_id, transfer_kind = 'card_payment') e não conta como despesa de novo.
-- "movement" = movimento entre a empresa e o sócio (PF); pf_entry_id liga ao lançamento pessoal correspondente, quando existe.
CREATE TABLE app.biz_entries (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid   NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  occurred_on   date   NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents <> 0),
  category      text   NOT NULL,
  note          text   NOT NULL DEFAULT '' CHECK (char_length(note) <= 120),
  wallet_id     uuid   REFERENCES app.biz_wallets(id) ON DELETE SET NULL,
  card_id       uuid   REFERENCES app.biz_cards(id) ON DELETE SET NULL,
  movement      text   CHECK (movement IN ('pro_labore', 'lucros', 'aporte', 'retirada')),
  pf_entry_id   uuid   REFERENCES app.ledger_entries(id) ON DELETE SET NULL,
  pf_created    boolean NOT NULL DEFAULT false, -- true = o lançamento pessoal foi criado junto com este (apagar este apaga aquele); false = já existia e só foi ligado
  transfer_kind text   CHECK (transfer_kind IN ('card_payment', 'investment')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX biz_entries_day_idx ON app.biz_entries (subscriber_id, occurred_on);
CREATE INDEX biz_entries_wallet_idx ON app.biz_entries (wallet_id) WHERE wallet_id IS NOT NULL;
CREATE INDEX biz_entries_card_idx ON app.biz_entries (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX biz_entries_pf_idx ON app.biz_entries (pf_entry_id) WHERE pf_entry_id IS NOT NULL;

-- Investimentos: 'pf' (padrão, tudo o que já existe) ou 'pj' (da empresa). As telas e contas pessoais só leem 'pf'.
ALTER TABLE app.investments ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'pf' CHECK (scope IN ('pf', 'pj'));

-- Do lado pessoal, aporte na empresa e retirada da empresa são transferências (não são renda nem gasto): tipo novo "business".
ALTER TABLE app.ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_transfer_kind_check;
ALTER TABLE app.ledger_entries ADD CONSTRAINT ledger_entries_transfer_kind_check CHECK (transfer_kind IS NULL OR transfer_kind IN ('card_payment', 'invoice_financing', 'investment_redeem', 'business'));
