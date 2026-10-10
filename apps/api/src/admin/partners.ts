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
  cnpj: z.string().regex(/^\d{14}$/).optional(),
  /** E-mail de acesso ao portal do parceiro (o login do primeiro usuário). A senha não muda. */
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  tradeName: z.string().trim().min(2).max(120).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  uf: z.string().length(2).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(),
});
export const campaignCreateSchema = campaignFields;
export const campaignPatchSchema = campaignFields.partial().extend({ webhookUrl: z.string().url().max(500).nullable().optional(), status: z.enum(['active', 'paused', 'ended']).optional(), monthlyBudgetCents: z.number().int().positive().nullable().optional(), minIncomeCents: z.number().int().nonnegative().nullable().optional(), maxIncomeCents: z.number().int().nonnegative().nullable().optional() }).strict();

const iso = (d: unknown): string => new Date(d as string).toISOString();

export async function listPartners(ctx: Ctx) {
  const p = await ctx.db.query<{ id: string; legal_name: string; trade_name: string | null; phone: string | null; city: string | null; uf: string | null; cnpj: string; category: string; status: string; created_at: Date; email: string | null; sent: string; contacts: string; deals_n: string; deals_cents: string; due: string; paid: string }>(
    `SELECT p.id, p.legal_name, p.trade_name, p.phone, p.city, p.uf, p.cnpj, p.category, p.status, p.created_at,
            (SELECT count(*) FROM app.partner_deals d WHERE d.partner_id = p.id AND d.origin = 'folego' AND d.status = 'fechado')::text AS deals_n,
            (SELECT coalesce(sum(d.amount_cents),0) FROM app.partner_deals d WHERE d.partner_id = p.id AND d.origin = 'folego' AND d.status = 'fechado')::text AS deals_cents,
            (SELECT coalesce(sum(d.commission_cents),0) FROM app.partner_deals d WHERE d.partner_id = p.id AND d.commission_status = 'a_receber')::text AS due,
            (SELECT coalesce(sum(d.commission_cents),0) FROM app.partner_deals d WHERE d.partner_id = p.id AND d.commission_status = 'recebida')::text AS paid,
            (SELECT u.email::text FROM app.partner_users u WHERE u.partner_id = p.id ORDER BY u.created_at LIMIT 1) AS email,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.partner_id = p.id)::text AS sent,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.partner_id = p.id AND d.status IN ('contacted','converted'))::text AS contacts
       FROM app.partners p ORDER BY p.legal_name`,
  );
  const c = await ctx.db.query<{ id: string; partner_id: string; name: string; status: string; consent_category: string; employment_types: string[]; ufs: string[]; min_income_cents: string | null; max_income_cents: string | null; price_per_lead_cents: string; commission_bps: number; daily_cap: number; monthly_budget_cents: string | null; webhook_url: string | null; sent: string }>(
    `SELECT c.id, c.partner_id, c.name, c.status, c.consent_category, c.employment_types, c.ufs::text[] AS ufs, c.min_income_cents, c.max_income_cents, c.price_per_lead_cents, c.commission_bps, c.daily_cap, c.monthly_budget_cents, c.webhook_url,
            (SELECT count(*) FROM app.lead_deliveries d WHERE d.campaign_id = c.id)::text AS sent
       FROM app.partner_campaigns c ORDER BY c.created_at`,
  );
  return {
    partners: p.rows.map((x) => ({
      id: x.id,
      legalName: x.legal_name,
      tradeName: x.trade_name,
      phone: x.phone,
      city: x.city,
      uf: x.uf,
      deals: { count: num(x.deals_n), volumeCents: num(x.deals_cents), commissionDueCents: num(x.due), commissionPaidCents: num(x.paid) },
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
          commissionBps: k.commission_bps,
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
  try {
    if (patch.email) {
      // O portal tem um login por parceiro (o primeiro usuário). Trocar o e-mail muda o login; a senha continua a mesma.
      const u = await ctx.db.query(`UPDATE app.partner_users SET email = $2 WHERE id = (SELECT id FROM app.partner_users WHERE partner_id = $1 ORDER BY created_at LIMIT 1)`, [id, patch.email]);
      if (!u.rowCount) throw new AppError(409, 'no_user', 'Este parceiro ainda não tem acesso ao portal. Gere uma senha primeiro.');
    }
    if (patch.cnpj) {
      const c = await ctx.db.query(`UPDATE app.partners SET cnpj = $2 WHERE id = $1`, [id, patch.cnpj]);
      if (!c.rowCount) throw notFound();
    }
  } catch (e) {
    if (e instanceof Error && /duplicate key/i.test(e.message)) throw new AppError(409, 'duplicate', 'Já existe um parceiro com este CNPJ ou e-mail.');
    throw e;
  }
  for (const [col, v] of [['legal_name', patch.legalName], ['category', patch.category], ['status', patch.status], ['trade_name', patch.tradeName], ['phone', patch.phone], ['city', patch.city], ['uf', patch.uf], ['address', patch.address]] as const) {
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
  if (c.webhookUrl) assertPublicHttpsUrl(c.webhookUrl);
  const exists = await ctx.db.query(`SELECT 1 FROM app.partners WHERE id = $1`, [partnerId]);
  if (exists.rows.length === 0) throw notFound();
  const secret = newToken();
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, employment_types, ufs, min_income_cents, max_income_cents, price_per_lead_cents, commission_bps, daily_cap, monthly_budget_cents, webhook_url, webhook_secret_enc)
     VALUES ($1,$2,'active',$3,$4::text[],$5::char(2)[],$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [partnerId, c.name, c.consentCategory, c.employmentTypes, c.ufs, c.minIncomeCents ?? null, c.maxIncomeCents ?? null, c.pricePerLeadCents, c.commissionBps ?? 0, c.dailyCap, c.monthlyBudgetCents ?? null, c.webhookUrl ?? null, c.webhookUrl ? encryptText(ctx.config.secret, secret) : null],
  );
  await audit(ctx.db, actor, 'campaign_created', 'campaign', r.rows[0]!.id, { partnerId });
  return { campaignId: r.rows[0]!.id, webhookSecret: c.webhookUrl ? secret : null };
}

export async function updateCampaign(ctx: Ctx, actor: string, id: string, patch: z.infer<typeof campaignPatchSchema>) {
  if (patch.webhookUrl) assertPublicHttpsUrl(patch.webhookUrl);
  const map: [string, unknown, string][] = [
    ['name', patch.name, ''], ['status', patch.status, ''], ['consent_category', patch.consentCategory, ''], ['employment_types', patch.employmentTypes, '::text[]'], ['ufs', patch.ufs, '::char(2)[]'],
    ['min_income_cents', patch.minIncomeCents, ''], ['max_income_cents', patch.maxIncomeCents, ''], ['price_per_lead_cents', patch.pricePerLeadCents, ''], ['commission_bps', patch.commissionBps, ''], ['daily_cap', patch.dailyCap, ''], ['monthly_budget_cents', patch.monthlyBudgetCents, ''], ['webhook_url', patch.webhookUrl, ''],
  ];
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [col, v, cast] of map) {
    if (v === undefined) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}${cast}`);
  }
  // Campanha que era só de portal e ganhou um webhook agora precisa de um segredo para assinar os envios.
  let newSecret: string | null = null;
  if (patch.webhookUrl) {
    const had = await ctx.db.query<{ s: boolean }>(`SELECT webhook_secret_enc IS NOT NULL AS s FROM app.partner_campaigns WHERE id = $1`, [id]);
    if (had.rows[0] && !had.rows[0].s) {
      newSecret = newToken();
      params.push(encryptText(ctx.config.secret, newSecret));
      sets.push(`webhook_secret_enc = $${params.length}`);
    }
  }
  if (!sets.length) return { ok: true, webhookSecret: null };
  const r = await ctx.db.query(`UPDATE app.partner_campaigns SET ${sets.join(', ')} WHERE id = $1`, params);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_updated', 'campaign', id, { fields: Object.keys(patch) });
  return { ok: true, webhookSecret: newSecret };
}

export async function rotateWebhookSecret(ctx: Ctx, actor: string, id: string) {
  const secret = newToken();
  const r = await ctx.db.query(`UPDATE app.partner_campaigns SET webhook_secret_enc = $2 WHERE id = $1`, [id, encryptText(ctx.config.secret, secret)]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_secret_rotated', 'campaign', id, {});
  return { webhookSecret: secret };
}

/** Contratos fechados por um parceiro a partir dos contatos do Fôlego (os que valem comissão) e a situação da comissão de cada um. */
export async function partnerDeals(ctx: Ctx, partnerId: string) {
  const r = await ctx.db.query<{ id: string; client_name: string | null; product: string; amount_cents: string; signed_on: Date | string; commission_bps: number; commission_cents: string; commission_status: string; received_on: Date | string | null; status: string; campaign: string | null }>(
    `SELECT d.id, d.client_name, d.product, d.amount_cents::text, d.signed_on, d.commission_bps, d.commission_cents::text, d.commission_status, d.received_on, d.status,
            (SELECT c.name FROM app.lead_deliveries l JOIN app.partner_campaigns c ON c.id = l.campaign_id WHERE l.id = d.delivery_id) AS campaign
       FROM app.partner_deals d WHERE d.partner_id = $1 AND d.origin = 'folego' ORDER BY d.signed_on DESC, d.created_at DESC LIMIT 300`,
    [partnerId],
  );
  const day = (v: unknown) => new Date(v as string).toISOString().slice(0, 10);
  return {
    deals: r.rows.map((x) => ({ id: x.id, clientName: x.client_name, product: x.product, amountCents: num(x.amount_cents), signedOn: day(x.signed_on), commissionBps: x.commission_bps, commissionCents: num(x.commission_cents), commissionStatus: x.commission_status, receivedOn: x.received_on ? day(x.received_on) : null, status: x.status, campaign: x.campaign })),
  };
}

export const commissionStatusSchema = z.strictObject({ status: z.enum(['a_receber', 'recebida']), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Baixa (ou desfaz a baixa) da comissão de um contrato: o Fôlego marca quando o parceiro pagou. */
export async function setCommissionStatus(ctx: Ctx, actor: string, dealId: string, input: z.infer<typeof commissionStatusSchema>) {
  const r = await ctx.db.query(
    `UPDATE app.partner_deals SET commission_status = $2, received_on = CASE WHEN $2 = 'recebida' THEN coalesce($3::date, current_date) ELSE NULL END
      WHERE id = $1 AND origin = 'folego' AND status = 'fechado' AND commission_cents > 0`,
    [dealId, input.status, input.receivedOn ?? null],
  );
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'partner_commission_status', 'partner_deal', dealId, { status: input.status });
  return { ok: true };
}

export async function removeCampaign(ctx: Ctx, actor: string, id: string) {
  const has = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.lead_deliveries WHERE campaign_id = $1`, [id]);
  if (num(has.rows[0]?.n ?? 0) > 0) throw new AppError(409, 'has_history', 'Esta campanha já enviou contatos. Encerre em vez de excluir, para manter o histórico.');
  const r = await ctx.db.query(`DELETE FROM app.partner_campaigns WHERE id = $1`, [id]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, actor, 'campaign_deleted', 'campaign', id, {});
  return { ok: true };
}
