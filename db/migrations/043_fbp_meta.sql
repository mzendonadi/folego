-- fbp (identificador do navegador criado pelo pixel da Meta, cookie _fbp): melhora a combinação dos eventos do servidor com o anúncio clicado.
-- Fica só enquanto o contato existir: o gatilho que apaga o contato do caso zera também este campo.
ALTER TABLE app.cases ADD COLUMN IF NOT EXISTS contact_fbp text;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS contact_fbp text;

CREATE OR REPLACE FUNCTION app.wipe_case_contact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.contact_email_enc := NULL;
  NEW.contact_phone_enc := NULL;
  NEW.ads_consent := false;
  NEW.contact_ip := NULL;
  NEW.contact_ua := NULL;
  NEW.contact_fbc := NULL;
  NEW.contact_fbp := NULL;
  RETURN NEW;
END $$;
