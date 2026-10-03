import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway, AsaasGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook, todaySaoPaulo } from '../src/services.ts';
import { maintenance } from '../src/subscriptions.ts';
import { purgeCanceledExpired } from '../src/account-data.ts';

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
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json, raw: res.rawPayload, headers: res.headers };
  };
}
type Client = ReturnType<typeof client>;
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;

async function subLogin(c: Client, email: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
}
const PW = 'Senha-Forte-2026';
let sharedOwner: Client | null = null;
async function ownerClient() {
  if (sharedOwner) return sharedOwner;
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/gestao/setup-code', { body: { email: 'dono@exemplo.com' } });
  await c('POST', '/api/gestao/setup', { body: { email: 'dono@exemplo.com', code: lastCode(), password: PW } });
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email: 'dono@exemplo.com', password: PW } })).status, 200);
  sharedOwner = c;
  return c;
}
async function payFirst(orderId: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  return handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}
const subIdOf = async (email: string) => (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;
const providerSub = async (email: string) => (await db.query<{ s: string }>(`SELECT provider_subscription_id AS s FROM app.billing_profiles WHERE subscriber_id = $1`, [await subIdOf(email)])).rows[0]!.s;

test('assinatura no cartão: exige aceite dos termos, ativa por 1 mês, renova por webhook e não duplica', async () => {
  const c = client();
  await subLogin(c, 'cartao@exemplo.com');
  assert.equal((await c('POST', '/api/account/subscription-checkout', { body: { plan: 'ousado', acceptTerms: false } })).status, 400);
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'ousado', acceptTerms: true } });
  assert.equal(co.status, 201);
  assert.match(co.json.checkoutUrl, /^DEMO-CARD-/);
  const before = (await c('GET', '/api/account')).json;
  assert.equal(before.subscription, null, 'antes do cartão passar, não há acesso');
  assert.equal(await payFirst(co.json.orderId), 'confirmed');

  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.subscription.active, true);
  assert.equal(acc.billing.mode, 'card');
  assert.equal(acc.billing.status, 'active');
  assert.equal(acc.billing.priceCents, 3999);
  const end1 = acc.subscription.periodEnd;
  assert.ok(end1 - Date.now() > 27 * 86_400_000 && end1 - Date.now() < 32 * 86_400_000, 'um mês de acesso');
  const terms = await db.query<{ terms_version: string }>(`SELECT terms_version FROM app.billing_profiles WHERE subscriber_id = $1`, [await subIdOf('cartao@exemplo.com')]);
  assert.ok(terms.rows[0]!.terms_version);

  assert.equal((await c('POST', '/api/account/subscription-checkout', { body: { plan: 'ousado', acceptTerms: true } })).status, 409, 'já assina');
  const renew = await c('POST', '/api/dev/renew');
  assert.equal(renew.json.outcome, 'confirmed');
  const end2 = (await c('GET', '/api/account')).json.subscription.periodEnd;
  assert.ok(end2 - end1 > 27 * 86_400_000, 'a renovação soma mais um mês ao fim do período');
  const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.payments p JOIN app.orders o ON o.id = p.order_id WHERE o.subscriber_id = $1 AND p.status = 'confirmed' AND p.method = 'card'`, [await subIdOf('cartao@exemplo.com')]);
  assert.equal(n.rows[0]!.n, '2');
});

test('cartão recusado: avisa por e-mail, acesso segue até o fim do período; webhook de assinatura encerrada vira cancelamento', async () => {
  const c = client();
  await subLogin(c, 'recusado@exemplo.com');
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'controle', acceptTerms: true } });
  await payFirst(co.json.orderId);
  const sid = await providerSub('recusado@exemplo.com');
  mailbox.sent.length = 0;
  assert.equal(await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-refused-1', subscriptionId: sid, billing: 'charge_refused' }), 'confirmed');
  assert.ok(mailbox.sent.some((m) => m.to === 'recusado@exemplo.com' && /cartão/.test(m.subject)));
  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.billing.status, 'past_due');
  assert.equal(acc.subscription.active, true);
  assert.equal(await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-refused-1', subscriptionId: sid, billing: 'charge_refused' }), 'ignored', 'evento repetido');
  assert.equal(await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-ended-1', subscriptionId: sid, billing: 'subscription_ended' }), 'confirmed');
  assert.equal((await c('GET', '/api/account')).json.billing.status, 'canceled');
});

test('cancelar: para a cobrança na hora, mantém acesso e exportação até o fim do mês pago, não devolve e aparece em Cancelados', async () => {
  const c = client();
  await subLogin(c, 'cancela@exemplo.com');
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'desbravador', acceptTerms: true } });
  await payFirst(co.json.orderId);
  const today = todaySaoPaulo();
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: 300_000, note: 'Salario' }, { date: today, amountCents: -45_000, note: 'Mercado' }] } });
  await c('POST', '/api/account/debts', { body: { name: 'Cartão', balanceCents: 200_000, monthlyRateBps: 1000, minPaymentCents: 20_000 } });
  await c('POST', '/api/account/wallets', { body: { name: 'Nubank', kind: 'conta' } });

  mailbox.sent.length = 0;
  const cancel = await c('POST', '/api/account/subscription-cancel', { body: { cancel: true } });
  assert.equal(cancel.status, 200);
  assert.ok(cancel.json.accessUntil > Date.now());
  assert.ok(!gateway.subscriptions.has(await providerSub('cancela@exemplo.com')), 'a cobrança foi cancelada no provedor');
  assert.ok(mailbox.sent.some((m) => m.to === 'cancela@exemplo.com' && /cancelada/.test(m.subject)));
  assert.equal((await c('POST', '/api/account/subscription-cancel', { body: { cancel: false } })).status, 409, 'não há "retomar": assina de novo depois do mês pago');
  assert.equal((await c('POST', '/api/account/subscription-checkout', { body: { plan: 'ousado', acceptTerms: true } })).status, 409, 'ainda no período');

  const acc = (await c('GET', '/api/account')).json;
  assert.equal(acc.billing.status, 'canceled');
  assert.equal(acc.subscription.active, true, 'acesso até o fim do mês pago');

  const xlsx = await c('GET', '/api/account/export.xlsx');
  assert.equal(xlsx.status, 200);
  assert.equal(xlsx.raw.subarray(0, 2).toString(), 'PK', 'é um arquivo zip/xlsx válido');
  const report = (await c('GET', '/api/account/export')).json;
  assert.ok(report.sheets.find((s: any) => s.name === 'Lançamentos').rows.length === 2);
  assert.ok(report.sheets.find((s: any) => s.name === 'Dívidas').rows.length === 1);
});

test('backoffice: Cancelados lista, baixar dados gera .zip com tudo, excluir exige o download e o e-mail e apaga tudo', async () => {
  const owner = await ownerClient();
  const list = (await owner('GET', '/api/gestao/assinaturas/cancelados')).json;
  const row = list.rows.find((r: any) => r.email === 'cancela@exemplo.com');
  assert.ok(row, 'o ex-assinante aparece');
  assert.equal(row.exportedAt, null);
  assert.ok(row.dataRows >= 4);
  assert.equal(list.purgeDays, 15);

  assert.equal((await owner('DELETE', `/api/gestao/assinaturas/cancelados/${row.subscriberId}`, { body: { confirmEmail: 'cancela@exemplo.com' } })).status, 409, 'baixe antes');
  const zip = await owner('GET', `/api/gestao/assinaturas/cancelados/${row.subscriberId}/dados.zip`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers['content-type'], 'application/zip');
  assert.equal(zip.raw.subarray(0, 2).toString(), 'PK');
  const text = zip.raw.toString('latin1');
  for (const name of ['LEIA-ME.txt', 'ledger_entries.json', 'account_debts.json', 'wallets.json', 'subscribers.json', 'payments.json']) assert.ok(text.includes(name), `o zip tem ${name}`);
  assert.ok(!text.includes('sessions.json'), 'sem segredos de sessão');

  assert.equal((await owner('DELETE', `/api/gestao/assinaturas/cancelados/${row.subscriberId}`, { body: { confirmEmail: 'outro@exemplo.com' } })).status, 422, 'e-mail de confirmação errado');
  const del = await owner('DELETE', `/api/gestao/assinaturas/cancelados/${row.subscriberId}`, { body: { confirmEmail: 'Cancela@Exemplo.com' } });
  assert.equal(del.status, 200);
  assert.ok(del.json.deletedRows >= 4);
  for (const t of ['ledger_entries', 'account_debts', 'wallets', 'billing_profiles', 'subscriptions']) {
    const r = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.${t} WHERE subscriber_id = $1`, [row.subscriberId]);
    assert.equal(r.rows[0]!.n, '0', `${t} vazio`);
  }
  const gone = await db.query<{ email: string; deleted_at: Date | null }>(`SELECT email::text AS email, deleted_at FROM app.subscribers WHERE id = $1`, [row.subscriberId]);
  assert.match(gone.rows[0]!.email, /^excluido-/);
  assert.ok(gone.rows[0]!.deleted_at);
  assert.equal((await owner('GET', '/api/gestao/assinaturas/cancelados')).json.rows.find((r: any) => r.email === 'cancela@exemplo.com'), undefined);
});

test('permissão: quem não é dono não baixa nem exclui dados de ex-assinantes', async () => {
  const owner = await ownerClient();
  await owner('POST', '/api/gestao/usuarios', { body: { email: 'fin@exemplo.com', role: 'financeiro' } });
  const fin = client();
  mailbox.sent.length = 0;
  await fin('POST', '/api/gestao/setup-code', { body: { email: 'fin@exemplo.com' } });
  await fin('POST', '/api/gestao/setup', { body: { email: 'fin@exemplo.com', code: lastCode(), password: PW } });
  await fin('POST', '/api/gestao/login-password', { body: { email: 'fin@exemplo.com', password: PW } });
  const id = '018f0000-0000-7000-8000-000000000000';
  assert.equal((await fin('GET', `/api/gestao/assinaturas/cancelados/${id}/dados.zip`)).status, 403);
  assert.equal((await fin('DELETE', `/api/gestao/assinaturas/cancelados/${id}`, { body: { confirmEmail: 'x@y.com' } })).status, 403);
});

test('encerramento: sem renovar o acesso fecha, e depois da janela de retenção os dados são apagados sozinhos', async () => {
  const c = client();
  await subLogin(c, 'expira@exemplo.com');
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'controle', acceptTerms: true } });
  await payFirst(co.json.orderId);
  await c('POST', '/api/account/entries', { body: { entries: [{ date: todaySaoPaulo(), amountCents: -1000, note: 'x' }] } });
  await c('POST', '/api/account/subscription-cancel', { body: { cancel: true } });
  const id = await subIdOf('expira@exemplo.com');
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() - interval '3 days' WHERE subscriber_id = $1`, [id]);
  await maintenance(ctx(), { force: true });
  assert.equal((await c('GET', '/api/account')).json.subscription.active, false);
  assert.equal((await c('GET', `/api/account/month/${todaySaoPaulo().slice(0, 7)}`)).status, 402, 'sem acesso aos dados');
  assert.equal(await purgeCanceledExpired(ctx()), 0, 'ainda dentro da janela de segurança');
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() - interval '20 days' WHERE subscriber_id = $1`, [id]);
  assert.equal(await purgeCanceledExpired(ctx()), 1);
  const left = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE subscriber_id = $1`, [id]);
  assert.equal(left.rows[0]!.n, '0');
});

test('perfil e preferências: nome, resumo semanal, lembretes e novidades', async () => {
  const c = client();
  await subLogin(c, 'perfil@exemplo.com');
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'controle', acceptTerms: true } });
  await payFirst(co.json.orderId);
  assert.equal((await c('GET', '/api/account')).json.profile.notifyDigest, true);
  const r = await c('PUT', '/api/account/profile', { body: { displayName: 'Ana', notifyDigest: false, notifyReminders: false, marketing: false } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { displayName: 'Ana', notifyDigest: false, notifyReminders: false, marketing: false });
  assert.equal((await c('PUT', '/api/account/profile', { body: { marketing: true } })).json.marketing, true);
});

test('adaptador Asaas: cria cliente + assinatura mensal no cartão sem dados de cartão, cancela e lê os webhooks da recorrência', async () => {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: String(init.method), url, body });
    if (url.endsWith('/customers')) return new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 });
    if (url.endsWith('/subscriptions')) return new Response(JSON.stringify({ id: 'sub_1' }), { status: 200 });
    if (url.includes('/subscriptions/sub_1/payments')) return new Response(JSON.stringify({ data: [{ id: 'pay_1', invoiceUrl: 'https://www.asaas.com/i/abc' }] }), { status: 200 });
    if (url.endsWith('/payments/pay_9')) return new Response(JSON.stringify({ status: 'CONFIRMED', value: 39.99 }), { status: 200 });
    if (init.method === 'DELETE') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const asaas = new AsaasGateway({ apiKey: 'k', baseUrl: 'https://api-sandbox.asaas.com/v3', pixKey: 'x', webhookToken: 'tok', fetchFn });
  const out = await asaas.createCardSubscription({ orderId: 'o1', subscriberId: 's1', email: 'a@b.com', name: 'Ana', planName: 'Ousado', valueCents: 3999, firstDueOn: '2026-10-03', successUrl: 'https://folego.online/#/conta' });
  assert.deepEqual(out, { providerCustomerId: 'cus_1', providerSubscriptionId: 'sub_1', providerPaymentId: 'pay_1', checkoutUrl: 'https://www.asaas.com/i/abc' });
  const subCall = calls.find((c) => c.url.endsWith('/subscriptions'))!;
  assert.equal(subCall.body.billingType, 'CREDIT_CARD');
  assert.equal(subCall.body.cycle, 'MONTHLY');
  assert.equal(subCall.body.value, 39.99);
  assert.ok(!('creditCard' in subCall.body), 'nenhum dado de cartão passa pelo Fôlego');
  assert.equal(await asaas.getPaymentStatus('pay_9', 3999), 'confirmed');
  await asaas.cancelCardSubscription('sub_1');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/subscriptions/sub_1')));

  const h = { 'asaas-access-token': 'tok' };
  assert.deepEqual(asaas.parseWebhook({}, { id: 'e', event: 'PAYMENT_CONFIRMED' }), { kind: 'invalid' });
  assert.deepEqual(asaas.parseWebhook(h, { id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_2', subscription: 'sub_1', value: 39.99 } }), { kind: 'payment', event: { providerEventId: 'e1', providerPaymentId: 'pay_2', providerSubscriptionId: 'sub_1', valueCents: 3999 } });
  assert.deepEqual(asaas.parseWebhook(h, { id: 'e2', event: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', payment: { id: 'pay_3', subscription: 'sub_1' } }), { kind: 'billing', event: { providerEventId: 'e2', providerSubscriptionId: 'sub_1', type: 'charge_refused' } });
  assert.deepEqual(asaas.parseWebhook(h, { id: 'e3', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } }), { kind: 'billing', event: { providerEventId: 'e3', providerSubscriptionId: 'sub_1', type: 'subscription_ended' } });
  assert.deepEqual(asaas.parseWebhook(h, { id: 'e4', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_4', pixQrCodeId: 'qr1' } }), { kind: 'payment', event: { providerEventId: 'e4', providerPaymentId: 'qr1' } }, 'o fluxo antigo de Pix continua entendido');
  assert.deepEqual(asaas.parseWebhook(h, { id: 'e5', event: 'PAYMENT_CREATED' }), { kind: 'ignore' });
});
