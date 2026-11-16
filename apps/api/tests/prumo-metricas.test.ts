// Indicadores do Prumo no backoffice: visitas em /prumo, abertura das abas do app, usuários ativos (app e WhatsApp), funil e jornada do cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { dashboard, prumo } from '../src/admin/metrics.ts';
import { sessionTimeline } from '../src/admin/customers.ts';
import { noteActivity } from '../src/activity.ts';

let db: Db;
let app: FastifyInstance;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };
const ctx = () => ({ db, config, gateway: new FakeGateway(config.webhookSecret), email: mailbox }) as never;

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
  return async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}

test('Prumo no backoffice: visitas, abas, cliques, usuários ativos, funil e jornada', async () => {
  // visitante que só viu a página /prumo
  const visitor = client();
  assert.equal((await visitor('POST', '/api/events', { name: 'view', props: { view: 'prumo' }, attr: { source: 'instagram', medium: 'bio', device: 'mobile' } })).status, 204);
  await visitor('POST', '/api/events', { name: 'cta', props: { id: 'prumo_tour_cartoes' } });

  // assinante que pede o código, entra e usa duas abas
  const user = client();
  await user('POST', '/api/events', { name: 'view', props: { view: 'conta_login' }, attr: { source: 'google', device: 'desktop' } });
  mailbox.sent.length = 0;
  await user('POST', '/api/account/login-code', { email: 'prumo-metricas@exemplo.com' });
  await user('POST', '/api/events', { name: 'cta', props: { id: 'prumo_pedir_codigo' } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1];
  assert.equal((await user('POST', '/api/account/login', { email: 'prumo-metricas@exemplo.com', code })).status, 200);
  await user('POST', '/api/events', { name: 'view', props: { view: 'conta_geral' } });
  await user('POST', '/api/events', { name: 'view', props: { view: 'conta_dividas' } });
  await user('GET', '/api/account'); // qualquer chamada da conta registra o dia de uso

  const pm = await prumo(ctx(), 30);
  assert.equal(pm.kpis.landingVisitors, 1);
  assert.equal(pm.kpis.appSessions, 1);
  assert.deepEqual(pm.tabs.map((t) => t.tab).sort(), ['dividas', 'geral']);
  assert.ok(pm.tabs.every((t) => t.sessions === 1 && t.users === 1), 'a aba conta a pessoa e o assinante, uma vez');
  assert.ok(pm.ctas.some((c) => c.id === 'prumo_pedir_codigo' && c.clicks === 1));
  assert.ok(pm.ctas.some((c) => c.id === 'prumo_tour_cartoes'));
  assert.equal(pm.kpis.activeUsers, 1);
  assert.equal(pm.kpis.dau, 1);
  assert.equal(pm.kpis.activeApp, 1);
  assert.equal(pm.kpis.activeWhatsapp, 0);
  const f = Object.fromEntries(pm.funnel.map((s) => [s.key, s.count]));
  assert.equal(f.landing, 1);
  assert.equal(f.opened_app, 1);
  assert.equal(f.asked_code, 1);
  assert.equal(f.new_accounts, 1);
  assert.equal(f.subscribed, 0);
  assert.deepEqual(pm.sources.map((s) => s.source).sort(), ['google', 'instagram']);
  assert.ok(pm.devices.some((d) => d.device === 'mobile') && pm.devices.some((d) => d.device === 'desktop'));
  assert.ok(pm.byPlan.length >= 1 && pm.byPlan.every((p) => p.users === 1));
  assert.ok(!JSON.stringify(pm).includes('prumo-metricas@'), 'nenhum dado pessoal nos indicadores');

  // WhatsApp também conta como uso, uma vez por dia e canal
  const sub = (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = 'prumo-metricas@exemplo.com'`)).rows[0]!.id;
  await noteActivity({ db }, sub, 'whatsapp');
  await noteActivity({ db }, sub, 'whatsapp');
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.subscriber_activity WHERE subscriber_id = $1`, [sub])).rows[0]!.n, '2', 'app e whatsapp, uma linha de cada');
  const pm2 = await prumo(ctx(), 30);
  assert.equal(pm2.kpis.activeUsers, 1, 'a mesma pessoa nos dois canais conta uma vez');
  assert.equal(pm2.kpis.activeWhatsapp, 1);

  // o painel traz a seção do Prumo
  assert.equal((await dashboard(ctx(), 30)).prumo.kpis.landingVisitors, 1);

  // jornada do cliente: as telas do Prumo aparecem com nome legível
  const sessions = (await db.query<{ id: string }>(`SELECT id FROM app.sessions WHERE subscriber_id = $1`, [sub])).rows.map((r) => r.id);
  const labels = (await sessionTimeline(ctx(), sessions)).map((i) => i.label);
  assert.ok(labels.includes('Abriu a tela de entrar no Prumo'));
  assert.ok(labels.includes('Pediu o código de acesso ao Prumo'));
  assert.ok(labels.includes('Abriu a aba "Visão geral" do Prumo'));
  assert.ok(labels.includes('Abriu a aba "Dívidas" do Prumo'));
});
