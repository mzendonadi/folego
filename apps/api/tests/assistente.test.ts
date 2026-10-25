import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleAssistantInbound } from '../src/assistant.ts';
import type { WaTransport } from '../src/whatsapp.ts';
import type { Ctx } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = {
  ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true,
  bird: { apiKey: 'bk_test_0123456789012345', from: '+5511913792370', baseUrl: 'http://bird.invalid', template: 'folego-indicacao-prumo', language: 'pt-BR', webhookSecret: 'whsec_teste_0123456789', classic: false, workspaceId: 'ws-teste', channelId: 'canal-teste', inviteProjectId: 'proj-teste', inviteVersion: 'ver-teste' },
};
const sent: { to: string; text: string }[] = [];
let n = 0;
const fake = { async sendText(_c: unknown, to: string, text: string) { sent.push({ to, text }); return { id: `w${(n += 1)}` }; } } as unknown as WaTransport;
const ctx = (): Ctx => ({ db, config, whatsapp: fake, email: mailbox } as unknown as Ctx);

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, whatsapp: fake, rateLimits: 'relaxed' });
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
async function subscribe(c: ReturnType<typeof client>, email: string, key: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  await c('POST', '/api/account/login', { body: { email, code } });
  const o = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}
let seq = 0;
const say = (phone: string, text: string | null, extra: Record<string, unknown> = {}) =>
  handleAssistantInbound(ctx(), { id: `m${(seq += 1)}`, from: { phone_number: phone }, ...(text === null ? {} : { text: { body: text } }), ...extra });
const last = () => sent.at(-1)?.text ?? '';
const PHONE = '+5534998375296';

test('assistente: vincula o número por código, lança por mensagem, consulta, desfaz e desconecta', async () => {
  const c = client();
  await subscribe(c, 'assist1@exemplo.com', 'assist-sub-0001');
  const v0 = (await c('GET', '/api/account/assistant')).json;
  assert.equal(v0.available, true);
  assert.equal(v0.linked, false);

  const link = (await c('POST', '/api/account/assistant/link')).json;
  assert.match(link.pending.code, /^[A-Z2-9]{6}$/);
  assert.equal(link.pending.link, `https://wa.me/5511913792370?text=VINCULAR%20${link.pending.code}`);

  sent.length = 0;
  assert.equal(await say(PHONE, 'oi, tudo bem?'), false, 'número desconhecido segue para o atendimento normal');
  assert.equal(sent.length, 0);
  assert.equal(await say(PHONE, 'vincular ZZZZZZ'), true);
  assert.match(last(), /não vale mais/);
  assert.equal(await say(PHONE, `vincular ${link.pending.code.toLowerCase()}`), true);
  assert.match(last(), /conectado ao Prumo/);
  assert.equal(sent.at(-1)!.to, '5534998375296');
  const v1 = (await c('GET', '/api/account/assistant')).json;
  assert.equal(v1.linked, true);
  assert.equal(v1.phone, '•••••5296');
  assert.equal(v1.pending, null);
  const stored = await db.query<{ phone_enc: Buffer }>(`SELECT phone_enc FROM app.assistant_links`);
  assert.ok(!stored.rows[0]!.phone_enc.includes(Buffer.from('5296')), 'telefone cifrado');

  // lançar
  sent.length = 0;
  assert.equal(await say(PHONE, 'mercado 45'), true);
  assert.match(last(), /Lancei R\$\s?45,00 em Mercado e comida \(hoje\)/);
  assert.match(last(), /DESFAZER/);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE amount_cents = -4500`)).rows[0]!.n, '1');
  // o mesmo aviso repetido pela Bird não lança duas vezes
  const repeated = { id: 'repetida-1', from: { phone_number: PHONE }, text: { body: 'padaria 10' } };
  await handleAssistantInbound(ctx(), repeated);
  await handleAssistantInbound(ctx(), repeated);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE amount_cents = -1000`)).rows[0]!.n, '1', 'aviso repetido é ignorado');

  assert.equal(await say(PHONE, 'saldo'), true);
  assert.match(last(), /saiu R\$\s?55,00/);
  assert.equal(await say(PHONE, 'desfazer'), true);
  assert.match(last(), /Desfeito/);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE amount_cents = -1000`)).rows[0]!.n, '0', 'desfez o último');
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE amount_cents = -4500`)).rows[0]!.n, '1', 'só o último');
  assert.equal(await say(PHONE, 'desfazer'), true);
  assert.match(last(), /Não há lançamento recente/);

  assert.equal(await say(PHONE, 'fui ao mercado'), true);
  assert.match(last(), /Não achei o valor/);
  assert.equal(await say(PHONE, null, { image: { url: 'https://x/y.jpg' } }), true);
  assert.match(last(), /Ainda não consigo ler foto/, 'sem a chave da IA, a foto é recusada com franqueza (a leitura com IA está em assistente-midia.test.ts)');
  assert.equal(await say(PHONE, 'ajuda'), true);
  assert.match(last(), /Como falar comigo/);

  // não vai para a caixa de entrada do atendimento
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE direction = 'in'`)).rows[0]!.n, '0');

  assert.equal(await say(PHONE, 'sair'), true);
  assert.match(last(), /desconectado/);
  assert.equal((await c('GET', '/api/account/assistant')).json.linked, false);
  assert.equal(await say(PHONE, 'mercado 45'), false, 'depois de sair, é um número comum de novo');
});

test('assistente: número já vinculado a outra conta é recusado; sem assinatura não lança', async () => {
  const a = client();
  await subscribe(a, 'assist2@exemplo.com', 'assist-sub-0002');
  const la = (await a('POST', '/api/account/assistant/link')).json;
  await say('+5511900000001', `VINCULAR ${la.pending.code}`);
  const b = client();
  await subscribe(b, 'assist3@exemplo.com', 'assist-sub-0003');
  const lb = (await b('POST', '/api/account/assistant/link')).json;
  sent.length = 0;
  // a outra pessoa tenta usar o mesmo telefone: ele já é da primeira conta e continua sendo (a mensagem vira conversa dela)
  assert.equal(await say('+5511900000001', `VINCULAR ${lb.pending.code}`), true);
  assert.equal((await b('GET', '/api/account/assistant')).json.linked, false);

  // assinatura vencida: o assistente avisa em vez de lançar
  await db.query(`UPDATE app.subscriptions SET status = 'expired', current_period_end = now() - interval '1 day' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'assist2@exemplo.com')`);
  sent.length = 0;
  await say('+5511900000001', 'mercado 20');
  assert.match(last(), /assinatura do Prumo não está ativa/);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE amount_cents = -2000`)).rows[0]!.n, '0');
});
