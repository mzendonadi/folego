-- O lead entregue ao parceiro não pode sumir do painel dele quando o caso do Fôlego é expurgado (7 dias sem pagamento).
-- Antes: o contato morava só em app.lead_contacts (apagado no expurgo) e a lista do parceiro exigia essa linha; os leads
-- "enviados" desapareciam do portal. Agora a entrega guarda a própria cópia (criptografada, como no resto), que o expurgo
-- por prazo NÃO apaga. Continuam apagando a cópia: a revogação do titular e o "apagar meus dados" (LGPD).
ALTER TABLE app.lead_deliveries
  ADD COLUMN IF NOT EXISTS kept_name_enc        bytea,
  ADD COLUMN IF NOT EXISTS kept_phone_enc       bytea,
  ADD COLUMN IF NOT EXISTS kept_email_enc       bytea,
  ADD COLUMN IF NOT EXISTS kept_phone_hmac      bytea,
  ADD COLUMN IF NOT EXISTS kept_uf              char(2),
  ADD COLUMN IF NOT EXISTS kept_employment_type text,
  ADD COLUMN IF NOT EXISTS kept_income_band     text,
  ADD COLUMN IF NOT EXISTS kept_debt_band       text;

-- Quem já foi entregue e ainda tem o contato guardado: copia agora (o que já foi expurgado não tem como voltar).
UPDATE app.lead_deliveries d
   SET kept_name_enc = lc.full_name_enc, kept_phone_enc = lc.phone_enc, kept_email_enc = lc.email_enc, kept_phone_hmac = lc.phone_hmac,
       kept_uf = lp.uf, kept_employment_type = lp.employment_type, kept_income_band = lp.income_band, kept_debt_band = lp.debt_band
  FROM app.lead_contacts lc
  LEFT JOIN app.lead_profiles lp ON lp.case_id = lc.case_id
 WHERE lc.case_id = d.case_id AND d.status IN ('delivered', 'contacted', 'converted') AND d.kept_phone_enc IS NULL;

-- O expurgo por prazo passa a copiar o contato para a entrega (se já foi entregue) antes de apagar o do caso.
CREATE OR REPLACE FUNCTION app.purge_expired_cases(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE
  v_count integer;
BEGIN
  WITH victims AS (
    SELECT id FROM app.cases
    WHERE purge_after <= now() AND status <> 'purged'
    ORDER BY purge_after
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  keep AS (
    UPDATE app.lead_deliveries d
       SET kept_name_enc = lc.full_name_enc, kept_phone_enc = lc.phone_enc, kept_email_enc = lc.email_enc, kept_phone_hmac = lc.phone_hmac,
           kept_uf = lp.uf, kept_employment_type = lp.employment_type, kept_income_band = lp.income_band, kept_debt_band = lp.debt_band
      FROM app.lead_contacts lc
      LEFT JOIN app.lead_profiles lp ON lp.case_id = lc.case_id
     WHERE lc.case_id = d.case_id AND d.case_id IN (SELECT id FROM victims)
       AND d.status IN ('delivered', 'contacted', 'converted') AND d.kept_phone_enc IS NULL
    RETURNING 1
  ),
  d1 AS (DELETE FROM app.debts          WHERE case_id IN (SELECT id FROM victims)),
  d2 AS (DELETE FROM app.deliverables   WHERE case_id IN (SELECT id FROM victims)),
  d3 AS (DELETE FROM app.diagnoses      WHERE case_id IN (SELECT id FROM victims)),
  d4 AS (DELETE FROM app.lead_contacts  WHERE case_id IN (SELECT id FROM victims)),
  d5 AS (DELETE FROM app.lead_profiles  WHERE case_id IN (SELECT id FROM victims)),
  d6 AS (DELETE FROM app.access_tokens  WHERE case_id IN (SELECT id FROM victims)),
  u  AS (
    UPDATE app.cases
       SET status = 'purged', inputs = '{}'::jsonb, purged_at = now()
     WHERE id IN (SELECT id FROM victims)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM u;

  RETURN v_count;
END $$;
