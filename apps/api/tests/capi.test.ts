import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook, purgeExpired } from '../src/services.ts';
import { setCapiFetch, normalizePhone } from '../src/capi.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', metaCapiToken: 'token-de-teste', metaPixelId: '123456789' };
const ctx = () => ({ db, config, gateway, email: mailbox });
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const sent: Array<{ url: string; auth: string; body: any }> = [];

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  setCapiFetch((async (url: string, init: RequestInit) => {
    sent.push({ url, auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
    return new Response('{"events_received":1}', { status: 200 });
  }) as unknown as typeof fetch);
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', 'user-agent': 'TesteAgent/1.0', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
const wait = () => new Promise((r) => setTimeout(r, 150));
const caseBody = { profile: { netIncomeCents: 300_000, fixedExpensesCents: 150_000, employmentType: 'clt', cltContract: 'permanent', ageBand: '35-44', uf: 'SP' }, debts: [{ creditorName: 'A', kind: 'rent', balanceCents: 100_000, daysOverdue: 10 }], acceptTerms: true };

async function order(adsConsent: boolean, key: string) {
  const c = client();
  const created = await c('POST', '/api/cases', { body: caseBody });
  assert.equal(created.status, 201);
  const o = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'], contact: { email: 'Maria@Exemplo.com', phone: '(11) 91234-5678', adsConsent } }, headers: { 'idempotency-key': key } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  return { caseId: created.json.caseId as string, orderId: o.json.orderId as string, c };
}
async function pay(orderId: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}

test('com aceite de publicidade: Lead, InitiateCheckout e Purchase saem com e-mail/celular em hash, sem dado em claro', async () => {
  sent.length = 0;
  const { caseId, orderId } = await order(true, 'capi-aceite-0001');
  await wait();
  assert.deepEqual(sent.map((s) => s.body.data[0].event_name), ['Lead', 'InitiateCheckout']);
  assert.equal(sent[0]!.url, 'https://graph.facebook.com/v21.0/123456789/events');
  assert.equal(sent[0]!.auth, 'Bearer token-de-teste');
  const u = sent[0]!.body.data[0].user_data;
  assert.deepEqual(u.em, [sha('maria@exemplo.com')]);
  assert.deepEqual(u.ph, [sha('5511912345678')]);
  assert.equal(u.client_user_agent, 'TesteAgent/1.0');
  assert.equal(sent[1]!.body.data[0].custom_data.currency, 'BRL');
  assert.ok(!JSON.stringify(sent).toLowerCase().includes('maria@exemplo.com'), 'e-mail nunca em claro');
  assert.ok(!JSON.stringify(sent).includes('91234'), 'celular nunca em claro');
  sent.length = 0;
  await pay(orderId);
  await wait();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.body.data[0].event_name, 'Purchase');
  assert.ok(sent[0]!.body.data[0].custom_data.value > 0);
  assert.ok(sent[0]!.body.data[0].event_id.startsWith('purchase-'));
  // pagou: o caso (e o contato) passa a durar 30 dias
  const row = await db.query<{ days: string }>(`SELECT round(extract(epoch FROM purge_after - now()) / 86400)::text AS days FROM app.cases WHERE id = $1`, [caseId]);
  assert.equal(row.rows[0]!.days, '30');
});

test('sem aceite de publicidade: o contato fica guardado criptografado, mas nada vai para a Meta', async () => {
  sent.length = 0;
  const { caseId, orderId } = await order(false, 'capi-sem-aceite-1');
  await pay(orderId);
  await wait();
  assert.equal(sent.length, 0);
  const raw = await db.query<{ e: Buffer; p: Buffer; ads: boolean }>(`SELECT contact_email_enc AS e, contact_phone_enc AS p, ads_consent AS ads FROM app.cases WHERE id = $1`, [caseId]);
  assert.equal(raw.rows[0]!.ads, false);
  assert.ok(!Buffer.from(raw.rows[0]!.e).toString('utf8').includes('maria'), 'criptografado');
});

test('retenção: não pagante tem 7 dias; ao apagar o caso, o contato some junto', async () => {
  const { caseId } = await order(true, 'capi-retencao-001');
  const d = await db.query<{ days: string }>(`SELECT round(extract(epoch FROM purge_after - now()) / 86400)::text AS days FROM app.cases WHERE id = $1`, [caseId]);
  assert.equal(d.rows[0]!.days, '7');
  await db.query(`UPDATE app.cases SET purge_after = now() - interval '1 minute' WHERE id = $1`, [caseId]);
  await purgeExpired(ctx());
  const r = await db.query<{ e: Buffer | null; p: Buffer | null; ads: boolean; status: string }>(`SELECT contact_email_enc AS e, contact_phone_enc AS p, ads_consent AS ads, status FROM app.cases WHERE id = $1`, [caseId]);
  assert.equal(r.rows[0]!.status, 'purged');
  assert.equal(r.rows[0]!.e, null);
  assert.equal(r.rows[0]!.p, null);
  assert.equal(r.rows[0]!.ads, false);
});

test('contato inválido é recusado e o celular é normalizado para o padrão da Meta', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: caseBody });
  const bad = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'], contact: { email: 'nao-e-email', phone: '123', adsConsent: false } }, headers: { 'idempotency-key': 'capi-invalido-001' } });
  assert.equal(bad.status, 400);
  assert.equal(normalizePhone('(11) 91234-5678'), '5511912345678');
  assert.equal(normalizePhone('5511912345678'), '5511912345678');
});
