-- Criador de Renda Extra 2.0: entrevista pós-compra + plano gerado (IA com verificador, igual aos roteiros
-- de negociação) + captura de contato pronta para futuras parcerias de capacitação (SEBRAE, escolas
-- técnicas etc. — sem nenhuma delas ativa ainda; reaproveita o mesmo mecanismo de leads já construído).
CREATE TABLE app.income_interviews (
  case_id        uuid PRIMARY KEY REFERENCES app.cases(id) ON DELETE CASCADE,
  skills         text NOT NULL,
  hours_band     text NOT NULL CHECK (hours_band IN ('ate_5h','5_10h','10_20h','mais_20h')),
  capital_cents  bigint NOT NULL DEFAULT 0 CHECK (capital_cents >= 0),
  has_vehicle    boolean NOT NULL DEFAULT false,
  mode           text NOT NULL CHECK (mode IN ('presencial','online','tanto_faz')),
  prior_attempts text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER income_interviews_touch BEFORE UPDATE ON app.income_interviews
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Nova categoria de parceiro (capacitação/empreendedorismo), usando a MESMA infraestrutura de leads já
-- construída (app.partners, app.partner_campaigns, app.lead_deliveries, app.consents) — nenhum código novo
-- de entrega é necessário quando um parceiro desta categoria for cadastrado.
ALTER TABLE app.partner_campaigns DROP CONSTRAINT IF EXISTS partner_campaigns_consent_category_check;
ALTER TABLE app.partner_campaigns ADD CONSTRAINT partner_campaigns_consent_category_check
  CHECK (consent_category IN ('consignado', 'renegotiation', 'personal_credit', 'empreendedorismo'));

ALTER TABLE app.partners DROP CONSTRAINT IF EXISTS partners_category_check;
ALTER TABLE app.partners ADD CONSTRAINT partners_category_check
  CHECK (category IN ('consignado', 'bank', 'fintech', 'renegotiation', 'capacitacao'));
