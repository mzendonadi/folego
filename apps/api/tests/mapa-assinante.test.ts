// Mapa da Virada para quem assina o Prumo: Ousado paga um preço especial (Pix) e tem 90 dias; Desbravador usa sem pagar enquanto a assinatura valer;
// Controle segue com o preço e o prazo de sempre. Preço e prazo são do servidor.
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

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };
const ctx = () => ({ db, config, gateway, email: mailbox });

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
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
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
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }],
  acceptTerms: true,
};
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
let seq = 0;

async function payOrder(orderId: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${orderId}-${++seq}`, paymentId: p.rows[0]!.provider_payment_id });
}
async function assinante(email: string, plan: 'controle' | 'ousado' | 'desbravador'): Promise<Client> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { email });
  await c('POST', '/api/account/login', { email, code: lastCode() });
  const co = await c('POST', '/api/account/subscription-checkout', { plan, acceptTerms: true });
  await payOrder(co.json.orderId);
  return c;
}
const days = (until: number) => (until - Date.now()) / 86_400_000;

test('Controle: sem oferta e com o preço e o prazo de sempre', async () => {
  const c = await assinante('mapa-controle@exemplo.com', 'controle');
  assert.deepEqual((await c('GET', '/api/account/map-offer')).json, { eligible: false });
  const created = await c('POST', '/api/cases', caseBody);
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'controle-0001' });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const regular = await db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = 'recovery_map'`);
  assert.equal(order.json.totalCents, Number(regular.rows[0]!.price_cents));
  await payOrder(order.json.orderId);
  const ent = await db.query<{ expires_at: string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'recovery_map'`, [created.json.caseId]);
  const d = days(new Date(ent.rows[0]!.expires_at).getTime());
  assert.ok(d > 29 && d < 31, `prazo normal de 30 dias (deu ${d})`);
});

test('visitante sem conta não vê a oferta', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/account/map-offer')).status, 401);
});

test('Ousado: R$ 12,99 no Pix, 90 dias, dados guardados pelo prazo, não compra de novo enquanto ativo e recompra depois de vencer', async () => {
  const c = await assinante('mapa-ousado@exemplo.com', 'ousado');
  const offer = (await c('GET', '/api/account/map-offer')).json;
  assert.equal(offer.eligible, true);
  assert.equal(offer.plan, 'ousado');
  assert.equal(offer.mode, 'paid');
  assert.equal(offer.priceCents, 1299);
  assert.equal(offer.days, 90);
  assert.equal(offer.discountCents, offer.regularCents - 1299);
  assert.equal(offer.active, null);
  assert.equal(offer.email, 'mapa-ousado@exemplo.com');

  const created = await c('POST', '/api/cases', caseBody);
  const caseId = created.json.caseId;
  const order = await c('POST', '/api/orders', { caseId, products: ['recovery_map'] }, { 'idempotency-key': 'ousado-0001' });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.totalCents, 1299);
  assert.equal(order.json.status, 'pending', 'Ousado paga de verdade, pelo Pix');
  await payOrder(order.json.orderId);

  const ent = await db.query<{ expires_at: string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'recovery_map'`, [caseId]);
  const d = days(new Date(ent.rows[0]!.expires_at).getTime());
  assert.ok(d > 89 && d < 91, `90 dias de acesso (deu ${d})`);
  const kept = await db.query<{ purge_after: string }>(`SELECT purge_after FROM app.cases WHERE id = $1`, [caseId]);
  assert.ok(days(new Date(kept.rows[0]!.purge_after).getTime()) > 89, 'os dados ficam guardados enquanto o acesso vale');
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 200);

  const after = (await c('GET', '/api/account/map-offer')).json;
  assert.equal(after.active.orderId, order.json.orderId);
  assert.ok(after.active.until > Date.now());

  // enquanto ativo: nada de comprar outro; é para refazer
  const again = await c('POST', '/api/cases', caseBody);
  const second = await c('POST', '/api/orders', { caseId: again.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'ousado-0002' });
  assert.equal(second.status, 409);
  assert.equal(second.json.error, 'map_active');
  const redo = await c('POST', `/api/orders/${order.json.orderId}/redo/map`, { profile: caseBody.profile, debts: caseBody.debts });
  assert.equal(redo.status, 200, JSON.stringify(redo.json));

  // vencido: o Mapa se encerra e pode contratar de novo, pelo mesmo fluxo
  await db.query(`UPDATE app.entitlements SET expires_at = now() - interval '1 day' WHERE case_id = $1`, [caseId]);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 403);
  assert.equal((await c('GET', '/api/account/map-offer')).json.active, null);
  const third = await c('POST', '/api/orders', { caseId: again.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'ousado-0003' });
  assert.equal(third.status, 201, JSON.stringify(third.json));
  assert.equal(third.json.totalCents, 1299);
});

test('Ousado: o desconto de combo não se soma ao preço de assinante', async () => {
  const c = await assinante('mapa-ousado2@exemplo.com', 'ousado');
  const created = await c('POST', '/api/cases', { ...caseBody, debts: [{ creditorName: 'Banco Y', kind: 'personal_loan', balanceCents: 500_000, monthlyPaymentCents: 60_000, daysOverdue: 120 }] });
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map', 'calendar_30d'] }, { 'idempotency-key': 'ousado-kit-1' });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const cal = await db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = 'calendar_30d'`);
  assert.equal(order.json.totalCents, 1299 + Number(cal.rows[0]!.price_cents));
});

test('Desbravador: usa o Mapa sem pagar, o acesso acompanha a assinatura e se estende na renovação', async () => {
  const c = await assinante('mapa-desb@exemplo.com', 'desbravador');
  const offer = (await c('GET', '/api/account/map-offer')).json;
  assert.equal(offer.eligible, true);
  assert.equal(offer.mode, 'free');
  assert.equal(offer.priceCents, 0);

  const created = await c('POST', '/api/cases', caseBody);
  const caseId = created.json.caseId;
  const order = await c('POST', '/api/orders', { caseId, products: ['recovery_map'] }, { 'idempotency-key': 'desb-0001' });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.status, 'paid', 'já nasce liberado, sem Pix');
  assert.equal(order.json.totalCents, 0);
  const pay = await db.query<{ provider: string; amount_cents: string }>(`SELECT provider, amount_cents FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  assert.equal(pay.rows[0]!.provider, 'plan');
  assert.equal(Number(pay.rows[0]!.amount_cents), 0);

  const sub = await db.query<{ current_period_end: string }>(`SELECT s.current_period_end FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id WHERE b.email = 'mapa-desb@exemplo.com'`);
  const end1 = new Date(sub.rows[0]!.current_period_end).getTime();
  const ent = await db.query<{ expires_at: string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'recovery_map'`, [caseId]);
  const exp1 = new Date(ent.rows[0]!.expires_at).getTime();
  assert.ok(Math.abs(exp1 - end1) < 2 * 86_400_000, 'acesso até o fim do período da assinatura (arredondado em dias)');
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 200);
  assert.equal((await c('GET', '/api/account/map-offer')).json.active.orderId, order.json.orderId);

  // enquanto ativo, refazer e não criar outro
  const dup = await c('POST', '/api/orders', { caseId: (await c('POST', '/api/cases', caseBody)).json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'desb-0002' });
  assert.equal(dup.status, 409);

  // renovação (novo pagamento mensal): o período e o acesso do Mapa andam juntos
  const renew = await c('POST', '/api/account/subscription-order', { plan: 'desbravador' }, { 'idempotency-key': 'desb-renova-0001' });
  await payOrder(renew.json.orderId);
  const sub2 = await db.query<{ current_period_end: string }>(`SELECT s.current_period_end FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id WHERE b.email = 'mapa-desb@exemplo.com'`);
  const end2 = new Date(sub2.rows[0]!.current_period_end).getTime();
  assert.ok(end2 > end1 + 25 * 86_400_000);
  const ent2 = await db.query<{ expires_at: string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'recovery_map'`, [caseId]);
  assert.equal(new Date(ent2.rows[0]!.expires_at).getTime(), end2, 'o acesso do Mapa foi estendido junto com a assinatura');
});

test('apagar a conta leva o Mapa que veio com a assinatura', async () => {
  const c = await assinante('mapa-apagar@exemplo.com', 'desbravador');
  const created = await c('POST', '/api/cases', caseBody);
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'apagar-0001' });
  assert.equal(order.json.status, 'paid');
  assert.equal((await c('DELETE', '/api/account')).status, 204);
  const left = await db.query<{ status: string }>(`SELECT status FROM app.cases WHERE id = $1`, [created.json.caseId]);
  assert.equal(left.rows[0]!.status, 'purged');
});
