-- Investimentos (Desbravador): aplicações lançadas à mão (CDB, Tesouro, fundos...), com posição opcional e status ativo/processando/resgatado.
-- Estratégias (Desbravador): análise do "Estrategista" gerada por IA em segundo plano (pode passar dos 100 s do Cloudflare).
-- Carteira: dias do limite da conta que o banco não cobra juros (informado pela pessoa), base das dicas de arbitragem.
CREATE TABLE app.investments (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id  uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind           text NOT NULL DEFAULT 'renda_fixa' CHECK (kind IN ('renda_fixa', 'tesouro', 'fundo', 'acoes', 'cripto', 'previdencia', 'poupanca', 'outro')),
  indexer        text NOT NULL DEFAULT 'cdi' CHECK (indexer IN ('cdi', 'selic', 'ipca', 'prefixado', 'poupanca', 'outro')),
  -- 102% do CDI = 10200; prefixado 12,5% ao ano = 1250 (percentual x 100)
  rate_bp        integer NOT NULL DEFAULT 10000 CHECK (rate_bp BETWEEN 0 AND 100000),
  applied_cents  bigint NOT NULL CHECK (applied_cents > 0 AND applied_cents <= 100000000000),
  position_cents bigint CHECK (position_cents IS NULL OR (position_cents >= 0 AND position_cents <= 100000000000)),
  applied_on     date NOT NULL,
  matures_on     date,
  liquidity      text NOT NULL DEFAULT 'diaria' CHECK (liquidity IN ('diaria', 'vencimento')),
  status         text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'processando', 'resgatado')),
  note           text CHECK (note IS NULL OR length(note) <= 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX investments_subscriber_idx ON app.investments (subscriber_id, status, applied_on);

CREATE TABLE app.strategy_reports (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  content       text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX strategy_reports_idx ON app.strategy_reports (subscriber_id, created_at DESC);

ALTER TABLE app.wallets ADD COLUMN overdraft_free_days integer CHECK (overdraft_free_days IS NULL OR overdraft_free_days BETWEEN 0 AND 60);
