import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig, vapidFrom } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { sendPushReminders, setPushTransport } from '../src/push.ts';
import type { PushPayload } from '../src/push.ts';
import { todaySaoPaulo } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let noKeys: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const vapid = vapidFrom(randomBytes(32).toString('base64url'))!;
const base = { ...loadConfig({ NODE_ENV: 'development' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };
const config = { ...base, push: { ...vapid, subject: 'mailto:teste@folego.test' } };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  noKeys = await buildApp({ config: base, db, gateway, email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  setPushTransport();
  await app.close();
  await noKeys.close();
  await db.close();
});

function client(server: FastifyInstance = app) {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await server.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
async function login(c: ReturnType<typeof client>, email: string) {
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/account/login-code', { body: { email } })).status, 200);
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  assert.equal((await c('POST', '/api/account/login', { body: { email, code } })).status, 200);
}
async function loginAndPay(c: ReturnType<typeof client>, email: string, key: string) {
  await login(c, email);
  const o = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}
const sub = (n: number) => ({ endpoint: `https://push.example.test/send/${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const personId = async (email: string) => (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;

test('chave VAPID: a pública sai da privada; chave torta desliga as notificações', () => {
  assert.equal(vapidFrom(undefined), null);
  assert.equal(vapidFrom('curta'), null);
  assert.equal(vapid.publicKey.length, 87, 'ponto P-256 não comprimido em base64url');
  assert.equal(vapidFrom(`${vapid.privateKey}\n`)?.publicKey, vapid.publicKey, 'quebra de linha no fim é aparada');
});

test('sem chave no servidor: o app mostra que não está disponível e recusa inscrição', async () => {
  const c = client(noKeys);
  await login(c, 'semchave@exemplo.com');
  const v = await c('GET', '/api/account/push');
  assert.equal(v.status, 200);
  assert.equal(v.json.available, false);
  assert.equal(v.json.publicKey, null);
  assert.equal((await c('POST', '/api/account/push/subscribe', { body: sub(1) })).status, 409);
});

test('inscrição, preferências, aparelho trocado e envio de teste', async () => {
  const c = client();
  await loginAndPay(c, 'push1@exemplo.com', 'push-sub-00001');
  assert.equal((await c('GET', '/api/account/push')).json.publicKey, vapid.publicKey);
  assert.equal((await c('POST', '/api/account/push/subscribe', { body: { endpoint: 'http://inseguro.test/x', keys: sub(1).keys } })).status, 400, 'só https');
  assert.equal((await c('POST', '/api/account/push/subscribe', { body: { ...sub(1), extra: 1 } })).status, 400);
  assert.equal((await c('POST', '/api/account/push/subscribe', { body: sub(1) })).status, 201);
  assert.equal((await c('POST', '/api/account/push/subscribe', { body: sub(1) })).status, 201, 'repetir não duplica');
  assert.equal((await c('GET', '/api/account/push')).json.devices, 1);
  for (let n = 2; n <= 7; n += 1) await c('POST', '/api/account/push/subscribe', { body: sub(n) });
  assert.equal((await c('GET', '/api/account/push')).json.devices, 5, 'guarda só os 5 aparelhos mais recentes');

  assert.equal((await c('PUT', '/api/account/push/prefs', { body: { hour: 5 } })).status, 400, 'antes das 8h não vale');
  assert.equal((await c('PUT', '/api/account/push/prefs', { body: { goals: false, hour: 19 } })).status, 200);
  assert.deepEqual((await c('GET', '/api/account/push')).json.prefs, { expenses: true, goals: false, bills: true, hour: 19 });

  const got: PushPayload[] = [];
  setPushTransport(async (_s, payload) => { got.push(payload); });
  try {
    assert.equal((await c('POST', '/api/account/push/test')).json.sent, 5);
    assert.equal(got[0]!.url, '/conta');
    await c('POST', '/api/account/push/unsubscribe', { body: { endpoint: sub(7).endpoint } });
    assert.equal((await c('GET', '/api/account/push')).json.devices, 4);
  } finally {
    setPushTransport();
  }
});

test('lembretes: despesas, metas (domingo) e contas a vencer saem na hora certa, uma vez, só do que faz sentido', async () => {
  const c = client();
  await loginAndPay(c, 'push2@exemplo.com', 'push-sub-00002');
  const id = await personId('push2@exemplo.com');
  await c('POST', '/api/account/push/subscribe', { body: sub(20) });
  await db.query(`DELETE FROM app.push_devices WHERE subscriber_id <> $1`, [id]); // só este assinante entra na conta (os de outros testes ficam de fora)
  const today = todaySaoPaulo();
  await c('POST', '/api/account/reminders', { body: { title: 'Conta de luz', dueOn: today, amountCents: 18_000, emailDaysBefore: 1 } });
  assert.ok([200, 201].includes((await c('POST', '/api/account/goals', { body: { name: 'Viagem', targetCents: 100_000 } })).status));
  const got: PushPayload[] = [];
  setPushTransport(async (_s, payload) => { got.push(payload); });
  try {
    assert.equal(await sendPushReminders({ db, config } as never, { force: true, now: { hour: 23, weekday: 0 } }), 0, 'noite é silêncio');
    assert.equal(await sendPushReminders({ db, config } as never, { force: true, now: { hour: 9, weekday: 2 } }), 1, 'às 9h de terça só a conta a vencer (despesas é às 20h)');
    assert.deepEqual(got.map((g) => g.tag), ['contas']);
    assert.match(got[0]!.title, /Conta de luz vence hoje/);
    assert.equal(got[0]!.url, '/conta/lembretes');

    got.length = 0;
    assert.equal(await sendPushReminders({ db, config } as never, { force: true, now: { hour: 20, weekday: 0 } }), 2, 'domingo 20h: despesas e metas');
    assert.deepEqual(got.map((g) => g.tag).sort(), ['despesas', 'metas']);
    assert.equal(got.find((g) => g.tag === 'despesas')!.url, '/conta/lancamentos');
    assert.match(got.find((g) => g.tag === 'metas')!.body, /Viagem.*0%/);
    assert.equal(got.find((g) => g.tag === 'metas')!.url, '/conta/metas');

    got.length = 0;
    assert.equal(await sendPushReminders({ db, config } as never, { force: true, now: { hour: 20, weekday: 0 } }), 0, 'não repete no mesmo dia');

    // Quem já lançou hoje não é incomodado; e quem desligou o tipo também não.
    await db.query(`UPDATE app.subscribers SET push_expenses_last = NULL, push_goals_last = NULL, push_goals = false WHERE id = $1`, [id]);
    await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -1500, note: 'Café' }] } });
    assert.equal(await sendPushReminders({ db, config } as never, { force: true, now: { hour: 21, weekday: 0 } }), 0);
    assert.equal(got.length, 0);
  } finally {
    setPushTransport();
  }
});

test('aparelho desligado pelo navegador (410) é esquecido; falha passageira não apaga de primeira', async () => {
  const c = client();
  await loginAndPay(c, 'push3@exemplo.com', 'push-sub-00003');
  const id = await personId('push3@exemplo.com');
  await c('POST', '/api/account/push/subscribe', { body: sub(30) });
  setPushTransport(async () => { throw Object.assign(new Error('boom'), { statusCode: 503 }); });
  try {
    assert.equal((await c('POST', '/api/account/push/test')).status, 409, 'nenhum aparelho recebeu');
    assert.equal((await db.query<{ n: string }>(`SELECT fail_n::text AS n FROM app.push_devices WHERE subscriber_id = $1`, [id])).rows[0]!.n, '1', 'falha passageira só conta ponto');
    setPushTransport(async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); });
    await c('POST', '/api/account/push/test');
    assert.equal((await c('GET', '/api/account/push')).json.devices, 0, '410: o aparelho some');
  } finally {
    setPushTransport();
  }
});
