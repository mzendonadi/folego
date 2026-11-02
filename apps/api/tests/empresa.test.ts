// Empresa (PJ): limites por plano, isolamento total dos números pessoais, movimentos com o sócio, cartão e investimentos da empresa. Dados inventados.
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
const conta = { name: 'Conta PJ Exemplo', kind: 'conta', openingBalanceCents: 0 };
const cartaoPj = { name: 'Cartão Empresa', brand: 'visa', last4: '4242', limitCents: 1_000_000, closingDay: 5, dueDay: 12 };
const biz = async (c: Client) => (await c('GET', `/api/account/business?month=${month}`)).json;
/** Números pessoais do mês: o que o gráfico pessoal enxerga (gasto por categoria e série de entrou/saiu). */
const pessoal = async (c: Client) => {
  const d = (await c('GET', `/api/account/charts?month=${month}&months=1`)).json;
  const m = d.series.find((s: any) => s.month === month) ?? { incomeCents: 0, spendCents: 0 };
  return { income: m.incomeCents as number, spend: m.spendCents as number, categories: d.byCategory.length as number };
};

test('Ousado: uma conta e um cartão da empresa; o resto é do Desbravador; Controle não tem', async () => {
  const controle = await assinante('empresa-controle@exemplo.com', 'controle');
  assert.equal((await controle('GET', `/api/account/business?month=${month}`)).status, 403);

  const o = await assinante('empresa-ousado@exemplo.com', 'ousado');
  const v = await biz(o);
  assert.equal(v.plan.multi, false);
  assert.deepEqual(v.plan.limits, { wallets: 1, cards: 1 });
  assert.equal(v.hasData, false);
  assert.equal((await o('POST', '/api/account/business/wallets', { body: conta })).status, 201);
  const second = await o('POST', '/api/account/business/wallets', { body: { ...conta, name: 'Segunda conta' } });
  assert.equal(second.status, 422);
  assert.match(second.json.message, /Desbravador/);
  assert.equal((await o('POST', '/api/account/business/cards', { body: cartaoPj })).status, 201);
  assert.equal((await o('POST', '/api/account/business/cards', { body: { ...cartaoPj, name: 'Outro cartão' } })).status, 422);
  // lançamentos da empresa valem no Ousado; movimentos com o sócio, relatório e investimentos da empresa são do Desbravador
  const w = (await biz(o)).wallets[0].id;
  assert.equal((await o('POST', '/api/account/business/entries', { body: { date: today, amountCents: 100_000, note: 'Venda de serviço', walletId: w } })).status, 201);
  assert.equal((await o('POST', '/api/account/business/movements', { body: { movement: 'pro_labore', date: today, amountCents: 10_000, walletId: w } })).status, 403);
  assert.equal((await o('GET', `/api/account/business/report?from=${month}-01&to=${today}`)).status, 403);
  assert.equal((await o('GET', '/api/account/business/suggestions')).status, 403);
  assert.equal((await o('GET', '/api/account/investments?scope=pj')).status, 403);
  const after = await biz(o);
  assert.equal(after.partner, null, 'sem movimentos com o sócio no Ousado');
  assert.equal(after.investments, null);
  assert.equal(after.month.incomeCents, 100_000);
});

test('Desbravador: contas e cartões ilimitados (até o teto), e NADA da empresa entra nos números pessoais', async () => {
  const c = await assinante('empresa-desbrav@exemplo.com');
  assert.equal((await biz(c)).plan.multi, true);
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -12_345, note: 'Mercado pessoal', category: 'mercado' }, { date: today, amountCents: 800_000, note: 'Salario' }] } });
  const antes = await pessoal(c);
  for (const n of ['Conta A', 'Conta B', 'Conta C']) assert.equal((await c('POST', '/api/account/business/wallets', { body: { ...conta, name: n } })).status, 201);
  for (const n of ['Cartão A', 'Cartão B']) assert.equal((await c('POST', '/api/account/business/cards', { body: { ...cartaoPj, name: n } })).status, 201);
  const v = await biz(c);
  assert.equal(v.wallets.length, 3);
  assert.equal(v.cards.length, 2);
  const w = v.wallets[0].id;
  // receitas e despesas grandes da empresa
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: 5_000_000, note: 'Venda para cliente', walletId: w } });
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -1_500_000, note: 'Fornecedor de material', walletId: w } });
  const depois = await pessoal(c);
  assert.deepEqual(depois, antes, 'o pessoal fica exatamente igual: empresa nunca se mistura');
  const e = await biz(c);
  assert.equal(e.month.incomeCents, 5_000_000);
  assert.equal(e.month.spendCents, 1_500_000);
  assert.equal(e.month.resultCents, 3_500_000);
  assert.equal(e.totals.balanceCents, 3_500_000);
  // e o contrário: lançamento pessoal não aparece na empresa
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: -99_999, note: 'Outra compra pessoal' }] } });
  assert.equal((await biz(c)).month.spendCents, 1_500_000);
  // isolamento entre pessoas
  const outro = await assinante('empresa-outro@exemplo.com');
  assert.equal((await biz(outro)).hasData, false);
  assert.equal((await outro('DELETE', `/api/account/business/wallets/${w}`)).status, 404);
});

test('movimentos com o sócio: pró-labore e lucros são renda pessoal; aporte e retirada são transferência; cada lado com a regra certa', async () => {
  const c = await assinante('empresa-socio@exemplo.com');
  const pfWallet = (await c('POST', '/api/account/wallets', { body: { name: 'Conta pessoal', kind: 'conta' } })).json.id as string;
  const pj = (await c('POST', '/api/account/business/wallets', { body: conta })).json.id as string;
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: 3_000_000, note: 'Venda grande', walletId: pj } });
  const base = await pessoal(c);
  const mv = (movement: string, amountCents: number, extra: object = {}) => c('POST', '/api/account/business/movements', { body: { movement, date: today, amountCents, walletId: pj, pfWalletId: pfWallet, ...extra } });

  const pro = await mv('pro_labore', 500_000);
  assert.equal(pro.status, 201, JSON.stringify(pro.json));
  let p = await pessoal(c);
  assert.equal(p.income - base.income, 500_000, 'pró-labore é renda pessoal');
  assert.equal((await mv('lucros', 300_000)).status, 201);
  p = await pessoal(c);
  assert.equal(p.income - base.income, 800_000, 'lucros também são renda pessoal');

  const ret = await mv('retirada', 100_000);
  const apo = await mv('aporte', 200_000);
  assert.equal(ret.status, 201);
  assert.equal(apo.status, 201);
  p = await pessoal(c);
  assert.equal(p.income - base.income, 800_000, 'retirada NÃO é renda pessoal');
  assert.equal(p.spend - base.spend, 0, 'aporte NÃO é gasto pessoal');
  const kinds = await db.query<{ note: string; transfer_kind: string | null; amount_cents: string }>(`SELECT note, transfer_kind, amount_cents::text FROM app.ledger_entries WHERE id = ANY($1::uuid[]) ORDER BY amount_cents`, [[ret.json.pfEntryId, apo.json.pfEntryId]]);
  assert.deepEqual(kinds.rows.map((r) => [r.transfer_kind, Number(r.amount_cents)]), [['business', -200_000], ['business', 100_000]]);

  const v = await biz(c);
  assert.deepEqual(v.partner, { proLaboreCents: 500_000, lucrosCents: 300_000, retiradaCents: 100_000, aporteCents: 200_000, paidToPartnerCents: 900_000, putByPartnerCents: 200_000, netToPartnerCents: 700_000 });
  assert.equal(v.month.incomeCents, 3_000_000, 'aporte do sócio não é receita da empresa');
  assert.equal(v.month.spendCents, 500_000, 'só o pró-labore é despesa; lucros e retirada são distribuição');
  assert.equal(v.totals.balanceCents, 3_000_000 - 500_000 - 300_000 - 100_000 + 200_000, 'o saldo da conta da empresa conta tudo');

  // apagar o movimento apaga o espelho pessoal que foi criado junto
  const list = (await c('GET', `/api/account/business/entries?month=${month}`)).json.entries as any[];
  const proEntry = list.find((x) => x.movement === 'pro_labore');
  assert.equal((await c('DELETE', `/api/account/business/entries/${proEntry.id}`)).status, 204);
  assert.equal((await db.query(`SELECT 1 FROM app.ledger_entries WHERE id = $1`, [pro.json.pfEntryId])).rows.length, 0);
  // sem espelho: só a empresa registra
  const solo = await mv('pro_labore', 50_000, { mirrorPf: false });
  assert.equal(solo.json.pfEntryId, null);
  // conta da empresa de outra pessoa é recusada
  const intruso = await assinante('empresa-intruso@exemplo.com');
  assert.equal((await intruso('POST', '/api/account/business/movements', { body: { movement: 'aporte', date: today, amountCents: 1000, walletId: pj } })).status, 422);
});

test('o Prumo lê os lançamentos pessoais, sugere os que parecem da empresa e liga com a regra certa', async () => {
  const c = await assinante('empresa-sugestao@exemplo.com');
  const pj = (await c('POST', '/api/account/business/wallets', { body: conta })).json.id as string;
  await c('POST', '/api/account/entries', { body: { entries: [
    { date: today, amountCents: 400_000, note: 'Pro-labore Minha Empresa LTDA' },
    { date: today, amountCents: -150_000, note: 'Aporte na empresa' },
    { date: today, amountCents: 90_000, note: 'PIX Padaria do Bairro' },
    { date: today, amountCents: 120_000, note: 'Pagamento Servicos Exemplo ME LTDA' },
  ] } });
  const s = (await c('GET', '/api/account/business/suggestions')).json.suggestions as any[];
  const por = (t: RegExp) => s.find((x) => t.test(x.note));
  assert.equal(por(/Pro-labore/)?.guess, 'pro_labore');
  assert.equal(por(/Aporte/)?.guess, 'aporte');
  assert.equal(por(/Servicos Exemplo/)?.guess ?? null, null, 'só o nome de empresa: sugere, mas a pessoa escolhe o movimento');
  assert.ok(por(/Servicos Exemplo/), 'nome de empresa vira sugestão');
  assert.equal(por(/Padaria/), undefined, 'lançamento comum não é sugerido');

  const apo = por(/Aporte/);
  const proPf = por(/Pro-labore/);
  // sentido errado: um aporte tem que SAIR da conta pessoal
  assert.equal((await c('POST', '/api/account/business/links', { body: { pfEntryId: proPf.id, movement: 'aporte', walletId: pj } })).status, 422);
  assert.equal((await c('POST', '/api/account/business/links', { body: { pfEntryId: apo.id, movement: 'aporte', walletId: pj } })).status, 201);
  assert.equal((await db.query<{ transfer_kind: string | null }>(`SELECT transfer_kind FROM app.ledger_entries WHERE id = $1`, [apo.id])).rows[0]!.transfer_kind, 'business', 'aporte ligado deixa de ser gasto pessoal');
  assert.equal((await c('POST', '/api/account/business/links', { body: { pfEntryId: apo.id, movement: 'aporte', walletId: pj } })).status, 409, 'não liga duas vezes');
  assert.equal((await c('POST', '/api/account/business/links', { body: { pfEntryId: proPf.id, movement: 'pro_labore', walletId: pj } })).status, 201);
  const s2 = (await c('GET', '/api/account/business/suggestions')).json.suggestions as any[];
  assert.ok(!s2.some((x) => /Aporte|Pro-labore/.test(x.note)), 'o que já foi ligado não volta como sugestão');
  // apagar o movimento ligado NÃO apaga o lançamento pessoal que já existia
  const list = (await c('GET', `/api/account/business/entries?month=${month}`)).json.entries as any[];
  const ligado = list.find((x) => x.movement === 'pro_labore');
  assert.equal(ligado.linkedToPf, true);
  assert.equal((await c('DELETE', `/api/account/business/entries/${ligado.id}`)).status, 204);
  assert.equal((await db.query(`SELECT 1 FROM app.ledger_entries WHERE id = $1`, [proPf.id])).rows.length, 1);
});

test('cartão da empresa: compra usa o limite sem mexer na conta; pagar a fatura sai da conta e não vira despesa de novo', async () => {
  const c = await assinante('empresa-cartao@exemplo.com');
  const pj = (await c('POST', '/api/account/business/wallets', { body: { ...conta, openingBalanceCents: 1_000_000 } })).json.id as string;
  const card = (await c('POST', '/api/account/business/cards', { body: cartaoPj })).json.id as string;
  assert.equal((await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -300_000, note: 'Google Ads campanha', cardId: card } })).status, 201);
  let v = await biz(c);
  assert.equal(v.cards[0].usedCents, 300_000);
  assert.equal(v.cards[0].availableCents, 700_000);
  assert.equal(v.wallets[0].balanceCents, 1_000_000, 'compra no cartão não sai da conta na hora');
  assert.equal(v.month.spendCents, 300_000);
  assert.equal(v.month.byCategory[0].category, 'marketing', 'o Prumo reconhece anúncio sozinho');
  // erros de uso
  assert.equal((await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -1000, note: 'x', cardId: card, walletId: pj } })).status, 422);
  assert.equal((await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: 1000, note: 'x', cardId: card } })).status, 422);
  // pagar parte da fatura
  assert.equal((await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -100_000, walletId: pj, cardId: card, cardPayment: true } })).status, 201);
  v = await biz(c);
  assert.equal(v.cards[0].usedCents, 200_000);
  assert.equal(v.wallets[0].balanceCents, 900_000);
  assert.equal(v.month.spendCents, 300_000, 'o pagamento da fatura não é despesa de novo');
  assert.equal((await c('PUT', `/api/account/business/cards/${card}`, { body: { ...cartaoPj, limitCents: 2_000_000 } })).status, 200);
  assert.equal((await biz(c)).cards[0].availableCents, 1_800_000);
});

test('investimentos da empresa: separados dos pessoais; resgate volta para conta da empresa; só Desbravador', async () => {
  const c = await assinante('empresa-invest@exemplo.com');
  const pj = (await c('POST', '/api/account/business/wallets', { body: conta })).json.id as string;
  const pf = (await c('POST', '/api/account/wallets', { body: { name: 'Conta pessoal', kind: 'conta' } })).json.id as string;
  const inv = { kind: 'renda_fixa', indexer: 'cdi', ratePct: 100, appliedOn: '2026-09-01', liquidity: 'diaria', status: 'ativo' };
  assert.equal((await c('POST', '/api/account/investments', { body: { ...inv, name: 'CDB pessoal', appliedCents: 100_000 } })).status, 201);
  const emp = await c('POST', '/api/account/investments', { body: { ...inv, name: 'CDB da empresa', appliedCents: 5_000_000, scope: 'pj' } });
  assert.equal(emp.status, 201, JSON.stringify(emp.json));
  const listPf = (await c('GET', '/api/account/investments')).json;
  const listPj = (await c('GET', '/api/account/investments?scope=pj')).json;
  assert.deepEqual(listPf.investments.map((x: any) => x.name), ['CDB pessoal']);
  assert.deepEqual(listPj.investments.map((x: any) => x.name), ['CDB da empresa']);
  assert.equal(listPf.totals.appliedCents, 100_000, 'o total pessoal não inclui a empresa');
  assert.equal(listPj.totals.appliedCents, 5_000_000);
  assert.equal((await biz(c)).investments.appliedCents, 5_000_000, 'a Visão geral da empresa mostra o investimento da empresa');
  // resgate: conta pessoal é recusada, conta da empresa recebe sem virar receita
  const red = (walletId: string, amountCents: number) => c('POST', `/api/account/investments/${emp.json.id}/redeem`, { body: { amountCents, date: today, walletId } });
  assert.equal((await red(pf, 1_000_000)).status, 422, 'dinheiro da empresa não volta para conta pessoal');
  assert.equal((await red(pj, 1_000_000)).status, 200);
  const v = await biz(c);
  assert.equal(v.wallets[0].balanceCents, 1_000_000);
  assert.equal(v.month.incomeCents, 0, 'resgate é transferência, não receita');
  // Ousado não tem investimentos da empresa
  const o = await assinante('empresa-invest-ousado@exemplo.com', 'ousado');
  assert.equal((await o('POST', '/api/account/investments', { body: { ...inv, name: 'X', appliedCents: 1000, scope: 'pj' } })).status, 403);
});

test('relatório da empresa (Desbravador): totais, categorias, movimentos com o sócio e comparação com o período anterior', async () => {
  const c = await assinante('empresa-relatorio@exemplo.com');
  const pj = (await c('POST', '/api/account/business/wallets', { body: conta })).json.id as string;
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: 2_000_000, note: 'Venda', walletId: pj } });
  await c('POST', '/api/account/business/entries', { body: { date: today, amountCents: -400_000, note: 'DAS Simples Nacional', walletId: pj } });
  await c('POST', '/api/account/business/movements', { body: { movement: 'pro_labore', date: today, amountCents: 300_000, walletId: pj, mirrorPf: false } });
  const r = (await c('GET', `/api/account/business/report?from=${month}-01&to=${today}`)).json;
  assert.equal(r.totals.incomeCents, 2_000_000);
  assert.equal(r.totals.spendCents, 700_000);
  assert.equal(r.totals.resultCents, 1_300_000);
  assert.equal(r.partner.proLaboreCents, 300_000);
  assert.ok(r.byCategory.find((x: any) => x.category === 'impostos' && x.spendCents === 400_000), 'DAS vira impostos sozinho');
  assert.equal(r.top[0].cents, 400_000);
  assert.equal((await c('GET', `/api/account/business/report?from=${today}&to=${month}-01`)).status, 422);
  assert.equal((await c('GET', '/api/account/business/report?from=2020-01-01&to=2026-12-31')).status, 422, 'período longo demais');
});
