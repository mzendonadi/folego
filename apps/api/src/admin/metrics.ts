// Indicadores do backoffice. Tudo é agregado no banco (sem carregar linhas de clientes na memória) e nada aqui
// devolve dado pessoal: só contagens, somas e faixas.
import type { Ctx } from '../services.ts';
import { num } from '../services.ts';

const TZ = `'America/Sao_Paulo'`;
const NOT_TRANSLATOR = `c.product_kind = 'map'`;

export interface Period {
  days: number;
}
export const clampDays = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(3650, Math.round(n))) : 30;
};

async function rows<T = Record<string, unknown>>(ctx: Ctx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await ctx.db.query<T>(sql, params)).rows;
}
const one = async (ctx: Ctx, sql: string, params: unknown[] = []): Promise<Record<string, unknown>> => (await rows(ctx, sql, params))[0] ?? {};

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ---------------------------------------------------------------------------
// Funil (por sessão) e abandono
// ---------------------------------------------------------------------------
// O Mapa da Virada é grátis (a pessoa só informa e-mail e celular): o funil conta quem viu o resultado, quem liberou o Mapa e o que fez DEPOIS dele
// (formulário do parceiro, outros produtos, banner do parceiro). "Pagou" é só produto cobrado (cartas, calendário, tradutor, guias, renda extra).
// Tudo por PESSOA (sessão): quem refaz o diagnóstico gera vários formulários e não pode contar duas vezes.
export async function funnel(ctx: Ctx, days: number) {
  const from = `now() - make_interval(days => $1)`;
  const since = `${TODAY} - ($1::int - 1)`;
  const v = await one(
    ctx,
    `WITH
       vis AS (SELECT DISTINCT session_id FROM app.events WHERE created_at >= ${from} AND session_id IS NOT NULL),
       started AS (SELECT DISTINCT session_id FROM app.events WHERE created_at >= ${from} AND name = 'view' AND props->>'view' IN ('intake','processing') AND session_id IS NOT NULL),
       diagnosed AS (SELECT DISTINCT c.session_id FROM app.cases c WHERE c.created_at >= ${from} AND ${NOT_TRANSLATOR} AND c.session_id IS NOT NULL),
       mapped AS (SELECT DISTINCT o.session_id FROM app.orders o JOIN app.order_items i ON i.order_id = o.id AND i.product_code = 'recovery_map' JOIN app.cases c ON c.id = o.case_id
                   WHERE o.status = 'paid' AND o.paid_at >= ${from} AND ${NOT_TRANSLATOR} AND o.session_id IS NOT NULL),
       partner AS (SELECT DISTINCT c.session_id FROM app.consents k JOIN app.cases c ON c.id = k.case_id
                    WHERE k.purpose = 'lead_sharing' AND k.action = 'grant' AND k.created_at >= ${from} AND ${NOT_TRANSLATOR} AND c.session_id IS NOT NULL),
       addon_view AS (SELECT DISTINCT session_id FROM app.events WHERE created_at >= ${from} AND name = 'view' AND props->>'view' = 'addon' AND session_id IS NOT NULL),
       addon_order AS (SELECT DISTINCT o.session_id FROM app.orders o JOIN app.order_items i ON i.order_id = o.id JOIN app.cases c ON c.id = o.case_id
                        WHERE o.created_at >= ${from} AND i.product_code <> 'recovery_map' AND ${NOT_TRANSLATOR} AND o.session_id IS NOT NULL),
       other AS (SELECT session_id FROM addon_view UNION SELECT session_id FROM addon_order),
       banner AS (SELECT DISTINCT session_id FROM app.events WHERE created_at >= ${from} AND name = 'cta' AND props->>'id' = 'banner_clique' AND session_id IS NOT NULL),
       followed AS (SELECT session_id FROM partner UNION SELECT session_id FROM other UNION SELECT session_id FROM banner),
       paid AS (SELECT DISTINCT o.session_id FROM app.orders o JOIN app.cases c ON c.id = o.case_id
                 WHERE o.status = 'paid' AND o.total_cents > 0 AND o.paid_at >= ${from} AND ${NOT_TRANSLATOR} AND o.session_id IS NOT NULL)
     SELECT
       (SELECT count(*) FROM vis) AS visitors,
       (SELECT count(*) FROM started) AS started,
       (SELECT count(*) FROM diagnosed) AS diagnosed,
       (SELECT count(*) FROM started WHERE session_id NOT IN (SELECT session_id FROM diagnosed)) AS started_not_finished,
       (SELECT count(*) FROM mapped) AS mapped,
       (SELECT count(*) FROM diagnosed WHERE session_id NOT IN (SELECT session_id FROM mapped)) AS diagnosed_no_map,
       (SELECT count(*) FROM partner) AS partner_forms,
       (SELECT count(*) FROM mapped WHERE session_id IN (SELECT session_id FROM partner)) AS map_partner,
       (SELECT count(*) FROM mapped WHERE session_id IN (SELECT session_id FROM other)) AS map_other,
       (SELECT count(*) FROM mapped WHERE session_id IN (SELECT session_id FROM banner)) AS map_banner,
       (SELECT count(*) FROM mapped WHERE session_id IN (SELECT session_id FROM followed)) AS map_followed,
       (SELECT count(*) FROM other) AS viewed_other,
       (SELECT count(*) FROM paid) AS paid`,
    [days],
  );
  const steps = [
    { key: 'visitors', label: 'Visitaram o site', count: num(v.visitors) },
    { key: 'started', label: 'Começaram o diagnóstico', count: num(v.started) },
    { key: 'diagnosed', label: 'Preencheram e viram o resultado', count: num(v.diagnosed) },
    { key: 'mapped', label: 'Liberaram o Mapa grátis', count: num(v.mapped) },
    { key: 'followed', label: 'Seguiram além do Mapa (parceiro, outro produto ou banner)', count: num(v.map_followed) },
    { key: 'paid', label: 'Compraram um produto pago', count: num(v.paid) },
  ];
  const withRates = steps.map((s, i) => ({ ...s, pctOfPrev: i === 0 ? null : pct(Math.min(s.count, steps[i - 1]!.count), steps[i - 1]!.count), pctOfFirst: pct(Math.min(s.count, steps[0]!.count), steps[0]!.count) }));
  const mapped = num(v.mapped);
  const diagnosed = num(v.diagnosed);

  // Os produtos que ainda são cobrados: quantos pedidos, quantos pagos, quanto rendeu, e quem gerou o Pix e não pagou.
  const byProduct = await rows<{ code: string; name: string; kind: string; created: string; paid: string; cents: string; buyers: string }>(
    ctx,
    `SELECT p.code, p.name, p.kind, count(DISTINCT o.id) AS created,
            count(DISTINCT o.id) FILTER (WHERE o.status = 'paid' AND o.paid_at >= ${from}) AS paid,
            coalesce(sum(i.unit_price_cents) FILTER (WHERE o.status = 'paid' AND o.paid_at >= ${from}), 0) AS cents,
            count(DISTINCT o.session_id) FILTER (WHERE o.status = 'paid' AND o.paid_at >= ${from}) AS buyers
       FROM app.order_items i JOIN app.orders o ON o.id = i.order_id JOIN app.products p ON p.code = i.product_code
      WHERE o.created_at >= ${from} AND i.unit_price_cents > 0 AND o.case_id IS NOT NULL AND p.kind <> 'subscription'
      GROUP BY p.code, p.name, p.kind, p.sort ORDER BY p.sort`,
    [days],
  );
  const mapsBySource = await rows<{ provider: string; n: string }>(
    ctx,
    `SELECT pay.provider, count(DISTINCT o.id) AS n
       FROM app.orders o JOIN app.order_items i ON i.order_id = o.id AND i.product_code = 'recovery_map' JOIN app.payments pay ON pay.order_id = o.id
      WHERE o.status = 'paid' AND o.paid_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`,
    [days],
  );

  // O que o Fôlego ganha com parceiros: autorizações, contatos entregues, contratos fechados e comissão.
  const pc = await one(
    ctx,
    `SELECT
       (SELECT count(DISTINCT k.case_id) FROM app.consents k WHERE k.purpose = 'lead_sharing' AND k.action = 'grant' AND k.created_at >= ${from}) AS granted,
       (SELECT count(*) FROM app.consents k WHERE k.purpose = 'lead_sharing' AND k.action = 'revoke' AND k.created_at >= ${from}) AS revoked,
       (SELECT count(*) FROM app.v_current_consents WHERE purpose = 'lead_sharing' AND action = 'grant') AS active_total,
       (SELECT count(*) FROM app.lead_deliveries d WHERE d.created_at >= ${from}) AS deliveries,
       (SELECT coalesce(sum(d.price_cents) FILTER (WHERE d.status IN ('delivered','contacted','converted')), 0) FROM app.lead_deliveries d WHERE d.created_at >= ${from}) AS lead_cents,
       (SELECT count(*) FROM app.partner_deals WHERE origin = 'folego' AND status = 'fechado' AND signed_on >= ${since}) AS deals,
       (SELECT coalesce(sum(amount_cents), 0) FROM app.partner_deals WHERE origin = 'folego' AND status = 'fechado' AND signed_on >= ${since}) AS volume,
       (SELECT coalesce(sum(commission_cents) FILTER (WHERE commission_status = 'a_receber'), 0) FROM app.partner_deals WHERE origin = 'folego' AND status = 'fechado' AND signed_on >= ${since}) AS due,
       (SELECT coalesce(sum(commission_cents) FILTER (WHERE commission_status = 'recebida'), 0) FROM app.partner_deals WHERE origin = 'folego' AND status = 'fechado' AND signed_on >= ${since}) AS received`,
    [days],
  );
  const deliveryStatus = await rows<{ status: string; n: string }>(ctx, `SELECT d.status, count(*) AS n FROM app.lead_deliveries d WHERE d.created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`, [days]);

  // Banner do parceiro no Mapa: quantas vezes apareceu e quantas pessoas clicaram, por campanha.
  const bn = await rows<{ camp: string | null; shown: string; clicks: string; people: string }>(
    ctx,
    `SELECT e.props->>'camp' AS camp, count(*) FILTER (WHERE e.name = 'view') AS shown, count(*) FILTER (WHERE e.name = 'cta') AS clicks, count(DISTINCT e.session_id) FILTER (WHERE e.name = 'cta') AS people
       FROM app.events e WHERE e.created_at >= ${from} AND ((e.name = 'view' AND e.props->>'view' = 'mapa_banner') OR (e.name = 'cta' AND e.props->>'id' = 'banner_clique')) GROUP BY 1`,
    [days],
  );
  const camps = bn.length
    ? await rows<{ id: string; name: string; partner: string }>(ctx, `SELECT c.id::text AS id, c.name, coalesce(nullif(trim(p.trade_name), ''), p.legal_name) AS partner FROM app.partner_campaigns c JOIN app.partners p ON p.id = c.partner_id`)
    : [];
  const bannerRows = bn.map((b) => ({ campaignId: b.camp, campaign: camps.find((c) => c.id === b.camp)?.name ?? 'Campanha removida', partner: camps.find((c) => c.id === b.camp)?.partner ?? '—', shown: num(b.shown), clicks: num(b.clicks), people: num(b.people), ctrPct: pct(num(b.clicks), num(b.shown)) }));
  const shown = bannerRows.reduce((s, b) => s + b.shown, 0);
  const clicks = bannerRows.reduce((s, b) => s + b.clicks, 0);

  return {
    steps: withRates,
    abandonment: {
      startedNotFinished: num(v.started_not_finished),
      diagnosedNoMap: num(v.diagnosed_no_map),
      mapReleased: mapped,
      mapNoFollow: Math.max(0, mapped - num(v.map_followed)),
      mapFollowed: num(v.map_followed),
      mapPartner: num(v.map_partner),
      mapOther: num(v.map_other),
      mapBanner: num(v.map_banner),
      partnerForms: num(v.partner_forms),
      viewedOtherProducts: num(v.viewed_other),
      paid: num(v.paid),
      mapRatePct: pct(mapped, diagnosed),
      followRatePct: pct(num(v.map_followed), mapped),
      partnerRatePct: pct(num(v.map_partner), mapped),
      payRatePct: pct(num(v.paid), mapped),
    },
    mapsBySource: mapsBySource.map((m) => ({ provider: m.provider, maps: num(m.n) })),
    products: byProduct.map((p) => ({ code: p.code, name: p.name, kind: p.kind, orders: num(p.created), paid: num(p.paid), unpaid: Math.max(0, num(p.created) - num(p.paid)), revenueCents: num(p.cents), buyers: num(p.buyers), conversionPct: pct(num(p.paid), num(p.created)) })),
    partners: {
      consentsGranted: num(pc.granted), consentsRevoked: num(pc.revoked), consentsActive: num(pc.active_total),
      deliveries: num(pc.deliveries), deliveriesByStatus: Object.fromEntries(deliveryStatus.map((d) => [d.status, num(d.n)])), leadRevenueCents: num(pc.lead_cents),
      deals: num(pc.deals), volumeCents: num(pc.volume), commissionDueCents: num(pc.due), commissionReceivedCents: num(pc.received),
    },
    banner: { shown, clicks, ctrPct: pct(clicks, shown), byCampaign: bannerRows.sort((a, b) => b.shown - a.shown) },
  };
}

// ---------------------------------------------------------------------------
// Receita, produtos e meios de pagamento
// ---------------------------------------------------------------------------
export async function revenue(ctx: Ctx, days: number) {
  const from = `now() - make_interval(days => $1)`;
  const tot = await one(ctx, `SELECT coalesce(sum(total_cents),0) AS gross, count(*) AS orders FROM app.orders WHERE status = 'paid' AND total_cents > 0 AND paid_at >= ${from}`, [days]); // só o que foi cobrado: o Mapa grátis (R$ 0) não entra
  const byDay = await rows<{ day: string; cents: string; orders: string }>(
    ctx,
    `SELECT to_char((paid_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day, sum(total_cents) AS cents, count(*) AS orders
       FROM app.orders WHERE status = 'paid' AND total_cents > 0 AND paid_at >= ${from} GROUP BY 1 ORDER BY 1`,
    [days],
  );
  const byProduct = await rows<{ code: string; name: string; kind: string; units: string; cents: string }>(
    ctx,
    `SELECT p.code, p.name, p.kind, count(*) AS units, sum(i.unit_price_cents) AS cents
       FROM app.order_items i JOIN app.orders o ON o.id = i.order_id JOIN app.products p ON p.code = i.product_code
      WHERE o.status = 'paid' AND o.paid_at >= ${from} AND i.unit_price_cents > 0 GROUP BY p.code, p.name, p.kind, p.sort ORDER BY p.sort`,
    [days],
  );
  const byMethod = await rows<{ provider: string; method: string; orders: string; cents: string }>(
    ctx,
    `SELECT pay.provider, pay.method, count(*) AS orders, sum(pay.amount_cents) AS cents
       FROM app.payments pay WHERE pay.status = 'confirmed' AND pay.amount_cents > 0 AND pay.confirmed_at >= ${from} GROUP BY 1, 2 ORDER BY 4 DESC`,
    [days],
  );
  const pending = await rows<{ status: string; n: string }>(ctx, `SELECT status, count(*) AS n FROM app.orders WHERE created_at >= ${from} AND status <> 'paid' GROUP BY 1`, [days]);
  const timing = await rows<{ h: number; wd: number; n: string }>(
    ctx,
    `SELECT extract(hour FROM paid_at AT TIME ZONE ${TZ})::int AS h, extract(dow FROM paid_at AT TIME ZONE ${TZ})::int AS wd, count(*) AS n
       FROM app.orders WHERE status = 'paid' AND total_cents > 0 AND paid_at >= ${from} GROUP BY 1, 2`,
    [days],
  );
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: timing.filter((t) => t.h === h).reduce((s, t) => s + num(t.n), 0) }));
  const weekdays = Array.from({ length: 7 }, (_, d) => ({ weekday: d, orders: timing.filter((t) => t.wd === d).reduce((s, t) => s + num(t.n), 0) }));
  const gross = num(tot.gross);
  const orders = num(tot.orders);
  return {
    grossCents: gross,
    orders,
    avgTicketCents: orders > 0 ? Math.round(gross / orders) : 0,
    byDay: byDay.map((d) => ({ day: d.day, cents: num(d.cents), orders: num(d.orders) })),
    byProduct: byProduct.map((p) => ({ code: p.code, name: p.name, kind: p.kind, units: num(p.units), cents: num(p.cents) })),
    byMethod: byMethod.map((m) => ({ provider: m.provider, method: m.method, orders: num(m.orders), cents: num(m.cents) })),
    unpaidOrders: Object.fromEntries(pending.map((p) => [p.status, num(p.n)])),
    hours,
    weekdays,
  };
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------
export const SUB_STATUS_SQL = `CASE
    WHEN s.id IS NULL THEN 'sem_plano'
    WHEN s.status = 'active' AND s.current_period_end > now() THEN
      CASE WHEN s.cancel_at_period_end THEN 'cancelando'
           WHEN s.current_period_end < now() + interval '7 days' THEN 'vencendo'
           ELSE 'em_dia' END
    ELSE 'em_debito' END`;

export async function subscriptions(ctx: Ctx, days: number) {
  const by = await rows<{ plan: string; status: string; n: string; price: string }>(
    ctx,
    `SELECT s.plan, ${SUB_STATUS_SQL} AS status, count(*) AS n, max(p.price_cents) AS price
       FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL
       JOIN app.products p ON p.code = 'sub_' || s.plan GROUP BY 1, 2`,
  );
  const count = (statuses: string[]) => by.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + num(r.n), 0);
  const mrr = (statuses: string[]) => by.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + num(r.n) * num(r.price), 0);
  const planNames = ['controle', 'ousado', 'desbravador'];
  const paying = ['em_dia', 'vencendo', 'cancelando'];
  const rn = await one(
    ctx,
    `SELECT
       (SELECT count(*) FROM app.subscribers WHERE deleted_at IS NULL) AS subscribers,
       (SELECT count(*) FROM app.subscribers WHERE deleted_at IS NULL AND created_at >= now() - make_interval(days => $1)) AS new_subscribers,
       (SELECT count(*) FROM (SELECT subscriber_id FROM app.orders WHERE subscriber_id IS NOT NULL AND status = 'paid' GROUP BY 1 HAVING count(*) >= 2) x) AS renewed,
       (SELECT count(*) FROM (SELECT subscriber_id FROM app.orders WHERE subscriber_id IS NOT NULL AND status = 'paid' GROUP BY 1) x) AS ever_paid`,
    [days],
  );
  return {
    subscribers: num(rn.subscribers),
    newSubscribers: num(rn.new_subscribers),
    payingCount: count(paying),
    upToDate: count(['em_dia']),
    expiringSoon: count(['vencendo']),
    cancelling: count(['cancelando']),
    delinquent: count(['em_debito']),
    mrrCents: mrr(paying),
    mrrAtRiskCents: mrr(['vencendo', 'cancelando']),
    lostMrrCents: mrr(['em_debito']),
    renewalRatePct: pct(num(rn.renewed), num(rn.ever_paid)),
    byPlan: planNames.map((p) => ({
      plan: p,
      payingCount: by.filter((r) => r.plan === p && paying.includes(r.status)).reduce((s, r) => s + num(r.n), 0),
      delinquent: by.filter((r) => r.plan === p && r.status === 'em_debito').reduce((s, r) => s + num(r.n), 0),
      mrrCents: by.filter((r) => r.plan === p && paying.includes(r.status)).reduce((s, r) => s + num(r.n) * num(r.price), 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Perfil dos clientes (o que interessa a parceiros e a campanhas)
// ---------------------------------------------------------------------------
const PAID_CASE = `EXISTS (SELECT 1 FROM app.orders o WHERE o.case_id = c.id AND o.status = 'paid' AND o.total_cents > 0)`; // pagou um produto cobrado (o Mapa grátis não conta)
const INCOME_BAND = `CASE WHEN c.net_income_cents IS NULL THEN 'n/d'
    WHEN c.net_income_cents < 150000 THEN 'até R$ 1.500'
    WHEN c.net_income_cents < 300000 THEN 'R$ 1.500 a 3.000'
    WHEN c.net_income_cents < 500000 THEN 'R$ 3.000 a 5.000'
    WHEN c.net_income_cents < 800000 THEN 'R$ 5.000 a 8.000'
    ELSE 'acima de R$ 8.000' END`;
const DEBT_BAND = `CASE WHEN c.debt_total_cents IS NULL THEN 'n/d'
    WHEN c.debt_total_cents < 200000 THEN 'até R$ 2.000'
    WHEN c.debt_total_cents < 500000 THEN 'R$ 2.000 a 5.000'
    WHEN c.debt_total_cents < 1500000 THEN 'R$ 5.000 a 15.000'
    WHEN c.debt_total_cents < 5000000 THEN 'R$ 15.000 a 50.000'
    ELSE 'acima de R$ 50.000' END`;

async function segment(ctx: Ctx, days: number, expr: string, order = 'cases DESC') {
  const r = await rows<{ key: string; cases: string; paid: string }>(
    ctx,
    `SELECT ${expr} AS key, count(*) AS cases, count(*) FILTER (WHERE ${PAID_CASE}) AS paid
       FROM app.cases c WHERE c.created_at >= now() - make_interval(days => $1) AND ${NOT_TRANSLATOR} GROUP BY 1 ORDER BY ${order}`,
    [days],
  );
  return r.map((x) => ({ key: x.key ?? 'n/d', cases: num(x.cases), paid: num(x.paid), conversionPct: pct(num(x.paid), num(x.cases)) }));
}

export async function customerProfile(ctx: Ctx, days: number) {
  const tot = await one(
    ctx,
    `SELECT count(*) AS cases, count(*) FILTER (WHERE ${PAID_CASE}) AS paid, coalesce(sum(c.debt_total_cents),0) AS debt_total,
            count(*) FILTER (WHERE c.has_overdue) AS overdue, coalesce(avg(c.debt_total_cents),0) AS debt_avg
       FROM app.cases c WHERE c.created_at >= now() - make_interval(days => $1) AND ${NOT_TRANSLATOR}`,
    [days],
  );
  const kinds = await rows<{ kind: string; cases: string }>(
    ctx,
    `SELECT k AS kind, count(*) AS cases FROM app.cases c, unnest(c.debt_kinds) k
      WHERE c.created_at >= now() - make_interval(days => $1) AND ${NOT_TRANSLATOR} GROUP BY 1 ORDER BY 2 DESC`,
    [days],
  );
  return {
    cases: num(tot.cases),
    paidCases: num(tot.paid),
    totalDebtCents: num(tot.debt_total),
    avgDebtCents: Math.round(num(tot.debt_avg)),
    withOverdue: num(tot.overdue),
    byUf: await segment(ctx, days, `coalesce(c.uf::text, 'n/d')`),
    byEmployment: await segment(ctx, days, `coalesce(c.employment_type, 'n/d')`),
    byAge: await segment(ctx, days, `coalesce(c.age_band, 'n/d')`, 'key'),
    byIncome: await segment(ctx, days, INCOME_BAND, 'min(c.net_income_cents) NULLS FIRST'),
    byDebt: await segment(ctx, days, DEBT_BAND, 'min(c.debt_total_cents) NULLS FIRST'),
    debtKinds: kinds.map((k) => ({ kind: k.kind, cases: num(k.cases) })),
  };
}

// ---------------------------------------------------------------------------
// Origem do tráfego, telas, cliques e ferramentas grátis
// ---------------------------------------------------------------------------
export async function traffic(ctx: Ctx, days: number) {
  const from = `now() - make_interval(days => $1)`;
  const sources = await rows<{ source: string; medium: string; visitors: string; cases: string; paid: string; free_maps: string; cents: string }>(
    ctx,
    `WITH first_attr AS (
       SELECT DISTINCT ON (session_id) session_id, coalesce(nullif(props->'attr'->>'source',''), 'direto') AS source, coalesce(nullif(props->'attr'->>'medium',''), '') AS medium
         FROM app.events WHERE created_at >= ${from} AND props ? 'attr' ORDER BY session_id, id),
     vis AS (SELECT DISTINCT session_id FROM app.events WHERE created_at >= ${from})
     SELECT coalesce(a.source, 'direto') AS source, coalesce(a.medium, '') AS medium,
            count(DISTINCT v.session_id) AS visitors,
            count(DISTINCT c.id) AS cases,
            count(DISTINCT o.id) FILTER (WHERE o.total_cents > 0) AS paid,
            count(DISTINCT o.id) FILTER (WHERE o.total_cents = 0) AS free_maps,
            coalesce(sum(o.total_cents), 0) AS cents
       FROM vis v
       LEFT JOIN first_attr a ON a.session_id = v.session_id
       LEFT JOIN app.cases c ON c.session_id = v.session_id AND c.created_at >= ${from} AND ${NOT_TRANSLATOR}
       LEFT JOIN app.orders o ON o.session_id = v.session_id AND o.status = 'paid' AND o.paid_at >= ${from} AND o.case_id IS NOT NULL
      GROUP BY 1, 2 ORDER BY visitors DESC LIMIT 25`,
    [days],
  );
  const views = await rows<{ k: string; n: string; s: string }>(ctx, `SELECT props->>'view' AS k, count(*) AS n, count(DISTINCT session_id) AS s FROM app.events WHERE name = 'view' AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`, [days]);
  const ctas = await rows<{ k: string; n: string }>(ctx, `SELECT props->>'id' AS k, count(*) AS n FROM app.events WHERE name = 'cta' AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`, [days]);
  const tools = await rows<{ k: string; n: string; s: string }>(ctx, `SELECT props->>'tool' AS k, count(*) AS n, count(DISTINCT session_id) AS s FROM app.events WHERE name = 'tool' AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`, [days]);
  const steps = await rows<{ k: string; s: string }>(ctx, `SELECT props->>'step' AS k, count(DISTINCT session_id) AS s FROM app.events WHERE name = 'intake_step' AND created_at >= ${from} GROUP BY 1 ORDER BY 1`, [days]);
  const devices = await rows<{ k: string; n: string }>(ctx, `SELECT coalesce(props->'attr'->>'device', 'n/d') AS k, count(DISTINCT session_id) AS n FROM app.events WHERE props ? 'attr' AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC`, [days]);
  const ttp = await one(
    ctx,
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (o.paid_at - f.first_at))) AS median_s
       FROM app.orders o JOIN (SELECT session_id, min(created_at) AS first_at FROM app.events GROUP BY 1) f ON f.session_id = o.session_id
      WHERE o.status = 'paid' AND o.total_cents > 0 AND o.paid_at >= ${from} AND o.case_id IS NOT NULL AND o.paid_at >= f.first_at`,
    [days],
  );
  return {
    sources: sources.map((s) => ({ source: s.source, medium: s.medium, visitors: num(s.visitors), cases: num(s.cases), freeMaps: num(s.free_maps), paid: num(s.paid), revenueCents: num(s.cents), conversionPct: pct(num(s.paid), num(s.visitors)), mapPct: pct(num(s.free_maps), num(s.visitors)) })),
    views: views.map((v) => ({ view: v.k ?? 'n/d', events: num(v.n), sessions: num(v.s) })),
    ctas: ctas.map((c) => ({ id: c.k ?? 'n/d', clicks: num(c.n) })),
    tools: tools.map((t) => ({ tool: t.k ?? 'n/d', uses: num(t.n), sessions: num(t.s) })),
    intakeSteps: steps.map((s) => ({ step: s.k ?? 'n/d', sessions: num(s.s) })),
    devices: devices.map((d) => ({ device: d.k, sessions: num(d.n) })),
    medianSecondsToPay: ttp.median_s === null || ttp.median_s === undefined ? null : Math.round(num(ttp.median_s)),
    trackingSince: (await one(ctx, `SELECT min(created_at) AS t FROM app.events`)).t ?? null,
  };
}

// ---------------------------------------------------------------------------
// IA (uso e custo em tokens)
// ---------------------------------------------------------------------------
export async function aiUsage(ctx: Ctx, days: number) {
  const r = await rows<{ product: string; source: string; n: string; tin: string; tout: string }>(
    ctx,
    `SELECT product_code AS product, coalesce(generation_meta->>'source', 'n/d') AS source, count(*) AS n,
            coalesce(sum((generation_meta->>'inputTokens')::bigint), 0) AS tin, coalesce(sum((generation_meta->>'outputTokens')::bigint), 0) AS tout
       FROM app.deliverables WHERE status = 'ready' AND generated_at >= now() - make_interval(days => $1) AND product_code IN ('negotiation_scripts','extra_income_plan')
      GROUP BY 1, 2`,
    [days],
  );
  const total = (src: string) => r.filter((x) => x.source === src).reduce((s, x) => s + num(x.n), 0);
  return {
    byProduct: r.map((x) => ({ product: x.product, source: x.source, count: num(x.n), inputTokens: num(x.tin), outputTokens: num(x.tout) })),
    ai: total('ai'),
    template: total('template'),
    inputTokens: r.reduce((s, x) => s + num(x.tin), 0),
    outputTokens: r.reduce((s, x) => s + num(x.tout), 0),
  };
}

// ---------------------------------------------------------------------------
// Parcerias: tamanho do público e do "pool" com consentimento
// ---------------------------------------------------------------------------
export async function partnerships(ctx: Ctx, days: number) {
  const from = `now() - make_interval(days => $1)`;
  const consented = await rows<{ category: string; n: string }>(
    ctx,
    `SELECT cat AS category, count(*) AS n
       FROM app.v_current_consents v, jsonb_array_elements_text(v.scope->'categories') cat
      WHERE v.purpose = 'lead_sharing' AND v.action = 'grant' GROUP BY 1 ORDER BY 2 DESC`,
  );
  const consentedCases = num((await one(ctx, `SELECT count(*) AS n FROM app.v_current_consents WHERE purpose = 'lead_sharing' AND action = 'grant'`)).n);
  const consentedByUf = await rows<{ key: string; n: string }>(
    ctx,
    `SELECT coalesce(c.uf::text, 'n/d') AS key, count(*) AS n FROM app.v_current_consents v JOIN app.cases c ON c.id = v.case_id
      WHERE v.purpose = 'lead_sharing' AND v.action = 'grant' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
  );
  const consentedByEmployment = await rows<{ key: string; n: string }>(
    ctx,
    `SELECT coalesce(c.employment_type, 'n/d') AS key, count(*) AS n FROM app.v_current_consents v JOIN app.cases c ON c.id = v.case_id
      WHERE v.purpose = 'lead_sharing' AND v.action = 'grant' GROUP BY 1 ORDER BY 2 DESC`,
  );
  // Público potencial (ainda SEM consentimento; não é lista de contatos): quem tem o perfil de cada tipo de parceria.
  const pot = await one(
    ctx,
    `SELECT
       count(*) AS cases,
       count(*) FILTER (WHERE c.has_overdue) AS renegotiation,
       count(*) FILTER (WHERE c.employment_type IN ('clt','public_servant','inss_retiree') AND c.debt_kinds && ARRAY['credit_card','overdraft','personal_loan','store_credit']) AS consignado,
       count(*) FILTER (WHERE c.employment_type IN ('self_employed','other')) AS entrepreneurship,
       count(*) FILTER (WHERE c.net_income_cents IS NOT NULL AND c.net_income_cents <= 300000 AND c.has_overdue) AS low_income_overdue
       FROM app.cases c WHERE c.created_at >= ${from} AND ${NOT_TRANSLATOR}`,
    [days],
  );
  const interviews = await one(ctx, `SELECT count(*) AS n, count(*) FILTER (WHERE hours_band IN ('10_20h','mais_20h')) AS committed FROM app.income_interviews WHERE created_at >= ${from}`, [days]);
  const deliveries = await rows<{ status: string; n: string; cents: string }>(ctx, `SELECT status, count(*) AS n, coalesce(sum(price_cents),0) AS cents FROM app.lead_deliveries GROUP BY 1`);
  const partners = num((await one(ctx, `SELECT count(*) AS n FROM app.partners WHERE NOT internal`)).n);
  return {
    consentedCases,
    consentedByCategory: consented.map((c) => ({ category: c.category, count: num(c.n) })),
    consentedByUf: consentedByUf.map((c) => ({ key: c.key, count: num(c.n) })),
    consentedByEmployment: consentedByEmployment.map((c) => ({ key: c.key, count: num(c.n) })),
    potential: {
      cases: num(pot.cases),
      renegotiation: num(pot.renegotiation),
      consignadoProfile: num(pot.consignado),
      entrepreneurship: num(pot.entrepreneurship),
      lowIncomeOverdue: num(pot.low_income_overdue),
    },
    incomeInterviews: { total: num(interviews.n), committed: num(interviews.committed) },
    partners,
    deliveries: deliveries.map((d) => ({ status: d.status, count: num(d.n), cents: num(d.cents) })),
  };
}

// ---------------------------------------------------------------------------
// Visão do dashboard (junta o essencial em uma chamada)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Prumo (a página /prumo e o app /conta): acessos, usuários ativos, abas mais usadas e o funil até a assinatura.
// Só contagens. As telas vêm do rastreamento anônimo do site (app.events); "ativos" vêm do registro de uso do servidor (app.subscriber_activity).
// ---------------------------------------------------------------------------
const APP_VIEW = `(e.props->>'view' = 'account' OR left(coalesce(e.props->>'view', ''), 6) = 'conta_')`;
const PRUMO_ANY = `(e.props->>'view' = 'prumo' OR ${APP_VIEW})`;
const TODAY = `(now() AT TIME ZONE ${TZ})::date`;

export async function prumo(ctx: Ctx, days: number) {
  const from = `now() - make_interval(days => $1)`;
  const since = `${TODAY} - ($1::int - 1)`; // início do período em dias de Brasília
  const view = `e.name = 'view' AND e.created_at >= ${from}`;

  const k = await one(
    ctx,
    `SELECT
       (SELECT count(DISTINCT e.session_id) FROM app.events e WHERE ${view} AND e.props->>'view' = 'prumo') AS landing,
       (SELECT count(DISTINCT e.session_id) FROM app.events e WHERE ${view} AND ${APP_VIEW}) AS app_sessions,
       (SELECT count(*) FROM app.events e WHERE ${view} AND ${APP_VIEW}) AS app_views,
       (SELECT count(*) FROM app.events e WHERE ${view} AND e.props->>'view' = 'prumo') AS landing_views,
       (SELECT min(e.created_at) FROM app.events e WHERE left(coalesce(e.props->>'view', ''), 6) = 'conta_') AS app_tracking_since`,
    [days],
  );
  const act = await one(
    ctx,
    `SELECT
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${TODAY}) AS dau,
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${TODAY} - 6) AS wau,
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${TODAY} - 29) AS mau,
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${since}) AS period_users,
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${since} AND channel = 'app') AS period_app,
       count(DISTINCT subscriber_id) FILTER (WHERE day >= ${since} AND channel = 'whatsapp') AS period_whatsapp,
       min(day) AS tracking_since
       FROM app.subscriber_activity`,
    [days],
  );
  const ret = await one(
    ctx,
    `SELECT count(*) AS active, count(*) FILTER (WHERE d >= 2) AS returning
       FROM (SELECT subscriber_id, count(DISTINCT day) AS d FROM app.subscriber_activity WHERE day >= ${since} GROUP BY 1) x`,
    [days],
  );
  const byPlan = await rows<{ plan: string; n: string }>(
    ctx,
    `SELECT coalesce(s.plan, 'sem_plano') AS plan, count(DISTINCT a.subscriber_id) AS n
       FROM app.subscriber_activity a LEFT JOIN app.subscriptions s ON s.subscriber_id = a.subscriber_id
      WHERE a.day >= ${since} GROUP BY 1 ORDER BY 2 DESC`,
    [days],
  );
  const dayViews = await rows<{ day: string; landing: string; app: string }>(
    ctx,
    `SELECT to_char((e.created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
            count(DISTINCT e.session_id) FILTER (WHERE e.props->>'view' = 'prumo') AS landing,
            count(DISTINCT e.session_id) FILTER (WHERE ${APP_VIEW}) AS app
       FROM app.events e WHERE ${view} AND ${PRUMO_ANY} GROUP BY 1 ORDER BY 1`,
    [days],
  );
  const dayUsers = await rows<{ day: string; users: string; whatsapp: string }>(
    ctx,
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(DISTINCT subscriber_id) AS users, count(DISTINCT subscriber_id) FILTER (WHERE channel = 'whatsapp') AS whatsapp
       FROM app.subscriber_activity WHERE day >= ${since} GROUP BY 1 ORDER BY 1`,
    [days],
  );
  const dayKeys = [...new Set([...dayViews.map((d) => d.day), ...dayUsers.map((d) => d.day)])].sort();
  const tabs = await rows<{ tab: string; n: string; s: string; u: string }>(
    ctx,
    `SELECT substr(e.props->>'view', 7) AS tab, count(*) AS n, count(DISTINCT e.session_id) AS s, count(DISTINCT x.subscriber_id) AS u
       FROM app.events e LEFT JOIN app.sessions x ON x.id = e.session_id
      WHERE ${view} AND left(coalesce(e.props->>'view', ''), 6) = 'conta_' AND e.props->>'view' NOT IN ('conta_login', 'conta_planos')
      GROUP BY 1 ORDER BY 3 DESC, 2 DESC`,
    [days],
  );
  const ctas = await rows<{ id: string; n: string; s: string }>(
    ctx,
    `SELECT e.props->>'id' AS id, count(*) AS n, count(DISTINCT e.session_id) AS s
       FROM app.events e WHERE e.name = 'cta' AND e.created_at >= ${from} AND left(coalesce(e.props->>'id', ''), 6) = 'prumo_' GROUP BY 1 ORDER BY 2 DESC`,
    [days],
  );
  const f = await one(
    ctx,
    `SELECT
       (SELECT count(DISTINCT e.session_id) FROM app.events e WHERE ${view} AND e.props->>'view' = 'prumo') AS landing,
       (SELECT count(DISTINCT e.session_id) FROM app.events e WHERE ${view} AND ${APP_VIEW}) AS opened_app,
       (SELECT count(DISTINCT e.session_id) FROM app.events e WHERE e.name = 'cta' AND e.created_at >= ${from} AND e.props->>'id' = 'prumo_pedir_codigo') AS asked_code,
       (SELECT count(*) FROM app.subscribers WHERE deleted_at IS NULL AND created_at >= ${from}) AS new_accounts,
       (SELECT count(DISTINCT subscriber_id) FROM app.orders WHERE subscriber_id IS NOT NULL AND created_at >= ${from}) AS started_checkout,
       (SELECT count(*) FROM (SELECT subscriber_id, min(paid_at) AS first_paid FROM app.orders WHERE subscriber_id IS NOT NULL AND status = 'paid' GROUP BY 1) x WHERE first_paid >= ${from}) AS subscribed,
       (SELECT count(DISTINCT entity_id) FROM app.audit_log WHERE entity = 'subscriber' AND action = 'subscriber_login' AND occurred_at >= ${from}) AS logins`,
    [days],
  );
  const steps = [
    { key: 'landing', label: 'Visitaram a página do Prumo (/prumo)', count: num(f.landing) },
    { key: 'opened_app', label: 'Abriram o app (/conta)', count: num(f.opened_app) },
    { key: 'asked_code', label: 'Pediram o código de acesso', count: num(f.asked_code) },
    { key: 'new_accounts', label: 'Criaram a conta (primeiro acesso)', count: num(f.new_accounts) },
    { key: 'started_checkout', label: 'Geraram a cobrança do plano', count: num(f.started_checkout) },
    { key: 'subscribed', label: 'Assinaram (primeiro pagamento)', count: num(f.subscribed) },
  ];
  const funnelSteps = steps.map((s, i) => ({ ...s, pctOfPrev: i === 0 ? null : pct(Math.min(s.count, steps[i - 1]!.count), steps[i - 1]!.count), pctOfFirst: pct(Math.min(s.count, steps[0]!.count), steps[0]!.count) }));
  const fa = `first_attr AS (SELECT DISTINCT ON (session_id) session_id, coalesce(nullif(props->'attr'->>'source',''), 'direto') AS source, coalesce(nullif(props->'attr'->>'medium',''), '') AS medium, props->'attr'->>'device' AS device FROM app.events WHERE props ? 'attr' ORDER BY session_id, id)`;
  const sessionsIn = `s AS (SELECT DISTINCT e.session_id FROM app.events e WHERE ${view} AND ${PRUMO_ANY})`;
  const sources = await rows<{ source: string; medium: string; n: string }>(ctx, `WITH ${sessionsIn}, ${fa} SELECT coalesce(a.source, 'direto') AS source, coalesce(a.medium, '') AS medium, count(*) AS n FROM s LEFT JOIN first_attr a ON a.session_id = s.session_id GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`, [days]);
  const devices = await rows<{ device: string; n: string }>(ctx, `WITH ${sessionsIn}, ${fa} SELECT coalesce(a.device, 'n/d') AS device, count(*) AS n FROM s LEFT JOIN first_attr a ON a.session_id = s.session_id GROUP BY 1 ORDER BY 2 DESC`, [days]);
  const subs = await one(ctx, `SELECT count(*) AS total FROM app.subscribers WHERE deleted_at IS NULL`);

  return {
    days,
    kpis: {
      landingVisitors: num(k.landing), landingViews: num(k.landing_views), appSessions: num(k.app_sessions), appViews: num(k.app_views),
      activeUsers: num(act.period_users), activeApp: num(act.period_app), activeWhatsapp: num(act.period_whatsapp),
      dau: num(act.dau), wau: num(act.wau), mau: num(act.mau),
      returningUsers: num(ret.returning), returningPct: pct(num(ret.returning), num(ret.active)),
      logins: num(f.logins), newAccounts: num(f.new_accounts), totalSubscribers: num(subs.total),
    },
    funnel: funnelSteps,
    byDay: dayKeys.map((day) => ({ day, landing: num(dayViews.find((d) => d.day === day)?.landing ?? 0), app: num(dayViews.find((d) => d.day === day)?.app ?? 0), users: num(dayUsers.find((d) => d.day === day)?.users ?? 0), whatsapp: num(dayUsers.find((d) => d.day === day)?.whatsapp ?? 0) })),
    tabs: tabs.map((t) => ({ tab: t.tab, events: num(t.n), sessions: num(t.s), users: num(t.u) })),
    ctas: ctas.map((c) => ({ id: c.id, clicks: num(c.n), sessions: num(c.s) })),
    byPlan: byPlan.map((p) => ({ plan: p.plan, users: num(p.n) })),
    sources: sources.map((s) => ({ source: s.source, medium: s.medium, sessions: num(s.n) })),
    devices: devices.map((d) => ({ device: d.device, sessions: num(d.n) })),
    appTrackingSince: k.app_tracking_since ?? null,
    activityTrackingSince: act.tracking_since ?? null,
  };
}

export async function dashboard(ctx: Ctx, days: number) {
  const [f, rev, subs, prof, tr, ai, pm] = await Promise.all([funnel(ctx, days), revenue(ctx, days), subscriptions(ctx, days), customerProfile(ctx, days), traffic(ctx, days), aiUsage(ctx, days), prumo(ctx, days)]);
  return { days, generatedAt: new Date().toISOString(), funnel: f, revenue: rev, subscriptions: subs, profile: prof, traffic: tr, ai, prumo: pm };
}
