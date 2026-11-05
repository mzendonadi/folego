// Conta de dono: Desbravador sem fim, nunca expira, não cancela, não troca de plano e não é excluída; os dados dela não mudam. Dados inventados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook, todaySaoPaulo } from '../src/services.ts';
import { maintenance } from '../src/subscriptions.ts';

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
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown } = {}) => {
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
async function assinante(email: string, plan: 'controle' | 'desbravador'): Promise<Client> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan, acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return c;
}

test('dono: assinatura cancelada e vencendo vira Desbravador sem fim, e os dados continuam os mesmos', async () => {
  const email = 'dono-teste@exemplo.com';
  const c = await assinante(email, 'controle');
  const today = todaySaoPaulo();
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -4500, note: 'Mercado teste' }] } });
  const before = (await c('GET', `/api/account/month/${today.slice(0, 7)}`)).json.entries.length;
  // cancelada hoje e vencendo em 3 dias, como estava em produção
  await db.query(`UPDATE app.subscriptions SET cancel_at_period_end = true, canceled_at = now(), current_period_end = now() + interval '3 days' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = $1)`, [email]);
  // marca como dono (o que a migração faz para o e-mail do dono) e deixa o gatilho normalizar
  await db.query(`UPDATE app.subscribers SET is_owner = true WHERE email = $1`, [email]);
  await db.query(`UPDATE app.subscriptions SET plan = plan WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = $1)`, [email]);
  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.owner, true);
  assert.equal(acc.subscription.plan, 'desbravador');
  assert.equal(acc.subscription.active, true);
  assert.equal(acc.subscription.cancelAtPeriodEnd, false);
  assert.ok(acc.subscription.periodEnd > Date.parse('2099-12-31T00:00:00Z'), 'sem prazo');
  assert.equal((await c('GET', `/api/account/month/${today.slice(0, 7)}`)).json.entries.length, before, 'os dados não mudaram');
  // recursos do Desbravador liberados (empresa e investimentos)
  assert.equal((await c('GET', `/api/account/business?month=${today.slice(0, 7)}`)).status, 200);
});

test('dono: não cancela, não troca de plano, não é excluído, a rotina de expiração não o toca e o banco recusa', async () => {
  const email = 'dono-teste@exemplo.com';
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  assert.equal((await c('POST', '/api/account/subscription-cancel', { body: { cancel: true } })).status, 409);
  assert.equal((await c('GET', '/api/account/plan-change/quote?plan=ousado')).status, 409);
  assert.equal((await c('DELETE', '/api/account')).status, 409);
  await maintenance(ctx(), { force: true });
  assert.equal((await c('GET', '/api/account')).json.subscription.active, true);
  // direto no banco: nada tira o dono do estado de dono
  await db.query(`UPDATE app.subscriptions SET status = 'expired', plan = 'controle', cancel_at_period_end = true, current_period_end = now() WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = $1)`, [email]);
  const row = (await db.query<{ plan: string; status: string; cancel: boolean }>(`SELECT plan, status, cancel_at_period_end AS cancel FROM app.subscriptions WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = $1)`, [email])).rows[0]!;
  assert.deepEqual({ plan: row.plan, status: row.status, cancel: row.cancel }, { plan: 'desbravador', status: 'active', cancel: false });
  await assert.rejects(() => db.query(`DELETE FROM app.subscriptions WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = $1)`, [email]), /conta de dono/);
  await assert.rejects(() => db.query(`UPDATE app.subscribers SET deleted_at = now() WHERE email = $1`, [email]), /conta de dono/);
});

test('quem não é dono continua cancelando normalmente', async () => {
  const c = await assinante('comum-teste@exemplo.com', 'controle');
  const r = await c('POST', '/api/account/subscription-cancel', { body: { cancel: true } });
  assert.equal(r.status, 200);
  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.owner, false);
  assert.equal(acc.subscription.cancelAtPeriodEnd, true);
});
