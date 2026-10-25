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
const config = { ...loadConfig({ NODE_ENV: 'development' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, rateLimits: 'relaxed' });
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
    return { status: res.statusCode, json, res };
  };
}
async function login(c: ReturnType<typeof client>, email: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  assert.equal((await c('POST', '/api/account/login', { body: { email, code } })).status, 200);
}
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300, 3)]);

test('foto de perfil: inclui, mostra no perfil, troca, recusa arquivo falso ou grande e apaga', async () => {
  const c = client();
  await login(c, 'foto1@exemplo.com');
  assert.equal((await c('GET', '/api/account/avatar')).status, 404, 'sem foto ainda');
  assert.equal((await c('GET', '/api/account')).json.profile.avatarAt, null);

  const put = await c('PUT', '/api/account/avatar', { body: { mime: 'image/jpeg', data: JPG.toString('base64') } });
  assert.equal(put.status, 200);
  assert.ok(put.json.avatarAt);
  assert.equal((await c('GET', '/api/account')).json.profile.avatarAt, put.json.avatarAt, 'o perfil informa quando a foto mudou');

  const got = await c('GET', '/api/account/avatar');
  assert.equal(got.status, 200);
  assert.equal(got.res.headers['content-type'], 'image/jpeg');
  assert.deepEqual(Buffer.from(got.res.rawPayload), JPG, 'a foto volta idêntica');
  const stored = await db.query<{ avatar_enc: Buffer }>(`SELECT avatar_enc FROM app.subscribers WHERE email = 'foto1@exemplo.com'`);
  assert.ok(!stored.rows[0]!.avatar_enc.includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'foto cifrada no banco');

  assert.equal((await c('PUT', '/api/account/avatar', { body: { mime: 'image/png', data: PNG.toString('base64') } })).status, 200, 'trocar por outra');
  assert.equal((await c('GET', '/api/account/avatar')).res.headers['content-type'], 'image/png');
  assert.equal((await c('PUT', '/api/account/avatar', { body: { mime: 'image/jpeg', data: Buffer.from('não é imagem nenhuma, só texto').toString('base64') } })).status, 415, 'conteúdo falso');
  assert.equal((await c('PUT', '/api/account/avatar', { body: { mime: 'image/gif', data: JPG.toString('base64') } })).status, 400, 'tipo não aceito');
  assert.equal((await c('PUT', '/api/account/avatar', { body: { mime: 'image/jpeg', data: Buffer.concat([JPG, Buffer.alloc(41 * 1024)]).toString('base64') } })).status, 400, 'passa do limite de tamanho');
  assert.equal((await c('GET', '/api/account/avatar')).res.headers['content-type'], 'image/png', 'as recusas não apagaram a foto');

  assert.equal((await c('DELETE', '/api/account/avatar')).status, 204);
  assert.equal((await c('GET', '/api/account/avatar')).status, 404);
  assert.equal((await c('GET', '/api/account')).json.profile.avatarAt, null);
});

test('foto de perfil: cada pessoa vê só a sua e é preciso estar logado', async () => {
  const a = client();
  await login(a, 'foto2@exemplo.com');
  await a('PUT', '/api/account/avatar', { body: { mime: 'image/jpeg', data: JPG.toString('base64') } });
  const b = client();
  await login(b, 'foto3@exemplo.com');
  assert.equal((await b('GET', '/api/account/avatar')).status, 404, 'a foto do outro não aparece');
  assert.equal((await client()('GET', '/api/account/avatar')).status, 401);
  assert.equal((await client()('PUT', '/api/account/avatar', { body: { mime: 'image/jpeg', data: JPG.toString('base64') } })).status, 401);
});
