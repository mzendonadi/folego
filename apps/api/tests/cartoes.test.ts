// Cartões de crédito do Prumo: Ousado (cadastro, limite, fatura, parcelas, pagamento) e Desbravador (fatura em PDF, estratégias, rotativo).
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
async function assinante(email: string, plan: 'controle' | 'ousado' | 'desbravador'): Promise<Client> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan, acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return c;
}
const hoje = () => todaySaoPaulo();
const mes = () => hoje().slice(0, 7);
const daysAgo = (n: number) => new Date(Date.parse(`${hoje()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const azul = { name: 'Banco Azul', brand: 'visa', last4: '1234', limitCents: 500_000, closingDay: 5, dueDay: 12 };

test('Controle não tem cartões; os dois planos de cima têm', async () => {
  const c = await assinante('cartao-controle@exemplo.com', 'controle');
  assert.equal((await c('GET', '/api/account/cards')).json.error, 'plan_upgrade');
  assert.equal((await c('POST', '/api/account/cards', { body: azul })).status, 403);
});

test('Ousado: cadastra, limita em 3, valida dias e bandeira, edita e apaga sem perder os gastos', async () => {
  const c = await assinante('cartao-ousado@exemplo.com', 'ousado');
  assert.equal((await c('POST', '/api/account/cards', { body: { ...azul, closingDay: 32 } })).status, 400);
  assert.equal((await c('POST', '/api/account/cards', { body: { ...azul, brand: 'diners' } })).status, 400);
  const a = await c('POST', '/api/account/cards', { body: azul });
  assert.equal(a.status, 201);
  const b = await c('POST', '/api/account/cards', { body: { ...azul, name: 'Banco Verde', last4: null } });
  await c('POST', '/api/account/cards', { body: { ...azul, name: 'Loja' } });
  const fourth = await c('POST', '/api/account/cards', { body: { ...azul, name: 'Quarto' } });
  assert.equal(fourth.status, 422);
  assert.equal(fourth.json.error, 'too_many');
  assert.match(fourth.json.message, /Desbravador/);

  assert.equal((await c('PUT', `/api/account/cards/${b.json.id}`, { body: { limitCents: 800_000, closingDay: 20 } })).status, 200);
  const list = (await c('GET', '/api/account/cards')).json;
  assert.equal(list.pro, false);
  assert.equal(list.maxCards, 3);
  const verde = list.cards.find((x: any) => x.name === 'Banco Verde');
  assert.deepEqual([verde.limitCents, verde.closingDay], [800_000, 20]);
  assert.equal(list.totals.limitCents, 500_000 * 2 + 800_000);
  assert.deepEqual(list.strategies, [], 'estratégias são do Desbravador');

  // compra à vista no cartão: conta como gasto do mês e usa o limite
  const buy = await c('POST', `/api/account/cards/${a.json.id}/purchases`, { body: { date: hoje(), amountCents: 12_000, note: 'Mercado do bairro', category: 'mercado' } });
  assert.equal(buy.status, 201);
  assert.equal(buy.json.installments, 1);
  const month = (await c('GET', `/api/account/month/${mes()}`)).json;
  const entry = month.entries.find((e: any) => e.note === 'Mercado do bairro');
  assert.equal(entry.amountCents, -12_000);
  assert.equal(entry.cardName, 'Banco Azul');
  assert.equal(month.summary.spendCents, 12_000, 'a compra entra no gasto do mês');
  const after = (await c('GET', '/api/account/cards')).json.cards.find((x: any) => x.id === a.json.id);
  assert.equal(after.summary.usedCents, 12_000);
  assert.equal(after.summary.availableCents, 488_000);

  // a compra não pode ser no futuro; as parcelas futuras entram sozinhas
  const future = await c('POST', `/api/account/cards/${a.json.id}/purchases`, { body: { date: '2099-01-01', amountCents: 1000, note: 'x' } });
  assert.equal(future.json.error, 'future_date');

  // apagar o cartão mantém os gastos, só sem o cartão
  assert.equal((await c('DELETE', `/api/account/cards/${a.json.id}`)).status, 204);
  const kept = (await c('GET', `/api/account/month/${mes()}`)).json.entries.find((e: any) => e.note === 'Mercado do bairro');
  assert.equal(kept.cardId, null);
  assert.equal((await c('DELETE', `/api/account/cards/${a.json.id}`)).status, 404);
});

test('Ousado: compra parcelada lança uma parcela agora, compromete o limite todo e as próximas entram mês a mês; cancelar tira as futuras', async () => {
  const c = await assinante('cartao-parcelas@exemplo.com', 'ousado');
  const id = (await c('POST', '/api/account/cards', { body: azul })).json.id;
  const buy = await c('POST', `/api/account/cards/${id}/purchases`, { body: { date: hoje(), amountCents: 100_000, note: 'Notebook', installments: 5 } });
  assert.deepEqual([buy.json.installments, buy.json.perCents], [5, 20_000]);
  const card = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(card.summary.usedCents, 100_000, 'o limite fica comprometido pelo total, como no banco');
  assert.equal(card.summary.futureInstallmentsCents, 80_000);
  assert.equal(card.installments.length, 1);
  assert.equal(card.installments[0].remainingCents, 80_000);
  const month = (await c('GET', `/api/account/month/${mes()}`)).json.entries.filter((e: any) => e.note === 'Notebook');
  assert.equal(month.length, 1, 'só a parcela 1 aparece neste mês');
  assert.deepEqual([month[0].installmentNo, month[0].installmentTotal], [1, 5]);

  // o tempo passa: a compra foi feita há 65 dias, então as parcelas 2 e 3 já devem ter chegado
  await db.query(`UPDATE app.card_installments SET first_on = $1 WHERE card_id = $2`, [daysAgo(65), id]);
  await db.query(`UPDATE app.ledger_entries SET occurred_on = $1 WHERE card_id = $2`, [daysAgo(65), id]);
  const list = (await c('GET', '/api/account/cards')).json.cards[0];
  const posted = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE card_id = $1`, [id]);
  assert.equal(Number(posted.rows[0]!.n), 3, 'parcelas 1, 2 e 3');
  assert.equal(list.installments[0].postedN, 3);
  assert.equal((await c('GET', '/api/account/cards')).json.cards[0].summary.usedCents, 100_000, 'ler de novo não duplica');

  assert.equal((await c('DELETE', `/api/account/cards/${id}/installments/${list.installments[0].id}`)).status, 204);
  const after = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(after.installments.length, 0);
  assert.equal(after.summary.futureInstallmentsCents, 0);
  assert.equal(after.summary.usedCents, 60_000, 'as 3 parcelas já lançadas continuam na dívida');
});

test('pagar a fatura abate o cartão e o saldo da conta, mas NÃO vira gasto novo', async () => {
  const c = await assinante('cartao-pagar@exemplo.com', 'ousado');
  const id = (await c('POST', '/api/account/cards', { body: azul })).json.id;
  const w = await c('POST', '/api/account/wallets', { body: { name: 'Conta Azul', kind: 'conta', openingBalanceCents: 300_000 } });
  const poup = await c('POST', '/api/account/wallets', { body: { name: 'Cofre', kind: 'poupanca' } });
  await c('POST', `/api/account/cards/${id}/purchases`, { body: { date: daysAgo(40), amountCents: 50_000, note: 'Passagem', category: 'transporte' } });
  const before = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(before.summary.usedCents, 50_000);
  const spendBefore = (await c('GET', `/api/account/month/${daysAgo(40).slice(0, 7)}`)).json.summary.spendCents;

  assert.equal((await c('POST', `/api/account/cards/${id}/payments`, { body: { amountCents: 50_000, walletId: poup.json.id } })).json.error, 'invalid_wallet');
  const pay = await c('POST', `/api/account/cards/${id}/payments`, { body: { amountCents: 50_000, walletId: w.json.id, paidOn: daysAgo(30) } });
  assert.equal(pay.status, 201);
  const cardAfter = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(cardAfter.summary.usedCents, 0);
  assert.equal(cardAfter.payments.length, 1);
  const wallets = (await c('GET', '/api/account/wallets')).json.wallets;
  assert.equal(wallets.find((x: any) => x.id === w.json.id).balanceCents, 250_000, 'o saldo da conta caiu o valor da fatura');
  const spendAfter = (await c('GET', `/api/account/month/${daysAgo(40).slice(0, 7)}`)).json.summary.spendCents;
  assert.equal(spendAfter, spendBefore, 'pagar a fatura não é gasto novo');

  assert.equal((await c('DELETE', `/api/account/cards/${id}/payments/${pay.json.id}`)).status, 204);
  assert.equal((await c('GET', '/api/account/cards')).json.cards[0].summary.usedCents, 50_000);
  assert.equal((await c('GET', '/api/account/wallets')).json.wallets.find((x: any) => x.id === w.json.id).balanceCents, 300_000);
});

test('fatura em detalhe, alerta de limite e cartões de uma pessoa não aparecem para outra', async () => {
  const c = await assinante('cartao-detalhe@exemplo.com', 'ousado');
  const other = await assinante('cartao-outro@exemplo.com', 'ousado');
  const id = (await c('POST', '/api/account/cards', { body: { ...azul, limitCents: 100_000 } })).json.id;
  await c('POST', `/api/account/cards/${id}/purchases`, { body: { date: hoje(), amountCents: 95_000, note: 'Geladeira' } });
  const list = (await c('GET', '/api/account/cards')).json;
  assert.equal(list.cards[0].summary.level, 'high');
  assert.ok(list.alerts.some((a: any) => /limite/.test(a.text)));
  const key = list.cards[0].summary.current.key;
  const inv = (await c('GET', `/api/account/cards/${id}/invoices/${key}`)).json;
  assert.equal(inv.totalCents, 95_000);
  assert.equal(inv.byCategory, undefined, 'comparação é do Desbravador');
  assert.equal((await c('GET', `/api/account/cards/${id}/invoices/2026-13`)).status, 422);
  assert.equal((await other('GET', `/api/account/cards/${id}/invoices/${key}`)).status, 404);
  assert.equal((await other('POST', `/api/account/cards/${id}/purchases`, { body: { date: hoje(), amountCents: 100, note: 'x' } })).status, 404);
  assert.equal((await other('GET', '/api/account/cards')).json.cards.length, 0);
});

test('fatura em PDF, estratégias e rotativo são do Desbravador (Ousado recebe o convite de upgrade)', async () => {
  const o = await assinante('cartao-pdf-ousado@exemplo.com', 'ousado');
  const oid = (await o('POST', '/api/account/cards', { body: azul })).json.id;
  assert.equal((await o('POST', `/api/account/cards/${oid}/import`, { body: { entries: [], credits: [] } })).json.error, 'plan_upgrade');
  assert.equal((await o('GET', `/api/account/cards/${oid}/revolving`)).status, 403);

  const c = await assinante('cartao-pdf@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/cards', { body: azul })).json.id;
  const d = (s: number) => daysAgo(s);
  const body = {
    entries: [
      { date: d(10), amountCents: 24_560, note: 'MERCADO CENTRAL' },
      { date: d(9), amountCents: 5_590, note: 'NETFLIX.COM' },
      { date: d(8), amountCents: 19_990, note: 'NOTEBOOK LOJA X', installmentNo: 3, installmentTotal: 10 },
    ],
    credits: [{ date: d(7), amountCents: 10_000, note: 'PAGAMENTO RECEBIDO' }],
  };
  const imp = await c('POST', `/api/account/cards/${id}/import`, { body });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  assert.deepEqual([imp.json.added, imp.json.duplicates, imp.json.credits], [3, 0, 1]);
  const again = await c('POST', `/api/account/cards/${id}/import`, { body });
  assert.deepEqual([again.json.added, again.json.duplicates, again.json.credits], [0, 4, 0], 'importar o mesmo PDF de novo não duplica');

  // a compra "3/10" criou o plano das 7 que faltam: o limite já conta com elas
  const card = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(card.installments.length, 1);
  assert.deepEqual([card.installments[0].postedN, card.installments[0].totalN], [3, 10]);
  assert.equal(card.summary.futureInstallmentsCents, 7 * 19_990);
  assert.equal(card.summary.usedCents, 24_560 + 5_590 + 19_990 - 10_000 + 7 * 19_990);

  // a fatura seguinte traz a parcela 4/10 da mesma compra: não duplica o plano nem a parcela futura
  const next = await c('POST', `/api/account/cards/${id}/import`, { body: { entries: [{ date: d(0), amountCents: 19_990, note: 'NOTEBOOK LOJA X', installmentNo: 4, installmentTotal: 10 }], credits: [] } });
  assert.deepEqual([next.json.added, next.json.duplicates], [1, 0]);
  const card2 = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(card2.installments.length, 1, 'continua um plano só');
  assert.equal(card2.installments[0].postedN, 4);
  assert.equal(card2.summary.futureInstallmentsCents, 6 * 19_990);

  // estratégias, comparação entre faturas e rotativo
  const full = (await c('GET', '/api/account/cards')).json;
  assert.equal(full.pro, true);
  assert.ok(full.strategies.length > 0);
  assert.ok(full.strategies.some((s: any) => s.id === 'installments'));
  const key = full.cards[0].summary.invoices.find((i: any) => i.totalCents > 0).key;
  const inv = (await c('GET', `/api/account/cards/${id}/invoices/${key}`)).json;
  assert.ok(inv.byCategory.length > 0);
  assert.equal(inv.biggest[0].note.length > 0, true);
  const sim = (await c('GET', `/api/account/cards/${id}/revolving?fixed=20000`)).json;
  if (sim.balanceCents > 0) assert.deepEqual(sim.options.map((x: any) => x.id), ['full', 'minimum', 'half', 'fixed']);

  // parcela fora do total (12/10) é tratada como compra comum, sem derrubar nada
  const odd = await c('POST', `/api/account/cards/${id}/import`, { body: { entries: [{ date: d(1), amountCents: 100, note: 'x', installmentNo: 12, installmentTotal: 10 }], credits: [] } });
  assert.equal(odd.status, 200);
  assert.equal((await c('GET', '/api/account/cards')).json.cards[0].installments.length, 1);
});
