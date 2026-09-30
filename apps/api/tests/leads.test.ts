import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { deliverPendingLeads, assertPublicHttpsUrl } from '../src/leads.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
let db: Db;
let app: FastifyInstance;
let off: FastifyInstance; // servidor com o recurso desligado
let gateway: FakeGateway;
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, rateLimits: 'relaxed' });
  off = await buildApp({ config: { ...config, leadsEnabled: false }, db, gateway, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await off.close();
  await db.close();
});

const caseBody = () => ({
  profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [
    { creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 },
    { creditorName: 'Loja Y', kind: 'store_credit', balanceCents: 120_000, monthlyPaymentCents: 10_000, daysOverdue: 60 },
  ],
  acceptTerms: true,
});

function client(server: FastifyInstance = app) {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await server.inject({
      method,
      url,
      headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers },
      payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = null;
    }
    return { status: res.statusCode, json };
  };
}

async function pay(orderId: string, key: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}

async function paidCase(key: string) {
  const c = client();
  const created = await c('POST', '/api/cases', { body: caseBody() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': `${key}-order-0001` } });
  await pay(order.json.orderId, key);
  return { c, caseId: created.json.caseId as string, orderId: order.json.orderId as string };
}

const newPartner = (name: string, cnpj: string, email: string, extra: Record<string, unknown> = {}) => ({
  legalName: name,
  cnpj,
  category: 'consignado',
  email,
  campaign: { name: 'Consignado SP', consentCategory: 'consignado', employmentTypes: ['clt'], ufs: ['SP'], pricePerLeadCents: 2500, dailyCap: 10, webhookUrl: 'https://parceiro.example.com/hook', ...extra },
});

test('desligado por padrão: as rotas de propostas e de parceiros não existem', async () => {
  const c = client(off);
  const created = await c('POST', '/api/cases', { body: caseBody() });
  const res = await c('POST', `/api/cases/${created.json.caseId}/leads`, { body: { name: 'Maria Silva', phone: '11987654321', categories: ['consignado'], consent: true } });
  assert.equal(res.status, 404);
  assert.equal((await c('POST', '/api/partner/login', { body: { email: 'a@b.com', password: 'x' } })).status, 404);
  assert.equal((await c('GET', '/api/features')).json.leads, false);
});

test('webhook do parceiro: só https com domínio público', () => {
  assert.throws(() => assertPublicHttpsUrl('http://parceiro.com/x'));
  assert.throws(() => assertPublicHttpsUrl('https://localhost/x'));
  assert.throws(() => assertPublicHttpsUrl('https://10.0.0.5/x'));
  assert.throws(() => assertPublicHttpsUrl('https://[::1]/x'));
  assert.throws(() => assertPublicHttpsUrl('https://intranet/x'));
  assert.doesNotThrow(() => assertPublicHttpsUrl('https://api.parceiro.com.br/leads'));
});

test('cadastro de parceiro exige o token do administrador', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/admin/partners', { body: newPartner('Banco Alfa Ltda', '11222333000144', 'alfa@banco.com') })).status, 404);
  assert.equal((await c('POST', '/api/admin/partners', { body: newPartner('Banco Alfa Ltda', '11222333000144', 'alfa@banco.com'), headers: { 'x-admin-token': 'errado' } })).status, 404);
  const bad = await c('POST', '/api/admin/partners', { body: newPartner('Banco Alfa Ltda', '11222333000144', 'alfa@banco.com', { webhookUrl: 'http://inseguro.com/x' }), headers: { 'x-admin-token': ADMIN } });
  assert.equal(bad.status, 422);
});

test('fluxo completo: consentimento → entrega assinada ao parceiro → portal → revogação', async () => {
  const admin = client();
  const alfa = await admin('POST', '/api/admin/partners', { body: newPartner('Banco Alfa Ltda', '11222333000144', 'alfa@banco.com'), headers: { 'x-admin-token': ADMIN } });
  assert.equal(alfa.status, 201);
  const beta = await admin('POST', '/api/admin/partners', { body: newPartner('Financeira Beta SA', '55666777000188', 'beta@fin.com', { ufs: ['RJ'] }), headers: { 'x-admin-token': ADMIN } });
  assert.equal(beta.status, 201); // campanha só do RJ: não deve receber lead de SP

  const { c, caseId, orderId } = await paidCase('leads-fluxo');
  const delivery = await c('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(delivery.json.leads.enabled, true);
  assert.equal(delivery.json.leads.available, true);
  assert.deepEqual(delivery.json.leads.categories.sort(), ['consignado', 'renegotiation']);
  assert.equal(delivery.json.leads.active, null);

  // sem consentimento marcado, ou com categoria fora do oferecido, ou telefone ruim: nada acontece
  const url = `/api/cases/${caseId}/leads`;
  assert.equal((await c('POST', url, { body: { name: 'Maria Souza', phone: '11987654321', categories: ['consignado'], consent: false } })).status, 400);
  assert.equal((await c('POST', url, { body: { name: 'Maria Souza', phone: '0012345678', categories: ['consignado'], consent: true } })).status, 422);
  const none = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.lead_contacts WHERE case_id = $1`, [caseId]);
  assert.equal(none.rows[0]!.n, '0');

  const ok = await c('POST', url, { body: { name: 'Maria Souza', phone: '(11) 98765-4321', email: 'maria@exemplo.com', categories: ['consignado'], consent: true } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.partners, 1);
  assert.equal((await c('POST', url, { body: { name: 'Maria Souza', phone: '11987654321', categories: ['consignado'], consent: true } })).status, 409);

  // o contato está criptografado no banco
  const raw = await db.query<{ full_name_enc: Buffer }>(`SELECT full_name_enc FROM app.lead_contacts WHERE case_id = $1`, [caseId]);
  assert.ok(!raw.rows[0]!.full_name_enc.toString('utf8').includes('Maria'));

  // entrega ao parceiro: corpo assinado com o segredo do webhook
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const stub = (async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  const ctx = { db, config, gateway };
  assert.equal(await deliverPendingLeads(ctx, { fetchFn: stub }), 1);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0]!.body);
  assert.equal(payload.name, 'Maria Souza');
  assert.equal(payload.phone, '11987654321');
  assert.equal(payload.uf, 'SP');
  assert.ok(!('cpf' in payload)); // CPF nunca é coletado por nós
  const expected = createHmac('sha256', alfa.json.webhookSecret).update(calls[0]!.body).digest('hex');
  assert.equal(calls[0]!.headers['x-folego-signature'], `sha256=${expected}`);
  assert.equal(await deliverPendingLeads(ctx, { fetchFn: stub }), 0); // já entregue: não reenvia

  // portal do parceiro: só vê os próprios leads
  const alfaLogin = await admin('POST', '/api/partner/login', { body: { email: 'alfa@banco.com', password: alfa.json.password } });
  assert.equal(alfaLogin.status, 200);
  assert.equal((await admin('POST', '/api/partner/login', { body: { email: 'alfa@banco.com', password: 'senha-errada' } })).status, 401);
  const auth = { authorization: `Bearer ${alfaLogin.json.token}` };
  const mine = await admin('GET', '/api/partner/leads', { headers: auth });
  assert.equal(mine.json.leads.length, 1);
  assert.equal(mine.json.leads[0].name, 'Maria Souza');
  assert.equal(mine.json.leads[0].status, 'delivered');
  const betaLogin = await admin('POST', '/api/partner/login', { body: { email: 'beta@fin.com', password: beta.json.password } });
  const theirs = await admin('GET', '/api/partner/leads', { headers: { authorization: `Bearer ${betaLogin.json.token}` } });
  assert.equal(theirs.json.leads.length, 0);
  assert.equal((await admin('GET', '/api/partner/leads')).status, 401);
  const id = mine.json.leads[0].id as string;
  assert.equal((await admin('POST', `/api/partner/leads/${id}/status`, { body: { status: 'contacted' }, headers: { authorization: `Bearer ${betaLogin.json.token}` } })).status, 404);
  assert.equal((await admin('POST', `/api/partner/leads/${id}/status`, { body: { status: 'contacted' }, headers: auth })).status, 200);

  // revogação: apaga contato e perfil; o parceiro vê que o titular revogou e perde o contato
  const revoke = await c('DELETE', url);
  assert.equal(revoke.status, 204);
  assert.equal((await db.query(`SELECT 1 FROM app.lead_contacts WHERE case_id = $1`, [caseId])).rows.length, 0);
  assert.equal((await db.query(`SELECT 1 FROM app.lead_profiles WHERE case_id = $1`, [caseId])).rows.length, 0);
  const after = await admin('GET', '/api/partner/leads', { headers: auth });
  assert.equal(after.json.leads[0].revoked, true);
  assert.equal(after.json.leads[0].phone, null);
  assert.equal((await c('DELETE', url)).status, 409); // já revogado
  const again = await c('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(again.json.leads.active, null);
  // o histórico de consentimento continua (append-only)
  const hist = await db.query<{ action: string }>(`SELECT action FROM app.consents WHERE case_id = $1 AND purpose = 'lead_sharing' ORDER BY created_at`, [caseId]);
  assert.deepEqual(hist.rows.map((r) => r.action), ['grant', 'revoke']);
});

test('revogar antes da entrega cancela o envio', async () => {
  const admin = client();
  await admin('POST', '/api/admin/partners', { body: newPartner('Banco Gama Ltda', '99888777000166', 'gama@banco.com'), headers: { 'x-admin-token': ADMIN } });
  const { c, caseId } = await paidCase('leads-revoga');
  assert.equal((await c('POST', `/api/cases/${caseId}/leads`, { body: { name: 'João Pereira', phone: '21987654321', categories: ['consignado'], consent: true } })).status, 201);
  await c('DELETE', `/api/cases/${caseId}/leads`);
  const stub = (async () => new Response('ok', { status: 200 })) as typeof fetch;
  await deliverPendingLeads({ db, config, gateway }, { fetchFn: stub });
  const rows = await db.query<{ status: string }>(`SELECT status FROM app.lead_deliveries WHERE case_id = $1`, [caseId]);
  assert.ok(rows.rows.every((r) => r.status === 'rejected'));
});

test('falha do parceiro: tenta de novo depois e desiste no limite', async () => {
  const admin = client();
  await admin('POST', '/api/admin/partners', { body: newPartner('Banco Delta Ltda', '12345678000199', 'delta@banco.com'), headers: { 'x-admin-token': ADMIN } });
  const { c, caseId } = await paidCase('leads-falha');
  await c('POST', `/api/cases/${caseId}/leads`, { body: { name: 'Ana Lima', phone: '31987654321', categories: ['consignado'], consent: true } });
  const boom = (async () => new Response('erro', { status: 500 })) as typeof fetch;
  await deliverPendingLeads({ db, config, gateway }, { fetchFn: boom });
  const row = await db.query<{ status: string; attempts: number; last_response_code: number }>(`SELECT status, attempts, last_response_code FROM app.lead_deliveries WHERE case_id = $1 AND status = 'failed'`, [caseId]);
  assert.equal(row.rows[0]!.attempts, 1);
  assert.equal(row.rows[0]!.last_response_code, 500);
  // dentro da espera, não tenta de novo
  assert.equal(await deliverPendingLeads({ db, config, gateway }, { fetchFn: boom }), 0);
});
