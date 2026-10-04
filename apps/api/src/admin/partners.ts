// Parceiros no backoffice: cadastro, edição, suspensão, exclusão e campanhas (destino, filtros, preço e webhook).
// Segredos (senha do portal e segredo do webhook) só aparecem UMA vez, na hora de criar ou trocar; no banco ficam como hash/criptografados.
import { AppError, notFound } from '../errors.ts';
import { encryptText, hashPassword, newToken } from '../crypto.ts';
import { assertPublicHttpsUrl, createPartner } from '../leads.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import { z } from 'zod';
import { newPartnerSchema } from '../schemas.ts';

const campaignFields = newPartnerSchema.shape.campaign;
export const partnerCreateSchema = newPartnerSchema;
export const partnerPatchSchema = z.strictObject({
  legalName: z.string().trim().min(3).max(200).optional(),
  category: z.enum(['consignado', 'bank', 'fintech', 'renegotiation']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export const campaignCreateSchema = campaignFields;
export const campaignPatchSchema = campaignFields.partial().extend({ status: z.enum(['active', 'paused', 'ended']).optional(), monthlyBudgetCents: z.number().int().positive().nullable().optional(), minIncomeCents: z.number().int().nonnegative().nullable().optional(), maxIncomeCents: z.number().int().nonnegative().nullable().optional() }).strict();

const iso = (d: unknown): string => new Date(d as string).toISOString();

export async function listPartners(ctx: Ctx) {
  const p = await ctx.db.query<{ id: string; legal_name: string; cnpj: string; category: string; status: string; created_at: Date; email: string | null; sent: string; contacts: string }>(
    `SELECT p.id, p.legal_name, p.cnpj, p.category, p.status, p.created_at,
            (SELECT u.email::text FROM app.partner_users u WHERE u.partner_id = p.id ORDER BY u.created_at LIMIT 1) AS email,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.partner_id = p.id)::text AS sent,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.partner_id = p.id AND d.status IN ('contacted','converted'))::text AS contacts
       FROM app.partners p ORDER BY p.legal_name`,
  );
  const c = await ctx.db.query<{ id: string; partner_id: string; name: string; status: string; consent_category: string; employment_types: string[]; ufs: string[]; min_income_cents: string | null; max_income_cents: string | null; price_per_lead_cents: string; daily_cap: number; monthly_budget_cents: string | null; webhook_url: string; sent: string }>(
    `SELECT c.id, c.partner_id, c.name, c.status, c.consent_category, c.employment_types, c.ufs::text[] AS ufs, c.min_income_cents, c.max_income_cents, c.price_per_lead_cents, c.daily_cap, c.monthly_budget_cents, c.webhook_url,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.campaign_id = c.id)::text AS sent
       FROM app.partner_campaigns c ORDER BY c.created_at`,
  );
  return {
    partners: p.rows.map((x) => ({
      id: x.id,
      legalName: x.legal_name,
      cnpj: x.cnpj,
      category: x.category,
      status: x.status,
      createdAt: iso(x.created_at),
      portalEmail: x.email,
      sent: num(x.sent),
      reached: num(x.contacts),
      campaigns: c.rows
        .filter((k) => k.partner_id === x.id)
        .map((k) => ({
          id: k.id,
          name: k.name,
          status: k.status,
          consentCategory: k.consent_category,
          employmentTypes: k.employment_types,
          ufs: k.ufs,
          minIncomeCents: k.min_income_cents === null ? null : num(k.min_income_cents),
          maxIncomeCents: k.max_income_cents === null ? null : num(k.max_income_cents),
          pricePerLeadCents: num(k.price_per_lead_cents),
          dailyCap: k.daily_cap,
          monthlyBudgetCents: k.monthly_budget_cents === null ? null : num(k.monthly_budget_cents),
          webhookUrl: k.webhook_url,
          sent: num(k.sent),
        })),
    })),
  };
}

export async function create(ctx: Ctx, actor: string, input: z.infer<typeof partnerCreateSchema>) {
  try {
    const out = await createPartner(ctx, input as Parameters<typeof createPartner>[1]);
    await audit(ctx.db, actor, 'partner_created_admin', 'partner', out.partnerId, {});
    return out;
  } catch (e) {
    if (e instanceof Error && /partners_cnpj_key|partner_users_email_key|duplicate key/i.test(e.message)) throw new AppError(409, 'duplicate', 'Já existe um parceiro com este CNPJ ou e-mail.');
    throw e;
  }
}

export async function update(ctx: Ctx, actor: string, id: string, patch: z.infer<typeof partnerPatchSchema>) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [col, v] of [['legal_name', patch.legalName], ['category', patch.category], ['status', patch.status]] as const) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return { ok: true };
  const r = await ctx.db.query(`UPDATE app.partners SET ${sets.join(', ')} WHERE id = $1`, params);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'partner_updated', 'partner', id, { fields: Object.keys(patch) });
  return { ok: true };
}

/** Só exclui quem nunca recebeu contato; com histórico, o caminho é suspender (o registro de envios é auditoria). */
export async function remove(ctx: Ctx, actor: string, id: string) {
  await ctx.db.tx(async (q) => {
    const has = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.lead_deliveries WHERE partner_id = $1`, [id]);
    if (num(has.rows[0]?.n ?? 0) > 0) throw new AppError(409, 'has_history', 'Este parceiro já recebeu contatos. Suspenda em vez de excluir, para manter o histórico.');
    await q.query(`DELETE FROM app.partner_campaigns WHERE partner_id = $1`, [id]);
    await q.query(`DELETE FROM app.partner_users WHERE partner_id = $1`, [id]);
    const r = await q.query(`DELETE FROM app.partners WHERE id = $1`, [id]);
    if (!r.rowCount) throw notFound();
    await audit(q, actor, 'partner_deleted', 'partner', id, {});
  });
  return { ok: true };
}

/** Nova senha do portal do parceiro (aparece uma vez). */
export async function resetPassword(ctx: Ctx, actor: string, id: string) {
  const password = newToken().slice(0, 20);
  const r = await ctx.db.query(`UPDATE app.partner_users SET password_hash = $2 WHERE partner_id = $1`, [id, hashPassword(password)]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'partner_password_reset', 'partner', id, {});
  return { password };
}

export async function createCampaign(ctx: Ctx, actor: string, partnerId: string, c: z.infer<typeof campaignCreateSchema>) {
  assertPublicHttpsUrl(c.webhookUrl);
  const exists = await ctx.db.query(`SELECT 1 FROM app.partners WHERE id = $1`, [partnerId]);
  if (exists.rows.length === 0) throw notFound();
  const secret = newToken();
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, employment_types, ufs, min_income_cents, max_income_cents, price_per_lead_cents, daily_cap, monthly_budget_cents, webhook_url, webhook_secret_enc)
     VALUES ($1,$2,'active',$3,$4::text[],$5::char(2)[],$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [partnerId, c.name, c.consentCategory, c.employmentTypes, c.ufs, c.minIncomeCents ?? null, c.maxIncomeCents ?? null, c.pricePerLeadCents, c.dailyCap, c.monthlyBudgetCents ?? null, c.webhookUrl, encryptText(ctx.config.secret, secret)],
  );
  await audit(ctx.db, actor, 'campaign_created', 'campaign', r.rows[0]!.id, { partnerId });
  return { campaignId: r.rows[0]!.id, webhookSecret: secret };
}

export async function updateCampaign(ctx: Ctx, actor: string, id: string, patch: z.infer<typeof campaignPatchSchema>) {
  if (patch.webhookUrl) assertPublicHttpsUrl(patch.webhookUrl);
  const map: [string, unknown, string][] = [
    ['name', patch.name, ''], ['status', patch.status, ''], ['consent_category', patch.consentCategory, ''], ['employment_types', patch.employmentTypes, '::text[]'], ['ufs', patch.ufs, '::char(2)[]'],
    ['min_income_cents', patch.minIncomeCents, ''], ['max_income_cents', patch.maxIncomeCents, ''], ['price_per_lead_cents', patch.pricePerLeadCents, ''], ['daily_cap', patch.dailyCap, ''], ['monthly_budget_cents', patch.monthlyBudgetCents, ''], ['webhook_url', patch.webhookUrl, ''],
  ];
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [col, v, cast] of map) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  }
  if (!sets.length) return { ok: true };
  const r = await ctx.db.query(`UPDATE app.partner_campaigns SET ${sets.join(', ')} WHERE id = $1`, params);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_updated', 'campaign', id, { fields: Object.keys(patch) });
  return { ok: true };
}

export async function rotateWebhookSecret(ctx: Ctx, actor: string, id: string) {
  const secret = newToken();
  const r = await ctx.db.query(`UPDATE app.partner_campaigns SET webhook_secret_enc = $2 WHERE id = $1`, [id, encryptText(ctx.config.secret, secret)]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_secret_rotated', 'campaign', id, {});
  return { webhookSecret: secret };
}

export async function removeCampaign(ctx: Ctx, actor: string, id: string) {
  const has = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.lead_deliveries WHERE campaign_id = $1`, [id]);
  if (num(has.rows[0]?.n ?? 0) > 0) throw new AppError(409, 'has_history', 'Esta campanha já enviou contatos. Encerre em vez de excluir, para manter o histórico.');
  const r = await ctx.db.query(`DELETE FROM app.partner_campaigns WHERE id = $1`, [id]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_deleted', 'campaign', id, {});
  return { ok: true };
}
