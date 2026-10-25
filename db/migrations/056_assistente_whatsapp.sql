-- Item 4: assistente do Prumo no WhatsApp. O assinante vincula o número mandando "VINCULAR <código>" para o WhatsApp do Fôlego
-- (prova que o número é dele e abre a janela de 24 h para responder, sem precisar de modelo aprovado). Depois lança, consulta e desfaz por mensagem.
-- O telefone fica criptografado e só é achado pelo HMAC; as conversas do assistente NÃO entram na caixa de entrada do atendimento.
CREATE TABLE app.assistant_links (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id    uuid NOT NULL UNIQUE REFERENCES app.subscribers(id) ON DELETE CASCADE,
  code             text,
  code_expires_at  timestamptz,
  phone_hmac       text UNIQUE,
  phone_enc        bytea,
  linked_at        timestamptz,
  last_entry_id    uuid,                 -- último lançamento feito por mensagem, para o "desfazer"
  last_entry_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX assistant_links_code_idx ON app.assistant_links (code) WHERE code IS NOT NULL;

-- Ids dos avisos já tratados: a Bird pode repetir o aviso e a busca de respostas atrasadas passa pelo mesmo caminho; sem isto, o gasto seria lançado duas vezes.
CREATE TABLE app.assistant_seen (
  message_id text PRIMARY KEY,
  seen_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_seen_at_idx ON app.assistant_seen (seen_at);
