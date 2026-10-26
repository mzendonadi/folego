// Fatura de cartão lida do PDF sem misturar com a conta: o pagamento da fatura no extrato não conta como gasto,
// compra solta no extrato vira compra do cartão (sem duplicar) e o cadastro do cartão acompanha o que o banco informa.
// Tudo com dados inventados.
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

const cartao = { name: 'Banco Exemplo Elite', brand: 'mastercard', last4: '3303', limitCents: 3_000_000, closingDay: 9, dueDay: 16 };
const fatura = {
  invoice: {
    key: '2026-10', periodStart: '2026-09-10', closingOn: '2026-10-08', dueOn: '2026-10-16', totalCents: 40_845, previousCents: 50_000, previousKey: '2026-09',
    history: [
      { key: '2026-08', periodStart: '2026-07-10', closingOn: '2026-08-10', totalCents: 90_000, paidCents: 90_000 },
      { key: '2026-09', periodStart: '2026-08-11', closingOn: '2026-09-09', totalCents: 50_000, paidCents: 50_000 },
    ],
  },
  entries: [
    { date: '2026-09-17', amountCents: 10_000, note: 'LOJA TESTE 6', installmentNo: 3, installmentTotal: 3 },
    { date: '2026-10-05', amountCents: 1_000, note: 'TARIFA TESTE' },
    { date: '2026-09-10', amountCents: 3_110, note: 'OPENAI' },
    { date: '2026-09-10', amountCents: 3_110, note: 'OPENAI' },
    { date: '2026-09-09', amountCents: 23_625, note: 'FACEBK *ABC123 (35,48 EURO)' },
  ],
  credits: [],
  payments: [{ date: '2026-09-10', amountCents: 50_000, note: 'PAGAMENTO DE FATURA-INTERNET' }],
  card: { name: 'Banco Exemplo Elite Mastercard', limitCents: 4_406_000, closingDay: 9, dueDay: 16, last4: '3303', availableCents: 3_507_802 },
};

test('fatura: o pagamento no extrato não vira gasto, a compra solta é adotada e o cartão ganha o limite do banco', async () => {
  const c = await assinante('fatura-um@exemplo.com', 'desbravador');
  const card = await c('POST', '/api/account/cards', { body: cartao });
  assert.equal(card.status, 201, JSON.stringify(card.json));
  const id = card.json.id as string;

  // Extrato de setembro importado ANTES: a saída do boleto parece uma despesa qualquer e a cobrança da OpenAI está solta na conta.
  const ext = await c('POST', '/api/account/entries', { body: { entries: [
    { date: '2026-09-10', amountCents: -50_000, note: 'PAGAMENTO DE BOLETO BANCO EXEMPLO', source: 'import' },
    { date: '2026-09-10', amountCents: -3_110, note: 'OPENAI', source: 'import' },
    { date: '2026-09-12', amountCents: -20_000, note: 'MERCADO CENTRAL', source: 'import' },
  ] } });
  assert.equal(ext.json.added, 3);
  assert.equal(ext.json.transfers, 0, 'sem fatura conhecida, "pagamento de boleto" ainda é só uma suspeita');
  assert.equal((await c('GET', '/api/account/month/2026-09')).json.summary.spendCents, 73_110, 'por enquanto o boleto está contado como gasto');

  const imp = await c('POST', `/api/account/cards/${id}/import`, { body: fatura });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  assert.equal(imp.json.adopted, 1, 'a OpenAI solta no extrato passa a ser do cartão');
  assert.equal(imp.json.added, 4);
  assert.equal(imp.json.transfers, 1, 'o boleto de 500,00 era o pagamento da fatura de setembro');
  assert.ok(imp.json.updated.includes('limite'));

  const set = (await c('GET', '/api/account/month/2026-09')).json;
  assert.equal(set.summary.spendCents, 20_000 + 10_000 + 6_220 + 23_625, 'mercado + compras do cartão; o pagamento da fatura fica de fora');
  const pagto = set.entries.find((e: any) => /BOLETO/.test(e.note));
  assert.equal(pagto.transfer, true);
  assert.equal(set.entries.filter((e: any) => e.note === 'OPENAI').length, 2, 'as duas cobranças iguais existem, sem terceira');

  const lista = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(lista.limitCents, 4_406_000);
  assert.equal(lista.closingDay, 9);
  const inv = lista.summary.invoices;
  assert.equal(inv.find((i: any) => i.key === '2026-09').status, 'paid', 'setembro está quitada pelo pagamento de 500,00');
  const out = inv.find((i: any) => i.key === '2026-10');
  assert.deepEqual([out.totalCents, out.paidCents, out.remainingCents], [40_845, 0, 40_845], 'outubro continua inteira em aberto, não "paga parcialmente"');

  // Ler a mesma fatura outra vez não duplica nada.
  const again = await c('POST', `/api/account/cards/${id}/import`, { body: fatura });
  assert.equal(again.json.added, 0);
  assert.equal(again.json.adopted, 0);
  assert.equal(again.json.transfers, 0);
  assert.equal((await c('GET', '/api/account/month/2026-09')).json.summary.spendCents, 59_845);
});

test('extrato: "pagamento de fatura" é reconhecido na hora; quem tem só um cartão ganha o pagamento registrado nele', async () => {
  const c = await assinante('fatura-dois@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  const r = await c('POST', '/api/account/entries', { body: { entries: [
    { date: '2026-10-20', amountCents: -7_000, note: 'PAGAMENTO DE FATURA CARTAO EXEMPLO', source: 'import' },
    { date: '2026-10-21', amountCents: -1_500, note: 'PADARIA', source: 'import' },
  ] } });
  assert.equal(r.json.transfers, 1);
  assert.equal((await c('GET', '/api/account/month/2026-10')).json.summary.spendCents, 1_500);
  const pagos = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.card_payments WHERE card_id = $1 AND amount_cents = 7000`, [id]);
  assert.equal(pagos.rows[0]!.n, '1');
  // A pessoa pode desmarcar na prévia: aí é gasto comum.
  const s = await c('POST', '/api/account/entries', { body: { entries: [{ date: '2026-10-22', amountCents: -9_000, note: 'PAGAMENTO DE FATURA OUTRA COISA', source: 'import', transfer: false }] } });
  assert.equal(s.json.transfers, 0);
  assert.equal((await c('GET', '/api/account/month/2026-10')).json.summary.spendCents, 10_500);
});

test('fatura: pagamento só parcial deixa a fatura anterior em aberto (não vira "paga" por engano)', async () => {
  const c = await assinante('fatura-tres@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  const parcial = {
    ...fatura,
    invoice: { ...fatura.invoice, previousCents: 50_000, history: [{ key: '2026-09', periodStart: '2026-08-11', closingOn: '2026-09-09', totalCents: 50_000, paidCents: 20_000 }] },
    payments: [{ date: '2026-09-10', amountCents: 20_000, note: 'PAGAMENTO DE FATURA-INTERNET' }],
  };
  const imp = await c('POST', `/api/account/cards/${id}/import`, { body: parcial });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  const inv = (await c('GET', '/api/account/cards')).json.cards[0].summary.invoices;
  const sep = inv.find((i: any) => i.key === '2026-09');
  assert.deepEqual([sep.totalCents, sep.paidCents, sep.remainingCents], [50_000, 20_000, 30_000]);
});

test('fatura: formato antigo (só entries e credits) continua funcionando', async () => {
  const c = await assinante('fatura-quatro@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  const imp = await c('POST', `/api/account/cards/${id}/import`, { body: { entries: [{ date: '2026-10-01', amountCents: 2_500, note: 'CAFE' }], credits: [] } });
  assert.equal(imp.status, 200);
  assert.equal(imp.json.added, 1);
});

test('fatura: parcelas "do futuro" lançadas com data do passado são corrigidas pela fatura e o plano volta a ter as parcelas que faltam', async () => {
  const c = await assinante('fatura-cinco@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/cards', { body: cartao })).json.id as string;
  const sub = (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = 'fatura-cinco@exemplo.com'`)).rows[0]!.id;
  const plan = (await db.query<{ id: string }>(
    `INSERT INTO app.card_installments(subscriber_id, card_id, note, category, per_cents, total_n, posted_n, first_on) VALUES ($1,$2,'COMPRA LONGA',$3,30000,6,6,'2026-03-27') RETURNING id`, [sub, id, 'outros'])).rows[0]!.id;
  for (const [no, date] of [[5, '2026-07-27'], [6, '2026-08-27']] as const) {
    await db.query(`INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, installment_plan) VALUES ($1,$2,-30000,'outros','COMPRA LONGA','import',$3,$4,6,$5)`, [sub, date, id, no, plan]);
  }
  const imp = await c('POST', `/api/account/cards/${id}/import`, { body: { entries: [{ date: '2026-09-27', amountCents: 30_000, note: 'COMPRA LONGA', installmentNo: 4, installmentTotal: 6 }], credits: [] } });
  assert.equal(imp.status, 200, JSON.stringify(imp.json));
  assert.equal(imp.json.added, 1);
  const left = await db.query<{ n: number }>(`SELECT installment_no AS n FROM app.ledger_entries WHERE installment_plan = $1 ORDER BY 1`, [plan]);
  assert.deepEqual(left.rows.map((r) => r.n), [4], 'as parcelas 5 e 6 com data anterior à 4 não existem');
  const p = (await db.query<{ posted_n: number }>(`SELECT posted_n FROM app.card_installments WHERE id = $1`, [plan])).rows[0]!;
  assert.equal(p.posted_n, 4);
  const card = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.equal(card.summary.futureInstallmentsCents, 60_000, 'faltam duas parcelas de R$ 300,00');
});
