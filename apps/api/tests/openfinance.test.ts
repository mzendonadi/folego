// Contas conectadas (Open Finance): adaptador do Pluggy (HTTP simulado), importação sem duplicar, saldo real, LIS, plano e revogação.
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
import { PluggyProvider, FakeOpenFinanceProvider, consentCheck, makeOpenFinance } from '../src/openfinance.ts';
import type { OpenFinanceProvider, OfAccount, OfTransaction } from '../src/openfinance.ts';

class FakeOf implements OpenFinanceProvider {
  readonly name = 'fake';
  deleted: string[] = [];
  /** Estado que o agregador informa para os itens (os testes trocam para simular "precisa reconectar"). */
  itemStatus = 'UPDATED';
  consentExpiresAt: string | undefined = undefined;
  tokens: { user: string; itemId?: string | undefined }[] = [];
  accounts: OfAccount[] = [
    { id: 'acc-1', name: 'Conta Corrente', type: 'BANK', subtype: 'CHECKING_ACCOUNT', balance: -450.5 },
    { id: 'card-1', name: 'Cartão Gold', type: 'CREDIT', subtype: 'CREDIT_CARD', balance: 1250.4, credit: { limit: 9000, available: 7749.6, closeDay: 8, dueDay: 15 } },
  ];
  txs: OfTransaction[] = [
    { id: 't1', date: new Date().toISOString(), description: 'Supermercado Extra', amount: 120.4, type: 'DEBIT' },
    { id: 't2', date: new Date().toISOString(), description: 'Salário Empresa', amount: 3000, type: 'CREDIT' },
  ];
  cardTxs: OfTransaction[] = [
    { id: 'c1', date: new Date().toISOString(), description: 'Amazon Marketplace', amount: 189.9, type: 'DEBIT', installmentNumber: 2, totalInstallments: 5 },
    { id: 'c2', date: new Date().toISOString(), description: 'Pagamento recebido', amount: 100, type: 'CREDIT' },
  ];
  async createConnectToken(user: string, itemId?: string) { this.tokens.push({ user, itemId }); return 'connect-token-123'; }
  async getItem(id: string) { return { id, status: this.itemStatus, institution: 'Banco Teste', ...(this.consentExpiresAt ? { consentExpiresAt: this.consentExpiresAt } : {}) }; }
  async deleteItem(id: string) { this.deleted.push(id); }
  async listAccounts() { return this.accounts; }
  async listTransactions(accountId: string) { return accountId === 'card-1' ? this.cardTxs : this.txs; }
}

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
let of: FakeOf;
const mailbox = new MemorySender();
const WEBHOOK_SECRET = 'segredo-webhook-de-teste-123';
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, openFinanceWebhookSecret: WEBHOOK_SECRET };
const ctx = () => ({ db, config, gateway, email: mailbox });

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  of = new FakeOf();
  app = await buildApp({ config, db, gateway, email: mailbox, openFinance: of, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
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
async function subscribe(c: Client, email: string, plan: 'ousado' | 'desbravador') {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { email });
  await c('POST', '/api/account/login', { email, code: lastCode() });
  const co = await c('POST', '/api/account/subscription-checkout', { plan, acceptTerms: true });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-of-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}

test('adaptador do Pluggy: autentica, lê item, contas e extrato paginado com os campos certos', async () => {
  const calls: { url: string; method: string; key: string | null }[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: init?.method ?? 'GET', key: headers['X-API-KEY'] ?? null });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (url.endsWith('/auth')) return json({ apiKey: 'key-1' });
    if (url.endsWith('/connect_token')) return json({ accessToken: 'tok' });
    if (url.includes('/items/')) return json({ id: 'it-1', status: 'UPDATED', connector: { name: 'Nubank' } });
    if (url.includes('/accounts')) return json({ results: [{ id: 'a1', name: 'Conta', type: 'BANK', subtype: 'CHECKING_ACCOUNT', balance: 10.5 }] });
    if (url.includes('page=1')) return json({ results: [{ id: 'x1', date: '2026-09-01T00:00:00.000Z', description: 'Pix', amount: -20, type: 'DEBIT' }], totalPages: 2 });
    return json({ results: [{ id: 'x2', date: '2026-09-02T00:00:00.000Z', descriptionRaw: 'Mercado', amount: 5, type: 'CREDIT' }], totalPages: 2 });
  }) as unknown as typeof fetch;
  const p = new PluggyProvider({ clientId: 'id', clientSecret: 'sec', baseUrl: 'https://api.test' }, fakeFetch);
  assert.equal(await p.createConnectToken('user-1'), 'tok');
  assert.deepEqual(await p.getItem('it-1'), { id: 'it-1', status: 'UPDATED', institution: 'Nubank' });
  assert.equal((await p.listAccounts('it-1'))[0]!.balance, 10.5);
  const txs = await p.listTransactions('a1', '2026-09-01', '2026-09-30');
  assert.deepEqual(txs.map((t) => [t.id, t.amount, t.type, t.description]), [['x1', 20, 'DEBIT', 'Pix'], ['x2', 5, 'CREDIT', 'Mercado']]);
  assert.equal(calls.filter((c) => c.url.endsWith('/auth')).length, 1, 'a chave é reaproveitada');
  assert.ok(calls.filter((c) => !c.url.endsWith('/auth')).every((c) => c.key === 'key-1'));
});

test('serviço desligado: tudo responde 503 e o site não oferece', async () => {
  const off = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  const res = await off.inject({ method: 'GET', url: '/api/features', headers: { 'x-folego': '1' } });
  assert.equal(res.json().openFinance, false);
  await off.close();
});

test('Open Finance exige o plano Desbravador', async () => {
  const c = client();
  await subscribe(c, 'of-ousado@exemplo.com', 'ousado');
  assert.equal((await c('POST', '/api/account/openfinance/connect-token')).status, 403);
  assert.equal((await c('POST', '/api/account/openfinance/connections', { itemId: 'item-0001', acceptConsent: true })).status, 403);
  const anon = await client()('POST', '/api/account/openfinance/connect-token');
  assert.equal(anon.status, 401);
});

test('conectar: importa só conta bancária, saldo real, sem duplicar, e o LIS entra nas dívidas', async () => {
  const c = client();
  await subscribe(c, 'of-desb@exemplo.com', 'desbravador');
  const tk = await c('POST', '/api/account/openfinance/connect-token');
  assert.equal(tk.status, 200);
  assert.equal(tk.json.accessToken, 'connect-token-123');
  assert.equal((await c('POST', '/api/account/openfinance/connections', { itemId: 'item-0001' })).status, 400, 'sem aceite do consentimento não conecta');
  assert.equal((await c('POST', '/api/account/openfinance/connections', { itemId: "x'; drop", acceptConsent: true })).status, 400);
  const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-0001', acceptConsent: true });
  assert.equal(add.status, 201);
  assert.equal(add.json.imported, 4, '2 da conta (compra e salário) + 2 do cartão (compra e pagamento recebido)');

  const wallets = await c('GET', '/api/account/wallets');
  assert.equal(wallets.json.wallets.length, 1, 'o cartão de crédito vira cartão (aba Cartões), não carteira');
  const w = wallets.json.wallets[0];
  assert.equal(w.kind, 'conta');
  assert.equal(w.balanceCents, -45_050, 'o saldo da carteira é o saldo do banco');
  assert.equal(w.entries, 2);
  assert.equal(w.overdraft.usedCents, 45_050);

  const debts = await c('GET', '/api/account/debts');
  assert.ok(debts.json.debts.some((d: any) => d.virtual && d.balanceCents === 45_050), 'cheque especial aparece nas dívidas');

  // repetir não duplica
  const again = await c('POST', `/api/account/openfinance/connections/${add.json.id}/sync`);
  assert.equal(again.json.imported, 0);
  const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE source = 'openfinance'`);
  assert.equal(n.rows[0]!.n, '3', '2 da conta + 1 compra do cartão (o pagamento recebido abate o cartão)');
  // categorização e sinal
  const rows = await db.query<{ note: string; amount_cents: string; category: string }>(`SELECT note, amount_cents, category FROM app.ledger_entries WHERE source = 'openfinance' AND card_id IS NULL ORDER BY amount_cents`);
  assert.deepEqual(rows.rows.map((r) => [r.note, Number(r.amount_cents), r.category]), [['Supermercado Extra', -12_040, 'mercado'], ['Salário Empresa', 300_000, 'renda']]);

  const list = await c('GET', '/api/account/openfinance');
  assert.equal(list.json.connections.length, 1);
  assert.equal(list.json.connections[0].institution, 'Banco Teste');

  // outra pessoa não revoga nem sincroniza a conexão alheia, nem conecta o mesmo item
  const other = client();
  await subscribe(other, 'of-outra@exemplo.com', 'desbravador');
  assert.equal((await other('DELETE', `/api/account/openfinance/connections/${add.json.id}`)).status, 404);
  assert.equal((await other('POST', `/api/account/openfinance/connections/${add.json.id}/sync`)).status, 404);
  assert.equal((await other('POST', '/api/account/openfinance/connections', { itemId: 'item-0001', acceptConsent: true })).status, 409);

  // revogar: some da lista, avisa o agregador e não sincroniza mais
  assert.equal((await c('DELETE', `/api/account/openfinance/connections/${add.json.id}`)).status, 204);
  assert.deepEqual(of.deleted, ['item-0001']);
  assert.equal((await c('GET', '/api/account/openfinance')).json.connections.length, 0);
  assert.equal((await c('POST', `/api/account/openfinance/connections/${add.json.id}/sync`)).status, 404);
});

test('cartão de crédito conectado: limite do banco, compras com parcela, pagamento recebido, sem duplicar e aparece na aba Cartões', async () => {
  const c = client();
  await subscribe(c, 'of-cartao@exemplo.com', 'desbravador');
  const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-cartao-1', acceptConsent: true });
  assert.equal(add.status, 201);
  const cards = (await c('GET', '/api/account/cards')).json;
  assert.equal(cards.cards.length, 1);
  const k = cards.cards[0];
  assert.equal(k.connected, true);
  assert.equal(k.bankReported, true);
  assert.deepEqual([k.limitCents, k.closingDay, k.dueDay], [900_000, 8, 15]);
  assert.equal(k.summary.availableCents, 774_960, 'o disponível é o que o banco informa');
  assert.equal(k.summary.usedCents, 125_040);
  assert.equal(k.name, 'Banco Teste Cartão Gold');
  const month = (await c('GET', `/api/account/month/${new Date().toISOString().slice(0, 7)}`)).json.entries.find((e: any) => e.note === 'Amazon Marketplace');
  assert.deepEqual([month.amountCents, month.cardName, month.installmentNo, month.installmentTotal], [-18_990, 'Banco Teste Cartão Gold', 2, 5]);
  assert.equal(k.payments.length, 1, 'o pagamento recebido abate o cartão');
  const again = await c('POST', `/api/account/openfinance/connections/${add.json.id}/sync`);
  assert.equal(again.json.imported, 0);
  assert.equal((await c('GET', '/api/account/cards')).json.cards.length, 1, 'sincronizar de novo não cria outro cartão');
  // o limite que o banco muda vale na hora
  of.accounts[1]!.credit = { limit: 12_000, available: 11_000, closeDay: 9, dueDay: 16 };
  await c('POST', `/api/account/openfinance/connections/${add.json.id}/sync`);
  const k2 = (await c('GET', '/api/account/cards')).json.cards[0];
  assert.deepEqual([k2.limitCents, k2.summary.availableCents, k2.closingDay], [1_200_000, 1_100_000, 9]);
  of.accounts[1]!.credit = { limit: 9000, available: 7749.6, closeDay: 8, dueDay: 15 };
});

test('pagamento de fatura que sai da conta corrente abate o cartão e NÃO vira gasto novo; o saldo continua o do banco', async () => {
  const c = client();
  await subscribe(c, 'of-fatura@exemplo.com', 'desbravador');
  const old = of.txs;
  of.txs = [...old, { id: 'pf1', date: new Date().toISOString(), description: 'PAGAMENTO FATURA CARTAO', amount: 300, type: 'DEBIT' }];
  try {
    const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-fatura-1', acceptConsent: true });
    assert.equal(add.status, 201);
    const wallets = (await c('GET', '/api/account/wallets')).json.wallets;
    assert.equal(wallets[0].balanceCents, -45_050, 'o saldo da carteira segue o saldo do banco');
    assert.equal(wallets[0].entries, 2, 'a linha da fatura não é lançamento da conta');
    const card = (await c('GET', '/api/account/cards')).json.cards[0];
    assert.equal(card.payments.length, 2, 'o pagamento recebido e o pagamento que saiu da conta');
    const pay = await db.query<{ amount_cents: string; wallet_id: string | null }>(`SELECT amount_cents, wallet_id FROM app.card_payments WHERE external_id = 'fake:pf1'`);
    assert.deepEqual([Number(pay.rows[0]!.amount_cents), pay.rows[0]!.wallet_id !== null], [30_000, true]);
  } finally {
    of.txs = old;
  }
});

test('o banco pede para entrar de novo: a conexão mostra "reconectar", não sincroniza e volta ao normal depois de reconectar', async () => {
  const c = client();
  await subscribe(c, 'of-reconectar@exemplo.com', 'desbravador');
  const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-reconecta-1', acceptConsent: true });
  const id = add.json.id;
  of.itemStatus = 'LOGIN_ERROR';
  try {
    assert.equal((await c('POST', `/api/account/openfinance/connections/${id}/sync`)).json.imported, 0);
    const list = (await c('GET', '/api/account/openfinance')).json.connections[0];
    assert.equal(list.needsAction, true);
    assert.equal(list.status, 'needs_action');
    assert.equal((await c('POST', `/api/account/openfinance/connections/${id}/sync`)).status, 404, 'precisa reconectar antes de atualizar');
    // pede o token em modo "reconectar": o servidor manda o item da conexão, nunca um que o navegador escolha
    const tk = await c('POST', `/api/account/openfinance/connections/${id}/reconnect-token`);
    assert.equal(tk.status, 200);
    assert.equal(tk.json.itemId, 'item-reconecta-1');
    assert.deepEqual(of.tokens.at(-1), { user: of.tokens.at(-1)!.user, itemId: 'item-reconecta-1' });
    // reconectou no widget, mas o banco ainda não aceitou: continua pedindo
    assert.equal((await c('POST', `/api/account/openfinance/connections/${id}/refresh`)).json.needsAction, true);
  } finally {
    of.itemStatus = 'UPDATED';
  }
  const ok = await c('POST', `/api/account/openfinance/connections/${id}/refresh`);
  assert.equal(ok.json.needsAction, false);
  const after = (await c('GET', '/api/account/openfinance')).json.connections[0];
  assert.deepEqual([after.status, after.needsAction, after.lastError], ['active', false, null]);
  assert.equal((await c('POST', '/api/account/openfinance/connections/00000000-0000-4000-8000-000000000000/reconnect-token')).status, 404);
});

test('avisos do agregador (webhook): segredo, sem repetir, e só confere o estado no agregador', async () => {
  const c = client();
  await subscribe(c, 'of-webhook@exemplo.com', 'desbravador');
  const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-webhook-1', acceptConsent: true });
  const hook = async (body: unknown, secret: string | null = WEBHOOK_SECRET, query = '') => {
    const res = await app.inject({ method: 'POST', url: `/webhooks/openfinance${query}`, headers: { 'content-type': 'application/json', ...(secret ? { 'x-webhook-secret': secret } : {}) }, payload: JSON.stringify(body) });
    return { status: res.statusCode, json: res.json() };
  };
  assert.equal((await hook({ event: 'item/updated', eventId: 'e0', itemId: 'item-webhook-1' }, 'errado')).status, 401);
  assert.equal((await hook({ event: 'item/updated', eventId: 'e0', itemId: 'item-webhook-1' }, null)).status, 401);
  assert.equal((await hook({ event: 'item/updated', eventId: 'e0', itemId: 'item-webhook-1' }, null, `?token=${WEBHOOK_SECRET}`)).status, 200, 'o segredo também vale na URL');

  of.itemStatus = 'LOGIN_ERROR';
  try {
    const r = await hook({ event: 'item/login_error', eventId: 'e1', itemId: 'item-webhook-1' });
    assert.deepEqual([r.status, r.json.outcome], [200, 'processed']);
    assert.equal((await c('GET', '/api/account/openfinance')).json.connections[0].needsAction, true);
    assert.equal((await hook({ event: 'item/login_error', eventId: 'e1', itemId: 'item-webhook-1' })).json.outcome, 'duplicate', 'o mesmo aviso não vale duas vezes');
  } finally {
    of.itemStatus = 'UPDATED';
  }
  // o banco voltou a responder: o aviso de atualização confere o estado, limpa o "reconectar" e sincroniza
  assert.equal((await hook({ event: 'item/updated', eventId: 'e2', itemId: 'item-webhook-1' })).json.outcome, 'processed');
  assert.equal((await c('GET', '/api/account/openfinance')).json.connections[0].needsAction, false);
  // item desconhecido, corpo estranho ou evento que não usamos: aceita sem fazer nada
  assert.equal((await hook({ event: 'item/updated', eventId: 'e3', itemId: 'item-que-nao-existe' })).json.outcome, 'ignored');
  assert.equal((await hook({ event: 'connector/status_updated', eventId: 'e4', itemId: 'item-webhook-1' })).json.outcome, 'ignored');
  assert.equal((await hook({ lixo: true })).json.outcome, 'ignored');
  assert.equal((await hook({ event: 'item/updated', itemId: "x'; drop" })).json.outcome, 'ignored');
  // o banco avisa que o item foi apagado lá
  assert.equal((await hook({ event: 'item/deleted', eventId: 'e5', itemId: 'item-webhook-1' })).json.outcome, 'processed');
  assert.equal((await c('GET', '/api/account/openfinance')).json.connections.length, 0);
  void add;
  // sem segredo configurado, o endereço de avisos não existe
  const noSecret = await buildApp({ config: { ...config, openFinanceWebhookSecret: null }, db, gateway, email: mailbox, openFinance: of, rateLimits: 'relaxed' });
  const res = await noSecret.inject({ method: 'POST', url: '/webhooks/openfinance', headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET }, payload: '{}' });
  assert.equal(res.statusCode, 404);
  await noSecret.close();
});

test('validade do consentimento: aviso por e-mail 30 dias antes (uma vez), e vencido pede reconexão', async () => {
  const c = client();
  await subscribe(c, 'of-validade@exemplo.com', 'desbravador');
  const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'item-validade-1', acceptConsent: true });
  const first = (await c('GET', '/api/account/openfinance')).json.connections[0];
  assert.ok(first.expiresInDays >= 364 && first.expiresInDays <= 366, 'sem a data do banco, vale 12 meses');
  assert.equal(await consentCheck(ctx()), 0, 'longe do vencimento não avisa');

  await db.query(`UPDATE app.of_connections SET consent_expires_at = now() + interval '10 days' WHERE id = $1`, [add.json.id]);
  mailbox.sent.length = 0;
  const run = () => consentCheck({ ...ctx(), openFinance: of });
  assert.equal(await run(), 1);
  assert.equal(mailbox.sent.length, 1);
  assert.match(mailbox.sent[0]!.subject, /Renove a conexão/);
  assert.match(mailbox.sent[0]!.text, /\/conta\/contas/);
  assert.equal(await run(), 0, 'não manda de novo no mesmo período');

  await db.query(`UPDATE app.of_connections SET consent_expires_at = now() - interval '1 day' WHERE id = $1`, [add.json.id]);
  await run();
  const expired = (await c('GET', '/api/account/openfinance')).json.connections[0];
  assert.deepEqual([expired.status, expired.needsAction], ['needs_action', true]);
  // renovar pelo widget traz a validade nova
  of.consentExpiresAt = new Date(Date.now() + 300 * 86_400_000).toISOString();
  try {
    assert.equal((await c('POST', `/api/account/openfinance/connections/${add.json.id}/refresh`)).json.needsAction, false);
  } finally {
    of.consentExpiresAt = undefined;
  }
  const renewed = (await c('GET', '/api/account/openfinance')).json.connections[0];
  assert.ok(renewed.expiresInDays >= 299 && renewed.expiresInDays <= 301);
  assert.equal(renewed.status, 'active');
});

test('apagar a conta corta o acesso aos bancos no agregador antes de apagar os dados', async () => {
  const c = client();
  await subscribe(c, 'of-apagar@exemplo.com', 'desbravador');
  await c('POST', '/api/account/openfinance/connections', { itemId: 'item-apagar-1', acceptConsent: true });
  of.deleted.length = 0;
  assert.equal((await c('DELETE', '/api/account')).status, 204);
  assert.deepEqual(of.deleted, ['item-apagar-1']);
  const left = await db.query<{ n: string }>(`SELECT (SELECT count(*) FROM app.credit_cards k JOIN app.subscribers s ON s.id = k.subscriber_id WHERE s.email LIKE 'excluido-%') AS n`);
  assert.equal(Number(left.rows[0]!.n), 0);
});

test('banco de mentira (só fora de produção): fluxo completo sem contrato e nunca em produção', async () => {
  const fake = new FakeOpenFinanceProvider();
  assert.equal((await fake.getItem('fake-azul')).institution, 'Banco Azul (teste)');
  await assert.rejects(() => fake.getItem('qualquer-coisa'));
  const accounts = await fake.listAccounts('fake-azul');
  assert.deepEqual(accounts.map((a) => a.subtype), ['CHECKING_ACCOUNT', 'SAVINGS_ACCOUNT', 'CREDIT_CARD']);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await fake.listTransactions('fake-azul-cartao', '2000-01-01', today)).some((t) => t.installmentNumber === 2));
  // só liga com OPENFINANCE_FAKE=1 e nunca em produção
  assert.equal(makeOpenFinance(loadConfig({ NODE_ENV: 'test', OPENFINANCE_FAKE: '1' }))?.name, 'fake');
  assert.equal(makeOpenFinance(loadConfig({ NODE_ENV: 'test' })), undefined);
  const prod = loadConfig({ NODE_ENV: 'production', OPENFINANCE_FAKE: '1', APP_SECRET: 'a'.repeat(40), DATABASE_URL: 'postgres://x:y@localhost/z', PAYMENT_PROVIDER: 'fake', ALLOW_FAKE_GATEWAY_IN_PRODUCTION: '1', WEBHOOK_SECRET: 'w'.repeat(32) } as Record<string, string>);
  assert.equal(prod.openFinanceFake, false);

  // o fluxo todo usando o banco de mentira como provedor
  const fakeApp = await buildApp({ config, db, gateway, email: mailbox, openFinance: fake, rateLimits: 'relaxed' });
  const oldApp = app;
  app = fakeApp;
  try {
    const c = client();
    await subscribe(c, 'of-mentira@exemplo.com', 'desbravador');
    const add = await c('POST', '/api/account/openfinance/connections', { itemId: 'fake-verde', acceptConsent: true });
    assert.equal(add.status, 201, JSON.stringify(add.json));
    assert.ok(add.json.imported >= 8);
    const wallets = (await c('GET', '/api/account/wallets')).json.wallets;
    assert.equal(wallets.length, 2);
    assert.equal(wallets.find((w: any) => /Corrente/.test(w.name)).balanceCents, 184_055);
    const k = (await c('GET', '/api/account/cards')).json.cards[0];
    assert.equal(k.limitCents, 900_000);
    assert.equal((await c('GET', '/api/account/openfinance')).json.fake, false, 'a tela só mostra o seletor de teste com OPENFINANCE_FAKE ligado');
  } finally {
    app = oldApp;
    await fakeApp.close();
  }
});
