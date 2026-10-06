-- Dados cadastrais de quem assina no cartão: CPF e celular criptografados (só aparecem no backoffice com permissão
-- e cada visualização é auditada). Os quatro últimos dígitos do CPF ficam em claro para conferência rápida.
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS cpf_enc bytea;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS cpf_last4 text;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS phone_enc bytea;
ALTER TABLE app.subscribers ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
