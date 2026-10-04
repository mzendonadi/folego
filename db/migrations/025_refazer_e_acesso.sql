-- Acesso de 30 dias com direito de refazer: controle do que foi refeito e das prorrogações feitas pelo dono (2026-10-04).
ALTER TABLE app.entitlements
  ADD COLUMN IF NOT EXISTS redo_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_redo_at  timestamptz,
  ADD COLUMN IF NOT EXISTS extended_days integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS entitlements_expires_idx ON app.entitlements (expires_at);
