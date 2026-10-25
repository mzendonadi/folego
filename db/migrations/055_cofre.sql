-- Item 5: cofre de acordos e documentos de dívida (contrato da renegociação, boleto, comprovante, extrato).
-- Título, credor, anotações, o texto extraído para busca e o próprio arquivo ficam criptografados (chave do servidor). Só o tipo, o valor e o vencimento
-- ficam abertos, porque o aviso de vencimento precisa consultá-los. A busca por conteúdo é feita no servidor, depois de decifrar os documentos da própria pessoa.
CREATE TABLE app.vault_docs (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('acordo', 'contrato', 'boleto', 'comprovante', 'extrato', 'outro')),
  title_enc     bytea NOT NULL,
  creditor_enc  bytea,
  notes_enc     bytea,
  text_enc      bytea,
  amount_cents  bigint CHECK (amount_cents IS NULL OR amount_cents > 0),
  due_on        date,
  mime          text,
  size_bytes    integer NOT NULL DEFAULT 0,
  filename_enc  bytea,
  data_enc      bytea,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((data_enc IS NULL) = (mime IS NULL))
);
CREATE INDEX vault_docs_subscriber_idx ON app.vault_docs (subscriber_id, created_at DESC);
CREATE INDEX vault_docs_due_idx ON app.vault_docs (due_on) WHERE due_on IS NOT NULL;
