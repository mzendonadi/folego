import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { todaySaoPaulo } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'development' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };

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
async function login(c: ReturnType<typeof client>, email: string) {
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/account/login-code', { body: { email } })).status, 200);
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  assert.equal((await c('POST', '/api/account/login', { body: { email, code } })).status, 200);
}
async function subscribe(c: ReturnType<typeof client>, email: string, plan: string, key: string) {
  await login(c, email);
  const o = await c('POST', '/api/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}

test('conta compartilhada: Desbravador convida até 3 pessoas, Ousado só 1; remover escolhe quem sai', async () => {
  const owner = client();
  await subscribe(owner, 'fam-dono@exemplo.com', 'desbravador', 'fam-sub-00000001');
  for (const e of ['fam-a@exemplo.com', 'fam-b@exemplo.com', 'fam-c@exemplo.com']) assert.equal((await owner('POST', '/api/account/household/invite', { body: { email: e } })).status, 204, e);
  const full = await owner('POST', '/api/account/household/invite', { body: { email: 'fam-d@exemplo.com' } });
  assert.equal(full.status, 409, 'o quarto passa do limite');
  assert.match(full.json.message, /3 pessoas/);
  const view = (await owner('GET', '/api/account/household')).json;
  assert.equal(view.members.length, 3);
  assert.equal(view.limit, 3);
  assert.equal(view.canInvite, false);

  assert.equal((await owner('DELETE', '/api/account/household/member')).status, 422, 'com várias pessoas é preciso dizer quem');
  const gone = view.members.find((m: any) => m.email === 'fam-b@exemplo.com');
  assert.equal((await owner('DELETE', `/api/account/household/member?id=${gone.id}`)).status, 204);
  assert.equal((await owner('GET', '/api/account/household')).json.members.length, 2);
  assert.equal((await owner('GET', '/api/account/household')).json.canInvite, true);

  const small = client();
  await subscribe(small, 'fam-ousado@exemplo.com', 'ousado', 'fam-sub-00000002');
  assert.equal((await small('POST', '/api/account/household/invite', { body: { email: 'fam-e@exemplo.com' } })).status, 204);
  assert.equal((await small('POST', '/api/account/household/invite', { body: { email: 'fam-f@exemplo.com' } })).status, 409, 'Ousado: uma pessoa');
  assert.equal((await small('GET', '/api/account/household')).json.limit, 1);
});

test('acesso só de consulta: vê tudo, não grava; o titular libera a edição e a pessoa passa a lançar', async () => {
  const owner = client();
  await subscribe(owner, 'cons-dono@exemplo.com', 'ousado', 'fam-sub-00000003');
  const today = todaySaoPaulo();
  await owner('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -2_500, note: 'Padaria' }] } });
  assert.equal((await owner('POST', '/api/account/household/invite', { body: { email: 'cons-leitora@exemplo.com', access: 'consulta' } })).status, 204);

  const reader = client();
  await login(reader, 'cons-leitora@exemplo.com');
  assert.equal((await reader('GET', '/api/account/household')).json.invite.access, 'consulta');
  assert.equal((await reader('POST', '/api/account/household/accept')).status, 204);
  const acc = (await reader('GET', '/api/account')).json;
  assert.equal(acc.role, 'member');
  assert.equal(acc.access, 'consulta');
  assert.equal((await reader('GET', `/api/account/month/${today.slice(0, 7)}`)).json.entries.length, 1, 'consulta enxerga os lançamentos do titular');
  const blocked = await reader('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -100, note: 'Tentativa' }] } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, 'read_only');
  assert.equal((await reader('POST', '/api/account/goals', { body: { name: 'Meta', targetCents: 10_000, savedCents: 0 } })).status, 403, 'metas também são só do titular');
  assert.equal((await reader('GET', '/api/account/reminders')).status, 200, 'ler continua valendo');
  assert.equal((await reader('PUT', '/api/account/push/prefs', { body: { goals: false } })).status, 200, 'as preferências da própria pessoa não dependem do acesso à conta');

  const row = (await owner('GET', '/api/account/household')).json.members[0];
  assert.equal(row.access, 'consulta');
  assert.equal((await owner('PUT', `/api/account/household/member/${row.id}`, { body: { access: 'edita' } })).status, 204);
  assert.equal((await owner('PUT', `/api/account/household/member/${row.id}`, { body: { access: 'admin' } })).status, 400);
  assert.equal((await reader('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -100, note: 'Agora vale' }] } })).status, 200);
  assert.equal((await owner('GET', `/api/account/month/${today.slice(0, 7)}`)).json.entries.length, 2);
});
