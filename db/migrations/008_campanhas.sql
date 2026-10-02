-- E-mail de campanha (relacionamento com ASSINANTES, que têm conta e e-mail). Compradores avulsos são anônimos: não entram.
-- Toda mensagem leva link de descadastro; quem sai nunca mais recebe campanha (e-mails de conta/código/lembrete continuam).
ALTER TABLE app.subscribers ADD COLUMN marketing_opt_out_at timestamptz;

CREATE TABLE app.email_campaigns (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  name          text NOT NULL,
  audience      text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,                    -- parágrafos separados por linha em branco
  button_label  text,
  button_url    text,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','cancelled')),
  recipients    integer NOT NULL DEFAULT 0,
  created_by    uuid,
  approved_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_started_at timestamptz,
  finished_at   timestamptz
);

CREATE TABLE app.email_sends (
  campaign_id   uuid NOT NULL REFERENCES app.email_campaigns(id) ON DELETE CASCADE,
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
  reason        text,
  sent_at       timestamptz,
  PRIMARY KEY (campaign_id, subscriber_id)
);
CREATE INDEX email_sends_queue_idx ON app.email_sends (campaign_id) WHERE status = 'queued';
CREATE INDEX email_sends_sent_idx  ON app.email_sends (subscriber_id, sent_at DESC) WHERE status = 'sent';
