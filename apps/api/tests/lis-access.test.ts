// Cheque especial (LIS) nas carteiras, observação de "Outra situação" e link de acesso em vários aparelhos.
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
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
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
async function subscribe(c: Client, email: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'controle', acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}

const validCase = () => ({
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Aluguel', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 }],
  acceptTerms: true,
});

test('cheque especial (LIS): limite, uso, custo e alerta na visão do mês', async () => {
  const c = client();
  await subscribe(c, 'lis@exemplo.com');
  const created = await c('POST', '/api/account/wallets', { body: { name: 'Banco', kind: 'conta', openingBalanceCents: 20_000, overdraftLimitCents: 100_000, overdraftRateBps: 800 } });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const today = new Date().toISOString().slice(0, 10);
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, note: 'Mercado', amountCents: -70_000, walletId: id }] } });
  const list = await c('GET', '/api/account/wallets');
  const w = list.json.wallets.find((x: any) => x.id === id);
  assert.equal(w.balanceCents, -50_000); // saldo de partida 200 - 700
  assert.equal(w.overdraft.usedCents, 50_000);
  assert.equal(w.overdraft.usedPct, 50);
  assert.equal(w.overdraft.monthlyCostCents, 4_000); // 8% de R$ 500
  assert.equal(w.overdraft.level, 'high');
  const month = await c('GET', `/api/account/month/${today.slice(0, 7)}`);
  assert.ok(month.json.alerts.some((a: any) => /cheque especial/i.test(a.title)), 'alerta de LIS na visão do mês');
  // passa do limite
  await c('PUT', `/api/account/wallets/${id}`, { body: { overdraftLimitCents: 30_000 } });
  const over = (await c('GET', '/api/account/wallets')).json.wallets.find((x: any) => x.id === id);
  assert.equal(over.overdraft.level, 'over');
  assert.equal(over.overdraft.overLimitCents, 20_000);
});

test('LIS só vale em conta bancária e respeita os limites de valor', async () => {
  const c = client();
  await subscribe(c, 'lis2@exemplo.com');
  const cash = await c('POST', '/api/account/wallets', { body: { name: 'Carteira', kind: 'dinheiro' } });
  assert.equal(cash.status, 201);
  assert.equal((await c('PUT', `/api/account/wallets/${cash.json.id}`, { body: { overdraftLimitCents: 1000 } })).status, 422);
  assert.equal((await c('POST', '/api/account/wallets', { body: { name: 'X', kind: 'conta', overdraftRateBps: 99_999 } })).status, 400);
  assert.equal((await c('POST', '/api/account/wallets', { body: { name: 'X', kind: 'conta', overdraftLimitCents: -1 } })).status, 400);
  const other = client();
  await subscribe(other, 'lis3@exemplo.com');
  assert.equal((await other('PUT', `/api/account/wallets/${cash.json.id}`, { body: { name: 'invadida' } })).status, 404, 'carteira de outra conta não se altera');
});

test('"Outra situação": a observação é guardada no caso e não entra no cálculo', async () => {
  const c = client();
  const body = validCase() as any;
  body.profile.employmentType = 'other';
  body.profile.employmentNote = 'bicos de diarista';
  const r = await c('POST', '/api/cases', { body });
  assert.equal(r.status, 201);
  const row = await db.query<{ n: string | null }>(`SELECT inputs->>'employmentNote' AS n FROM app.cases WHERE id = $1`, [r.json.caseId]);
  assert.equal(row.rows[0]!.n, 'bicos de diarista');
  const longNote = validCase() as any;
  longNote.profile.employmentNote = 'x'.repeat(61);
  assert.equal((await client()('POST', '/api/cases', { body: longNote })).status, 400);
});

test('link de acesso: o novo aparelho ganha acesso e o original continua com o dele', async () => {
  const a = client();
  const created = await a('POST', '/api/cases', { body: validCase() });
  const o = await a('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'two-devices-0001' } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-two-devices', paymentId: p.rows[0]!.provider_payment_id });
  const link = await a('POST', `/api/orders/${o.json.orderId}/access-link`, { body: {} });
  assert.equal(link.status, 200);

  const b = client();
  assert.equal((await b('GET', `/api/orders/${o.json.orderId}/delivery`)).status, 404, 'antes do link, o aparelho B não vê nada');
  assert.equal((await b('POST', '/api/access', { body: { token: link.json.token } })).status, 200);
  assert.equal((await b('GET', `/api/orders/${o.json.orderId}/delivery`)).status, 200, 'B abre o Mapa');
  assert.equal((await a('GET', `/api/orders/${o.json.orderId}/delivery`)).status, 200, 'A continua abrindo');
  assert.ok((await a('GET', '/api/me')).json.access, 'A continua reconhecido em /api/me');

  // um terceiro aparelho sem o link continua sem acesso
  assert.equal((await client()('GET', `/api/orders/${o.json.orderId}/delivery`)).status, 404);

  // quem não tem o link não apaga o caso; B (com acesso) apaga e some para os dois
  assert.equal((await client()('DELETE', `/api/cases/${created.json.caseId}`)).status, 404);
  assert.equal((await b('DELETE', `/api/cases/${created.json.caseId}`)).status, 204);
  assert.notEqual((await a('GET', `/api/orders/${o.json.orderId}/delivery`)).status, 200);
});

test('link de acesso: no máximo 5 aparelhos por caso', async () => {
  const a = client();
  const created = await a('POST', '/api/cases', { body: validCase() });
  const o = await a('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'five-devices-0001' } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-five', paymentId: p.rows[0]!.provider_payment_id });
  const { token } = (await a('POST', `/api/orders/${o.json.orderId}/access-link`, { body: {} })).json;
  for (let i = 0; i < 7; i++) {
    const d = client();
    assert.equal((await d('POST', '/api/access', { body: { token } })).status, 200);
  }
  const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.case_access WHERE case_id = $1`, [created.json.caseId]);
  assert.equal(n.rows[0]!.n, '5');
});

test('LIS entra nas dívidas (plano de quitação) e no coach', async () => {
  const c = client();
  await subscribe(c, 'lis-coach@exemplo.com');
  const w = await c('POST', '/api/account/wallets', { body: { name: 'Banco', kind: 'conta', openingBalanceCents: -40_000, overdraftLimitCents: 100_000, overdraftRateBps: 800 } });
  assert.equal(w.status, 201);
  const debts = await c('GET', '/api/account/debts');
  const lis = debts.json.debts.find((d: any) => d.virtual);
  assert.ok(lis, 'cheque especial aparece na lista de dívidas');
  assert.equal(lis.balanceCents, 40_000);
  assert.equal(lis.monthlyRateBps, 800);
  assert.equal(debts.json.plan.focusId, lis.id, 'é a dívida mais cara: foco do plano');
  assert.equal(debts.json.totals.owedCents, 40_000);
  // virtual não se paga nem se remove pela lista de dívidas
  assert.equal((await c('POST', `/api/account/debts/${lis.id}/payments`, { body: { amountCents: 1000 } })).status, 400);
  const overview = await c('GET', '/api/account/coach/overview');
  assert.equal(overview.json.focus.kind, 'alerta');
  assert.match(overview.json.focus.text, /cheque especial/i);
  const insights = await c('GET', '/api/account/coach');
  assert.match(insights.json.insights[0].title, /cheque especial/i);
  // quitou: sai das dívidas e o foco volta ao normal
  await c('PUT', `/api/account/wallets/${w.json.id}`, { body: { openingBalanceCents: 10_000 } });
  const after = await c('GET', '/api/account/debts');
  assert.ok(!after.json.debts.some((d: any) => d.virtual));
  assert.notEqual((await c('GET', '/api/account/coach/overview')).json.focus.kind, 'alerta');
});
