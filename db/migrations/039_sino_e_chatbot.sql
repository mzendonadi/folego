-- Sino de alertas do backoffice (o que cada pessoa já viu) e Chatbot com IA (leads e conversas da landing e do Prumo).

-- Alertas são calculados na hora. Aqui fica só "esta pessoa já viu este alerta, neste estado".
-- A impressão (fingerprint) muda quando o alerta piora (ex.: mais cancelamentos) e o sino volta a tocar.
CREATE TABLE app.bo_alert_seen (
  admin_id    uuid NOT NULL REFERENCES app.admin_users(id) ON DELETE CASCADE,
  alert_key   text NOT NULL,
  fingerprint text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, alert_key)
);

-- Quem acionou o chatbot. Celular (com DDD) e e-mail são obrigatórios: é o que permite retomar o contato depois.
-- Telefone e e-mail ficam criptografados (AES-256-GCM) e também como HMAC para cruzar com assinantes sem descriptografar.
CREATE TABLE app.chat_leads (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  origin          text NOT NULL CHECK (origin IN ('landing','prumo')),
  name_enc        bytea,
  phone_enc       bytea NOT NULL,
  email_enc       bytea NOT NULL,
  phone_key       text NOT NULL,
  email_key       text NOT NULL,
  subscriber_id   uuid REFERENCES app.subscribers(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_contato','convertido','descartado')),
  intent          text,
  notes_enc       bytea,
  contacted_at    timestamptz,
  converted_at    timestamptz,
  messages_count  integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  utm             jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_leads_status_idx ON app.chat_leads (status, created_at DESC);
CREATE INDEX chat_leads_email_key_idx ON app.chat_leads (email_key);
CREATE INDEX chat_leads_phone_key_idx ON app.chat_leads (phone_key);
CREATE TRIGGER chat_leads_touch BEFORE UPDATE ON app.chat_leads FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.chat_messages (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  lead_id    uuid NOT NULL REFERENCES app.chat_leads(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user','assistant','team')),
  body_enc   bytea NOT NULL,
  source     text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','regras','pessoa')),
  tokens_in  integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_lead_idx ON app.chat_messages (lead_id, created_at);
