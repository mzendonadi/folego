-- eBook de presente (Ousado e Desbravador) e programa de indicações.

-- Repositório do eBook: o PDF fica no banco (bytea), com versões; só um pode estar ativo (é o que vai de presente).
CREATE TABLE app.ebooks (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  title       text   NOT NULL,
  filename    text   NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  pages       integer,
  content     bytea  NOT NULL,
  active      boolean NOT NULL DEFAULT false,
  version     integer NOT NULL DEFAULT 1,
  source      text   NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','padrao')),
  uploaded_by text,
  sent_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ebooks_one_active_idx ON app.ebooks ((true)) WHERE active;
CREATE TRIGGER ebooks_touch BEFORE UPDATE ON app.ebooks FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

ALTER TABLE app.subscribers ADD COLUMN ebook_sent_at timestamptz;
ALTER TABLE app.subscribers ADD COLUMN ebook_id uuid;
-- Quem já assinava antes deste recurso não recebe o presente de repente.
UPDATE app.subscribers SET ebook_sent_at = now();

-- Indicações. kind 'lead' = comprador de produto Pix indicando um amigo (sem bônus); 'subscriber' = assinante indicando (10% por conversão).
CREATE TABLE app.referrals (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  kind                   text NOT NULL CHECK (kind IN ('lead','subscriber')),
  referrer_subscriber_id uuid REFERENCES app.subscribers(id) ON DELETE SET NULL,
  referrer_session_id    uuid,
  referrer_name          text,
  friend_email           citext NOT NULL,
  status                 text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','converted')),
  converted_subscriber_id uuid REFERENCES app.subscribers(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  converted_at           timestamptz
);
CREATE INDEX referrals_referrer_idx ON app.referrals (referrer_subscriber_id);
CREATE INDEX referrals_friend_idx ON app.referrals (friend_email);
CREATE INDEX referrals_session_idx ON app.referrals (referrer_session_id);

-- Quem não quer receber convites de amigos (por e-mail, guardado só como hash).
CREATE TABLE app.referral_optout (
  email_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Cada indicação que vira assinatura gera um crédito de desconto na PRÓXIMA fatura de quem indicou (um crédito por mês).
CREATE TABLE app.referral_credits (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id      uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  referral_id        uuid REFERENCES app.referrals(id) ON DELETE SET NULL,
  percent            integer NOT NULL CHECK (percent BETWEEN 1 AND 100),
  status             text NOT NULL DEFAULT 'available' CHECK (status IN ('available','applied','revoked')),
  source             text NOT NULL DEFAULT 'indicacao' CHECK (source IN ('indicacao','manual')),
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  applied_at         timestamptz,
  applied_payment_id uuid
);
CREATE INDEX referral_credits_sub_idx ON app.referral_credits (subscriber_id, status, created_at);

ALTER TABLE app.subscribers ADD COLUMN referral_code text;
CREATE UNIQUE INDEX subscribers_referral_code_idx ON app.subscribers (referral_code) WHERE referral_code IS NOT NULL;

ALTER TABLE app.billing_profiles ADD COLUMN referred_by uuid REFERENCES app.subscribers(id) ON DELETE SET NULL;
ALTER TABLE app.billing_profiles ADD COLUMN referral_id uuid REFERENCES app.referrals(id) ON DELETE SET NULL;
ALTER TABLE app.billing_profiles ADD COLUMN referral_credited_at timestamptz;
ALTER TABLE app.billing_profiles ADD COLUMN synced_value_cents bigint;
