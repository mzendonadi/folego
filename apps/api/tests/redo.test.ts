// Acesso de 30 dias e refazer com novos dados: Mapa, tradutor e guias; prazo que não muda; vencido não refaz; controle do dono.
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
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', adminEmails: ['dono@exemplo.com'] };

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
  return async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}

async function pay(c: ReturnType<typeof client>, caseId: string, product: string, key: string) {
  const order = await c('POST', '/api/orders', { caseId, products: [product] }, { 'idempotency-key': `${key}-order-0001` });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  return order.json.orderId as string;
}
const expiry = async (orderId: string) => (await db.query<{ expires_at: Date }>(`SELECT e.expires_at FROM app.entitlements e JOIN app.orders o ON o.case_id = e.case_id WHERE o.id = $1 ORDER BY e.granted_at LIMIT 1`, [orderId])).rows[0]!.expires_at.toISOString();

const caseBody = (income: number) => ({
  profile: { netIncomeCents: income, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }],
  acceptTerms: true,
});

test('Mapa: refaz com dados novos dentro do prazo, sem cobrar e sem mudar a data final', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', caseBody(450_000));
  const orderId = await pay(c, created.json.caseId, 'recovery_map', 'redo-map');
  const before = await c('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(before.status, 200);
  const until = await expiry(orderId);

  const { acceptTerms: _ignored, ...novo } = caseBody(800_000);
  const redo = await c('POST', `/api/orders/${orderId}/redo/map`, novo);
  assert.equal(redo.status, 200, JSON.stringify(redo.json));
  assert.equal(redo.json.redoCount, 1);
  const after1 = await c('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(after1.json.input.profile.netIncomeCents, 800_000, 'o Mapa passa a usar os dados novos');
  assert.equal(await expiry(orderId), until, 'a data final do acesso não muda');
  assert.equal((await db.query(`SELECT 1 FROM app.orders WHERE case_id = (SELECT case_id FROM app.orders WHERE id = $1)`, [orderId])).rows.length, 1, 'nenhum pedido novo');

  assert.equal((await c('POST', `/api/orders/${orderId}/redo/map`, { profile: { netIncomeCents: -1 } })).status, 400);
  assert.equal((await c('POST', `/api/orders/${orderId}/redo/translation`, { text: 'qualquer texto longo' })).status, 409, 'tipo errado');
  assert.ok([401, 404].includes((await client()('POST', `/api/orders/${orderId}/redo/map`, novo)).status), 'de outra pessoa, não');

  // venceu: não refaz
  await db.query(`UPDATE app.entitlements SET expires_at = now() - interval '1 minute' WHERE case_id = (SELECT case_id FROM app.orders WHERE id = $1)`, [orderId]);
  assert.equal((await c('POST', `/api/orders/${orderId}/redo/map`, novo)).status, 403);
});

test('tradutor e guia: refaz com texto e respostas novas', async () => {
  const c = client();
  const t = await c('POST', '/api/translations', { text: 'Seu nome será negativado em 5 dias caso não regularize o débito de R$ 1.200,00.', acceptTerms: true });
  const tOrder = await pay(c, t.json.caseId, 'collection_translator', 'redo-tr');
  const first = await c('GET', `/api/orders/${tOrder}/translation`);
  const redoT = await c('POST', `/api/orders/${tOrder}/redo/translation`, { text: 'Proposta de acordo com 70% de desconto à vista para quitar a dívida do cartão ainda hoje.' });
  assert.equal(redoT.status, 200, JSON.stringify(redoT.json));
  const second = await c('GET', `/api/orders/${tOrder}/translation`);
  assert.notDeepEqual(second.json.analysis, first.json.analysis);

  const g = await c('POST', '/api/guided/forgotten', { input: { workedFormal: 'sim', workedBefore1989: 'nao', closedBankAccount: 'sim', consorcioOrCoop: 'nao', relativeDied: 'nao', declaresIr: 'sim', invested: 'nao', lifeInsurance: 'nao', inssBenefit: 'nao' }, acceptTerms: true });
  const gOrder = await pay(c, g.json.caseId, 'guide_forgotten', 'redo-gd');
  const gFirst = await c('GET', `/api/orders/${gOrder}/guided`);
  const redoG = await c('POST', `/api/orders/${gOrder}/redo/guided`, { input: { workedFormal: 'nao', workedBefore1989: 'nao', closedBankAccount: 'nao', consorcioOrCoop: 'nao', relativeDied: 'sim', declaresIr: 'nao', invested: 'sim', lifeInsurance: 'sim', inssBenefit: 'sim' } });
  assert.equal(redoG.status, 200, JSON.stringify(redoG.json));
  const gSecond = await c('GET', `/api/orders/${gOrder}/guided`);
  assert.notDeepEqual(gSecond.json.content, gFirst.json.content);
  assert.equal(gSecond.json.accessUntil, gFirst.json.accessUntil, 'prazo igual');
  assert.ok([400, 422].includes((await c('POST', `/api/orders/${gOrder}/redo/guided`, { input: { workedFormal: 'talvez' } })).status));
});

test('backoffice: lista acessos com dias restantes e refeitos, prorroga e encerra', async () => {
  const o = client();
  await o('POST', '/api/gestao/setup-code', { email: 'dono@exemplo.com' });
  const code = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
  await o('POST', '/api/gestao/setup', { email: 'dono@exemplo.com', code, password: 'Senha-Forte-2026' });
  assert.equal((await o('POST', '/api/gestao/login-password', { email: 'dono@exemplo.com', password: 'Senha-Forte-2026' })).status, 200);

  const list = await o('GET', '/api/gestao/acessos?filtro=todos');
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.ok(list.json.items.length >= 3);
  assert.ok(list.json.summary.redos >= 3);
  const row = list.json.items.find((x: any) => x.productCode === 'guide_forgotten');
  assert.ok(row.daysLeft >= 29 && row.daysLeft <= 30);
  assert.equal(row.redoCount, 1);

  assert.equal((await o('POST', `/api/gestao/acessos/${row.id}/prorrogar`, { days: 10 })).status, 200);
  const after1 = (await o('GET', '/api/gestao/acessos?filtro=todos')).json.items.find((x: any) => x.id === row.id);
  assert.ok(after1.daysLeft >= 39 && after1.extendedDays === 10);
  assert.equal((await o('POST', `/api/gestao/acessos/${row.id}/prorrogar`, { days: 0 })).status, 400);
  assert.equal((await o('POST', `/api/gestao/acessos/${row.id}/encerrar`, {})).status, 200);
  assert.equal((await o('GET', '/api/gestao/acessos?filtro=ativos')).json.items.some((x: any) => x.id === row.id), false);
  assert.equal((await o('GET', '/api/gestao/acessos?filtro=vencidos')).json.items.some((x: any) => x.id === row.id), true);
});
