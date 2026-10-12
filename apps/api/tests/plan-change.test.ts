// Troca de plano no meio do mês com pró-rata por dia: upgrade (paga a diferença agora), downgrade (crédito na próxima fatura),
// upgrade pequeno demais para cobrar, bloqueios e troca abandonada. O período e o dia da cobrança nunca mudam.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { prorate } from '../src/plan-change.ts';
import { syncPrices } from '../src/referrals.ts';
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
  return async (method: 'GET' | 'POST', url: string, opts: { body?: unknown } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
type Client = ReturnType<typeof client>;
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
async function login(c: Client, email: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
}
const pay = async (providerPaymentId: string, eventId: string) => {
  gateway.markPaid(providerPaymentId);
  return handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId, paymentId: providerPaymentId });
};
/** Conta com assinatura no cartão ativa no plano dado. */
async function subscribed(email: string, plan: 'controle' | 'ousado' | 'desbravador') {
  const c = client();
  await login(c, email);
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan, acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  assert.equal(await pay(p.rows[0]!.provider_payment_id, `evt-first-${email}`), 'confirmed');
  const id = (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;
  return { c, id };
}
const setDaysLeft = (id: string, days: number) => db.query(`UPDATE app.subscriptions SET current_period_end = now() + make_interval(days => $2) WHERE subscriber_id = $1`, [id, days]);
const price = async (code: string) => Number((await db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1`, [code])).rows[0]!.price_cents);
const subId = async (id: string) => (await db.query<{ s: string }>(`SELECT provider_subscription_id AS s FROM app.billing_profiles WHERE subscriber_id = $1`, [id])).rows[0]!.s;

test('pró-rata: diferença x dias que faltam / dias do período, nunca negativa', () => {
  assert.equal(prorate(3000, 10, 30), 1000);
  assert.equal(prorate(3000, 30, 30), 3000);
  assert.equal(prorate(3000, 45, 30), 3000, 'não passa do período inteiro');
  assert.equal(prorate(3000, 0, 30), 0);
  assert.equal(prorate(-500, 10, 30), 0);
  assert.equal(prorate(3001, 1, 30), 100);
});

test('upgrade: mostra a diferença proporcional, só troca depois de pago, mantém o período e passa ao preço cheio', async () => {
  const { c, id } = await subscribed('up@exemplo.com', 'controle');
  await setDaysLeft(id, 10);
  const from = await price('sub_controle');
  const to = await price('sub_desbravador');
  const q = await c('GET', '/api/account/plan-change/quote?plan=desbravador');
  assert.equal(q.status, 200);
  assert.equal(q.json.kind, 'upgrade');
  assert.equal(q.json.daysLeft, 10);
  assert.equal(q.json.prorataCents, prorate(to - from, 10, q.json.periodDays));
  assert.equal(q.json.chargeNowCents, q.json.prorataCents);
  assert.equal(q.json.nextChargeCents, to, 'nos meses seguintes, o valor cheio do plano novo');

  assert.equal((await c('POST', '/api/account/plan-change', { body: { plan: 'desbravador', acceptTerms: false } })).status, 422, 'exige confirmar a cobrança proporcional');
  const started = await c('POST', '/api/account/plan-change', { body: { plan: 'desbravador', acceptTerms: true } });
  assert.equal(started.status, 201);
  assert.equal(started.json.status, 'payment_required');
  assert.match(started.json.checkoutUrl, /^DEMO-CARD-/);
  assert.equal((await c('GET', '/api/account')).json.subscription.plan, 'controle', 'antes de pagar, nada muda');

  const endBefore = (await c('GET', '/api/account')).json.subscription.periodEnd;
  const pp = await db.query<{ provider_payment_id: string; amount_cents: string }>(`SELECT provider_payment_id, amount_cents FROM app.payments WHERE order_id = $1`, [started.json.orderId]);
  assert.equal(Number(pp.rows[0]!.amount_cents), q.json.prorataCents);
  assert.equal(await pay(pp.rows[0]!.provider_payment_id, 'evt-upgrade-1'), 'confirmed');

  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.subscription.plan, 'desbravador');
  assert.equal(acc.subscription.periodEnd, endBefore, 'a troca não estende nem encurta o período já pago');
  assert.equal(acc.billing.priceCents, to);
  await syncPrices(ctx());
  assert.equal(gateway.valueOf(await subId(id)), to, 'a próxima fatura no provedor passa ao preço cheio do plano novo');
  const done = await db.query<{ status: string }>(`SELECT status FROM app.plan_changes WHERE subscriber_id = $1`, [id]);
  assert.deepEqual(done.rows.map((r) => r.status), ['applied']);
  // O pagamento da diferença não conta como mensalidade: o webhook repetido não duplica nada.
  assert.equal(await pay(pp.rows[0]!.provider_payment_id, 'evt-upgrade-1'), 'duplicate');
});

test('downgrade: vale na hora, a diferença proporcional vira crédito só na próxima fatura e depois volta ao preço cheio', async () => {
  const { c, id } = await subscribed('down@exemplo.com', 'desbravador');
  await setDaysLeft(id, 15);
  const from = await price('sub_desbravador');
  const to = await price('sub_ousado');
  const q = await c('GET', '/api/account/plan-change/quote?plan=ousado');
  assert.equal(q.json.kind, 'downgrade');
  assert.equal(q.json.chargeNowCents, 0);
  assert.equal(q.json.creditCents, prorate(from - to, 15, q.json.periodDays));
  const out = await c('POST', '/api/account/plan-change', { body: { plan: 'ousado', acceptTerms: true } });
  assert.equal(out.json.status, 'applied');
  assert.equal((await c('GET', '/api/account')).json.subscription.plan, 'ousado');
  await syncPrices(ctx());
  assert.equal(gateway.valueOf(await subId(id)), to - q.json.creditCents, 'a próxima fatura sai com o crédito');

  const renew = await c('POST', '/api/dev/renew');
  assert.equal(renew.json.outcome, 'confirmed');
  const left = await db.query<{ plan_credit_cents: number }>(`SELECT plan_credit_cents FROM app.billing_profiles WHERE subscriber_id = $1`, [id]);
  assert.equal(left.rows[0]!.plan_credit_cents, 0, 'o crédito vale uma fatura só');
  await syncPrices(ctx());
  assert.equal(gateway.valueOf(await subId(id)), to, 'depois, o valor normal do plano escolhido');
});

test('upgrade nos últimos dias, com diferença abaixo do mínimo do provedor: libera na hora, sem cobrança extra', async () => {
  const { c, id } = await subscribed('pouco@exemplo.com', 'ousado');
  await setDaysLeft(id, 1);
  const q = await c('GET', '/api/account/plan-change/quote?plan=desbravador');
  assert.equal(q.json.waived, true);
  assert.equal(q.json.chargeNowCents, 0);
  const out = await c('POST', '/api/account/plan-change', { body: { plan: 'desbravador', acceptTerms: true } });
  assert.equal(out.json.status, 'applied');
  assert.equal((await c('GET', '/api/account')).json.subscription.plan, 'desbravador');
});

test('bloqueios: mesmo plano, plano inválido, cancelada, sem assinatura no cartão', async () => {
  const { c, id } = await subscribed('bloq@exemplo.com', 'ousado');
  assert.equal((await c('GET', '/api/account/plan-change/quote?plan=ousado')).status, 422);
  assert.equal((await c('GET', '/api/account/plan-change/quote?plan=platina')).status, 422);
  await db.query(`UPDATE app.billing_profiles SET status = 'past_due' WHERE subscriber_id = $1`, [id]);
  assert.equal((await c('GET', '/api/account/plan-change/quote?plan=desbravador')).status, 409, 'cartão recusado: regulariza antes');
  await db.query(`UPDATE app.billing_profiles SET status = 'canceled' WHERE subscriber_id = $1`, [id]);
  assert.equal((await c('POST', '/api/account/plan-change', { body: { plan: 'desbravador', acceptTerms: true } })).status, 409, 'cancelada: só assina de novo depois do fim do mês pago');
  const sem = client();
  await login(sem, 'semplano@exemplo.com');
  assert.equal((await sem('GET', '/api/account/plan-change/quote?plan=ousado')).status, 409);
});

test('troca abandonada: abrir outra cancela a anterior; pagar a antiga depois não muda o plano nem estende o período', async () => {
  const { c, id } = await subscribed('abandona@exemplo.com', 'controle');
  await setDaysLeft(id, 20);
  const first = await c('POST', '/api/account/plan-change', { body: { plan: 'desbravador', acceptTerms: true } });
  const second = await c('POST', '/api/account/plan-change', { body: { plan: 'ousado', acceptTerms: true } });
  assert.equal(second.json.status, 'payment_required');
  const st = await db.query<{ status: string; to_plan: string }>(`SELECT status, to_plan FROM app.plan_changes WHERE subscriber_id = $1 ORDER BY created_at`, [id]);
  assert.deepEqual(st.rows.map((r) => `${r.to_plan}:${r.status}`), ['desbravador:canceled', 'ousado:pending']);
  const endBefore = (await c('GET', '/api/account')).json.subscription.periodEnd;
  const old = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [first.json.orderId]);
  await pay(old.rows[0]!.provider_payment_id, 'evt-stale-1');
  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.subscription.plan, 'controle', 'a troca cancelada não vale');
  assert.equal(acc.subscription.periodEnd, endBefore);
  const audited = await db.query(`SELECT 1 FROM app.audit_log WHERE action = 'plan_change_paid_but_not_pending'`);
  assert.equal(audited.rows.length, 1, 'fica registrado para devolver o valor');
});
