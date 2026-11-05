-- Conta de dono: ilimitada, nunca expira, versão completa (Desbravador), não se cancela e não se exclui.
-- A condição fica no BANCO, para valer em qualquer caminho (tela da pessoa, backoffice, webhook de pagamento, rotina de expiração, troca de plano):
--   * assinatura de dono é sempre desbravador, ativa, sem cancelamento e com validade em 2100;
--   * a assinatura e o cadastro de dono não podem ser apagados nem marcados como excluídos.
-- Os dados da conta (lançamentos, carteiras, empresa, investimentos...) não são tocados.

ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.owner_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM app.subscribers b WHERE b.id = OLD.subscriber_id AND b.is_owner) THEN
      RAISE EXCEPTION 'conta de dono: a assinatura não pode ser apagada';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM app.subscribers b WHERE b.id = NEW.subscriber_id AND b.is_owner) THEN
    NEW.plan := 'desbravador';
    NEW.status := 'active';
    NEW.current_period_end := timestamptz '2100-01-01 00:00:00+00';
    NEW.cancel_at_period_end := false;
    NEW.canceled_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS subscriptions_owner_guard ON app.subscriptions;
CREATE TRIGGER subscriptions_owner_guard BEFORE INSERT OR UPDATE OR DELETE ON app.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.owner_subscription_guard();

CREATE OR REPLACE FUNCTION app.owner_subscriber_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_owner THEN RAISE EXCEPTION 'conta de dono: o cadastro não pode ser apagado'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_owner AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'conta de dono: o cadastro não pode ser excluído';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS subscribers_owner_guard ON app.subscribers;
CREATE TRIGGER subscribers_owner_guard BEFORE UPDATE OR DELETE ON app.subscribers
  FOR EACH ROW EXECUTE FUNCTION app.owner_subscriber_guard();

-- A conta do dono do produto.
UPDATE app.subscribers SET is_owner = true WHERE lower(email) = 'mzendonadi@gmail.com' AND deleted_at IS NULL;
-- Sem assinatura ainda? cria. Com assinatura (cancelada hoje, por exemplo)? o gatilho a normaliza.
INSERT INTO app.subscriptions(subscriber_id, plan, status, current_period_end)
  SELECT id, 'desbravador', 'active', timestamptz '2100-01-01 00:00:00+00' FROM app.subscribers WHERE is_owner
  ON CONFLICT (subscriber_id) DO NOTHING;
UPDATE app.subscriptions SET plan = plan WHERE subscriber_id IN (SELECT id FROM app.subscribers WHERE is_owner);
