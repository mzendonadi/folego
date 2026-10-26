// "Paguei uma parte e parcelei o resto": a fatura deixa de ficar vencida, as parcelas chegam na fatura seguinte, os juros viram
// gasto, e o saldo da conta passa a compor com o extrato (saldo negativo que já existia). Tudo com dados inventados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook } from '../src/services.ts';

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
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown } = {}) => {
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
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan: 'desbravador', acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return c;
}

const cartao = { name: 'Banco Exemplo', brand: 'visa', last4: '1111', limitCents: 5_000_000, closingDay: 5, dueDay: 12 };

test('parcelar a fatura: liga o pagamento, a fatura vira "parcelada", as parcelas chegam e os juros viram gasto', async () => {
  const c = await assinante('parcela-um@exemplo.com');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  // compra de 10/03 entra na fatura de 2026-04 (fecha 05/04, vence 12/04): já vencida hoje
  assert.equal((await c('POST', `/api/account/cards/${id}/purchases`, { body: { date: '2026-03-10', amountCents: 830_878, note: 'COMPRAS DO MES' } })).status, 201);
  assert.equal((await c('POST', `/api/account/cards/${id}/payments`, { body: { paidOn: '2026-04-09', amountCents: 250_000, note: 'pagamento parcial' } })).status, 201);

  const before = (await c('GET', '/api/account/cards')).json.cards[0].summary.invoices.find((i: any) => i.key === '2026-04');
  assert.equal(before.status, 'overdue');

  const detail = (await c('GET', `/api/account/cards/${id}/invoices/2026-04`)).json;
  assert.equal(detail.unlinkedPayments.length, 1);
  const r = await c('POST', `/api/account/cards/${id}/invoices/2026-04/finance`, { body: { count: 4, perCents: 216_092, paymentIds: [detail.unlinkedPayments[0].id] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.principalCents, 580_878);
  assert.equal(r.json.interestCents, 4 * 216_092 - 580_878);
  assert.ok(r.json.monthlyRatePct > 15 && r.json.monthlyRatePct < 25, String(r.json.monthlyRatePct));

  const after = (await c('GET', '/api/account/cards')).json.cards[0];
  const inv = after.summary.invoices.find((i: any) => i.key === '2026-04');
  assert.equal(inv.status, 'financed');
  assert.equal(inv.remainingCents, 0);
  assert.equal(inv.paidCents, 250_000);
  assert.equal(after.installments.length, 1, 'o plano de 4 parcelas existe');
  assert.equal(after.installments[0].perCents, 216_092);

  // a primeira parcela já caiu numa fatura seguinte
  const nov = (await c('GET', `/api/account/cards/${id}/invoices/2026-11`)).json;
  assert.ok(nov.entries.some((e: any) => e.installmentNo === 1 && e.installmentTotal === 4 && e.amountCents === 216_092), JSON.stringify(nov.entries));

  // os juros entram como gasto (e as parcelas não contam em dobro na conta)
  const mes = (await c('GET', '/api/account/month/2026-10')).json;
  assert.ok(mes.entries.some((e: any) => /juros do parcelamento/i.test(e.note) && e.amountCents === -283_490), JSON.stringify(mes.entries));
});

test('parcelar a fatura: valida e não deixa registrar duas vezes', async () => {
  const c = await assinante('parcela-dois@exemplo.com');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  await c('POST', `/api/account/cards/${id}/purchases`, { body: { date: '2026-03-10', amountCents: 100_000, note: 'X' } });
  assert.equal((await c('POST', `/api/account/cards/${id}/invoices/2026-04/finance`, { body: { count: 0, perCents: 1 } })).status, 400);
  assert.equal((await c('POST', `/api/account/cards/${id}/invoices/2026-04/finance`, { body: { count: 4, perCents: 30_000 } })).status, 200);
  const again = await c('POST', `/api/account/cards/${id}/invoices/2026-04/finance`, { body: { count: 4, perCents: 30_000 } });
  assert.ok(again.status >= 400 && again.status < 500, `segundo parcelamento da mesma fatura: ${again.status}`);
});

test('saldo da conta: o saldo do extrato vira a base e o negativo anterior compõe o saldo do mês', async () => {
  const c = await assinante('parcela-tres@exemplo.com');
  const w = await c('POST', '/api/account/wallets', { body: { name: 'Conta Exemplo', kind: 'conta', overdraftLimitCents: 1_000_000 } });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  const wid = w.json.id as string;
  // lançamentos soltos (sem carteira), como vieram do extrato
  await c('POST', '/api/account/entries', { body: { entries: [
    { date: '2026-10-02', amountCents: 500_000, note: 'SALARIO EXEMPLO', source: 'import' },
    { date: '2026-10-20', amountCents: -300_000, note: 'ALUGUEL EXEMPLO', source: 'import' },
  ] } });
  // o extrato disse: saldo de R$ -1.862,12 em 25/10
  const a = await c('POST', `/api/account/wallets/${wid}/anchor`, { body: { asOf: '2026-10-25', balanceCents: -186_212 } });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.balanceCents, -186_212);
  assert.equal(a.json.openingBalanceCents, -186_212 - 200_000, 'saldo de partida = saldo do extrato menos o que se moveu');

  const mes = (await c('GET', '/api/account/month/2026-10')).json;
  assert.equal(mes.summary.balanceCents, 200_000, 'o saldo do mês continua sendo entrou menos saiu');
  assert.equal(mes.account.endCents, -186_212);
  assert.equal(mes.account.startCents, -386_212);
  assert.equal(mes.account.limitCents, 1_000_000);
});
