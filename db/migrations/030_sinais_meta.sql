-- Sinais de atribuição para a Meta (Conversions API): IP, navegador e fbc (do clique no anúncio) de quem informou contato.
-- Ficam só enquanto o contato existir: o gatilho que apaga o contato do caso zera também estes campos.
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_ip text;
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_ua text;
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_fbc text;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS contact_ip text;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS contact_ua text;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS contact_fbc text;

CREATE OR REPLACE FUNCTION app.wipe_case_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.contact_email_enc := NULL;
  NEW.contact_phone_enc := NULL;
  NEW.ads_consent := false;
  NEW.contact_ip := NULL;
  NEW.contact_ua := NULL;
  NEW.contact_fbc := NULL;
  RETURN NEW;
END $$;
