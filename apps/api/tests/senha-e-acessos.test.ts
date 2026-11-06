// "Esqueci minha senha" (portal do parceiro e backoffice) e vários acessos ao mesmo portal do parceiro. Dados inventados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import * as partners from '../src/admin/partners.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN, adminEmails: ['dono@exemplo.com'] };
const ctx = () => ({ db, config, gateway, email: mailbox });

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  await db.query(`DELETE FROM app.partner_campaigns`);
  await db.query(`DELETE FROM app.partner_users`);
  await db.query(`DELETE FROM app.partners`);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, json };
};
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
const login = (email: string, password: string) => call('POST', '/api/partner/login', { email, password });

async function novoParceiro(email: string, cnpj: string) {
  const r = await call('POST', '/api/admin/partners', { legalName: 'Parceiro Teste ME', cnpj, category: 'consignado', email, campaign: { name: 'Campanha teste', consentCategory: 'consignado', pricePerLeadCents: 0, dailyCap: 5 } }, { 'x-admin-token': ADMIN });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return { id: r.json.partnerId as string, password: r.json.password as string };
}

test('vários acessos no mesmo portal: adicionar, entrar, trocar a senha de um sem afetar o outro, remover e nunca o último', async () => {
  const p = await novoParceiro('principal@parceiro.test', '11222333000144');
  const added = await partners.addPortalUser(ctx(), 'teste', p.id, { email: 'colega@parceiro.test' });
  assert.equal(added.email, 'colega@parceiro.test');
  assert.equal((await login('colega@parceiro.test', added.password)).status, 200, 'o novo acesso entra no mesmo portal');
  assert.equal((await login('principal@parceiro.test', p.password)).status, 200, 'o principal continua entrando');

  const list = await partners.listPortalUsers(ctx(), p.id);
  assert.deepEqual(list.users.map((u) => [u.email, u.main]), [['principal@parceiro.test', true], ['colega@parceiro.test', false]]);

  await assert.rejects(() => partners.addPortalUser(ctx(), 'teste', p.id, { email: 'colega@parceiro.test' }), /Já existe um acesso/);

  const nova = await partners.resetPassword(ctx(), 'teste', p.id, added.id);
  assert.equal((await login('colega@parceiro.test', added.password)).status, 401, 'a senha antiga do colega deixou de valer');
  assert.equal((await login('colega@parceiro.test', nova.password)).status, 200);
  assert.equal((await login('principal@parceiro.test', p.password)).status, 200, 'a senha do principal não mudou');

  await partners.removePortalUser(ctx(), 'teste', p.id, added.id);
  assert.equal((await login('colega@parceiro.test', nova.password)).status, 401, 'acesso removido não entra');
  const only = (await partners.listPortalUsers(ctx(), p.id)).users[0]!;
  await assert.rejects(() => partners.removePortalUser(ctx(), 'teste', p.id, only.id), /único acesso/);
});

test('portal do parceiro: "esqueci minha senha" por código no e-mail, com resposta igual para e-mail desconhecido', async () => {
  const p = await novoParceiro('esqueci@parceiro.test', '11222333000225');
  mailbox.sent.length = 0;
  const ghost = await call('POST', '/api/partner/forgot', { email: 'ninguem@parceiro.test' });
  assert.equal(ghost.status, 200);
  assert.equal(mailbox.sent.length, 0, 'e-mail desconhecido não recebe nada e a resposta é a mesma');
  assert.equal((await call('POST', '/api/partner/forgot', { email: 'esqueci@parceiro.test' })).status, 200);
  assert.equal(mailbox.sent.length, 1);
  const code = lastCode();

  assert.equal((await call('POST', '/api/partner/reset', { email: 'esqueci@parceiro.test', code, password: 'curta1' })).status, 422, 'senha fraca');
  assert.equal((await call('POST', '/api/partner/reset', { email: 'esqueci@parceiro.test', code: code === '000000' ? '111111' : '000000', password: 'SenhaNova-2026x' })).status, 401, 'código errado');
  assert.equal((await call('POST', '/api/partner/reset', { email: 'esqueci@parceiro.test', code, password: 'SenhaNova-2026x' })).status, 204);
  assert.equal((await login('esqueci@parceiro.test', 'SenhaNova-2026x')).status, 200, 'a senha nova entra');
  assert.equal((await login('esqueci@parceiro.test', p.password)).status, 401, 'a antiga deixou de valer');
  assert.equal((await call('POST', '/api/partner/reset', { email: 'esqueci@parceiro.test', code, password: 'OutraSenha-2026y' })).status, 401, 'o código só vale uma vez');
});

test('backoffice: "esqueci minha senha" vale também para quem já tem senha (código no e-mail) e derruba a senha antiga', async () => {
  const P = '/api/gestao';
  const email = 'dono@exemplo.com';
  mailbox.sent.length = 0;
  assert.equal((await call('POST', `${P}/setup-code`, { email })).status, 200);
  assert.equal((await call('POST', `${P}/setup`, { email, code: lastCode(), password: 'Primeira-senha-2026' })).status, 204);
  assert.equal((await call('POST', `${P}/login-password`, { email, password: 'Primeira-senha-2026' })).status, 200);

  mailbox.sent.length = 0;
  await call('POST', `${P}/setup-code`, { email });
  assert.equal(mailbox.sent.length, 1, 'quem já tem senha também recebe o código ao esquecer');
  assert.match(mailbox.sent[0]!.subject, /redefinir/i);
  assert.equal((await call('POST', `${P}/setup`, { email, code: lastCode(), password: 'Segunda-senha-2026' })).status, 204);
  assert.equal((await call('POST', `${P}/login-password`, { email, password: 'Primeira-senha-2026' })).status, 401);
  assert.equal((await call('POST', `${P}/login-password`, { email, password: 'Segunda-senha-2026' })).status, 200);

  mailbox.sent.length = 0;
  assert.equal((await call('POST', `${P}/setup-code`, { email: 'desconhecido@exemplo.com' })).status, 200);
  assert.equal(mailbox.sent.length, 0, 'e-mail sem acesso não recebe código e a resposta é a mesma');
});
