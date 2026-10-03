-- Prumo: assinatura mensal recorrente no cartão (Asaas), cancelamento com acesso até o fim do mês pago,
-- preferências de notificação e controle de exportação/exclusão dos dados de quem cancelou.

CREATE TABLE app.billing_profiles (
  subscriber_id            uuid PRIMARY KEY REFERENCES app.subscribers(id) ON DELETE CASCADE,
  provider                 text NOT NULL,
  provider_customer_id     text,
  provider_subscription_id text,
  plan                     text NOT NULL CHECK (plan IN ('controle','ousado','desbravador')),
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','canceled')),
  terms_accepted_at        timestamptz NOT NULL,
  terms_version            text NOT NULL,
  last_charge_at           timestamptz,
  past_due_since           timestamptz,
  canceled_at              timestamptz,
  data_exported_at         timestamptz,   -- o backoffice baixou o pacote completo de dados (libera a exclusão)
  data_exported_by         uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_provider_sub_idx ON app.billing_profiles (provider, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX billing_canceled_idx ON app.billing_profiles (canceled_at) WHERE canceled_at IS NOT NULL;
CREATE TRIGGER billing_profiles_touch BEFORE UPDATE ON app.billing_profiles FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Cancelamento explícito também marcado na assinatura (para as telas e o worker).
ALTER TABLE app.subscriptions ADD COLUMN canceled_at timestamptz;

-- Preferências e perfil.
ALTER TABLE app.subscribers ADD COLUMN display_name text;
ALTER TABLE app.subscribers ADD COLUMN notify_digest boolean NOT NULL DEFAULT true;
ALTER TABLE app.subscribers ADD COLUMN notify_reminders boolean NOT NULL DEFAULT true;

-- Renovações chegam por webhook, sem sessão do navegador.
ALTER TABLE app.orders ALTER COLUMN session_id DROP NOT NULL;
