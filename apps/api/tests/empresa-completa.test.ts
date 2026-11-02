// Empresa (PJ), parte 2: cheque especial (LIS), extrato e fatura importados, dívidas e WhatsApp com o lado escolhido. Tudo separado do pessoal. Dados inventados.
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
const ctx = (): Ctx => ({ db, config, gateway, whatsapp: fake, email: mailbox } as unknown as Ctx);

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
async function assinante(email: string, plan: 'controle' | 'ousado' | 'desbravador' = 'desbravador'): Promise<Client> {
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

const today = todaySaoPaulo();
const month = today.slice(0, 7);
const biz = async (c: Client) => (await c('GET', `/api/account/business?month=${month}`)).json;
const pessoal = async (c: Client) => {
  const d = (await c('GET', `/api/account/charts?month=${month}&months=1`)).json;
  const m = d.series.find((s: any) => s.month === month) ?? { incomeCents: 0, spendCents: 0 };
  return { income: m.incomeCents as number, spend: m.spendCents as number };
};

test('conta da empresa no negativo: cheque especial (LIS) vira alerta e dívida da empresa, sem tocar as dívidas pessoais', async () => {
  const c = await assinante('pj-lis@exemplo.com');
  const before = await pessoal(c);
  const w = (await c('POST', '/api/account/business/wallets', { body: { name: 'Conta PJ LIS', kind: 'conta', openingBalanceCents: 0, overdraftLimitCents: 100_000, overdraftRateBps: 800 } })).json;
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -150_000, note: 'Fornecedor atrasado', walletId: w.id } });
  const ov = await biz(c);
  const cw = ov.wallets[0];
  assert.equal(cw.balanceCents, -150_000);
  assert.equal(cw.overdraft.level, 'over');
  assert.equal(cw.overdraft.usedCents, 150_000);
  assert.equal(cw.overdraft.overLimitCents, 50_000);
  assert.ok(ov.alerts.length > 0 && /cheque especial/.test(ov.alerts[0].title));
  const debts = (await c('GET', '/api/account/business/debts')).json;
  const lis = debts.debts.find((d: any) => d.virtual);
  assert.equal(lis.balanceCents, 150_000);
  assert.equal(debts.totals.owedCents, 150_000);
  assert.deepEqual(await pessoal(c), before, 'pessoal intacto');
  const pfDebts = (await c('GET', '/api/account/debts')).json;
  assert.equal(pfDebts.debts.length, 0, 'o cheque especial da empresa não aparece nas dívidas pessoais');
  // entrou dinheiro: sai do negativo
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: 200_000, note: 'Venda cliente', walletId: w.id } });
  assert.equal((await biz(c)).wallets[0].overdraft.level, 'none');
  assert.equal((await c('GET', '/api/account/business/debts')).json.debts.length, 0);
  // só conta bancária tem cheque especial
  const cx = (await c('POST', '/api/account/business/wallets', { body: { name: 'Caixa', kind: 'caixa' } }));
  assert.equal(cx.status, 201);
  const bad = await c('PUT', `/api/account/business/wallets/${cx.json.id}`, { body: { overdraftLimitCents: 1000 } });
  assert.equal(bad.status, 422);
});

test('extrato importado na empresa: sem repetir, reconhece pró-labore, ancora o saldo e não mexe no pessoal', async () => {
  const c = await assinante('pj-import@exemplo.com');
  const before = await pessoal(c);
  const w = (await c('POST', '/api/account/business/wallets', { body: { name: 'Conta PJ Import', kind: 'conta' } })).json;
  const lines = [
    { date: today, amountCents: 500_000, note: 'PIX recebido cliente Alfa' },
    { date: today, amountCents: -12_000, note: 'Tarifa mensal' },
    { date: today, amountCents: -12_000, note: 'Tarifa mensal' }, // duas cobranças iguais no mesmo dia são duas
    { date: today, amountCents: -300_000, note: 'Pro-labore sócio' },
  ];
  const r1 = (await c('POST', '/api/account/business/import', { body: { walletId: w.id, entries: lines } })).json;
  assert.equal(r1.added, 4);
  const r2 = (await c('POST', '/api/account/business/import', { body: { walletId: w.id, entries: lines } })).json;
  assert.equal(r2.added, 0);
  assert.equal(r2.duplicates, 4, 'o mesmo extrato de novo não duplica nada');
  const ov = await biz(c);
  assert.equal(ov.month.incomeCents, 500_000);
  assert.equal(ov.month.spendCents, 12_000 + 12_000 + 300_000, 'pró-labore conta como despesa');
  const list = (await c('GET', `/api/account/business/entries?month=${month}`)).json.entries;
  assert.equal(list.find((e: any) => /labore/i.test(e.note)).movement, 'pro_labore');
  // o saldo que o extrato informa vira o saldo da conta
  const a = (await c('POST', `/api/account/business/wallets/${w.id}/anchor`, { body: { asOf: today, balanceCents: 123_456 } })).json;
  assert.equal(a.balanceCents, 123_456);
  assert.equal((await biz(c)).wallets[0].balanceCents, 123_456);
  assert.deepEqual(await pessoal(c), before, 'pessoal intacto');
});

test('fatura do cartão da empresa: compras no cartão, estorno abate, repetir não duplica, não mexe no saldo da conta', async () => {
  const c = await assinante('pj-fatura@exemplo.com');
  await c('POST', '/api/account/business/wallets', { body: { name: 'Conta PJ Fatura', kind: 'conta', openingBalanceCents: 1_000_000 } });
  const card = (await c('POST', '/api/account/business/cards', { body: { name: 'Cartão Empresa', brand: 'visa', last4: '4242', limitCents: 1_000_000, closingDay: 5, dueDay: 12 } })).json;
  const body = {
    entries: [{ date: today, amountCents: 50_000, note: 'Software gestão', installmentNo: 1, installmentTotal: 3 }, { date: today, amountCents: 8_000, note: 'Combustível' }],
    credits: [{ date: today, amountCents: 10_000, note: 'Estorno combustível' }],
    invoice: { key: month, closingOn: today, dueOn: today, totalCents: 48_000 },
    card: { limitCents: 2_000_000 },
  };
  const r = (await c('POST', `/api/account/business/cards/${card.id}/import`, { body })).json;
  assert.equal(r.added, 2);
  assert.equal(r.credits, 1);
  const ov = await biz(c);
  assert.equal(ov.cards[0].usedCents, 48_000);
  assert.equal(ov.cards[0].limitCents, 2_000_000, 'o limite do banco atualiza o cartão');
  assert.equal(ov.wallets[0].balanceCents, 1_000_000, 'compra no cartão não sai da conta');
  assert.equal(ov.month.spendCents, 48_000, 'estorno abate a despesa');
  assert.equal(ov.month.incomeCents, 0, 'estorno não é venda');
  const again = (await c('POST', `/api/account/business/cards/${card.id}/import`, { body })).json;
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 2);
});

test('dívidas da empresa: cadastrar, pagar com saída na conta, plano de quitação e Controle sem acesso', async () => {
  const c = await assinante('pj-dividas@exemplo.com');
  const w = (await c('POST', '/api/account/business/wallets', { body: { name: 'Conta PJ Dívidas', kind: 'conta', openingBalanceCents: 1_000_000 } })).json;
  const d = (await c('POST', '/api/account/business/debts', { body: { name: 'Empréstimo capital de giro', balanceCents: 500_000, monthlyRateBps: 250, minPaymentCents: 50_000 } })).json;
  const before = await pessoal(c);
  const list = (await c('GET', '/api/account/business/debts')).json;
  assert.equal(list.totals.owedCents, 500_000);
  assert.ok(list.plan, 'plano de quitação (avalanche e bola de neve) também para a empresa');
  const p = (await c('POST', `/api/account/business/debts/${d.id}/payments`, { body: { amountCents: 100_000, walletId: w.id, addToLedger: true } })).json;
  assert.equal(p.balanceCents, 400_000);
  assert.equal((await biz(c)).wallets[0].balanceCents, 900_000, 'o pagamento saiu da conta da empresa');
  assert.equal((await biz(c)).debts.owedCents, 400_000);
  assert.deepEqual(await pessoal(c), before, 'pessoal intacto');
  assert.equal((await c('GET', '/api/account/debts')).json.debts.length, 0, 'dívidas pessoais seguem separadas');
  const quit = (await c('POST', `/api/account/business/debts/${d.id}/payments`, { body: { amountCents: 900_000 } })).json;
  assert.equal(quit.paidOff, true);
  const controle = await assinante('pj-dividas-ctl@exemplo.com', 'controle');
  assert.equal((await controle('GET', '/api/account/business/debts')).status, 403);
});

let seq = 0;
const say = (phone: string, text: string | null, extra: Record<string, unknown> = {}) =>
  handleAssistantInbound(ctx(), { id: `pj${(seq += 1)}`, from: { phone_number: phone }, ...(text === null ? {} : { text: { body: text } }), ...extra });
const last = () => sent.at(-1)?.text ?? '';
async function vincular(c: Client, phone: string) {
  const link = (await c('POST', '/api/account/assistant/link')).json;
  await say(phone, `vincular ${link.pending.code}`);
}
const nBiz = async (c: Client) => (await c('GET', `/api/account/business/entries?month=${month}`)).json.entries as any[];
const nPf = async (c: Client) => ((await c('GET', `/api/account/month/${month}`)).json.entries ?? []) as any[];

test('WhatsApp: "empresa:" lança na empresa, "pessoal:" no pessoal, MODO muda o padrão e DESFAZER vale para o lado atual', async () => {
  const c = await assinante('pj-zap@exemplo.com');
  await c('POST', '/api/account/business/wallets', { body: { name: 'Conta PJ Zap', kind: 'conta' } });
  await vincular(c, '+5534991110001');
  assert.equal((await nBiz(c)).length, 0);
  assert.equal((await nPf(c)).length, 0);

  await say('+5534991110001', 'empresa: fornecedor 850');
  assert.match(last(), /Lancei na EMPRESA/);
  assert.equal((await nBiz(c)).length, 1);
  assert.equal((await nPf(c)).length, 0, 'não foi para o pessoal');

  await say('+5534991110001', 'mercado 45');
  assert.doesNotMatch(last(), /EMPRESA/);
  assert.equal((await nPf(c)).length, 1);
  assert.equal((await nBiz(c)).length, 1);

  await say('+5534991110001', 'empresa de luz 80'); // sem os dois-pontos continua sendo um gasto pessoal
  assert.equal((await nPf(c)).length, 2);

  await say('+5534991110001', 'modo empresa');
  assert.match(last(), /EMPRESA/);
  await say('+5534991110001', 'material de escritório 120');
  assert.equal((await nBiz(c)).length, 2);
  await say('+5534991110001', 'pessoal: farmácia 30');
  assert.equal((await nPf(c)).length, 3);
  assert.equal((await nBiz(c)).length, 2);

  await say('+5534991110001', 'saldo');
  assert.match(last(), /EMPRESA/);
  await say('+5534991110001', 'desfazer');
  assert.match(last(), /empresa/);
  assert.equal((await nBiz(c)).length, 1);
  assert.equal((await nPf(c)).length, 3, 'desfazer na empresa não apaga lançamento pessoal');

  await say('+5534991110001', 'modo pessoal');
  await say('+5534991110001', 'padaria 12');
  assert.equal((await nPf(c)).length, 4);
});

test('WhatsApp: Controle não tem empresa — avisa em vez de lançar no lado errado', async () => {
  const c = await assinante('pj-zap-ctl@exemplo.com', 'controle');
  await vincular(c, '+5534991110002');
  await say('+5534991110002', 'empresa: fornecedor 850');
  assert.doesNotMatch(last(), /Lancei/);
  assert.equal((await nPf(c)).length, 0);
});
