-- Contador diário de e-mails enviados (alerta de custo/limite no backoffice). Só dia e quantidade, nenhum dado pessoal.
CREATE TABLE IF NOT EXISTS app.email_usage (
  day  date PRIMARY KEY,
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0)
);
