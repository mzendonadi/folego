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
let gateway: FakeGateway;
const mailbox = new MemorySender();
const vapid = vapidFrom(randomBytes(32).toString('base64url'))!;
const config = { ...loadConfig({ NODE_ENV: 'development' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, push: { ...vapid, subject: 'mailto:teste@folego.test' } };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  setPushTransport();
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
    return { status: res.statusCode, json, raw: res };
  };
}
async function subscribe(c: ReturnType<typeof client>, email: string, plan: string, key: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  await c('POST', '/api/account/login', { body: { email, code } });
  const o = await c('POST', '/api/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}
const PDF = Buffer.from('%PDF-1.4\nAcordo de renegociação com o Banco Exemplo\n%%EOF');
const b64 = (b: Buffer) => b.toString('base64');

test('cofre: guarda acordo com arquivo, busca pelo texto, baixa igual ao que entrou e apaga', async () => {
  const c = client();
  await subscribe(c, 'cofre1@exemplo.com', 'controle', 'cofre-sub-0001');
  const add = await c('POST', '/api/account/vault', { body: { kind: 'acordo', title: 'Acordo Banco Exemplo', creditor: 'Banco Exemplo S.A.', notes: 'Parcela de 300 todo dia 10', amountCents: 30_000, dueOn: todaySaoPaulo(), text: 'cláusula quinta: desconto de 60% para quitação à vista', file: { name: 'acordo.pdf', mime: 'application/pdf', data: b64(PDF) } } });
  assert.equal(add.status, 201);
  const id = add.json.id;
  const raw = await db.query<{ title_enc: Buffer; data_enc: Buffer }>(`SELECT title_enc, data_enc FROM app.vault_docs WHERE id = $1`, [id]);
  assert.ok(!raw.rows[0]!.title_enc.toString('latin1').includes('Acordo Banco'), 'título cifrado');
  assert.ok(!raw.rows[0]!.data_enc.includes(Buffer.from('%PDF')), 'arquivo cifrado');

  const list = (await c('GET', '/api/account/vault')).json;
  assert.equal(list.docs.length, 1);
  assert.equal(list.docs[0].title, 'Acordo Banco Exemplo');
  assert.equal(list.docs[0].hasFile, true);
  assert.equal(list.docs[0].text, undefined, 'o texto de busca não volta para a tela');
  assert.equal((await c('GET', '/api/account/vault?q=desconto%20quita%C3%A7%C3%A3o')).json.docs.length, 1, 'acha pelo conteúdo do PDF, sem acento');
  assert.equal((await c('GET', '/api/account/vault?q=banco%20exemplo')).json.docs.length, 1, 'acha pelo credor');
  assert.equal((await c('GET', '/api/account/vault?q=nada%20disso')).json.docs.length, 0);

  const file = await c('GET', `/api/account/vault/${id}/file`);
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(file.raw.rawPayload), PDF, 'o arquivo volta idêntico');
  assert.match(String(file.raw.headers['content-disposition']), /attachment/);
  assert.equal(file.raw.headers['cache-control'], 'private, no-store');

  assert.equal((await c('PUT', `/api/account/vault/${id}`, { body: { title: 'Acordo renegociado', dueOn: null } })).status, 200);
  const upd = (await c('GET', '/api/account/vault')).json.docs[0];
  assert.equal(upd.title, 'Acordo renegociado');
  assert.equal(upd.dueOn, null);
  assert.equal((await c('DELETE', `/api/account/vault/${id}`)).status, 204);
  assert.equal((await c('GET', '/api/account/vault')).json.docs.length, 0);
});

test('cofre: recusa arquivo disfarçado, tipo estranho e grande demais; isola uma conta da outra', async () => {
  const c = client();
  await subscribe(c, 'cofre2@exemplo.com', 'controle', 'cofre-sub-0002');
  const base = { kind: 'boleto', title: 'Boleto' };
  assert.equal((await c('POST', '/api/account/vault', { body: { ...base, file: { mime: 'application/pdf', data: b64(Buffer.from('MZ executável disfarçado')) } } })).status, 415, 'não é PDF de verdade');
  assert.equal((await c('POST', '/api/account/vault', { body: { ...base, file: { mime: 'application/zip', data: b64(PDF) } } })).status, 415);
  assert.equal((await c('POST', '/api/account/vault', { body: { ...base, file: { mime: 'application/pdf', data: b64(Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)])) } } })).status, 413);
  assert.equal((await c('POST', '/api/account/vault', { body: { ...base, dueOn: '2026-02-31' } })).status, 400, 'data que não existe');
  assert.equal((await c('POST', '/api/account/vault', { body: { kind: 'recibo', title: 'x' } })).status, 400);
  const ok = await c('POST', '/api/account/vault', { body: { ...base, notes: 'só a anotação, sem arquivo' } });
  assert.equal(ok.status, 201);
  assert.equal((await c('GET', `/api/account/vault/${ok.json.id}/file`)).status, 404, 'sem arquivo não há o que baixar');

  const other = client();
  await subscribe(other, 'cofre3@exemplo.com', 'controle', 'cofre-sub-0003');
  assert.equal((await other('GET', '/api/account/vault')).json.docs.length, 0, 'não vê o cofre alheio');
  assert.equal((await other('GET', `/api/account/vault/${ok.json.id}/file`)).status, 404);
  assert.equal((await other('PUT', `/api/account/vault/${ok.json.id}`, { body: { title: 'invadido' } })).status, 404);
  assert.equal((await other('DELETE', `/api/account/vault/${ok.json.id}`)).status, 404);
});

test('cofre: documento que vence nos próximos dias vira notificação, uma vez', async () => {
  const c = client();
  await subscribe(c, 'cofre4@exemplo.com', 'controle', 'cofre-sub-0004');
  await c('POST', '/api/account/push/subscribe', { body: { endpoint: 'https://push.example.test/cofre/1', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } } });
  await db.query(`DELETE FROM app.push_devices WHERE endpoint <> 'https://push.example.test/cofre/1'`);
  const due = new Date(Date.parse(`${todaySaoPaulo()}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
  await c('POST', '/api/account/vault', { body: { kind: 'acordo', title: 'Acordo da loja de móveis', dueOn: due } });
  const got: PushPayload[] = [];
  setPushTransport(async (_s, payload) => { got.push(payload); });
  try {
    await sendPushReminders({ db, config } as never, { force: true, now: { hour: 9, weekday: 3 } });
    const msg = got.find((g) => g.tag === 'cofre');
    assert.ok(msg, 'avisou');
    assert.match(msg.title, /Acordo vence em 2 dias/);
    assert.equal(msg.body, 'Acordo da loja de móveis');
    assert.equal(msg.url, '/conta/cofre');
    got.length = 0;
    await sendPushReminders({ db, config } as never, { force: true, now: { hour: 10, weekday: 3 } });
    assert.ok(!got.some((g) => g.tag === 'cofre'), 'não repete');
  } finally {
    setPushTransport();
  }
});
