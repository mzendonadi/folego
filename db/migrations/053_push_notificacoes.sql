-- Notificações no celular (web push) do Prumo instalado como app: aparelhos inscritos e preferências de cada assinante.
-- Um aparelho = um endereço (endpoint) do serviço de push do navegador + as chaves dele; sem elas ninguém, nem nós, consegue ler ou forjar a notificação.
CREATE TABLE app.push_devices (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%'),
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  fail_n        integer NOT NULL DEFAULT 0,       -- falhas seguidas; ao passar de 5 o aparelho é esquecido
  last_sent_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_subscriber_idx ON app.push_devices (subscriber_id);

-- O que cada pessoa quer receber, e quando. Os "_last" evitam repetir no mesmo dia (ou na mesma semana, no caso das metas).
ALTER TABLE app.subscribers
  ADD COLUMN push_expenses      boolean  NOT NULL DEFAULT true,
  ADD COLUMN push_goals         boolean  NOT NULL DEFAULT true,
  ADD COLUMN push_bills         boolean  NOT NULL DEFAULT true,
  ADD COLUMN push_hour          smallint NOT NULL DEFAULT 20 CHECK (push_hour BETWEEN 8 AND 21),  -- hora de Brasília do lembrete de despesas
  ADD COLUMN push_expenses_last date,
  ADD COLUMN push_goals_last    date;

-- Para qual vencimento a notificação (diferente do e-mail) de um lembrete de conta já foi enviada.
ALTER TABLE app.reminders ADD COLUMN push_notified_for date;
