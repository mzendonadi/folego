// Fale conosco da landing: a mensagem vira e-mail para o suporte; robô (isca preenchida) não gera e-mail; nada é gravado.
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
let off: FastifyInstance;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste' };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, rateLimits: 'relaxed' });
  off = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await off.close();
  await db.close();
});

const post = (server: FastifyInstance, body: unknown) => server.inject({ method: 'POST', url: '/api/contact', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: JSON.stringify(body) });

test('contato: a mensagem chega ao suporte com resposta direta para quem escreveu', async () => {
  const res = await post(app, { name: 'Maria Souza', email: 'Maria@Exemplo.com', phone: '(11) 91234-5678', message: 'Tenho uma dúvida sobre o Mapa.' });
  assert.equal(res.statusCode, 200);
  assert.equal(mailbox.sent.length, 1);
  const m = mailbox.sent[0]!;
  assert.equal(m.to, 'suporte@folego.online');
  assert.equal(m.headers?.['Reply-To'], 'maria@exemplo.com');
  assert.match(m.text, /Tenho uma dúvida sobre o Mapa/);
  assert.match(m.text, /\(11\) 91234-5678/);
});

test('contato: robô (isca preenchida) não gera e-mail; dados inválidos e cabeçalho forjado são recusados; sem e-mail configurado avisa', async () => {
  const before = mailbox.sent.length;
  assert.equal((await post(app, { name: 'Robo', email: 'r@exemplo.com', message: 'compre agora', website: 'http://spam' })).statusCode, 200);
  assert.equal(mailbox.sent.length, before, 'a isca não envia nada');
  assert.equal((await post(app, { name: 'A', email: 'x', message: 'oi' })).statusCode, 400);
  assert.equal((await post(app, { name: 'Ana Lima', email: 'ana@exemplo.com', message: 'Mensagem válida aqui', extra: 1 })).statusCode, 400);
  const injected = await post(app, { name: 'Ana\r\nBcc: alguem@x.com', email: 'ana@exemplo.com', message: 'Mensagem válida aqui' });
  assert.equal(injected.statusCode, 200);
  assert.ok(!/[\r\n]/.test(mailbox.sent.at(-1)!.subject), 'o assunto fica em uma linha só');
  const res = await post(off, { name: 'Ana Lima', email: 'ana@exemplo.com', message: 'Mensagem válida aqui' });
  assert.equal(res.statusCode, 503);
  assert.match(res.json().message, /suporte@folego\.online/);
});
