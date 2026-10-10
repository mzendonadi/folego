-- WhatsApp do portal do parceiro (API oficial da Meta, "Cloud API"): conexão por parceiro, conversas, modelos, disparos e gancho para agente de IA.
-- Isolamento por parceiro (partner_id em tudo). Texto das mensagens e telefones ficam criptografados na aplicação (AES-256-GCM);
-- o telefone também vira HMAC para achar a conversa certa sem descriptografar.

-- Permissão de WhatsApp na base própria: 'sim' só quando o parceiro declara que tem autorização do contato (ou o contato escreveu primeiro).
ALTER TABLE app.partner_contacts ADD COLUMN IF NOT EXISTS wa_optin text NOT NULL DEFAULT 'desconhecido' CHECK (wa_optin IN ('desconhecido','sim','nao'));
ALTER TABLE app.partner_contacts ADD COLUMN IF NOT EXISTS phone_keys text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS partner_contacts_phone_keys_idx ON app.partner_contacts USING gin (phone_keys);
ALTER TABLE app.partner_imports ADD COLUMN IF NOT EXISTS wa_optin boolean NOT NULL DEFAULT false;

CREATE TABLE app.wa_accounts (
  partner_id      uuid PRIMARY KEY REFERENCES app.partners(id),
  phone_number_id text NOT NULL,
  waba_id         text,
  display_phone   text,
  token_enc       bytea NOT NULL,        -- token permanente do usuário do sistema (Meta)
  app_secret_enc  bytea NOT NULL,        -- segredo do app (assina o webhook: X-Hub-Signature-256)
  verify_token    text NOT NULL,         -- gerado aqui; o parceiro cola na tela de webhook da Meta
  status          text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','pausada')),
  daily_cap       integer NOT NULL DEFAULT 200 CHECK (daily_cap BETWEEN 1 AND 5000),   -- teto de mensagens ativas (modelos/disparos) por dia
  quiet_start     smallint NOT NULL DEFAULT 20 CHECK (quiet_start BETWEEN 0 AND 23),  -- sem disparo ativo entre quiet_start e quiet_end (hora de Brasília)
  quiet_end       smallint NOT NULL DEFAULT 8 CHECK (quiet_end BETWEEN 0 AND 23),
  agent           jsonb NOT NULL DEFAULT '{}'::jsonb,                                  -- configuração do agente de IA (desligado por padrão)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wa_accounts_phone_number_idx ON app.wa_accounts (phone_number_id);
CREATE TRIGGER wa_accounts_touch BEFORE UPDATE ON app.wa_accounts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Modelos de mensagem (fora da janela de 24 h só modelo aprovado pela Meta pode ser enviado).
CREATE TABLE app.wa_templates (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id uuid NOT NULL REFERENCES app.partners(id),
  name       text NOT NULL CHECK (name ~ '^[a-z0-9_]{3,60}$'),
  language   text NOT NULL DEFAULT 'pt_BR',
  category   text NOT NULL CHECK (category IN ('MARKETING','UTILITY')),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 5 AND 1024),   -- com {{1}}, {{2}}...
  status     text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_analise','aprovado','rejeitado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, name)
);

-- Uma conversa por parceiro e telefone.
CREATE TABLE app.wa_threads (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id      uuid NOT NULL REFERENCES app.partners(id),
  contact_id      uuid REFERENCES app.partner_contacts(id) ON DELETE SET NULL,
  delivery_id     uuid REFERENCES app.lead_deliveries(id) ON DELETE SET NULL,
  phone_hmac      text NOT NULL,
  phone_enc       bytea NOT NULL,
  display_name    text,
  state           text NOT NULL DEFAULT 'aberta' CHECK (state IN ('aberta','fechada')),
  mode            text NOT NULL DEFAULT 'humano' CHECK (mode IN ('humano','ia')),
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  unread_n        integer NOT NULL DEFAULT 0,
  opted_out       boolean NOT NULL DEFAULT false,
  ai_replies_hour integer NOT NULL DEFAULT 0,
  ai_hour_start   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, phone_hmac)
);
CREATE INDEX wa_threads_inbox_idx ON app.wa_threads (partner_id, last_message_at DESC);

CREATE TABLE app.wa_broadcasts (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id  uuid NOT NULL REFERENCES app.partners(id),
  name        text NOT NULL,
  template_id uuid NOT NULL REFERENCES app.wa_templates(id),
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  total       integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'fila' CHECK (status IN ('fila','concluido','cancelado')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.wa_messages (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id   uuid NOT NULL REFERENCES app.partners(id),
  thread_id    uuid NOT NULL REFERENCES app.wa_threads(id) ON DELETE CASCADE,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  author       text NOT NULL CHECK (author IN ('contato','humano','ia','sistema')),
  kind         text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','template')),
  body_enc     bytea NOT NULL,
  template_id  uuid REFERENCES app.wa_templates(id),
  vars_enc     bytea,                       -- variáveis do modelo (JSON), para enviar depois
  broadcast_id uuid REFERENCES app.wa_broadcasts(id),
  wa_id        text,
  status       text NOT NULL CHECK (status IN ('fila','enviada','entregue','lida','falhou','recebida')),
  error        text,
  attempts     integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_messages_thread_idx ON app.wa_messages (thread_id, created_at);
CREATE UNIQUE INDEX wa_messages_wa_id_idx ON app.wa_messages (partner_id, wa_id) WHERE wa_id IS NOT NULL;
CREATE INDEX wa_messages_queue_idx ON app.wa_messages (created_at) WHERE status = 'fila';
CREATE INDEX wa_messages_sent_day_idx ON app.wa_messages (partner_id, sent_at) WHERE direction = 'out' AND sent_at IS NOT NULL;
