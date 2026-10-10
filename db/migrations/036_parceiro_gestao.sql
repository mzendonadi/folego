-- Portal de gestão do parceiro (primeiro: Euro Multiplan & Fôlego).
-- (1) A campanha ganha a comissão em % sobre o contrato fechado, além do valor por contato que já existia.
-- (2) A entrega pode ser só no portal (sem webhook): o contato aparece na tela do parceiro assim que é enviado.
-- (3) A base própria do parceiro (planilhas dele) fica em tabelas separadas dos contatos do Fôlego: nunca se misturam.
-- (4) Contratos fechados (valor, produto, data) com a comissão do Fôlego congelada na hora do registro.

ALTER TABLE app.partners
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS phone      text,
  ADD COLUMN IF NOT EXISTS city       text,
  ADD COLUMN IF NOT EXISTS uf         char(2),
  ADD COLUMN IF NOT EXISTS address    text;

ALTER TABLE app.partner_campaigns ALTER COLUMN webhook_url DROP NOT NULL;
ALTER TABLE app.partner_campaigns ALTER COLUMN webhook_secret_enc DROP NOT NULL;
ALTER TABLE app.partner_campaigns
  ADD COLUMN IF NOT EXISTS commission_bps integer NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000);

-- Cada arquivo importado: serve de histórico e de prova de onde veio cada contato.
CREATE TABLE app.partner_imports (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id  uuid NOT NULL REFERENCES app.partners(id),
  filename    text NOT NULL,
  layout      text NOT NULL,
  rows_total  integer NOT NULL DEFAULT 0,
  created_n   integer NOT NULL DEFAULT 0,
  updated_n   integer NOT NULL DEFAULT 0,
  same_n      integer NOT NULL DEFAULT 0,
  invalid_n   integer NOT NULL DEFAULT 0,
  repeated_n  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX partner_imports_idx ON app.partner_imports (partner_id, created_at DESC);

-- Contatos da base do parceiro. CPF, nome da mãe, conta, telefones, e-mails e endereço ficam criptografados (pii_enc);
-- o CPF também vira um HMAC (cpf_hmac) para achar repetidos sem descriptografar. Só o que é preciso para filtrar fica em claro.
CREATE TABLE app.partner_contacts (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id       uuid NOT NULL REFERENCES app.partners(id),
  cpf_hmac         text NOT NULL,          -- HMAC-SHA256 em hexadecimal
  name             text NOT NULL,
  org_uf           char(2),
  city             text,
  uf               char(2),
  service_status   text,
  age              smallint,
  available_margin_cents bigint,
  card_margin_cents      bigint,
  pii_enc          bytea NOT NULL,
  stage            text NOT NULL DEFAULT 'novo' CHECK (stage IN ('novo','em_contato','proposta','fechado','sem_interesse')),
  next_action_on   date,
  last_contact_at  timestamptz,
  import_id        uuid REFERENCES app.partner_imports(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, cpf_hmac)
);
CREATE INDEX partner_contacts_stage_idx ON app.partner_contacts (partner_id, stage, updated_at DESC);
CREATE INDEX partner_contacts_name_idx  ON app.partner_contacts (partner_id, lower(name) text_pattern_ops);
CREATE INDEX partner_contacts_margin_idx ON app.partner_contacts (partner_id, available_margin_cents DESC NULLS LAST);
CREATE INDEX partner_contacts_next_idx  ON app.partner_contacts (partner_id, next_action_on) WHERE next_action_on IS NOT NULL;
CREATE TRIGGER partner_contacts_touch BEFORE UPDATE ON app.partner_contacts
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Histórico de cada contato (da base própria ou entregue pelo Fôlego): notas, ligações, mudanças de etapa.
CREATE TABLE app.partner_events (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id  uuid NOT NULL REFERENCES app.partners(id),
  contact_id  uuid REFERENCES app.partner_contacts(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES app.lead_deliveries(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('nota','ligacao','whatsapp','etapa','contrato')),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((contact_id IS NULL) <> (delivery_id IS NULL))
);
CREATE INDEX partner_events_contact_idx  ON app.partner_events (contact_id, created_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX partner_events_delivery_idx ON app.partner_events (delivery_id, created_at DESC) WHERE delivery_id IS NOT NULL;

-- Contratos fechados. origin='folego': veio de um contato que enviamos, então vale a comissão da campanha (congelada aqui).
-- origin='propria': veio da base do parceiro; sem comissão para o Fôlego.
CREATE TABLE app.partner_deals (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id        uuid NOT NULL REFERENCES app.partners(id),
  origin            text NOT NULL CHECK (origin IN ('folego','propria')),
  delivery_id       uuid REFERENCES app.lead_deliveries(id),
  contact_id        uuid REFERENCES app.partner_contacts(id) ON DELETE SET NULL,
  client_name      text,
  product           text NOT NULL CHECK (product IN ('consignado','cartao_consignado','refinanciamento','portabilidade','outro')),
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  installments      smallint CHECK (installments IS NULL OR installments BETWEEN 1 AND 240),
  monthly_cents     bigint CHECK (monthly_cents IS NULL OR monthly_cents > 0),
  bank              text,
  signed_on         date NOT NULL,
  commission_bps    integer NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  commission_cents  bigint NOT NULL DEFAULT 0 CHECK (commission_cents >= 0),
  commission_status text NOT NULL DEFAULT 'a_receber' CHECK (commission_status IN ('a_receber','recebida','nao_se_aplica')),
  received_on       date,
  status            text NOT NULL DEFAULT 'fechado' CHECK (status IN ('fechado','cancelado')),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (origin = 'propria' OR delivery_id IS NOT NULL)
);
CREATE INDEX partner_deals_idx ON app.partner_deals (partner_id, signed_on DESC);
CREATE INDEX partner_deals_delivery_idx ON app.partner_deals (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE TRIGGER partner_deals_touch BEFORE UPDATE ON app.partner_deals
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
