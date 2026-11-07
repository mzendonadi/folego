// Cancelamento que vale de verdade: o provedor confirma, o que não dá para confirmar vira alerta, cobrança nova de assinatura cancelada é barrada
// e uma varredura reconfere. Incidente de 06/11/2026: assinatura de outra conta (404) era dada como cancelada e seguia cobrando. Dados inventados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { AsaasGateway, FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook } from '../src/services.ts';
import { reconcileCanceled } from '../src/billing.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, adminEmails: ['dono@exemplo.com'] };
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
  return async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
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
async function assinante(email: string): Promise<{ c: Client; orderId: string }> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { email });
  await c('POST', '/api/account/login', { email, code: lastCode() });
  const co = await c('POST', '/api/account/subscription-checkout', { plan: 'controle', acceptTerms: true });
  assert.equal(co.status, 201);
  return { c, orderId: co.json.orderId as string };
}
async function pagar(orderId: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}
const idOf = async (email: string) => (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;
const profile = async (email: string) => (await db.query<{ sub: string; status: string; verified: boolean | null }>(`SELECT provider_subscription_id AS sub, status, cancel_verified AS verified FROM app.billing_profiles WHERE subscriber_id = $1`, [await idOf(email)])).rows[0]!;
const webhook = (body: Record<string, unknown>) => handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, body);

test('cancelar: o provedor confirma (assinatura encerrada) e o cancelamento fica marcado como verificado', async () => {
  const { c, orderId } = await assinante('cancela-ok@exemplo.test');
  await pagar(orderId);
  const before = await profile('cancela-ok@exemplo.test');
  assert.ok(gateway.subscriptions.has(before.sub));
  assert.equal((await c('POST', '/api/account/subscription-cancel', { cancel: true })).status, 200);
  const after = await profile('cancela-ok@exemplo.test');
  assert.equal(after.status, 'canceled');
  assert.equal(after.verified, true);
  assert.ok(!gateway.subscriptions.has(before.sub), 'a assinatura saiu do provedor');
});

test('cancelar assinatura que o provedor NÃO enxerga (outra conta): não finge, marca como não confirmada e avisa o dono por e-mail', async () => {
  const { c, orderId } = await assinante('cancela-outra-conta@exemplo.test');
  await pagar(orderId);
  const sub = (await profile('cancela-outra-conta@exemplo.test')).sub;
  gateway.invisible.add(sub); // como a assinatura criada na conta PF antiga: o servidor recebe 404
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/account/subscription-cancel', { cancel: true })).status, 200, 'o pedido da pessoa é respeitado');
  const p = await profile('cancela-outra-conta@exemplo.test');
  assert.equal(p.status, 'canceled');
  assert.equal(p.verified, false, 'NÃO confirmado no provedor');
  assert.ok(mailbox.sent.some((m) => m.to === 'dono@exemplo.com' && /URGENTE: cancelamento não confirmado/.test(m.subject)), 'o dono é avisado');
  const logged = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.audit_log WHERE action = 'cancel_unverified'`);
  assert.ok(Number(logged.rows[0]!.n) >= 1);
});

test('cobrança nova de assinatura já cancelada: é apagada na hora e vira alerta; de assinatura ativa, é ignorada', async () => {
  const ativa = await assinante('ativa-cobranca@exemplo.test');
  await pagar(ativa.orderId);
  const subAtiva = (await profile('ativa-cobranca@exemplo.test')).sub;
  assert.equal(await webhook({ eventId: 'evt-created-ativa', subscriptionId: subAtiva, paymentId: 'pay_ativa_1', billing: 'charge_created' }), 'ignored', 'assinante ativo: cobrança normal');

  const { c, orderId } = await assinante('cancelada-cobranca@exemplo.test');
  await pagar(orderId);
  const sub = (await profile('cancelada-cobranca@exemplo.test')).sub;
  await c('POST', '/api/account/subscription-cancel', { cancel: true });
  mailbox.sent.length = 0;
  assert.equal(await webhook({ eventId: 'evt-created-cancelada', subscriptionId: sub, paymentId: 'pay_depois_do_cancelamento', billing: 'charge_created' }), 'confirmed');
  assert.ok(gateway.cancelledCharges.includes('pay_depois_do_cancelamento'), 'a cobrança foi mandada apagar no provedor');
  assert.ok(mailbox.sent.some((m) => m.to === 'dono@exemplo.com' && /barrada/.test(m.subject)));
  assert.ok(!gateway.cancelledCharges.includes('pay_ativa_1'));
});

test('varredura: reencerra assinatura de cancelado que voltou a ficar ativa e não repete alerta de quem acabou de ser avisado', async () => {
  const { c, orderId } = await assinante('varredura@exemplo.test');
  await pagar(orderId);
  const sub = (await profile('varredura@exemplo.test')).sub;
  await c('POST', '/api/account/subscription-cancel', { cancel: true });
  assert.ok(!gateway.subscriptions.has(sub));
  gateway.subscriptions.add(sub); // o provedor "ressuscitou" a assinatura (ou o cancelamento não pegou)
  const fixed = await reconcileCanceled(ctx(), { force: true });
  assert.ok(fixed >= 1, 'a varredura encerrou de novo');
  assert.ok(!gateway.subscriptions.has(sub));
  assert.equal((await profile('varredura@exemplo.test')).verified, true);

  // não visível: alerta no máximo uma vez por semana (não enche a caixa do dono)
  const o = await assinante('varredura-invisivel@exemplo.test');
  await pagar(o.orderId);
  gateway.invisible.add((await profile('varredura-invisivel@exemplo.test')).sub);
  await o.c('POST', '/api/account/subscription-cancel', { cancel: true });
  mailbox.sent.length = 0;
  await reconcileCanceled(ctx(), { force: true });
  assert.equal(mailbox.sent.filter((m) => /URGENTE/.test(m.subject)).length, 0, 'acabou de alertar no cancelamento: não repete já');
});

test('novo checkout depois de um abandonado: a assinatura pendente anterior é encerrada (não fica cobrando sozinha)', async () => {
  const { c } = await assinante('abandona@exemplo.test');
  const first = (await profile('abandona@exemplo.test')).sub;
  assert.ok(gateway.subscriptions.has(first));
  const again = await c('POST', '/api/account/subscription-checkout', { plan: 'ousado', acceptTerms: true });
  assert.equal(again.status, 201);
  assert.ok(!gateway.subscriptions.has(first), 'a pendente antiga saiu do provedor');
  const now = (await profile('abandona@exemplo.test')).sub;
  assert.notEqual(now, first);
  assert.ok(gateway.subscriptions.has(now));
});

test('Asaas real (fetch simulado): 404 é "não enxergo" e não apaga nada; assinatura visível tem as cobranças em aberto apagadas, é encerrada e conferida', async () => {
  const calls: string[] = [];
  const mk = (handler: (method: string, path: string) => { status: number; body?: unknown }): AsaasGateway => new AsaasGateway({
    apiKey: 'chave-de-teste', baseUrl: 'https://asaas.exemplo.test/v3', pixKey: 'pix', webhookToken: 'x'.repeat(32),
    fetchFn: (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname.replace('/v3', '') + new URL(url).search;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const r = handler(method, path);
      return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch,
  });

  // chave que não enxerga a assinatura (conta antiga): nada é apagado e o resultado NÃO é "cancelada"
  const blind = mk(() => ({ status: 404 }));
  assert.deepEqual(await blind.stopCardSubscription('sub_antiga'), { result: 'not_visible', chargesRemoved: 0 });
  assert.deepEqual(calls, ['GET /subscriptions/sub_antiga']);

  // assinatura visível: apaga PENDING e OVERDUE, apaga a assinatura e confere que saiu
  calls.length = 0;
  let deleted = false;
  const sees = mk((method, path) => {
    if (method === 'GET' && path === '/subscriptions/sub_viva') return deleted ? { status: 404 } : { status: 200, body: { id: 'sub_viva', deleted: false } };
    if (method === 'GET' && path.startsWith('/subscriptions/sub_viva/payments?status=PENDING')) return { status: 200, body: { data: [{ id: 'pay_proxima' }] } };
    if (method === 'GET' && path.startsWith('/subscriptions/sub_viva/payments?status=OVERDUE')) return { status: 200, body: { data: [{ id: 'pay_vencida' }] } };
    if (method === 'DELETE' && path === '/subscriptions/sub_viva') { deleted = true; return { status: 200, body: { deleted: true } }; }
    if (method === 'DELETE' && path.startsWith('/payments/')) return { status: 200, body: { deleted: true } };
    return { status: 500 };
  });
  assert.deepEqual(await sees.stopCardSubscription('sub_viva'), { result: 'stopped', chargesRemoved: 2 });
  assert.ok(calls.includes('DELETE /payments/pay_proxima') && calls.includes('DELETE /payments/pay_vencida'), 'as cobranças em aberto foram apagadas');
  assert.ok(calls.indexOf('DELETE /subscriptions/sub_viva') > calls.indexOf('DELETE /payments/pay_proxima'), 'primeiro as cobranças, depois a assinatura');

  // se o provedor não confirma que a assinatura saiu, falha em vez de fingir sucesso
  const stuck = mk((method, path) => {
    if (method === 'GET' && path === '/subscriptions/sub_teimosa') return { status: 200, body: { id: 'sub_teimosa', deleted: false } };
    if (method === 'GET') return { status: 200, body: { data: [] } };
    return { status: 200, body: {} };
  });
  await assert.rejects(() => stuck.stopCardSubscription('sub_teimosa'), /não confirmou/);
});