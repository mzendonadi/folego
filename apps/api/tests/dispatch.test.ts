// Parcerias no backoffice: envio manual de contatos autorizados, sem repetir, e gestão do que já foi enviado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { deliverPendingLeads } from '../src/leads.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN, adminEmails: ['dono@exemplo.com'] };

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
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
const PW = 'Senha-Forte-2026';
let owner: ReturnType<typeof client> | null = null;
async function ownerClient() {
  if (owner) return owner;
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/gestao/setup-code', { email: 'dono@exemplo.com' });
  await c('POST', '/api/gestao/setup', { email: 'dono@exemplo.com', code: lastCode(), password: PW });
  assert.equal((await c('POST', '/api/gestao/login-password', { email: 'dono@exemplo.com', password: PW })).status, 200);
  owner = c;
  return c;
}

const caseBody = () => ({
  profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }, { creditorName: 'Loja Y', kind: 'store_credit', balanceCents: 120_000, monthlyPaymentCents: 10_000, daysOverdue: 60 }],
  acceptTerms: true,
});

async function leadCase(key: string, categories: string[]) {
  const c = client();
  const created = await c('POST', '/api/cases', caseBody());
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'] }, { 'idempotency-key': `${key}-order-0001` });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  const lead = await c('POST', `/api/cases/${created.json.caseId}/leads`, { name: 'Maria Silva', phone: '11987654321', categories, consent: true });
  assert.equal(lead.status, 201, JSON.stringify(lead.json));
  return created.json.caseId as string;
}

const partnerBody = (cnpj: string, email: string, name: string) => ({
  legalName: name, cnpj, category: 'consignado', email,
  campaign: { name: 'Consignado SP', consentCategory: 'consignado', employmentTypes: [], ufs: [], pricePerLeadCents: 2500, dailyCap: 10, webhookUrl: 'https://parceiro.example.com/hook' },
});

test('envio manual: só ao parceiro e campanha escolhidos, sem repetir, com situação por contato', async () => {
  // contatos autorizados ANTES de existir parceiro: ficam no pool, sem entrega automática
  const a = await leadCase('disp-a', ['consignado']);
  const b = await leadCase('disp-b', ['consignado']);
  const c3 = await leadCase('disp-c', ['renegotiation']); // outra categoria
  const o = await ownerClient();

  const none = await o('GET', '/api/gestao/parcerias/destinos');
  assert.equal(none.json.partners.length, 0);

  const created = await client()('POST', '/api/admin/partners', partnerBody('11222333000144', 'alfa@banco.com', 'Banco Alfa Ltda'), { 'x-admin-token': ADMIN });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const targets = (await o('GET', '/api/gestao/parcerias/destinos')).json.partners;
  assert.equal(targets.length, 1);
  const partnerId = targets[0].partnerId;
  const campaignId = targets[0].campaigns[0].id;

  // a lista mostra os três como não enviados
  const pool = await o('GET', '/api/gestao/parcerias/contatos?filtro=nao_enviados');
  assert.equal(pool.json.total, 3);
  assert.ok(pool.json.items.every((x: any) => x.sent.length === 0));
  assert.ok(!JSON.stringify(pool.json).includes('Maria Silva') && !JSON.stringify(pool.json).includes('11987654321'), 'sem dado de contato no backoffice');

  // envia os 3: o de renegociação não tem consentimento da categoria da campanha
  const sent = await o('POST', '/api/gestao/parcerias/enviar', { partnerId, campaignId, caseIds: [a, b, c3] });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.queued, 2);
  assert.equal(sent.json.skipped.noConsent, 1);

  // repetir: ninguém vai duas vezes ao mesmo parceiro
  const again = await o('POST', '/api/gestao/parcerias/enviar', { partnerId, campaignId, caseIds: [a, b] });
  assert.equal(again.json.queued, 0);
  assert.equal(again.json.skipped.alreadySent, 2);

  // filtros: enviados x não enviados
  assert.equal((await o('GET', '/api/gestao/parcerias/contatos?filtro=enviados')).json.total, 2);
  const left = await o('GET', '/api/gestao/parcerias/contatos?filtro=nao_enviados');
  assert.equal(left.json.total, 1);
  assert.equal(left.json.items[0].caseId, c3);
  assert.equal((await o('GET', `/api/gestao/parcerias/contatos?filtro=nao_enviados&parceiro=${partnerId}`)).json.total, 1);
  const sentRow = (await o('GET', '/api/gestao/parcerias/contatos?filtro=enviados')).json.items[0];
  assert.equal(sentRow.sent[0].partner, 'Banco Alfa Ltda');
  assert.equal(sentRow.sent[0].status, 'queued');

  // o worker entrega (webhook simulado) e a situação muda
  let hits = 0;
  await deliverPendingLeads({ db, config, gateway, email: mailbox }, { fetchFn: (async () => { hits += 1; return new Response('ok', { status: 200 }); }) as unknown as typeof fetch });
  assert.equal(hits, 2);
  const overview = await o('GET', '/api/gestao/parcerias/envios');
  assert.equal(overview.json.items.length, 2);
  assert.ok(overview.json.items.every((x: any) => x.status === 'delivered' && x.partner === 'Banco Alfa Ltda'));
  assert.deepEqual(overview.json.summary.map((s: any) => [s.status, s.count]), [['delivered', 2]]);
  assert.ok(!JSON.stringify(overview.json).includes('11987654321'));

  // entregue não se cancela nem se reenvia
  const id = overview.json.items[0].id;
  assert.equal((await o('POST', `/api/gestao/parcerias/envios/${id}/acao`, { action: 'cancel' })).status, 409);
  assert.equal((await o('POST', `/api/gestao/parcerias/envios/${id}/acao`, { action: 'retry' })).status, 409);
});

test('envio manual: falha volta para a fila, fila cancelada libera o contato, e há limites e permissão', async () => {
  const x = await leadCase('disp-x', ['consignado']);
  const o = await ownerClient();
  const created = await client()('POST', '/api/admin/partners', partnerBody('55666777000188', 'beta@banco.com', 'Banco Beta Ltda'), { 'x-admin-token': ADMIN });
  assert.equal(created.status, 201);
  const t = (await o('GET', '/api/gestao/parcerias/destinos')).json.partners.find((p: any) => p.name === 'Banco Beta Ltda');
  const q = await o('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: t.campaigns[0].id, caseIds: [x] });
  assert.equal(q.json.queued, 1);
  // webhook falha
  await deliverPendingLeads({ db, config, gateway, email: mailbox }, { fetchFn: (async () => new Response('erro', { status: 500 })) as unknown as typeof fetch });
  const failed = (await o('GET', `/api/gestao/parcerias/envios?parceiro=${t.partnerId}&situacao=failed`)).json.items[0];
  assert.equal(failed.status, 'failed');
  assert.equal((await o('POST', `/api/gestao/parcerias/envios/${failed.id}/acao`, { action: 'retry' })).status, 200);
  assert.equal((await o('GET', `/api/gestao/parcerias/envios?parceiro=${t.partnerId}`)).json.items[0].status, 'queued');
  // cancelar libera o contato para ser enviado de novo
  assert.equal((await o('POST', `/api/gestao/parcerias/envios/${failed.id}/acao`, { action: 'cancel' })).status, 200);
  assert.equal((await o('GET', `/api/gestao/parcerias/envios?parceiro=${t.partnerId}`)).json.items.length, 0);
  const re = await o('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: t.campaigns[0].id, caseIds: [x] });
  assert.equal(re.json.queued, 1);

  // validações
  assert.equal((await o('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: t.campaigns[0].id, caseIds: [] })).status, 400);
  assert.equal((await o('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: '00000000-0000-4000-8000-000000000000', caseIds: [x] })).status, 404);
  assert.equal((await client()('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: t.campaigns[0].id, caseIds: [x] })).status, 401);

  // o papel Suporte não tem a seção Parcerias
  await o('POST', '/api/gestao/usuarios', { email: 'suporte-disp@exemplo.com', name: 'S', role: 'suporte' });
  const s = client();
  mailbox.sent.length = 0;
  await s('POST', '/api/gestao/setup-code', { email: 'suporte-disp@exemplo.com' });
  await s('POST', '/api/gestao/setup', { email: 'suporte-disp@exemplo.com', code: lastCode(), password: 'Suporte-Forte-2026' });
  await s('POST', '/api/gestao/login-password', { email: 'suporte-disp@exemplo.com', password: 'Suporte-Forte-2026' });
  assert.equal((await s('POST', '/api/gestao/parcerias/enviar', { partnerId: t.partnerId, campaignId: t.campaigns[0].id, caseIds: [x] })).status, 403);
  assert.equal((await s('GET', '/api/gestao/parcerias/contatos')).status, 403);
});
