// Gestão de parceiros e campanhas no backoffice: cadastrar, editar, suspender, excluir, segredos que aparecem uma vez.
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
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, adminEmails: ['dono@exemplo.com'] };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

let cookie = '';
async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers['set-cookie'];
  const raw = Array.isArray(set) ? set[0] : set;
  if (raw) cookie = raw.split(';')[0]!;
  let json: any = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, json };
}
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;

const body = (cnpj: string, email: string) => ({
  legalName: 'Banco Gama Ltda', cnpj, category: 'consignado', email,
  campaign: { name: 'Consignado SP', consentCategory: 'consignado', employmentTypes: ['clt'], ufs: ['SP'], pricePerLeadCents: 2500, dailyCap: 10, webhookUrl: 'https://parceiro.example.com/hook' },
});

test('parceiros: ciclo completo de cadastro, edição, campanha, suspensão e exclusão', async () => {
  await call('POST', '/api/gestao/setup-code', { email: 'dono@exemplo.com' });
  await call('POST', '/api/gestao/setup', { email: 'dono@exemplo.com', code: lastCode(), password: 'Senha-Forte-2026' });
  assert.equal((await call('POST', '/api/gestao/login-password', { email: 'dono@exemplo.com', password: 'Senha-Forte-2026' })).status, 200);

  assert.equal((await call('GET', '/api/gestao/parcerias/parceiros')).json.partners.length, 0);

  const bad = await call('POST', '/api/gestao/parcerias/parceiros', body('123', 'x@gama.com'));
  assert.equal(bad.status, 400);
  const insecure = await call('POST', '/api/gestao/parcerias/parceiros', { ...body('11222333000144', 'gama@banco.com'), campaign: { ...body('', '').campaign, webhookUrl: 'http://inseguro.com/x' } });
  assert.ok(insecure.status >= 400 && insecure.status < 500);

  const created = await call('POST', '/api/gestao/parcerias/parceiros', body('11222333000144', 'gama@banco.com'));
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.ok(created.json.password && created.json.webhookSecret);
  assert.equal((await call('POST', '/api/gestao/parcerias/parceiros', body('11222333000144', 'outro@banco.com'))).status, 409, 'CNPJ repetido');

  const list = (await call('GET', '/api/gestao/parcerias/parceiros')).json.partners;
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(created.json.webhookSecret) && !JSON.stringify(list).includes(created.json.password), 'segredos nunca voltam na listagem');
  const id = list[0].id as string;
  assert.equal(list[0].campaigns.length, 1);

  assert.equal((await call('PATCH', `/api/gestao/parcerias/parceiros/${id}`, { legalName: 'Banco Gama S.A.', category: 'bank' })).status, 200);
  const reset = await call('POST', `/api/gestao/parcerias/parceiros/${id}/senha`, {});
  assert.ok(reset.json.password && reset.json.password !== created.json.password);

  const camp = await call('POST', `/api/gestao/parcerias/parceiros/${id}/campanhas`, { ...body('', '').campaign, name: 'Renegociação' , consentCategory: 'renegotiation' });
  assert.equal(camp.status, 201, JSON.stringify(camp.json));
  assert.ok(camp.json.webhookSecret);
  const campId = camp.json.campaignId as string;
  const withBudget = await call('PATCH', `/api/gestao/parcerias/campanhas/${campId}`, { monthlyBudgetCents: 100000, minIncomeCents: 200000, status: 'paused' });
  assert.equal(withBudget.status, 200, JSON.stringify(withBudget.json));
  assert.equal((await call('PATCH', `/api/gestao/parcerias/campanhas/${campId}`, { monthlyBudgetCents: null, minIncomeCents: null })).status, 200);
  const after1 = (await call('GET', '/api/gestao/parcerias/parceiros')).json.partners[0].campaigns.find((c: any) => c.id === campId);
  assert.equal(after1.monthlyBudgetCents, null);
  assert.equal(after1.status, 'paused');
  assert.equal((await call('POST', `/api/gestao/parcerias/campanhas/${campId}/segredo`, {})).status, 200);

  // campanhas pausadas e parceiros suspensos saem dos destinos do envio
  assert.equal((await call('GET', '/api/gestao/parcerias/destinos')).json.partners[0].campaigns.length, 1);
  await call('PATCH', `/api/gestao/parcerias/parceiros/${id}`, { status: 'suspended' });
  assert.equal((await call('GET', '/api/gestao/parcerias/destinos')).json.partners.length, 0);
  await call('PATCH', `/api/gestao/parcerias/parceiros/${id}`, { status: 'active' });

  // sem entrega registrada, exclui (com histórico a regra é suspender; o envio é coberto em dispatch.test.ts)
  const first = (await call('GET', '/api/gestao/parcerias/parceiros')).json.partners[0].campaigns.find((c: any) => c.name === 'Consignado SP').id as string;
  assert.equal((await call('DELETE', `/api/gestao/parcerias/campanhas/${campId}`)).status, 200);
  assert.equal((await call('DELETE', `/api/gestao/parcerias/campanhas/${first}`)).status, 200);
  assert.equal((await call('DELETE', `/api/gestao/parcerias/parceiros/${id}`)).status, 200);
  assert.equal((await call('GET', '/api/gestao/parcerias/parceiros')).json.partners.length, 0);
});
