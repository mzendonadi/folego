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
  return async (method: 'GET' | 'POST', url: string, opts: { body?: unknown } = {}) => {
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
async function assinante(email: string): Promise<Client> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'ousado', acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return c;
}
const hoje = () => todaySaoPaulo();
const mes = () => hoje().slice(0, 7);

test('categorias próprias: criar, usar no lançamento, trocar, limitar e apagar (lançamentos voltam para Outros)', async () => {
  const c = await assinante('cat1@exemplo.com');
  const novo = await c('POST', '/api/account/categories', { body: { name: '  Cartão   de crédito ' } });
  assert.equal(novo.status, 201);
  assert.equal(novo.json.name, 'Cartão de crédito', 'espaços sobrando são arrumados');
  assert.equal((await c('POST', '/api/account/categories', { body: { name: 'cartão de crédito' } })).json.name, 'Cartão de crédito', 'mesmo nome (maiúsculas) devolve o existente');
  assert.deepEqual((await c('GET', '/api/account/categories')).json, { custom: ['Cartão de crédito'] });

  const add = await c('POST', '/api/account/entries', { body: { entries: [{ date: hoje(), amountCents: -5000, note: 'Fatura do cartão', category: 'Cartão de crédito' }, { date: hoje(), amountCents: -900, note: 'Padaria', category: 'Inventada' }] } });
  assert.equal(add.json.added, 2);
  let month = (await c('GET', `/api/account/month/${mes()}`)).json;
  const fatura = month.entries.find((e: any) => e.note === 'Fatura do cartão');
  const padaria = month.entries.find((e: any) => e.note === 'Padaria');
  assert.equal(fatura.category, 'Cartão de crédito');
  assert.notEqual(padaria.category, 'Inventada', 'categoria que a pessoa não tem cai na automática');
  assert.deepEqual(month.customCategories, ['Cartão de crédito']);
  assert.ok(month.summary.byCategory.some((x: any) => x.category === 'Cartão de crédito' && x.cents === 5000), 'entra no resumo do mês');

  assert.equal((await c('POST', `/api/account/entries/${padaria.id}/category`, { body: { category: 'Cartão de crédito' } })).status, 200);
  assert.equal((await c('POST', `/api/account/entries/${padaria.id}/category`, { body: { category: 'Inventada' } })).status, 422);
  assert.equal((await c('POST', `/api/account/limits/${encodeURIComponent('Cartão de crédito')}`, { body: { limitCents: 100000 } })).status, 200, 'limite de orçamento para a categoria própria');
  assert.equal((await c('POST', `/api/account/budget/${mes()}/limits/${encodeURIComponent('Cartão de crédito')}`, { body: { limitCents: 80000 } })).status, 200);

  const del = await c('POST', '/api/account/categories/remove', { body: { name: 'Cartão de crédito' } });
  assert.equal(del.json.moved, 2);
  month = (await c('GET', `/api/account/month/${mes()}`)).json;
  assert.ok(month.entries.every((e: any) => e.category !== 'Cartão de crédito'));
  assert.equal(month.entries.find((e: any) => e.note === 'Fatura do cartão').category, 'outros');
  assert.deepEqual(month.customCategories, []);
  assert.equal(month.limits['Cartão de crédito'], undefined, 'o limite da categoria apagada sai');
  assert.equal((await c('POST', '/api/account/categories/remove', { body: { name: 'Cartão de crédito' } })).status, 404);
});

test('categorias próprias: nomes inválidos ou iguais aos do sistema são recusados; cada assinante só vê as suas; limite de 20', async () => {
  const a = await assinante('cat2@exemplo.com');
  const b = await assinante('cat3@exemplo.com');
  assert.equal((await a('POST', '/api/account/categories', { body: { name: 'a' } })).status, 400);
  assert.equal((await a('POST', '/api/account/categories', { body: { name: '<script>x</script>' } })).status, 422);
  assert.equal((await a('POST', '/api/account/categories', { body: { name: 'Mercado e comida' } })).json.error, 'category_exists');
  assert.equal((await a('POST', '/api/account/categories', { body: { name: 'transporte' } })).json.error, 'category_exists');
  await a('POST', '/api/account/categories', { body: { name: 'Parcela de financiamento' } });
  assert.deepEqual((await b('GET', '/api/account/categories')).json, { custom: [] }, 'a lista é só da própria pessoa');
  const intruso = await b('POST', '/api/account/entries', { body: { entries: [{ date: hoje(), amountCents: -100, note: 'Teste', category: 'Parcela de financiamento' }] } });
  assert.equal(intruso.json.added, 1);
  const mb = (await b('GET', `/api/account/month/${mes()}`)).json;
  assert.notEqual(mb.entries[0].category, 'Parcela de financiamento', 'a categoria de outra pessoa não vale');
  assert.equal((await b('POST', '/api/account/categories/remove', { body: { name: 'Parcela de financiamento' } })).status, 404);
  for (let i = 0; i < 19; i++) assert.equal((await a('POST', '/api/account/categories', { body: { name: `Categoria ${i + 1}` } })).status, 201);
  assert.equal((await a('POST', '/api/account/categories', { body: { name: 'Categoria 21' } })).json.error, 'too_many_categories');
});
