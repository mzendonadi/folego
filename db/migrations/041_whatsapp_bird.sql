-- WhatsApp do Fôlego pela Bird (número próprio da empresa): convite de indicação do Prumo, fila de envio, estados e "SAIR".
-- Telefone nunca fica em texto puro: criptografado (AES-256-GCM, na aplicação) e, para achar a pessoa, só o HMAC (phone_key).

-- Contatos de WhatsApp (quem recebeu ou escreveu). opted_out = pediu para parar: nada mais é enviado a esse número.
CREATE TABLE app.msg_contacts (
  phone_key    text PRIMARY KEY,
  phone_enc    bytea NOT NULL,
  opted_out    boolean NOT NULL DEFAULT false,
  opted_out_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Registro de cada mensagem (saída e entrada). A fila de envios é este mesmo registro com status 'fila'.
CREATE TABLE app.msg_log (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  channel             text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp')),
  direction           text NOT NULL CHECK (direction IN ('out','in')),
  purpose             text NOT NULL,                       -- ex.: 'indicacao_prumo', 'resposta'
  phone_key           text NOT NULL REFERENCES app.msg_contacts(phone_key),
  subscriber_id       uuid REFERENCES app.subscribers(id) ON DELETE SET NULL,
  referral_id         uuid,
  template_slug       text,
  params_enc          bytea,                               -- parâmetros do modelo (nome do amigo, link), criptografados
  body_enc            bytea,                               -- texto recebido (entrada), criptografado
  status              text NOT NULL CHECK (status IN ('fila','enviando','aceita','enviada','entregue','lida','falhou','recebida','cancelada')),
  attempts            integer NOT NULL DEFAULT 0,
  send_after          timestamptz NOT NULL DEFAULT now(),  -- fora do horário comercial a mensagem espera na fila
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX msg_log_queue_idx ON app.msg_log (send_after) WHERE status = 'fila';
CREATE INDEX msg_log_provider_idx ON app.msg_log (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX msg_log_phone_idx ON app.msg_log (phone_key, created_at DESC);
CREATE INDEX msg_log_subscriber_idx ON app.msg_log (subscriber_id, created_at DESC) WHERE subscriber_id IS NOT NULL;
CREATE TRIGGER msg_log_touch BEFORE UPDATE ON app.msg_log FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Indicações também por WhatsApp: o amigo pode ser identificado só pelo telefone.
ALTER TABLE app.referrals ALTER COLUMN friend_email DROP NOT NULL;
ALTER TABLE app.referrals ADD COLUMN channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','whatsapp'));
ALTER TABLE app.referrals ADD COLUMN friend_phone_key text;
ALTER TABLE app.referrals ADD COLUMN friend_name text;
ALTER TABLE app.referrals ADD CONSTRAINT referrals_friend_chk CHECK (friend_email IS NOT NULL OR friend_phone_key IS NOT NULL);
CREATE INDEX referrals_friend_phone_idx ON app.referrals (friend_phone_key) WHERE friend_phone_key IS NOT NULL;
