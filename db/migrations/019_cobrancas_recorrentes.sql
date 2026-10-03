-- Detector de cobranças recorrentes: o que a pessoa decidiu sobre cada cobrança (manter ou cancelar).
CREATE TABLE app.recurring_flags (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  merchant_key  text NOT NULL,
  status        text NOT NULL CHECK (status IN ('keep','cancel')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, merchant_key)
);
