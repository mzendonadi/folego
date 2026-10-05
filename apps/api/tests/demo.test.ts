// Contas de teste (demo): o dono liga e desliga; ligada, o Prumo vem completo e os produtos saem sem cobrança.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';

let db: Db;
let app: FastifyInstance;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, adminEmails: ['dono@exemplo.com'] };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, rateLimits: 'relaxed' });
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
const caseBody = {
  profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }],
  acceptTerms: true,
};

test('conta demo: ligar, entrar com o código, comprar sem cobrança e desligar', async () => {
  const o = client();
  await o('POST', '/api/gestao/setup-code', { email: 'dono@exemplo.com' });
  const code = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
  await o('POST', '/api/gestao/setup', { email: 'dono@exemplo.com', code, password: 'Senha-Forte-2026' });
  assert.equal((await o('POST', '/api/gestao/login-password', { email: 'dono@exemplo.com', password: 'Senha-Forte-2026' })).status, 200);

  const list = await o('GET', '/api/gestao/demo');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const acc = list.json.accounts.find((x: any) => x.email === 'demo@folego.online');
  assert.ok(acc, 'a conta demo já nasce cadastrada');
  assert.equal(acc.active, false);
  assert.equal((await o('POST', `/api/gestao/demo/${acc.id}/codigo`, {})).status, 409, 'desligada não gera código');

  // desligada: um visitante comum não vira demo só por usar o e-mail
  const u = client();
  assert.equal((await u('POST', '/api/account/login', { email: 'demo@folego.online', code: '000000' })).status, 401);

  assert.equal((await o('POST', `/api/gestao/demo/${acc.id}/ligar`, { active: true })).status, 200);
  const issued = await o('POST', `/api/gestao/demo/${acc.id}/codigo`, {});
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  assert.match(issued.json.code, /^\d{6}$/);

  const login = await u('POST', '/api/account/login', { email: 'demo@folego.online', code: issued.json.code });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  assert.equal(login.json.demo, true);
  assert.equal(login.json.subscription.plan, 'desbravador');
  assert.equal(login.json.subscription.active, true);
  assert.equal((await u('POST', '/api/account/login', { email: 'demo@folego.online', code: issued.json.code })).status, 401, 'o código vale uma vez');

  // produto avulso sem pagamento
  const created = await u('POST', '/api/cases', caseBody);
  const order = await u('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'demo-order-0001' });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.status, 'paid');
  assert.equal(order.json.totalCents, 0);
  assert.equal((await u('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 200, 'o Mapa abre');
  const pay = await db.query<{ provider: string; amount_cents: string }>(`SELECT provider, amount_cents FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  assert.equal(pay.rows[0]!.provider, 'demo');
  assert.equal(Number(pay.rows[0]!.amount_cents), 0);

  // desligada: volta a exigir pagamento e o Prumo fecha
  assert.equal((await o('POST', `/api/gestao/demo/${acc.id}/ligar`, { active: false })).status, 200);
  const account = await u('GET', '/api/account');
  assert.equal(account.json.demo, false);
  assert.equal(account.json.subscription.active, false);
  const c2 = await u('POST', '/api/cases', caseBody);
  const paid = await u('POST', '/api/orders', { caseId: c2.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'demo-order-0002' });
  assert.equal(paid.status, 201);
  assert.equal(paid.json.status, 'pending');
  assert.ok(paid.json.totalCents > 0 && paid.json.pixCode);

  // gestão da lista
  assert.equal((await o('POST', '/api/gestao/demo', { email: 'outro@exemplo.com', label: 'Teste da equipe' })).status, 201);
  assert.equal((await o('POST', '/api/gestao/demo', { email: 'outro@exemplo.com' })).status, 409);
  const again = (await o('GET', '/api/gestao/demo')).json.accounts;
  const outro = again.find((x: any) => x.email === 'outro@exemplo.com');
  assert.equal((await o('DELETE', `/api/gestao/demo/${outro.id}`)).status, 200);
  assert.equal((await o('GET', '/api/gestao/demo')).json.accounts.some((x: any) => x.email === 'outro@exemplo.com'), false);
});
