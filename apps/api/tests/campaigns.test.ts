import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { dispatchCampaigns, unsubscribeUrl } from '../src/admin/campaigns.ts';

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
    return { status: res.statusCode, json };
  };
}
type Client = ReturnType<typeof client>;

const PW = 'Senha-Forte-2026';
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
const passwords = new Set<string>();
async function adminLogin(c: Client, email: string) {
  if (!passwords.has(email)) {
    mailbox.sent.length = 0;
    await c('POST', '/api/gestao/setup-code', { body: { email } });
    assert.equal((await c('POST', '/api/gestao/setup', { body: { email, code: lastCode(), password: PW } })).status, 204);
    passwords.add(email);
  }
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email, password: PW } })).status, 200);
}
let owner: Client | null = null;
async function ownerClient() {
  if (!owner) {
    owner = client();
    await adminLogin(owner, 'dono@exemplo.com');
  }
  return owner;
}

async function makeSubscriber(email: string, plan: string, key: string) {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const o = await c('POST', '/api/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  return (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;
}

const body = { name: 'Volte para o Fôlego', audience: 'todos_ativos', subject: 'Sua conta continua aqui', body: 'Oi! Passando para lembrar que seus lançamentos e metas continuam guardados.\n\nÉ só entrar e seguir de onde parou.', buttonLabel: 'Abrir minha conta', buttonUrl: 'https://folego.online/#/conta' };

test('campanha: rascunho → teste obrigatório → só quem tem permissão aprova → sai com link de descadastro e respeita quem saiu', async () => {
  const o = await ownerClient();
  const subA = await makeSubscriber('camp-a@exemplo.com', 'ousado', 'camp-a-0000000001');
  await makeSubscriber('camp-b@exemplo.com', 'controle', 'camp-b-0000000001');
  await db.query(`UPDATE app.subscribers SET marketing_opt_out_at = now() WHERE email = 'camp-b@exemplo.com'`);

  assert.equal((await o('POST', '/api/gestao/marketing/emails', { body: { ...body, buttonUrl: 'https://golpe.com/x' } })).status, 422);
  assert.equal((await o('POST', '/api/gestao/marketing/emails', { body: { ...body, buttonUrl: null } })).status, 422);
  const created = await o('POST', '/api/gestao/marketing/emails', { body });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const list = (await o('GET', '/api/gestao/marketing/emails')).json;
  const size = list.audiences.find((a: any) => a.id === 'todos_ativos');
  assert.ok(size.eligible >= 1);

  assert.equal((await o('POST', `/api/gestao/marketing/emails/${id}/enviar`, { body: { recipients: size.eligible } })).status, 409, 'sem teste não envia');

  await o('POST', '/api/gestao/usuarios', { body: { email: 'mkt@exemplo.com', role: 'marketing' } });
  const mkt = client();
  await adminLogin(mkt, 'mkt@exemplo.com');
  assert.equal((await mkt('GET', '/api/gestao/marketing/emails')).json.canSend, false);
  assert.equal((await mkt('POST', `/api/gestao/marketing/emails/${id}/enviar`, { body: { recipients: 1 } })).status, 403);

  mailbox.sent.length = 0;
  assert.equal((await o('POST', `/api/gestao/marketing/emails/${id}/teste`)).status, 200);
  assert.equal(mailbox.sent[0]!.to, 'dono@exemplo.com');
  assert.match(mailbox.sent[0]!.subject, /^\[TESTE\]/);

  assert.equal((await o('POST', `/api/gestao/marketing/emails/${id}/enviar`, { body: { recipients: size.eligible + 50 } })).status, 409, 'número desatualizado');
  assert.equal((await o('POST', `/api/gestao/marketing/emails/${id}/enviar`, { body: { recipients: size.eligible } })).status, 200);
  assert.equal((await o('PUT', `/api/gestao/marketing/emails/${id}`, { body })).status, 409, 'não edita depois de enviar');

  mailbox.sent.length = 0;
  while (await dispatchCampaigns(ctx())) { /* esvazia a fila */ }
  const to = mailbox.sent.map((m) => m.to);
  assert.ok(to.includes('camp-a@exemplo.com'));
  assert.ok(!to.includes('camp-b@exemplo.com'), 'quem se descadastrou não recebe');
  const mail = mailbox.sent.find((m) => m.to === 'camp-a@exemplo.com')!;
  assert.ok(mail.text.includes(unsubscribeUrl(ctx(), subA)));
  assert.ok(mail.html.includes('Cancelar o recebimento'));
  assert.match(mail.headers!['List-Unsubscribe']!, /\/descadastrar#/);
  assert.equal((await o('GET', '/api/gestao/marketing/emails')).json.campaigns.find((c: any) => c.id === id).status, 'sent');

  // frequência: quem recebeu agora não é elegível a outra campanha na mesma semana
  const after = (await o('GET', '/api/gestao/marketing/emails')).json.audiences.find((a: any) => a.id === 'todos_ativos');
  assert.ok(after.eligible < after.total || after.total === 0);
});

test('descadastro: link assinado funciona sem login, é idempotente, adulterado é recusado, e e-mail de conta continua chegando', async () => {
  const sid = await makeSubscriber('sair@exemplo.com', 'controle', 'camp-sair-00000001');
  const token = unsubscribeUrl(ctx(), sid).split('/descadastrar#')[1]!;
  const c = client();
  assert.equal((await c('POST', '/api/unsubscribe', { body: { token: `${sid}.assinatura-falsa-xxxxxxxxxxxxxxxxxxxx` } })).status, 400);
  assert.equal((await c('POST', '/api/unsubscribe', { body: { token } })).status, 204);
  const oneClick = await app.inject({ method: 'POST', url: `/api/unsubscribe?t=${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
  assert.equal(oneClick.statusCode, 204, 'aceita o POST de um clique do Gmail, sem o cabeçalho do site');
  const row = await db.query<{ marketing_opt_out_at: Date | null }>(`SELECT marketing_opt_out_at FROM app.subscribers WHERE id = $1`, [sid]);
  assert.ok(row.rows[0]!.marketing_opt_out_at);
  mailbox.sent.length = 0;
  assert.equal((await client()('POST', '/api/account/login-code', { body: { email: 'sair@exemplo.com' } })).status, 200);
  assert.equal(mailbox.sent.length, 1);
});

test('teto diário e parada: com o teto em 0 nada sai; cancelar esvazia a fila', async () => {
  const o = await ownerClient();
  await makeSubscriber('teto@exemplo.com', 'controle', 'camp-teto-00000001');
  const c = await o('POST', '/api/gestao/marketing/emails', { body: { ...body, name: 'Teto', audience: 'sem_uso_14d' } });
  await o('POST', `/api/gestao/marketing/emails/${c.json.id}/teste`);
  const size = (await o('GET', '/api/gestao/marketing/emails')).json.audiences.find((a: any) => a.id === 'sem_uso_14d').eligible;
  assert.ok(size >= 1);
  assert.equal((await o('POST', `/api/gestao/marketing/emails/${c.json.id}/enviar`, { body: { recipients: size } })).status, 200);
  await o('PUT', '/api/gestao/config', { body: { campaignDailyCap: 0 } });
  mailbox.sent.length = 0;
  assert.equal(await dispatchCampaigns(ctx()), false);
  assert.equal(mailbox.sent.length, 0);
  assert.equal((await o('POST', `/api/gestao/marketing/emails/${c.json.id}/parar`)).status, 200);
  await o('PUT', '/api/gestao/config', { body: { campaignDailyCap: 200 } });
  assert.equal(await dispatchCampaigns(ctx()), false);
  assert.equal((await o('GET', '/api/gestao/marketing/emails')).json.campaigns.find((x: any) => x.id === c.json.id).status, 'cancelled');
});
