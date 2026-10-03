import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { verifyTurnstile } from '../src/turnstile.ts';
import { deepHealth, workerBeat } from '../src/health.ts';

let db: Db;
let app: FastifyInstance;
const base = loadConfig({ NODE_ENV: 'test' });
const config = { ...base, webhookSecret: 'segredo-de-teste', turnstileSiteKey: 'site', turnstileSecret: 'segredo', subscriptionsEnabled: true };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: new MemorySender(), rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

test('saúde profunda: banco e filas ok; em teste ignora worker/backup', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health/deep' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.checks.banco.ok, true);
  await workerBeat({ db, config } as never);
  const h = await deepHealth({ db, config } as never);
  assert.equal(h.checks.fila!.ok, true);
});

test('saúde profunda: entrega parada há mais de 15 min acende o alerta', async () => {
  const se = await db.query<{ id: string }>(`INSERT INTO app.sessions(token_hash, expires_at) VALUES ('\x01'::bytea, now() + interval '1 day') RETURNING id`);
  const c = await db.query<{ id: string }>(`INSERT INTO app.cases(session_id, purge_after) VALUES ($1, now() + interval '1 day') RETURNING id`, [se.rows[0]!.id]);
  await db.query(`INSERT INTO app.deliverables(case_id, product_code, status, created_at, updated_at) VALUES ($1,'negotiation_scripts','pending', now() - interval '1 hour', now() - interval '1 hour')`, [c.rows[0]!.id]);
  const h = await deepHealth({ db, config } as never);
  assert.equal(h.checks.fila!.ok, false);
});

test('turnstile: sem token falha, token ruim falha, token bom passa, Cloudflare fora não bloqueia', async () => {
  await assert.rejects(() => verifyTurnstile(config, undefined, '1.1.1.1'), /verificação/);
  const ruim = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
  await assert.rejects(() => verifyTurnstile(config, 'x'.repeat(20), '1.1.1.1', ruim), /verificação/);
  const bom = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;
  await verifyTurnstile(config, 'x'.repeat(20), '1.1.1.1', bom);
  const fora = (async () => { throw new Error('rede'); }) as typeof fetch;
  await verifyTurnstile(config, 'x'.repeat(20), '1.1.1.1', fora);
  await verifyTurnstile(base, undefined, '1.1.1.1'); // desligado sem chaves
});

test('turnstile ligado: /api/features expõe só a chave pública e o login exige token', async () => {
  const f = await app.inject({ method: 'GET', url: '/api/features', headers: { 'x-folego': '1' } });
  assert.equal(f.json().turnstileSiteKey, 'site');
  assert.ok(!JSON.stringify(f.json()).includes('segredo'));
  const r = await app.inject({ method: 'POST', url: '/api/account/login-code', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: JSON.stringify({ email: 'a@b.com' }) });
  assert.equal(r.statusCode, 403);
});
