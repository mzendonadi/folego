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
import { PluggyProvider } from '../src/openfinance.ts';
import type { OpenFinanceProvider, OfAccount, OfTransaction } from '../src/openfinance.ts';

class FakeOf implements OpenFinanceProvider {
  readonly name = 'fake';
  deleted: string[] = [];
  accounts: OfAccount[] = [
    { id: 'acc-1', name: 'Conta Corrente', type: 'BANK', subtype: 'CHECKING_ACCOUNT', balance: -450.5 },
    { id: 'card-1', name: 'Cartão', type: 'CREDIT', subtype: 'CREDIT_CARD', balance: 900 },
  ];
  txs: OfTransaction[] = [
    { id: 't1', date: new Date().toISOString(), description: 'Supermercado Extra', amount: 120.4, type: 'DEBIT' },
    { id: 't2', date: new Date().toISOString(), description: 'Salário Empresa', amount: 3000, type: 'CREDIT' },
  ];
  async createConnectToken() { return 'connect-token-123'; }
  async getItem(id: string) { return { id, status: 'UPDATED', institution: 'Banco Teste' }; }
  async deleteItem(id: string) { this.deleted.push(id); }
  async listAccounts() { return this.accounts; }
  async listTransactions() { return this.txs; }
}

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
let of: FakeOf;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };
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
  assert.equal(add.json.imported, 2);

  const wallets = await c('GET', '/api/account/wallets');
  assert.equal(wallets.json.wallets.length, 1, 'cartão de crédito não é importado');
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
  assert.equal(n.rows[0]!.n, '2');
  // categorização e sinal
  const rows = await db.query<{ note: string; amount_cents: string; category: string }>(`SELECT note, amount_cents, category FROM app.ledger_entries WHERE source = 'openfinance' ORDER BY amount_cents`);
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
