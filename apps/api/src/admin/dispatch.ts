// Parcerias: envio MANUAL de contatos autorizados aos parceiros e gestão do que já foi enviado.
// O contato (nome, telefone) nunca aparece no backoffice: o envio cria uma entrega na fila e o worker manda ao webhook do parceiro
// (que também a vê no portal dele). A regra UNIQUE (caso, parceiro) garante que o mesmo contato nunca vai duas vezes ao mesmo parceiro.
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import { MAX_PARTNERS_PER_LEAD } from '../leads.ts';

const iso = (d: unknown): string => new Date(d as string).toISOString();
export const MAX_BATCH = 100;
const PAGE = 25;

export type SentFilter = 'todos' | 'nao_enviados' | 'enviados';

/** Parceiros ativos e as campanhas ativas deles (destinos possíveis do envio manual). */
export async function dispatchTargets(ctx: Ctx) {
  const r = await ctx.db.query<{ partner_id: string; legal_name: string; category: string; campaign_id: string; campaign: string; consent_category: string; price: string }>(
    `SELECT p.id AS partner_id, p.legal_name, p.category, c.id AS campaign_id, c.name AS campaign, c.consent_category, c.price_per_lead_cents::text AS price
       FROM app.partners p JOIN app.partner_campaigns c ON c.partner_id = p.id AND c.status = 'active'
      WHERE p.status = 'active' ORDER BY p.legal_name, c.name`,
  );
  const map = new Map<string, { partnerId: string; name: string; category: string; campaigns: { id: string; name: string; consentCategory: string; priceCents: number }[] }>();
  for (const x of r.rows) {
    const p = map.get(x.partner_id) ?? { partnerId: x.partner_id, name: x.legal_name, category: x.category, campaigns: [] };
    p.campaigns.push({ id: x.campaign_id, name: x.campaign, consentCategory: x.consent_category, priceCents: num(x.price) });
    map.set(x.partner_id, p);
  }
  return { partners: [...map.values()] };
}

/** Contatos com autorização ativa, com "enviado a quem" em cada linha e filtros de envio. */
export async function contactsWithDispatch(ctx: Ctx, o: { category?: string | undefined; filter?: SentFilter | undefined; partnerId?: string | undefined; page?: number | undefined }) {
  const page = Math.max(0, Math.floor(o.page ?? 0));
  const params: unknown[] = [];
  const where: string[] = [`v.purpose = 'lead_sharing'`, `v.action = 'grant'`];
  if (o.category) {
    params.push(o.category);
    where.push(`v.scope->'categories' ? $${params.length}`);
  }
  if (o.partnerId) {
    params.push(o.partnerId);
    if (o.filter === 'nao_enviados') where.push(`NOT EXISTS (SELECT 1 FROM app.lead_deliveries d WHERE d.case_id = v.case_id AND d.partner_id = $${params.length})`);
    else if (o.filter === 'enviados') where.push(`EXISTS (SELECT 1 FROM app.lead_deliveries d WHERE d.case_id = v.case_id AND d.partner_id = $${params.length})`);
  } else if (o.filter === 'nao_enviados') where.push(`NOT EXISTS (SELECT 1 FROM app.lead_deliveries d WHERE d.case_id = v.case_id)`);
  else if (o.filter === 'enviados') where.push(`EXISTS (SELECT 1 FROM app.lead_deliveries d WHERE d.case_id = v.case_id)`);
  const base = `FROM app.v_current_consents v JOIN app.cases c ON c.id = v.case_id JOIN app.lead_contacts l ON l.case_id = v.case_id WHERE ${where.join(' AND ')}`;
  const total = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n ${base}`, params);
  const r = await ctx.db.query<{ case_id: string; created_at: Date; scope: { categories?: string[] }; uf: string | null; employment_type: string | null; net_income_cents: string | null; debt_total_cents: string | null; has_overdue: boolean | null; sent: { partnerId: string; partner: string; status: string; at: string }[] | null }>(
    `SELECT v.case_id, v.created_at, v.scope, c.uf::text AS uf, c.employment_type, c.net_income_cents, c.debt_total_cents, c.has_overdue,
            (SELECT json_agg(json_build_object('partnerId', p.id, 'partner', p.legal_name, 'status', d.status, 'at', d.created_at) ORDER BY d.created_at)
               FROM app.lead_deliveries d JOIN app.partners p ON p.id = d.partner_id WHERE d.case_id = v.case_id) AS sent
       ${base} ORDER BY v.created_at DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  return {
    total: num(total.rows[0]?.n ?? 0),
    pageSize: PAGE,
    items: r.rows.map((x) => ({
      caseId: x.case_id,
      consentedAt: iso(x.created_at),
      categories: x.scope.categories ?? [],
      uf: x.uf,
      employment: x.employment_type,
      netIncomeCents: x.net_income_cents === null ? null : num(x.net_income_cents),
      debtTotalCents: x.debt_total_cents === null ? null : num(x.debt_total_cents),
      hasOverdue: Boolean(x.has_overdue),
      sent: x.sent ?? [],
    })),
  };
}

export interface DispatchResult {
  queued: number;
  skipped: { alreadySent: number; noConsent: number; noContact: number; leadLimit: number };
}

/** Coloca contatos selecionados na fila de um parceiro/campanha. Nunca repete o mesmo contato ao mesmo parceiro. */
export async function dispatchContacts(ctx: Ctx, adminId: string, args: { partnerId: string; campaignId: string; caseIds: string[] }): Promise<DispatchResult> {
  if (!ctx.config.leadsEnabled) throw new AppError(409, 'leads_off', 'As propostas de parceiros estão desligadas em Configurações.');
  const caseIds = [...new Set(args.caseIds)];
  if (caseIds.length === 0 || caseIds.length > MAX_BATCH) throw new AppError(422, 'invalid_batch', `Escolha de 1 a ${MAX_BATCH} contatos por envio.`);
  const camp = await ctx.db.query<{ consent_category: string; price: string; pstatus: string }>(
    `SELECT c.consent_category, c.price_per_lead_cents::text AS price, p.status AS pstatus FROM app.partner_campaigns c JOIN app.partners p ON p.id = c.partner_id
      WHERE c.id = $1 AND c.partner_id = $2 AND c.status = 'active'`,
    [args.campaignId, args.partnerId],
  );
  const c = camp.rows[0];
  if (!c || c.pstatus !== 'active') throw notFound();
  const result: DispatchResult = { queued: 0, skipped: { alreadySent: 0, noConsent: 0, noContact: 0, leadLimit: 0 } };
  await ctx.db.tx(async (q) => {
    for (const caseId of caseIds) {
      // consentimento vigente que cobre a categoria da campanha (revogado ou de outra categoria não serve)
      const consent = await q.query<{ id: string; action: string; scope: { categories?: string[] } }>(
        `SELECT id, action, scope FROM app.consents WHERE case_id = $1 AND purpose = 'lead_sharing' ORDER BY created_at DESC, id DESC LIMIT 1`,
        [caseId],
      );
      const cs = consent.rows[0];
      if (!cs || cs.action !== 'grant' || !(cs.scope.categories ?? []).includes(c.consent_category)) {
        result.skipped.noConsent += 1;
        continue;
      }
      const contact = await q.query(`SELECT 1 FROM app.lead_contacts WHERE case_id = $1`, [caseId]);
      if (contact.rows.length === 0) {
        result.skipped.noContact += 1;
        continue;
      }
      await q.query(`SELECT 1 FROM app.lead_profiles WHERE case_id = $1 FOR UPDATE`, [caseId]); // trava para o limite de parceiros por contato
      const have = await q.query<{ n: string; same: string }>(`SELECT count(*)::text AS n, count(*) FILTER (WHERE partner_id = $2)::text AS same FROM app.lead_deliveries WHERE case_id = $1 AND status <> 'rejected'`, [caseId, args.partnerId]);
      if (num(have.rows[0]?.same ?? 0) > 0) {
        result.skipped.alreadySent += 1;
        continue;
      }
      if (num(have.rows[0]?.n ?? 0) >= MAX_PARTNERS_PER_LEAD) {
        result.skipped.leadLimit += 1;
        continue;
      }
      const ins = await q.query(
        `INSERT INTO app.lead_deliveries(case_id, partner_id, campaign_id, consent_id, price_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (case_id, partner_id) DO NOTHING`,
        [caseId, args.partnerId, args.campaignId, cs.id, num(c.price)],
      );
      if ((ins.rowCount ?? 0) > 0) result.queued += 1;
      else result.skipped.alreadySent += 1;
    }
    await audit(q, `admin:${adminId}`, 'admin_leads_dispatched', 'partner', args.partnerId, { campaign: args.campaignId, requested: caseIds.length, ...result.skipped, queued: result.queued });
  });
  return result;
}

/** Acompanhamento do que já foi enviado: situação por parceiro, sem dados de contato. */
export async function deliveriesOverview(ctx: Ctx, o: { partnerId?: string | undefined; status?: string | undefined; page?: number | undefined }) {
  const page = Math.max(0, Math.floor(o.page ?? 0));
  const params: unknown[] = [];
  const where: string[] = ['TRUE'];
  if (o.partnerId) {
    params.push(o.partnerId);
    where.push(`d.partner_id = $${params.length}`);
  }
  if (o.status) {
    params.push(o.status);
    where.push(`d.status = $${params.length}`);
  }
  const sum = await ctx.db.query<{ status: string; n: string; cents: string }>(`SELECT d.status, count(*)::text AS n, coalesce(sum(d.price_cents), 0)::text AS cents FROM app.lead_deliveries d WHERE ${where.join(' AND ')} GROUP BY d.status`, params);
  const rows = await ctx.db.query<{ id: string; case_id: string; status: string; created_at: Date; delivered_at: Date | null; attempts: number; last_response_code: number | null; price_cents: string; partner: string; campaign: string; category: string; uf: string | null; employment: string | null }>(
    `SELECT d.id, d.case_id, d.status, d.created_at, d.delivered_at, d.attempts, d.last_response_code, d.price_cents, p.legal_name AS partner, c.name AS campaign, c.consent_category AS category,
            lp.uf, lp.employment_type AS employment
       FROM app.lead_deliveries d JOIN app.partners p ON p.id = d.partner_id JOIN app.partner_campaigns c ON c.id = d.campaign_id LEFT JOIN app.lead_profiles lp ON lp.case_id = d.case_id
      WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  return {
    summary: sum.rows.map((x) => ({ status: x.status, count: num(x.n), cents: num(x.cents) })),
    items: rows.rows.map((x) => ({
      id: x.id, caseId: x.case_id, status: x.status, createdAt: iso(x.created_at), deliveredAt: x.delivered_at ? iso(x.delivered_at) : null, attempts: x.attempts, lastCode: x.last_response_code,
      priceCents: num(x.price_cents), partner: x.partner, campaign: x.campaign, category: x.category, uf: x.uf, employment: x.employment,
    })),
  };
}

/** Falhou? Volta para a fila (o worker tenta de novo). Na fila e ainda não enviado? Cancela (some da fila e libera para outro parceiro). */
export async function deliveryAction(ctx: Ctx, adminId: string, id: string, action: 'retry' | 'cancel'): Promise<void> {
  if (action === 'retry') {
    const r = await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'queued', attempts = 0, next_attempt_at = NULL WHERE id = $1 AND status = 'failed'`, [id]);
    if ((r.rowCount ?? 0) === 0) throw new AppError(409, 'not_failed', 'Só dá para reenviar uma entrega que falhou.');
  } else {
    // apaga a entrega que nunca saiu: o contato fica livre para ser enviado de novo (a trava de repetição só vale para o que foi enviado)
    const r = await ctx.db.query(`DELETE FROM app.lead_deliveries WHERE id = $1 AND status IN ('queued','failed')`, [id]);
    if ((r.rowCount ?? 0) === 0) throw new AppError(409, 'already_sent', 'Esta entrega já foi enviada ao parceiro e não pode ser cancelada.');
  }
  await audit(ctx.db, `admin:${adminId}`, action === 'retry' ? 'admin_lead_retry' : 'admin_lead_cancel', 'lead_delivery', id);
}
