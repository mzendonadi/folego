-- Coach: jornadas escolhidas pela pessoa, missões confirmadas à mão/por evento e indicadores econômicos (Banco Central).
CREATE TABLE app.journeys (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  program       text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, program)
);
CREATE TABLE app.journey_done (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  mission_id    text NOT NULL,
  done_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, mission_id)
);
CREATE TABLE app.market_indicators (
  code        text NOT NULL,           -- selic | ipca12 | cdi | usd
  ref_date    date NOT NULL,
  value       numeric(14,4) NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, ref_date)
);
