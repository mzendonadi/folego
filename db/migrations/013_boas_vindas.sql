-- E-mail de boas-vindas da Assinatura (enviado uma vez pelo worker). Quem já era assinante não recebe.
ALTER TABLE app.subscribers ADD COLUMN welcome_sent_at timestamptz;
UPDATE app.subscribers SET welcome_sent_at = now();
