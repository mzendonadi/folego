-- Contato de quem gera Pix (e-mail e celular criptografados) e aceite SEPARADO de publicidade.
-- Retenção: o contato mora no caso; quando o caso é apagado (7 dias sem pagar, 30 dias depois de pago) o gatilho zera os campos.
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_email_enc bytea;
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_phone_enc bytea;
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS ads_consent boolean NOT NULL DEFAULT false;
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_at timestamptz;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS ads_consent boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.wipe_case_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.contact_email_enc := NULL;
  NEW.contact_phone_enc := NULL;
  NEW.ads_consent := false;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cases_wipe_contact ON app.cases;
CREATE TRIGGER cases_wipe_contact BEFORE UPDATE OF status ON app.cases FOR EACH ROW WHEN (NEW.status = 'purged' AND OLD.status <> 'purged') EXECUTE FUNCTION app.wipe_case_contact();
