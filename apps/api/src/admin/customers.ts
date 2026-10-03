// Cadastro de clientes no backoffice: assinantes (têm e-mail) e compradores avulsos (anônimos, identificados pelo caso).
// Dados pessoais de contato ficam criptografados e só aparecem com permissão específica, e cada visualização é auditada.
import { decryptText } from '../crypto.ts';
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import { SUB_STATUS_SQL } from './metrics.ts';
import type { AdminUser } from './auth.ts';
import { can } from './auth.ts';
import { subscriberReferralView } from '../referrals.ts';

const PAGE = 40;
const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

// ---------------------------------------------------------------------------
// Assinantes e assinaturas
// ---------------------------------------------------------------------------
export interface SubscriberRow {
  id: string;
  email: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  plan: string | null;
  status: string;
  periodEnd: string | null;
  daysLeft: number | null;
  cancelAtPeriodEnd: boolean;
  paidCents: number;
  paidOrders: number;
}

export async function listSubscribers(ctx: Ctx, opts: { status?: string; q?: string; page?: number }): Promise<{ total: number; page: number; pageSize: number; items: SubscriberRow[]; counts: Record<string, number> }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const params: unknown[] = [];
  const where: string[] = [`b.deleted_at IS NULL`];
  if (opts.q && opts.q.trim()) {
    params.push(`%${opts.q.trim().toLowerCase().replace(/[%_]/g, '')}%`);
    where.push(`b.email::text ILIKE $${params.length}`);
  }
  const base = `FROM app.subscribers b
       LEFT JOIN app.subscriptions s ON s.subscriber_id = b.id
       LEFT JOIN (SELECT subscriber_id, sum(total_cents) AS paid, count(*) AS n FROM app.orders WHERE status = 'paid' AND subscriber_id IS NOT NULL GROUP BY 1) o ON o.subscriber_id = b.id
      WHERE ${where.join(' AND ')}`;
  const counts = await ctx.db.query<{ status: string; n: string }>(`SELECT ${SUB_STATUS_SQL} AS status, count(*) AS n ${base} GROUP BY 1`, params);
  const countMap: Record<string, number> = Object.fromEntries(counts.rows.map((c) => [c.status, num(c.n)]));
  const filter = opts.status && opts.status !== 'todos' ? ` AND ${SUB_STATUS_SQL} = $${params.length + 1}` : '';
  const listParams = opts.status && opts.status !== 'todos' ? [...params, opts.status] : params;
  const total = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n ${base}${filter}`, listParams);
  const r = await ctx.db.query<{
    id: string; email: string; created_at: Date; last_login_at: Date | null; plan: string | null; status: string; period_end: Date | null;
    cancel: boolean | null; paid: string | null; n: string | null;
  }>(
    `SELECT b.id, b.email::text AS email, b.created_at, b.last_login_at, s.plan, ${SUB_STATUS_SQL} AS status, s.current_period_end AS period_end,
            s.cancel_at_period_end AS cancel, o.paid, o.n
       ${base}${filter}
      ORDER BY (CASE WHEN ${SUB_STATUS_SQL} = 'em_debito' THEN 0 WHEN ${SUB_STATUS_SQL} = 'vencendo' THEN 1 ELSE 2 END), s.current_period_end NULLS LAST, b.created_at DESC
      LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    listParams,
  );
  return {
    total: num(total.rows[0]?.n ?? 0),
    page,
    pageSize: PAGE,
    counts: countMap,
    items: r.rows.map((x) => ({
      id: x.id,
      email: x.email,
      createdAt: iso(x.created_at),
      lastLoginAt: iso(x.last_login_at),
      plan: x.plan,
      status: x.status,
      periodEnd: iso(x.period_end),
      daysLeft: x.period_end ? Math.ceil((new Date(x.period_end).getTime() - Date.now()) / 86_400_000) : null,
      cancelAtPeriodEnd: Boolean(x.cancel),
      paidCents: num(x.paid ?? 0),
      paidOrders: num(x.n ?? 0),
    })),
  };
}

export async function subscriberDetail(ctx: Ctx, id: string) {
  const s = await ctx.db.query<{ id: string; email: string; created_at: Date; last_login_at: Date | null; plan: string | null; status: string; period_end: Date | null; cancel: boolean | null }>(
    `SELECT b.id, b.email::text AS email, b.created_at, b.last_login_at, s.plan, ${SUB_STATUS_SQL} AS status, s.current_period_end AS period_end, s.cancel_at_period_end AS cancel
       FROM app.subscribers b LEFT JOIN app.subscriptions s ON s.subscriber_id = b.id WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [id],
  );
  const row = s.rows[0];
  if (!row) throw notFound();
  const orders = await ctx.db.query<{ id: string; status: string; total_cents: string; created_at: Date; paid_at: Date | null; product: string; list_cents: string | null; method: string | null; credit_pct: number | null }>(
    `SELECT o.id, o.status, o.total_cents, o.created_at, o.paid_at, (SELECT string_agg(product_code, ', ') FROM app.order_items WHERE order_id = o.id) AS product,
            (SELECT sum(unit_price_cents) FROM app.order_items WHERE order_id = o.id)::text AS list_cents,
            (SELECT method FROM app.payments WHERE order_id = o.id ORDER BY created_at LIMIT 1) AS method,
            (SELECT c.percent FROM app.referral_credits c JOIN app.payments p ON p.id = c.applied_payment_id WHERE p.order_id = o.id LIMIT 1) AS credit_pct
       FROM app.orders o WHERE o.subscriber_id = $1 ORDER BY o.created_at DESC LIMIT 50`,
    [id],
  );
  const use = await ctx.db.query<{ entries: string; goals: string; contributions: string; last_entry: Date | null }>(
    `SELECT (SELECT count(*) FROM app.ledger_entries WHERE subscriber_id = $1) AS entries,
            (SELECT count(*) FROM app.goals WHERE subscriber_id = $1) AS goals,
            (SELECT count(*) FROM app.goal_contributions WHERE subscriber_id = $1) AS contributions,
            (SELECT max(created_at) FROM app.ledger_entries WHERE subscriber_id = $1) AS last_entry`,
    [id],
  );
  const audits = await ctx.db.query<{ occurred_at: Date; actor: string; action: string; data: Record<string, unknown> }>(
    `SELECT occurred_at, actor, action, data FROM app.audit_log WHERE entity = 'subscriber' AND entity_id = $1 ORDER BY id DESC LIMIT 30`,
    [id],
  );
  const u = use.rows[0];
  return {
    id: row.id,
    email: row.email,
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
    plan: row.plan,
    status: row.status,
    periodEnd: iso(row.period_end),
    cancelAtPeriodEnd: Boolean(row.cancel),
    orders: orders.rows.map((o) => ({ id: o.id, status: o.status, totalCents: num(o.total_cents), createdAt: iso(o.created_at), paidAt: iso(o.paid_at), product: o.product, method: o.method, listCents: o.list_cents === null ? null : num(o.list_cents), discountCents: o.list_cents === null ? 0 : Math.max(0, num(o.list_cents) - num(o.total_cents)), creditPercent: o.credit_pct })),
    referral: await subscriberReferralView(ctx, id),
    usage: { entries: num(u?.entries ?? 0), goals: num(u?.goals ?? 0), contributions: num(u?.contributions ?? 0), lastEntryAt: iso(u?.last_entry) },
    history: audits.rows.map((a) => ({ at: iso(a.occurred_at), actor: a.actor, action: a.action, data: a.data })),
  };
}

const PLAN_CODES = ['controle', 'ousado', 'desbravador'];

/** Ações manuais sobre uma assinatura (cortesia, correção, cancelamento). Tudo vai para a auditoria com o motivo. */
export async function subscriptionAction(ctx: Ctx, admin: AdminUser, subscriberId: string, action: { type: 'extend'; days: number; reason: string } | { type: 'set_plan'; plan: string; reason: string } | { type: 'cancel'; cancel: boolean; reason: string }): Promise<void> {
  await ctx.db.tx(async (q) => {
    const exists = await q.query(`SELECT 1 FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [subscriberId]);
    if (exists.rows.length === 0) throw notFound();
    if (action.type === 'extend') {
      if (!Number.isInteger(action.days) || action.days < 1 || action.days > 365) throw new AppError(422, 'invalid_days', 'Informe de 1 a 365 dias.');
      const plan = await q.query<{ plan: string }>(`SELECT plan FROM app.subscriptions WHERE subscriber_id = $1`, [subscriberId]);
      if (!plan.rows[0]) throw new AppError(422, 'no_subscription', 'Este cadastro ainda não tem assinatura. Use "Definir plano".');
      await q.query(
        `UPDATE app.subscriptions SET status = 'active', reminded_at = NULL,
                current_period_end = GREATEST(current_period_end, now()) + make_interval(days => $2) WHERE subscriber_id = $1`,
        [subscriberId, action.days],
      );
    } else if (action.type === 'set_plan') {
      if (!PLAN_CODES.includes(action.plan)) throw new AppError(422, 'invalid_plan', 'Plano inválido.');
      await q.query(
        `INSERT INTO app.subscriptions(subscriber_id, plan, status, current_period_end) VALUES ($1, $2, 'active', now() + interval '30 days')
         ON CONFLICT (subscriber_id) DO UPDATE SET plan = EXCLUDED.plan`,
        [subscriberId, action.plan],
      );
    } else {
      const r = await q.query(`UPDATE app.subscriptions SET cancel_at_period_end = $2 WHERE subscriber_id = $1`, [subscriberId, action.cancel]);
      if (r.rowCount === 0) throw new AppError(422, 'no_subscription', 'Este cadastro ainda não tem assinatura.');
    }
    await audit(q, `admin:${admin.id}`, `admin_subscription_${action.type}`, 'subscriber', subscriberId, { ...action, by: admin.email });
  });
}

// ---------------------------------------------------------------------------
// Compradores avulsos (casos)
// ---------------------------------------------------------------------------
export interface CaseRow {
  id: string;
  createdAt: string | null;
  kind: string;
  uf: string | null;
  employment: string | null;
  ageBand: string | null;
  netIncomeCents: number | null;
  debtTotalCents: number | null;
  debtCount: number | null;
  hasOverdue: boolean;
  status: string;
  paidCents: number;
  products: string[];
  lastOrderAt: string | null;
  leadConsent: boolean;
}

export async function listCases(ctx: Ctx, opts: { filter?: string; q?: string; page?: number; kind?: string }): Promise<{ total: number; page: number; pageSize: number; items: CaseRow[] }> {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.kind === 'translator') where.push(`c.product_kind = 'translator'`);
  else if (opts.kind !== 'todos') where.push(`c.product_kind = 'map'`);
  if (opts.filter === 'pagaram') where.push(`t.paid > 0`);
  if (opts.filter === 'nao_pagaram') where.push(`coalesce(t.paid,0) = 0`);
  if (opts.filter === 'abandonaram_checkout') where.push(`coalesce(t.paid,0) = 0 AND t.orders > 0`);
  if (opts.q && opts.q.trim()) {
    params.push(`${opts.q.trim().toLowerCase().replace(/[^a-f0-9-]/g, '')}%`);
    where.push(`c.id::text LIKE $${params.length}`);
  }
  const from = `FROM app.cases c
      LEFT JOIN (SELECT o.case_id, sum(o.total_cents) FILTER (WHERE o.status = 'paid') AS paid, count(*) AS orders, max(o.created_at) AS last_order
                   FROM app.orders o WHERE o.case_id IS NOT NULL GROUP BY 1) t ON t.case_id = c.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const total = await ctx.db.query<{ n: string }>(`SELECT count(*) AS n ${from}`, params);
  const r = await ctx.db.query<{
    id: string; created_at: Date; product_kind: string; uf: string | null; employment_type: string | null; age_band: string | null; net_income_cents: string | null;
    debt_total_cents: string | null; debt_count: number | null; has_overdue: boolean | null; status: string; paid: string | null; last_order: Date | null; products: string[] | null; consent: boolean;
  }>(
    `SELECT c.id, c.created_at, c.product_kind, c.uf::text AS uf, c.employment_type, c.age_band, c.net_income_cents, c.debt_total_cents, c.debt_count, c.has_overdue, c.status,
            t.paid, t.last_order,
            (SELECT array_agg(DISTINCT i.product_code) FROM app.order_items i JOIN app.orders o ON o.id = i.order_id WHERE o.case_id = c.id AND o.status = 'paid') AS products,
            EXISTS (SELECT 1 FROM app.v_current_consents v WHERE v.case_id = c.id AND v.purpose = 'lead_sharing' AND v.action = 'grant') AS consent
       ${from} ORDER BY c.created_at DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  return {
    total: num(total.rows[0]?.n ?? 0),
    page,
    pageSize: PAGE,
    items: r.rows.map((x) => ({
      id: x.id,
      createdAt: iso(x.created_at),
      kind: x.product_kind,
      uf: x.uf,
      employment: x.employment_type,
      ageBand: x.age_band,
      netIncomeCents: x.net_income_cents === null ? null : num(x.net_income_cents),
      debtTotalCents: x.debt_total_cents === null ? null : num(x.debt_total_cents),
      debtCount: x.debt_count,
      hasOverdue: Boolean(x.has_overdue),
      status: x.status,
      paidCents: num(x.paid ?? 0),
      products: x.products ?? [],
      lastOrderAt: iso(x.last_order),
      leadConsent: x.consent,
    })),
  };
}

export async function caseDetail(ctx: Ctx, id: string) {
  const c = await ctx.db.query<{
    id: string; session_id: string; created_at: Date; status: string; product_kind: string; uf: string | null; employment_type: string | null; age_band: string | null;
    net_income_cents: string | null; fixed_expenses_cents: string | null; debt_total_cents: string | null; debt_count: number | null; has_overdue: boolean | null; debt_kinds: string[]; purge_after: Date;
  }>(
    `SELECT id, session_id, created_at, status, product_kind, uf::text AS uf, employment_type, age_band, net_income_cents, fixed_expenses_cents, debt_total_cents, debt_count, has_overdue, debt_kinds, purge_after
       FROM app.cases WHERE id = $1`,
    [id],
  );
  const row = c.rows[0];
  if (!row) throw notFound();
  const orders = await ctx.db.query<{ id: string; status: string; total_cents: string; created_at: Date; paid_at: Date | null; items: string; method: string | null; provider: string | null }>(
    `SELECT o.id, o.status, o.total_cents, o.created_at, o.paid_at,
            (SELECT string_agg(product_code || ' (' || unit_price_cents || ')', ', ') FROM app.order_items WHERE order_id = o.id) AS items,
            (SELECT method FROM app.payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS method,
            (SELECT provider FROM app.payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS provider
       FROM app.orders o WHERE o.case_id = $1 ORDER BY o.created_at`,
    [id],
  );
  const deliverables = await ctx.db.query<{ product_code: string; status: string; generation_meta: Record<string, unknown> | null; generated_at: Date | null }>(
    `SELECT product_code, status, generation_meta, generated_at FROM app.deliverables WHERE case_id = $1 ORDER BY created_at`,
    [id],
  );
  const consent = await ctx.db.query<{ action: string; scope: { categories?: string[] }; created_at: Date }>(`SELECT action, scope, created_at FROM app.v_current_consents WHERE case_id = $1 AND purpose = 'lead_sharing'`, [id]);
  const contact = await ctx.db.query(`SELECT 1 FROM app.lead_contacts WHERE case_id = $1`, [id]);
  const interview = await ctx.db.query<{ hours_band: string; mode: string; has_vehicle: boolean; capital_cents: string; created_at: Date }>(`SELECT hours_band, mode, has_vehicle, capital_cents, created_at FROM app.income_interviews WHERE case_id = $1`, [id]);
  const cons = consent.rows[0];
  return {
    id: row.id,
    sessionId: row.session_id,
    createdAt: iso(row.created_at),
    status: row.status,
    kind: row.product_kind,
    uf: row.uf,
    employment: row.employment_type,
    ageBand: row.age_band,
    netIncomeCents: row.net_income_cents === null ? null : num(row.net_income_cents),
    fixedExpensesCents: row.fixed_expenses_cents === null ? null : num(row.fixed_expenses_cents),
    debtTotalCents: row.debt_total_cents === null ? null : num(row.debt_total_cents),
    debtCount: row.debt_count,
    hasOverdue: Boolean(row.has_overdue),
    debtKinds: row.debt_kinds,
    purgeAfter: iso(row.purge_after),
    orders: orders.rows.map((o) => ({ id: o.id, status: o.status, totalCents: num(o.total_cents), createdAt: iso(o.created_at), paidAt: iso(o.paid_at), items: o.items, method: o.method, provider: o.provider })),
    deliverables: deliverables.rows.map((d) => ({ product: d.product_code, status: d.status, source: d.generation_meta?.source ?? null, at: iso(d.generated_at) })),
    leadConsent: cons ? { active: cons.action === 'grant', categories: cons.scope.categories ?? [], at: iso(cons.created_at) } : null,
    hasContact: contact.rows.length > 0,
    incomeInterview: interview.rows[0] ? { hoursBand: interview.rows[0].hours_band, mode: interview.rows[0].mode, hasVehicle: interview.rows[0].has_vehicle, capitalCents: num(interview.rows[0].capital_cents), at: iso(interview.rows[0].created_at) } : null,
  };
}

/** Mostra o contato (descriptografado) de quem AUTORIZOU ser contatado. Exige permissão própria e deixa rastro na auditoria. */
export async function revealContact(ctx: Ctx, admin: AdminUser, caseId: string): Promise<{ name: string; phone: string; email: string | null }> {
  if (!can(admin, 'clientes_pii')) throw new AppError(403, 'forbidden', 'Você não tem permissão para ver dados pessoais.');
  const r = await ctx.db.query<{ full_name_enc: Buffer; phone_enc: Buffer; email_enc: Buffer | null; consent: boolean }>(
    `SELECT l.full_name_enc, l.phone_enc, l.email_enc,
            EXISTS (SELECT 1 FROM app.v_current_consents v WHERE v.case_id = l.case_id AND v.purpose = 'lead_sharing' AND v.action = 'grant') AS consent
       FROM app.lead_contacts l WHERE l.case_id = $1`,
    [caseId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  if (!row.consent) throw new AppError(403, 'no_consent', 'Esta pessoa não autorizou contato (ou revogou). Os dados não podem ser exibidos.');
  await audit(ctx.db, `admin:${admin.id}`, 'admin_reveal_contact', 'case', caseId, { by: admin.email });
  const dec = (b: Buffer) => decryptText(ctx.config.secret, Buffer.from(b));
  return { name: dec(row.full_name_enc), phone: dec(row.phone_enc), email: row.email_enc ? dec(row.email_enc) : null };
}

export async function consentedContacts(ctx: Ctx, opts: { category?: string; page?: number }) {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const params: unknown[] = [];
  let cat = '';
  if (opts.category) {
    params.push(opts.category);
    cat = ` AND v.scope->'categories' ? $1`;
  }
  const r = await ctx.db.query<{ case_id: string; created_at: Date; scope: { categories?: string[] }; uf: string | null; employment_type: string | null; net_income_cents: string | null; debt_total_cents: string | null; has_overdue: boolean | null; interview: boolean }>(
    `SELECT v.case_id, v.created_at, v.scope, c.uf::text AS uf, c.employment_type, c.net_income_cents, c.debt_total_cents, c.has_overdue,
            EXISTS (SELECT 1 FROM app.income_interviews i WHERE i.case_id = v.case_id) AS interview
       FROM app.v_current_consents v JOIN app.cases c ON c.id = v.case_id
       JOIN app.lead_contacts l ON l.case_id = v.case_id
      WHERE v.purpose = 'lead_sharing' AND v.action = 'grant'${cat}
      ORDER BY v.created_at DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  return r.rows.map((x) => ({
    caseId: x.case_id,
    consentedAt: iso(x.created_at),
    categories: x.scope.categories ?? [],
    uf: x.uf,
    employment: x.employment_type,
    netIncomeCents: x.net_income_cents === null ? null : num(x.net_income_cents),
    debtTotalCents: x.debt_total_cents === null ? null : num(x.debt_total_cents),
    hasOverdue: Boolean(x.has_overdue),
    hasInterview: x.interview,
  }));
}

// ---------------------------------------------------------------------------
// Jornada: linha do tempo de um cliente (eventos de navegação + registros do banco)
// ---------------------------------------------------------------------------
export interface TimelineItem {
  at: string;
  kind: 'view' | 'click' | 'tool' | 'step' | 'case' | 'order' | 'payment' | 'delivery' | 'consent' | 'account' | 'admin';
  label: string;
  detail?: string | undefined;
}

const VIEW_LABEL: Record<string, string> = {
  landing: 'Abriu a página inicial', intake: 'Abriu o formulário do diagnóstico', processing: 'Aguardou o cálculo', preview: 'Viu o resultado grátis',
  checkout: 'Abriu o pagamento', addon: 'Abriu a compra de um complemento', delivery: 'Abriu o Mapa completo', tools: 'Abriu as ferramentas grátis',
  translator: 'Abriu o Tradutor de Cobrança', account: 'Abriu a área da assinatura', partner: 'Abriu o portal do parceiro',
};

export async function sessionTimeline(ctx: Ctx, sessionIds: string[]): Promise<TimelineItem[]> {
  if (sessionIds.length === 0) return [];
  const ev = await ctx.db.query<{ created_at: Date; name: string; props: Record<string, unknown> }>(`SELECT created_at, name, props FROM app.events WHERE session_id = ANY($1::uuid[]) ORDER BY id LIMIT 1000`, [sessionIds]);
  const out: TimelineItem[] = [];
  for (const e of ev.rows) {
    const at = iso(e.created_at)!;
    if (e.name === 'view') out.push({ at, kind: 'view', label: VIEW_LABEL[String(e.props.view)] ?? `Abriu ${String(e.props.view)}` });
    else if (e.name === 'cta') out.push({ at, kind: 'click', label: `Clicou em "${String(e.props.id)}"` });
    else if (e.name === 'tool') out.push({ at, kind: 'tool', label: `Usou a ferramenta grátis "${String(e.props.tool)}"` });
    else if (e.name === 'intake_step') out.push({ at, kind: 'step', label: `Avançou para a etapa ${String(e.props.step)} do formulário` });
    if (e.props.attr && typeof e.props.attr === 'object') {
      const a = e.props.attr as Record<string, string>;
      out.push({ at, kind: 'view', label: `Origem: ${a.source || 'direto'}${a.medium ? ` / ${a.medium}` : ''}`, detail: [a.campaign, a.device].filter(Boolean).join(' · ') || undefined });
    }
  }
  const cases = await ctx.db.query<{ id: string; created_at: Date; product_kind: string }>(`SELECT id, created_at, product_kind FROM app.cases WHERE session_id = ANY($1::uuid[])`, [sessionIds]);
  for (const c of cases.rows) out.push({ at: iso(c.created_at)!, kind: 'case', label: c.product_kind === 'translator' ? 'Leu uma cobrança no Tradutor (resultado grátis)' : 'Preencheu o diagnóstico e recebeu o resultado grátis', detail: `caso ${c.id.slice(0, 8)}` });
  const orders = await ctx.db.query<{ id: string; created_at: Date; paid_at: Date | null; status: string; total_cents: string; items: string; method: string | null }>(
    `SELECT o.id, o.created_at, o.paid_at, o.status, o.total_cents,
            (SELECT string_agg(product_code, ', ') FROM app.order_items WHERE order_id = o.id) AS items,
            (SELECT method FROM app.payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS method
       FROM app.orders o WHERE o.session_id = ANY($1::uuid[])`,
    [sessionIds],
  );
  for (const o of orders.rows) {
    out.push({ at: iso(o.created_at)!, kind: 'order', label: `Gerou o Pix de ${(num(o.total_cents) / 100).toFixed(2).replace('.', ',')}`, detail: o.items });
    if (o.paid_at) out.push({ at: iso(o.paid_at)!, kind: 'payment', label: `Pagou (${o.method ?? 'pix'})`, detail: o.items });
    else if (o.status === 'expired' || o.status === 'canceled') out.push({ at: iso(o.created_at)!, kind: 'order', label: `Pedido ${o.status === 'expired' ? 'expirou sem pagamento' : 'cancelado'}` });
  }
  const dl = await ctx.db.query<{ product_code: string; status: string; generated_at: Date | null; meta: Record<string, unknown> | null }>(
    `SELECT d.product_code, d.status, d.generated_at, d.generation_meta AS meta FROM app.deliverables d JOIN app.cases c ON c.id = d.case_id WHERE c.session_id = ANY($1::uuid[]) AND d.generated_at IS NOT NULL`,
    [sessionIds],
  );
  for (const d of dl.rows) out.push({ at: iso(d.generated_at)!, kind: 'delivery', label: `Entrega pronta: ${d.product_code}`, detail: d.meta?.source ? `origem: ${String(d.meta.source)}` : undefined });
  const cons = await ctx.db.query<{ created_at: Date; action: string; purpose: string; scope: { categories?: string[] } }>(
    `SELECT k.created_at, k.action, k.purpose, k.scope FROM app.consents k JOIN app.cases c ON c.id = k.case_id WHERE c.session_id = ANY($1::uuid[]) AND k.purpose = 'lead_sharing'`,
    [sessionIds],
  );
  for (const k of cons.rows) out.push({ at: iso(k.created_at)!, kind: 'consent', label: k.action === 'grant' ? 'Autorizou contato de parceiros' : 'Revogou a autorização de contato', detail: (k.scope.categories ?? []).join(', ') || undefined });
  const acc = await ctx.db.query<{ occurred_at: Date; action: string }>(
    `SELECT a.occurred_at, a.action FROM app.audit_log a WHERE a.entity = 'subscriber' AND a.entity_id IN (SELECT subscriber_id::text FROM app.sessions WHERE id = ANY($1::uuid[]) AND subscriber_id IS NOT NULL) AND a.action IN ('subscriber_login','subscription_paid','subscription_cancel','subscription_resume','subscriber_deleted')`,
    [sessionIds],
  );
  const ACC_LABEL: Record<string, string> = { subscriber_login: 'Entrou na conta da assinatura', subscription_paid: 'Pagou a assinatura', subscription_cancel: 'Marcou para não renovar', subscription_resume: 'Voltou atrás: vai renovar', subscriber_deleted: 'Apagou a conta' };
  for (const a of acc.rows) out.push({ at: iso(a.occurred_at)!, kind: 'account', label: ACC_LABEL[a.action] ?? a.action });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function caseTimeline(ctx: Ctx, caseId: string) {
  const c = await ctx.db.query<{ session_id: string }>(`SELECT session_id FROM app.cases WHERE id = $1`, [caseId]);
  if (!c.rows[0]) throw notFound();
  // Um caso pode ter passado para outra sessão ao abrir o link de acesso em outro aparelho: junta todas.
  const sessions = await ctx.db.query<{ session_id: string }>(`SELECT DISTINCT session_id FROM (SELECT session_id FROM app.cases WHERE id = $1 UNION SELECT session_id FROM app.orders WHERE case_id = $1) x`, [caseId]);
  return sessionTimeline(ctx, sessions.rows.map((s) => s.session_id));
}

export async function subscriberTimeline(ctx: Ctx, subscriberId: string) {
  const s = await ctx.db.query<{ id: string }>(`SELECT id FROM app.sessions WHERE subscriber_id = $1 UNION SELECT session_id FROM app.orders WHERE subscriber_id = $1`, [subscriberId]);
  const base = await sessionTimeline(ctx, s.rows.map((x) => x.id));
  const orders = await ctx.db.query<{ created_at: Date; paid_at: Date | null; status: string; total_cents: string; product: string }>(
    `SELECT o.created_at, o.paid_at, o.status, o.total_cents, (SELECT string_agg(product_code, ', ') FROM app.order_items WHERE order_id = o.id) AS product FROM app.orders o WHERE o.subscriber_id = $1`,
    [subscriberId],
  );
  const seen = new Set(base.map((b) => `${b.at}|${b.kind}`));
  for (const o of orders.rows) {
    const created = iso(o.created_at)!;
    if (!seen.has(`${created}|order`)) base.push({ at: created, kind: 'order', label: `Gerou a cobrança da assinatura (${(num(o.total_cents) / 100).toFixed(2).replace('.', ',')})`, detail: o.product });
    const paidIso = o.paid_at ? iso(o.paid_at)! : null;
    const dup = paidIso ? base.some((x) => x.label === 'Pagou a assinatura' && Math.abs(Date.parse(x.at) - Date.parse(paidIso)) < 15_000) : false;
    if (o.paid_at && !dup && !seen.has(`${iso(o.paid_at)}|payment`)) base.push({ at: iso(o.paid_at)!, kind: 'payment', label: 'Pagou a assinatura', detail: o.product });
  }
  // Cobrança, indicações e descontos: tudo o que mexe no valor da fatura aparece na jornada.
  const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const audits = await ctx.db.query<{ occurred_at: Date; action: string; data: Record<string, unknown> }>(
    `SELECT occurred_at, action, data FROM app.audit_log WHERE entity = 'subscriber' AND entity_id = $1 AND action IN ('subscription_checkout_started','subscription_charge_refused','subscription_canceled','referral_credit_granted','referral_credits_adjusted','ebook_gift_sent','subscriber_data_exported')`,
    [subscriberId],
  );
  const AUD: Record<string, string> = {
    subscription_checkout_started: 'Aceitou os termos e começou a assinatura mensal no cartão',
    subscription_charge_refused: 'Cartão recusado na cobrança mensal',
    subscription_canceled: 'Cancelou a assinatura (cobrança interrompida)',
    referral_credit_granted: 'Ganhou desconto por indicação: um amigo assinou',
    referral_credits_adjusted: 'Créditos de desconto ajustados pelo backoffice',
    ebook_gift_sent: 'Recebeu o eBook de presente por e-mail',
    subscriber_data_exported: 'Dados baixados pelo backoffice',
  };
  for (const x of audits.rows) base.push({ at: iso(x.occurred_at)!, kind: 'account', label: AUD[x.action] ?? x.action, ...(x.action === 'referral_credit_granted' ? { detail: `${String(x.data.percent ?? '')}% na próxima fatura` } : x.action === 'referral_credits_adjusted' ? { detail: `${Number(x.data.delta) > 0 ? '+' : ''}${String(x.data.delta)}: ${String(x.data.reason ?? '')}` } : {}) });
  const invited = await ctx.db.query<{ created_at: Date; status: string; converted_at: Date | null }>(`SELECT created_at, status, converted_at FROM app.referrals WHERE referrer_subscriber_id = $1`, [subscriberId]);
  for (const r of invited.rows) base.push({ at: iso(r.created_at)!, kind: 'account', label: 'Indicou um amigo por e-mail', detail: r.status === 'converted' ? 'o amigo assinou' : 'convite enviado' });
  const used = await ctx.db.query<{ applied_at: Date; percent: number; amount: string | null; list: string | null }>(
    `SELECT c.applied_at, c.percent, p.amount_cents::text AS amount,
            (SELECT sum(unit_price_cents) FROM app.order_items oi WHERE oi.order_id = p.order_id)::text AS list
       FROM app.referral_credits c LEFT JOIN app.payments p ON p.id = c.applied_payment_id WHERE c.subscriber_id = $1 AND c.status = 'applied' AND c.applied_at IS NOT NULL`,
    [subscriberId],
  );
  for (const u of used.rows) base.push({ at: iso(u.applied_at)!, kind: 'payment', label: `Desconto de ${u.percent}% aplicado na fatura`, detail: u.amount ? `cobrado R$ ${brl(num(u.amount))}${u.list ? ` em vez de R$ ${brl(num(u.list))}` : ''}` : undefined });
  const from = await ctx.db.query<{ email: string; created_at: Date }>(`SELECT r.email::text AS email, p.created_at FROM app.billing_profiles p JOIN app.subscribers r ON r.id = p.referred_by WHERE p.subscriber_id = $1`, [subscriberId]);
  for (const x of from.rows) base.push({ at: iso(x.created_at)!, kind: 'account', label: 'Chegou por indicação de um assinante', detail: x.email });
  return base.sort((a, b) => a.at.localeCompare(b.at));
}
