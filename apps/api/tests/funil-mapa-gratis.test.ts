// Funil e painel com o Mapa grátis: quem não terminou o formulário, quem viu o resultado e não liberou o Mapa, quem abriu o Mapa e não seguiu,
// quem seguiu (formulário do parceiro, outros produtos, banner) e quem pagou, por produto cobrado. Pedido de R$ 0 nunca conta como receita.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook } from '../src/services.ts';
import { dashboard, funnel } from '../src/admin/metrics.ts';
import { insights } from '../src/admin/marketing.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', mapFree: true, leadsEnabled: true };
const ctx = () => ({ db, config, gateway, email: mailbox }) as never;

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
type Client = ReturnType<typeof client>;
const caseBody = {
  profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 30 }],
  acceptTerms: true,
};
let n = 0;
async function diagnose(): Promise<{ c: Client; caseId: string }> {
  const c = client();
  const created = await c('POST', '/api/cases', caseBody);
  return { c, caseId: created.json.caseId };
}
async function freeMap(c: Client, caseId: string) {
  n += 1;
  const order = await c('POST', '/api/orders', { caseId, products: ['recovery_map'], contact: { email: `pessoa${n}@exemplo.com`, phone: '34998375296', adsConsent: false } }, { 'idempotency-key': `funil-gratis-${n}` });
  assert.equal(order.json.status, 'paid');
  return order.json.orderId as string;
}

test('funil com o Mapa grátis: abandono do formulário, resultado sem Mapa, Mapa sem seguir, parceiro, outros produtos, banner e pagamentos por produto', async () => {
  const p = await db.query<{ id: string }>(`INSERT INTO app.partners(legal_name, cnpj, category, status, trade_name) VALUES ('Banco Funil SA','11222333000181','consignado','active','Banco Funil') RETURNING id`);
  const camp = (await db.query<{ id: string }>(
    `INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, employment_types, ufs, price_per_lead_cents, commission_bps, daily_cap, banner_on, banner_title, banner_text, banner_url)
     VALUES ($1,'Campanha funil','active','consignado',ARRAY['clt']::text[],ARRAY['SP']::char(2)[],1000,500,10,true,'Compare','Veja as condições','https://parceiro.exemplo.com/oferta') RETURNING id`,
    [p.rows[0]!.id],
  )).rows[0]!.id;

  // A: começou o formulário e não terminou
  const a = client();
  await a('POST', '/api/events', { name: 'view', props: { view: 'intake' } });
  // B: viu o resultado e não liberou o Mapa
  await diagnose();
  // C: abriu o Mapa e parou
  const cc = await diagnose();
  await freeMap(cc.c, cc.caseId);
  // D: abriu o Mapa e preencheu o formulário do parceiro
  const d = await diagnose();
  await freeMap(d.c, d.caseId);
  const lead = await d.c('POST', `/api/cases/${d.caseId}/leads`, { name: 'Maria Silva', phone: '11987654321', categories: ['consignado'], consent: true });
  assert.equal(lead.status, 201);
  // E: abriu o Mapa, viu um complemento e clicou no banner
  const e = await diagnose();
  await freeMap(e.c, e.caseId);
  await e.c('POST', '/api/events', { name: 'view', props: { view: 'addon' } });
  await e.c('POST', '/api/events', { name: 'view', props: { view: 'mapa_banner', camp } });
  await e.c('POST', '/api/events', { name: 'cta', props: { id: 'banner_clique', camp, where: 'top' } });
  // F: abriu o Mapa e comprou as cartas (produto cobrado)
  const f = await diagnose();
  await freeMap(f.c, f.caseId);
  const letters = await f.c('POST', '/api/orders', { caseId: f.caseId, products: ['defense_letters'] }, { 'idempotency-key': 'funil-cartas-1' });
  assert.equal(letters.status, 201);
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [letters.json.orderId]);
  gateway.markPaid(pay.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-funil-cartas', paymentId: pay.rows[0]!.provider_payment_id });

  const fn = await funnel(ctx(), 30);
  const step = (k: string) => fn.steps.find((s) => s.key === k)!.count;
  assert.equal(step('diagnosed'), 5, 'B, C, D, E e F');
  assert.equal(step('mapped'), 4, 'C, D, E e F liberaram o Mapa');
  assert.equal(step('followed'), 3, 'D, E e F seguiram');
  assert.equal(step('paid'), 1, 'só F pagou (produto cobrado)');
  const ab = fn.abandonment;
  assert.equal(ab.startedNotFinished, 1, 'A começou e não terminou');
  assert.equal(ab.diagnosedNoMap, 1, 'B viu o resultado e não liberou o Mapa');
  assert.equal(ab.mapReleased, 4);
  assert.equal(ab.mapNoFollow, 1, 'só C abriu o Mapa e parou');
  assert.equal(ab.mapPartner, 1);
  assert.equal(ab.partnerForms, 1);
  assert.equal(ab.mapOther, 2, 'E (complemento visto) e F (cartas)');
  assert.equal(ab.mapBanner, 1);
  assert.equal(ab.mapRatePct, 80);
  assert.deepEqual(fn.mapsBySource, [{ provider: 'free', maps: 4 }]);

  const letter = fn.products.find((x) => x.code === 'defense_letters')!;
  assert.equal(letter.paid, 1);
  assert.equal(letter.orders, 1);
  assert.ok(letter.revenueCents > 0);
  assert.ok(!fn.products.some((x) => x.code === 'recovery_map'), 'o Mapa grátis não aparece como produto cobrado');

  assert.equal(fn.partners.consentsGranted, 1);
  assert.equal(fn.partners.consentsRevoked, 0);
  assert.equal(fn.banner.shown, 1);
  assert.equal(fn.banner.clicks, 1);
  assert.equal(fn.banner.ctrPct, 100);
  assert.deepEqual(fn.banner.byCampaign.map((b) => [b.campaign, b.partner, b.shown, b.clicks]), [['Campanha funil', 'Banco Funil', 1, 1]]);

  // receita: pedido de R$ 0 nunca conta
  const dash = await dashboard(ctx(), 30);
  assert.equal(dash.revenue.orders, 1);
  assert.equal(dash.revenue.grossCents, letter.revenueCents);
  assert.ok(!dash.revenue.byProduct.some((x) => x.code === 'recovery_map'));
  assert.ok(dash.revenue.byMethod.every((m) => m.cents > 0));
  assert.ok(!JSON.stringify(dash.funnel).includes('pessoa1@exemplo.com'), 'nenhum dado pessoal no funil');

  // os insights usam o funil novo sem quebrar
  const ins = await insights(ctx(), 30);
  assert.ok(Array.isArray(ins.insights));
});
