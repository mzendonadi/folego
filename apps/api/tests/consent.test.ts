// Aviso de cookies: o PageView para a Meta só sai depois do aceite; recusar apaga a escolha e nada é enviado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { setCapiFetch } from '../src/capi.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';

let db: Db;
let app: FastifyInstance;
const sent: unknown[] = [];
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', metaCapiToken: 'token-de-teste', metaPixelId: '123456789', metaPageView: true };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: new MemorySender(), rateLimits: 'relaxed' });
  setCapiFetch((async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response('{"events_received":1}', { status: 200 });
  }) as unknown as typeof fetch);
});
after(async () => {
  await app.close();
  await db.close();
});

const wait = () => new Promise((r) => setTimeout(r, 60));
const consent = (ads: boolean) => app.inject({ method: 'POST', url: '/api/consent', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: JSON.stringify({ ads }) });

test('sem aceite nenhum PageView sai para a Meta', async () => {
  await app.inject({ method: 'GET', url: '/' });
  await wait();
  assert.equal(sent.length, 0);
});

test('aceitar grava o cookie e envia o PageView; as visitas seguintes (com o cookie) também', async () => {
  const res = await consent(true);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['set-cookie']), /folego_ads=1/);
  await wait();
  assert.equal(sent.length, 1);
  await app.inject({ method: 'GET', url: '/', headers: { cookie: 'folego_ads=1' } });
  await wait();
  assert.equal(sent.length, 2);
});

test('recusar apaga o cookie e não envia nada', async () => {
  const before = sent.length;
  const res = await consent(false);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['set-cookie']), /folego_ads=;/);
  await wait();
  assert.equal(sent.length, before);
  assert.equal((await app.inject({ method: 'POST', url: '/api/consent', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: '{"ads":"sim"}' })).statusCode, 400);
});
