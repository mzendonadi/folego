// Regressão dos achados do QA de 2026-10-03 (QA-RELATORIO.md): cada teste fecha um achado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';

let db: Db;
let app: FastifyInstance;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { body?: unknown; raw?: string; headers?: Record<string, string> } = {}) => {
    const hasBody = opts.body !== undefined || opts.raw !== undefined;
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;

const validCase = () => ({
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Aluguel', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 }],
  acceptTerms: true,
});

test('F-03: data de atraso no futuro, data impossível e caractere nulo viram 400 (nunca 500)', async () => {
  const c = client();
  const futuro = validCase();
  (futuro.debts[0] as any).firstDefaultOn = '2999-01-01';
  assert.equal((await c('POST', '/api/cases', { body: futuro })).status, 400);
  const impossivel = validCase();
  (impossivel.debts[0] as any).firstDefaultOn = '2020-02-31';
  assert.equal((await c('POST', '/api/cases', { body: impossivel })).status, 400);
  const nulo = validCase();
  nulo.debts[0]!.creditorName = 'a\u0000b';
  assert.equal((await c('POST', '/api/cases', { body: nulo })).status, 400);
  assert.equal((await c('POST', '/api/cases', { body: validCase() })).status, 201);
});

test('F-03/F-19: mês inválido = 400; campo desconhecido nos dados do caso = 400', async () => {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email: 'qa-fix@exemplo.com' } });
  await c('POST', '/api/account/login', { body: { email: 'qa-fix@exemplo.com', code: lastCode() } });
  assert.equal((await c('GET', '/api/account/month/2020-13')).status, 400);
  assert.equal((await c('GET', '/api/account/month/abc')).status, 400);
  assert.equal((await c('POST', '/api/account/budget/2020-13/copy', { body: {} })).status, 400);
  const extra = validCase() as any;
  extra.profile.hack = 1;
  assert.equal((await c('POST', '/api/cases', { body: extra })).status, 400);
  const entry = await c('POST', '/api/account/entries', { body: { entries: [{ date: '2026-10-01', description: 'x', amountCents: -100 }] } });
  assert.equal(entry.status, 400, 'campo "description" (o certo é "note") deixa de ser ignorado em silêncio');
});

test('F-11: conta sem sessão = 401 not_logged_in', async () => {
  const r = await client()('GET', '/api/account');
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'not_logged_in');
});

test('F-12: 404 e JSON quebrado no mesmo formato, em português', async () => {
  const c = client();
  const nf = await c('GET', '/api/nao-existe');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.error, 'not_found');
  assert.ok(!/Route/.test(JSON.stringify(nf.json)));
  const bad = await c('POST', '/api/cases', { raw: '{"profile":' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'invalid_json');
});

test('F-13: código queimado por tentativas erradas não impede pedir outro', async () => {
  const c = client();
  const email = 'griefing@exemplo.com';
  for (let i = 0; i < 3; i++) {
    await c('POST', '/api/account/login-code', { body: { email } });
    for (let t = 0; t < 5; t++) await c('POST', '/api/account/login', { body: { email, code: '000000' } });
  }
  mailbox.sent.length = 0;
  const again = await c('POST', '/api/account/login-code', { body: { email } });
  assert.equal(again.status, 200, 'a pessoa consegue um código novo depois de ter códigos queimados');
  const ok = await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  assert.equal(ok.status, 200);
});

test('F-14: o código de login só vai no corpo da resposta com EXPOSE_DEV_CODES=1 (e em desenvolvimento)', async () => {
  const r = await client()('POST', '/api/account/login-code', { body: { email: 'semcodigo@exemplo.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.devCode, undefined);
  assert.equal(loadConfig({ NODE_ENV: 'development', EXPOSE_DEV_CODES: '1' }).exposeDevCodes, true);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).exposeDevCodes, false);
  assert.equal(loadConfig({ NODE_ENV: 'test', EXPOSE_DEV_CODES: '1' }).exposeDevCodes, false);
});

test('F-21: mensagem da Idempotency-Key diz o formato', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const r = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'abc' } });
  assert.equal(r.status, 400);
  assert.match(r.json.message, /8 a 100/);
});
