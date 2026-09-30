-- =============================================================================
-- Schema v0.1  |  PostgreSQL 18 (uuidv7() nativo)
-- Em PostgreSQL 16/17: gerar UUIDv7 na aplicação e remover os DEFAULT uuidv7().
-- Escopo: fases 1-3 (organizador, upsells, leads/parceiros). Assinatura = fase 4.
-- Valores monetários sempre em centavos (bigint). Datas em timestamptz (UTC).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- ---------------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é append-only (% bloqueado)', TG_TABLE_NAME, TG_OP;
END $$;

-- ---------------------------------------------------------------------------
-- Sessão anônima (sem login). O cookie guarda o token; o banco guarda só o hash.
-- ---------------------------------------------------------------------------
CREATE TABLE app.sessions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  token_hash   bytea       NOT NULL UNIQUE,
  ip_hash      bytea,
  ab_variant   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_expires_idx ON app.sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Documentos legais versionados (termos, privacidade, compartilhamento com parceiros)
-- ---------------------------------------------------------------------------
CREATE TABLE app.legal_documents (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  kind           text        NOT NULL CHECK (kind IN ('terms','privacy','lead_sharing')),
  version        text        NOT NULL,
  content_sha256 bytea       NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

-- ---------------------------------------------------------------------------
-- Caso (um atendimento). Colunas tipadas para o que filtra/qualifica; jsonb para o resto.
-- ---------------------------------------------------------------------------
CREATE TABLE app.cases (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  session_id          uuid        NOT NULL REFERENCES app.sessions(id),
  status              text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','previewed','paid','delivered','expired','purged')),
  employment_type     text        CHECK (employment_type IN
                        ('inss_retiree','public_servant','clt','self_employed','other')),
  net_income_cents    bigint      CHECK (net_income_cents >= 0),
  fixed_expenses_cents bigint     CHECK (fixed_expenses_cents >= 0),
  age_band            text        CHECK (age_band IN ('18-24','25-34','35-44','45-54','55-64','65-74','75+')),
  uf                  char(2),
  inputs              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  input_schema_version integer    NOT NULL DEFAULT 1,
  price_variant       text,
  purge_after         timestamptz NOT NULL,
  purged_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cases_session_idx  ON app.cases (session_id);
CREATE INDEX cases_purge_idx    ON app.cases (purge_after) WHERE status <> 'purged';
CREATE TRIGGER cases_touch BEFORE UPDATE ON app.cases
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.debts (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id              uuid   NOT NULL REFERENCES app.cases(id) ON DELETE CASCADE,
  creditor_name        text   NOT NULL,
  kind                 text   NOT NULL CHECK (kind IN
                         ('credit_card','overdraft','personal_loan','payroll_loan','financing',
                          'store_credit','utility','rent','other')),
  balance_cents        bigint NOT NULL CHECK (balance_cents >= 0),
  monthly_payment_cents bigint CHECK (monthly_payment_cents >= 0),
  remaining_installments integer CHECK (remaining_installments >= 0),
  monthly_rate_bps     integer CHECK (monthly_rate_bps >= 0),   -- 1 bps = 0,01% a.m.
  days_overdue         integer NOT NULL DEFAULT 0 CHECK (days_overdue >= 0),
  first_default_on     date,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX debts_case_idx ON app.debts (case_id);

-- Preview: SOMENTE o que pode sair para o navegador antes do pagamento.
CREATE TABLE app.diagnoses (
  case_id        uuid PRIMARY KEY REFERENCES app.cases(id) ON DELETE CASCADE,
  engine_version text        NOT NULL,
  preview        jsonb       NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now()
);

-- Conteúdo pago. A API só lê esta tabela se existir entitlement válido.
CREATE TABLE app.deliverables (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id      uuid NOT NULL REFERENCES app.cases(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','generating','ready','failed')),
  content      jsonb,
  pdf_key      text,
  generation_meta jsonb,               -- modelo, tokens, custo, latência
  generated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, product_code)
);
CREATE TRIGGER deliverables_touch BEFORE UPDATE ON app.deliverables
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Comércio: produtos, pedidos, pagamentos (Pix), eventos do gateway, direitos
-- ---------------------------------------------------------------------------
CREATE TABLE app.products (
  code        text PRIMARY KEY,
  name        text    NOT NULL,
  price_cents bigint  NOT NULL CHECK (price_cents >= 0),
  kind        text    NOT NULL DEFAULT 'one_off' CHECK (kind IN ('one_off','subscription')),
  access_days integer NOT NULL DEFAULT 30,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE app.orders (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id         uuid   NOT NULL REFERENCES app.cases(id),
  session_id      uuid   NOT NULL REFERENCES app.sessions(id),
  status          text   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','expired','canceled','refunded')),
  total_cents     bigint NOT NULL CHECK (total_cents >= 0),
  currency        char(3) NOT NULL DEFAULT 'BRL',
  idempotency_key text   NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idempotency_key)
);
CREATE INDEX orders_case_idx ON app.orders (case_id);
CREATE TRIGGER orders_touch BEFORE UPDATE ON app.orders
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.order_items (
  order_id         uuid   NOT NULL REFERENCES app.orders(id) ON DELETE CASCADE,
  product_code     text   NOT NULL REFERENCES app.products(code),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),   -- preço congelado no pedido
  PRIMARY KEY (order_id, product_code)
);

CREATE TABLE app.payments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id            uuid   NOT NULL REFERENCES app.orders(id),
  provider            text   NOT NULL,
  provider_payment_id text   NOT NULL,
  method              text   NOT NULL DEFAULT 'pix' CHECK (method IN ('pix','card')),
  amount_cents        bigint NOT NULL CHECK (amount_cents > 0),
  status              text   NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','failed','expired','refunded')),
  pix_copy_paste      text,
  pix_expires_at      timestamptz,
  confirmed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
CREATE INDEX payments_order_idx ON app.payments (order_id);
CREATE INDEX payments_pending_expiry_idx ON app.payments (pix_expires_at) WHERE status = 'pending';
CREATE TRIGGER payments_touch BEFORE UPDATE ON app.payments
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Idempotência de webhook: mesmo evento chegando duas vezes não processa duas vezes.
CREATE TABLE app.payment_events (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  provider          text        NOT NULL,
  provider_event_id text        NOT NULL,
  payload           jsonb       NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (provider, provider_event_id)
);
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON app.payment_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

CREATE TABLE app.entitlements (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id      uuid NOT NULL REFERENCES app.cases(id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES app.products(code),
  order_id     uuid NOT NULL REFERENCES app.orders(id),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  UNIQUE (case_id, product_code)
);

-- Link mágico: o caso é a "conta". Só o hash do token fica no banco.
CREATE TABLE app.access_tokens (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id     uuid   NOT NULL REFERENCES app.cases(id) ON DELETE CASCADE,
  token_hash  bytea  NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_tokens_case_idx ON app.access_tokens (case_id);

-- ---------------------------------------------------------------------------
-- Consentimento (append-only): concessão e revogação são linhas novas.
-- ---------------------------------------------------------------------------
CREATE TABLE app.consents (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id           uuid NOT NULL REFERENCES app.cases(id),
  legal_document_id uuid NOT NULL REFERENCES app.legal_documents(id),
  purpose           text NOT NULL CHECK (purpose IN ('terms_of_service','lead_sharing')),
  action            text NOT NULL CHECK (action IN ('grant','revoke')),
  scope             jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ex.: {"categories":["consignado"]}
  ip_hash           bytea,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_case_purpose_idx ON app.consents (case_id, purpose, created_at DESC);
CREATE TRIGGER consents_append_only BEFORE UPDATE OR DELETE ON app.consents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- Consentimento vigente = última linha por (case, purpose) com action = 'grant'.
CREATE VIEW app.v_current_consents AS
SELECT DISTINCT ON (case_id, purpose)
       case_id, purpose, action, scope, legal_document_id, created_at
FROM app.consents
ORDER BY case_id, purpose, created_at DESC, id DESC;

-- ---------------------------------------------------------------------------
-- Leads: contato criptografado na aplicação (AES-256-GCM) separado do perfil derivado.
-- ---------------------------------------------------------------------------
CREATE TABLE app.lead_contacts (
  case_id       uuid PRIMARY KEY REFERENCES app.cases(id) ON DELETE CASCADE,
  full_name_enc bytea NOT NULL,
  phone_enc     bytea NOT NULL,
  email_enc     bytea,
  phone_hmac    bytea NOT NULL,        -- HMAC(phone) para deduplicar sem descriptografar
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_contacts_phone_idx ON app.lead_contacts (phone_hmac);

CREATE TABLE app.lead_profiles (
  case_id         uuid PRIMARY KEY REFERENCES app.cases(id) ON DELETE CASCADE,
  employment_type text NOT NULL,
  income_band     text NOT NULL,       -- ex.: '2000-3000'
  age_band        text NOT NULL,
  uf              char(2) NOT NULL,
  debt_band       text NOT NULL,
  debt_kinds      text[] NOT NULL DEFAULT '{}',
  debt_to_income_pct numeric(6,2),
  suitability_ok  boolean NOT NULL,    -- filtro de adequação: false bloqueia qualquer envio
  suitability_notes text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_profiles_match_idx ON app.lead_profiles (uf, employment_type) WHERE suitability_ok;
CREATE INDEX lead_profiles_debt_kinds_gin ON app.lead_profiles USING gin (debt_kinds);

-- ---------------------------------------------------------------------------
-- Parceiros (tenants) e campanhas
-- ---------------------------------------------------------------------------
CREATE TABLE app.partners (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  legal_name text   NOT NULL,
  cnpj       char(14) NOT NULL UNIQUE,
  category   text   NOT NULL CHECK (category IN ('consignado','bank','fintech','renegotiation')),
  status     text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.partner_users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id    uuid   NOT NULL REFERENCES app.partners(id),
  email         citext NOT NULL UNIQUE,
  password_hash text   NOT NULL,
  role          text   NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.partner_campaigns (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  partner_id        uuid   NOT NULL REFERENCES app.partners(id),
  name              text   NOT NULL,
  status            text   NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused','ended')),
  consent_category  text   NOT NULL CHECK (consent_category IN ('consignado','renegotiation','personal_credit')),
  employment_types  text[] NOT NULL DEFAULT '{}',    -- vazio = todos
  ufs               char(2)[] NOT NULL DEFAULT '{}', -- vazio = todas
  min_income_cents  bigint,
  max_income_cents  bigint,
  price_per_lead_cents bigint NOT NULL CHECK (price_per_lead_cents >= 0),
  daily_cap         integer NOT NULL DEFAULT 50,
  monthly_budget_cents bigint,
  webhook_url       text   NOT NULL,
  webhook_secret_enc bytea NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_active_idx ON app.partner_campaigns (consent_category) WHERE status = 'active';
CREATE INDEX campaigns_partner_idx ON app.partner_campaigns (partner_id);
CREATE TRIGGER campaigns_touch BEFORE UPDATE ON app.partner_campaigns
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE app.lead_deliveries (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  case_id      uuid   NOT NULL REFERENCES app.cases(id),
  partner_id   uuid   NOT NULL REFERENCES app.partners(id),
  campaign_id  uuid   NOT NULL REFERENCES app.partner_campaigns(id),
  consent_id   uuid   NOT NULL REFERENCES app.consents(id),   -- prova do consentimento usado
  status       text   NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','delivered','failed','contacted','converted','rejected')),
  price_cents  bigint NOT NULL CHECK (price_cents >= 0),       -- preço congelado na entrega
  attempts     integer NOT NULL DEFAULT 0,
  last_response_code integer,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, partner_id)          -- nunca reenviar o mesmo lead ao mesmo parceiro
);
CREATE INDEX deliveries_partner_idx  ON app.lead_deliveries (partner_id, created_at DESC);
CREATE INDEX deliveries_campaign_day ON app.lead_deliveries (campaign_id, created_at);
CREATE INDEX deliveries_queue_idx    ON app.lead_deliveries (created_at) WHERE status IN ('queued','failed');
CREATE TRIGGER deliveries_touch BEFORE UPDATE ON app.lead_deliveries
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Limite de N parceiros por lead: aplicado na aplicação com
-- SELECT ... FROM app.lead_profiles WHERE case_id = $1 FOR UPDATE antes de inserir a entrega.

-- ---------------------------------------------------------------------------
-- Auditoria imutável com hash encadeado
-- ---------------------------------------------------------------------------
CREATE TABLE app.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor       text  NOT NULL,          -- 'system', 'partner:<id>', 'session:<id>'
  action      text  NOT NULL,
  entity      text  NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   bytea,
  row_hash    bytea
);
CREATE INDEX audit_entity_idx ON app.audit_log (entity, entity_id);
CREATE INDEX audit_time_brin  ON app.audit_log USING brin (occurred_at);

CREATE OR REPLACE FUNCTION app.audit_chain() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE
  prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app.audit_log.chain'));
  SELECT row_hash INTO prev FROM app.audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.row_hash  := digest(
    coalesce(prev, ''::bytea) ||
    convert_to(NEW.actor || '|' || NEW.action || '|' || NEW.entity || '|' ||
               coalesce(NEW.entity_id, '') || '|' || NEW.data::text || '|' ||
               NEW.occurred_at::text, 'UTF8'),
    'sha256');
  RETURN NEW;
END $$;

CREATE TRIGGER audit_chain_ins BEFORE INSERT ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_chain();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Funil (medir conversão e testes de preço). BRIN: tabela só recebe INSERT em ordem de tempo.
-- ---------------------------------------------------------------------------
CREATE TABLE app.funnel_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  session_id  uuid,
  case_id     uuid,
  event       text  NOT NULL,     -- landing_view, intake_step, preview_view, checkout_start, paid...
  props       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX funnel_time_brin ON app.funnel_events USING brin (occurred_at);
CREATE INDEX funnel_event_idx ON app.funnel_events (event, occurred_at);

-- ---------------------------------------------------------------------------
-- Expurgo (LGPD): apaga dados pessoais e conteúdo; mantém o caso "anônimo" para estatística
-- e os pedidos/pagamentos para obrigação fiscal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.purge_expired_cases(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH victims AS (
    SELECT id FROM app.cases
    WHERE purge_after <= now() AND status <> 'purged'
    ORDER BY purge_after
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  d1 AS (DELETE FROM app.debts          WHERE case_id IN (SELECT id FROM victims)),
  d2 AS (DELETE FROM app.deliverables   WHERE case_id IN (SELECT id FROM victims)),
  d3 AS (DELETE FROM app.diagnoses      WHERE case_id IN (SELECT id FROM victims)),
  d4 AS (DELETE FROM app.lead_contacts  WHERE case_id IN (SELECT id FROM victims)),
  d5 AS (DELETE FROM app.lead_profiles  WHERE case_id IN (SELECT id FROM victims)),
  d6 AS (DELETE FROM app.access_tokens  WHERE case_id IN (SELECT id FROM victims)),
  u  AS (
    UPDATE app.cases
       SET status = 'purged', inputs = '{}'::jsonb, purged_at = now()
     WHERE id IN (SELECT id FROM victims)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM u;

  RETURN v_count;
END $$;

-- ---------------------------------------------------------------------------
-- Papéis e RLS. api/worker: acesso amplo. partner_portal: só o que é do parceiro.
-- (Criar os logins e senhas fora deste arquivo; nunca versionar segredos.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'partner_portal') THEN
    CREATE ROLE partner_portal NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO app_rw, partner_portal;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;

-- O portal do parceiro enxerga apenas campanhas e entregas dele; nunca contato, caso ou perfil.
GRANT SELECT, UPDATE ON app.partner_campaigns TO partner_portal;
GRANT SELECT ON app.lead_deliveries TO partner_portal;
GRANT UPDATE (status) ON app.lead_deliveries TO partner_portal;   -- retorno: contatado/contratado

ALTER TABLE app.partner_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.lead_deliveries   ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_tenant ON app.partner_campaigns TO partner_portal
  USING (partner_id = nullif(current_setting('app.partner_id', true), '')::uuid)
  WITH CHECK (partner_id = nullif(current_setting('app.partner_id', true), '')::uuid);

CREATE POLICY deliveries_tenant ON app.lead_deliveries TO partner_portal
  USING (partner_id = nullif(current_setting('app.partner_id', true), '')::uuid)
  WITH CHECK (partner_id = nullif(current_setting('app.partner_id', true), '')::uuid);

-- Uso no portal: BEGIN; SELECT set_config('app.partner_id', '<uuid>', true); ... COMMIT;

-- Catálogo inicial
INSERT INTO app.products (code, name, price_cents, access_days) VALUES
  ('recovery_map',      'Mapa da Virada',          2900, 30),
  ('defense_letters',   'Kit de Cartas e Defesas', 1900, 30),
  ('calendar_30d',      'Calendário dos 30 dias',  1999, 30),
  ('extra_income_plan', 'Criador de Renda Extra',  1599, 30)
ON CONFLICT (code) DO NOTHING;
