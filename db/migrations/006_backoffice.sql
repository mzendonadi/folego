-- Backoffice (folego.online/gestao): usuários e permissões, eventos de navegação (funil e jornada), configurações em
-- tempo de execução, catálogo editável (preços, gratuito/pago, uso de IA) e planejamento de marketing.

-- Usuários do backoffice. Entram por código de 6 dígitos no e-mail (sem senha guardada).
CREATE TABLE app.admin_users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         citext NOT NULL UNIQUE,
  name          text   NOT NULL DEFAULT '',
  role          text   NOT NULL CHECK (role IN ('owner','gestor','financeiro','marketing','suporte')),
  permissions   text[] NOT NULL DEFAULT '{}',   -- seções liberadas (o papel só sugere o conjunto inicial)
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

ALTER TABLE app.sessions ADD COLUMN admin_user_id uuid REFERENCES app.admin_users(id) ON DELETE SET NULL;
ALTER TABLE app.sessions ADD COLUMN admin_login_at timestamptz;

-- Um código de login serve a um propósito só (assinante ou backoffice).
ALTER TABLE app.login_codes ADD COLUMN purpose text NOT NULL DEFAULT 'subscriber';

-- Eventos de navegação próprios (sem terceiros, sem IP, sem dado pessoal). session_id sem chave estrangeira de
-- propósito: a sessão expira em 30 dias e o histórico do funil precisa continuar.
CREATE TABLE app.events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid   NOT NULL,
  name       text   NOT NULL,
  props      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_time_idx    ON app.events (created_at);
CREATE INDEX events_session_idx ON app.events (session_id, created_at);
CREATE INDEX events_name_idx    ON app.events (name, created_at);

-- Configurações que o dono muda sem reiniciar nada (recursos ligados/desligados, aviso no site, vendas pausadas...).
CREATE TABLE app.settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Catálogo editável.
ALTER TABLE app.products ADD COLUMN uses_ai     boolean NOT NULL DEFAULT false;
ALTER TABLE app.products ADD COLUMN description text    NOT NULL DEFAULT '';
ALTER TABLE app.products ADD COLUMN sort        integer NOT NULL DEFAULT 100;
ALTER TABLE app.products ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now();

UPDATE app.products SET uses_ai = true, sort = 10, description = 'Diagnóstico completo, ordem de pagamento, orçamento e roteiros de negociação (com IA depois do pagamento).' WHERE code = 'recovery_map';
UPDATE app.products SET sort = 20, description = 'Cartas prontas de prescrição, informações e contestação. Modelos fixos, sem IA.' WHERE code = 'defense_letters';
UPDATE app.products SET sort = 30, description = 'As ações do Mapa em ordem, com data, para baixar no calendário do celular.' WHERE code = 'calendar_30d';
UPDATE app.products SET uses_ai = true, sort = 40, description = 'Entrevista curta depois da compra e plano de 4 semanas personalizado (IA escreve o texto; números vêm do motor).' WHERE code = 'extra_income_plan';
UPDATE app.products SET sort = 50, description = 'Explica uma cobrança recebida, aponta sinais de golpe e sugere resposta. Análise por regras, sem IA.' WHERE code = 'collection_translator';
UPDATE app.products SET sort = 60, description = 'Controle de gastos, importação de extrato, alertas e treinador (3 dicas).' WHERE code = 'sub_controle';
UPDATE app.products SET sort = 70, description = 'Tudo do Controle, mais metas com aportes e treinador completo.' WHERE code = 'sub_ousado';
UPDATE app.products SET sort = 80, description = 'Tudo do Ousado, mais simulador educativo de investimento.' WHERE code = 'sub_desbravador';

CREATE TABLE app.product_price_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_code    text   NOT NULL,
  old_price_cents bigint,
  new_price_cents bigint NOT NULL,
  changed_by      uuid,
  changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_history_product_idx ON app.product_price_history (product_code, changed_at DESC);

-- Planejamento de marketing e relacionamento.
CREATE TABLE app.marketing_plans (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  title      text NOT NULL,
  goal       text NOT NULL DEFAULT '',
  segment    text NOT NULL DEFAULT '',
  channel    text NOT NULL DEFAULT '',
  status     text NOT NULL DEFAULT 'planejado' CHECK (status IN ('ideia','planejado','em_andamento','concluido','pausado')),
  due_on     date,
  notes      text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER marketing_plans_touch BEFORE UPDATE ON app.marketing_plans
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Totais anonimizados por caso, para os indicadores (e a conversa com parceiros) continuarem existindo depois do expurgo
-- LGPD, que apaga o detalhe das dívidas (nomes de credores, valores individuais) mas mantém o caso como registro do funil.
ALTER TABLE app.cases ADD COLUMN product_kind     text    NOT NULL DEFAULT 'map';
ALTER TABLE app.cases ADD COLUMN debt_total_cents bigint;
ALTER TABLE app.cases ADD COLUMN debt_count       integer;
ALTER TABLE app.cases ADD COLUMN has_overdue      boolean;
ALTER TABLE app.cases ADD COLUMN debt_kinds       text[]  NOT NULL DEFAULT '{}';

UPDATE app.cases SET product_kind = 'translator' WHERE inputs->>'kind' = 'translator';
UPDATE app.cases c SET debt_total_cents = s.total, debt_count = s.n, has_overdue = s.ov, debt_kinds = s.kinds
  FROM (SELECT case_id, sum(balance_cents) AS total, count(*)::integer AS n, bool_or(days_overdue > 0) AS ov, array_agg(DISTINCT kind) AS kinds
          FROM app.debts GROUP BY case_id) s
 WHERE s.case_id = c.id;
CREATE INDEX cases_created_idx ON app.cases (created_at);
