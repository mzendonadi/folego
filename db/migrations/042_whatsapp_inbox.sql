-- Caixa de entrada completa de WhatsApp (estilo WhatsApp Business) no portal do parceiro (API da Meta) e no backoffice do Fôlego (Bird):
-- mídia (fotos, áudios, documentos, vídeos), encaminhar mensagens, perfil do contato e conta por provedor.
-- Arquivos ficam criptografados (AES-256-GCM, na aplicação) no próprio banco: entram no backup e no expurgo como o resto.

-- O Fôlego usa o mesmo motor de conversas dos parceiros, como um "parceiro interno" (não aparece na lista de parceiros nem recebe leads).
ALTER TABLE app.partners ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;
INSERT INTO app.partners(id, legal_name, trade_name, cnpj, category, status, internal)
VALUES ('0192f000-0000-7000-8000-000000000001', 'Emegetech Soluções em Tecnologia LTDA', 'Fôlego (interno)', '08896800000144', 'fintech', 'suspended', true)
ON CONFLICT DO NOTHING;

-- Conta por provedor: 'meta' (Cloud API, token do parceiro) ou 'bird' (chave da plataforma, em variável de ambiente; nada de segredo no banco).
ALTER TABLE app.wa_accounts ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta','bird'));
ALTER TABLE app.wa_accounts ADD COLUMN IF NOT EXISTS app_id text;          -- ID do app da Meta: necessário só para trocar a foto do perfil da empresa
ALTER TABLE app.wa_accounts ALTER COLUMN token_enc DROP NOT NULL;
ALTER TABLE app.wa_accounts ALTER COLUMN app_secret_enc DROP NOT NULL;

-- Modelos com variáveis nomeadas (Bird): param_names[i] é o nome da variável {{i+1}}.
ALTER TABLE app.wa_templates ADD COLUMN IF NOT EXISTS param_names text[];
-- O identificador de modelo da Bird usa hífen (ex.: folego-indicacao-prumo).
ALTER TABLE app.wa_templates DROP CONSTRAINT IF EXISTS wa_templates_name_check;
ALTER TABLE app.wa_templates ADD CONSTRAINT wa_templates_name_check CHECK (name ~ '^[a-z0-9_-]{3,60}$');

-- Arquivos das conversas.
CREATE TABLE app.wa_media (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id uuid NOT NULL REFERENCES app.partners(id),
  mime       text NOT NULL,
  filename   text,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 16777216),
  sha256     text NOT NULL,
  data_enc   bytea NOT NULL,
  origin     text NOT NULL CHECK (origin IN ('in','out','avatar')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_media_partner_idx ON app.wa_media (partner_id, created_at DESC);

ALTER TABLE app.wa_messages DROP CONSTRAINT IF EXISTS wa_messages_kind_check;
ALTER TABLE app.wa_messages ADD CONSTRAINT wa_messages_kind_check CHECK (kind IN ('text','template','image','audio','document','video','sticker'));
ALTER TABLE app.wa_messages ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES app.wa_media(id) ON DELETE SET NULL;
ALTER TABLE app.wa_messages ADD COLUMN IF NOT EXISTS voice boolean NOT NULL DEFAULT false;       -- áudio gravado na hora (mensagem de voz)
ALTER TABLE app.wa_messages ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false;
ALTER TABLE app.wa_messages ADD COLUMN IF NOT EXISTS sent_by text;                                -- quem enviou (e-mail do usuário), para auditoria interna
CREATE INDEX IF NOT EXISTS wa_messages_media_idx ON app.wa_messages (media_id) WHERE media_id IS NOT NULL;

-- Perfil do contato: foto e observações (só visíveis para quem atende; o WhatsApp não entrega a foto do contato pela API).
ALTER TABLE app.wa_threads ADD COLUMN IF NOT EXISTS avatar_media_id uuid REFERENCES app.wa_media(id) ON DELETE SET NULL;
ALTER TABLE app.wa_threads ADD COLUMN IF NOT EXISTS notes_enc bytea;
-- Número adicionado à mão: quem atende declara que a pessoa autorizou receber mensagens (permite o primeiro modelo).
ALTER TABLE app.wa_threads ADD COLUMN IF NOT EXISTS optin boolean NOT NULL DEFAULT false;
