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
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, adminEmails: ['dono@exemplo.com'] };

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
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({
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
type Client = ReturnType<typeof client>;

const PASSWORDS = new Map<string, string>();
const PW = 'Senha-Forte-2026';

const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;

/** Primeiro acesso: código por e-mail + senha nova. */
async function adminSetup(c: Client, email: string, password = PW) {
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/gestao/setup-code', { body: { email } })).status, 200);
  assert.equal(mailbox.sent.length, 1, 'o código de primeiro acesso deve chegar por e-mail');
  const res = await c('POST', '/api/gestao/setup', { body: { email, code: lastCode(), password } });
  assert.equal(res.status, 204);
  PASSWORDS.set(email, password);
}

/** Login: e-mail + senha (o código por e-mail só existe no primeiro acesso/redefinição). */
async function adminLogin(c: Client, email: string) {
  if (!PASSWORDS.has(email)) await adminSetup(c, email);
  mailbox.sent.length = 0;
  const ok = await c('POST', '/api/gestao/login-password', { body: { email, password: PASSWORDS.get(email) } });
  assert.equal(ok.status, 200);
  assert.equal(mailbox.sent.length, 0, 'login normal não manda código');
  return ok.json.user;
}

let sharedOwner: Client | null = null;
/** Uma única sessão de dono para os testes (o pedido de código é limitado a 3 por 10 minutos por e-mail). */
async function ownerClient(): Promise<Client> {
  if (!sharedOwner) {
    sharedOwner = client();
    await adminLogin(sharedOwner, 'dono@exemplo.com');
  }
  return sharedOwner;
}

const profile = { netIncomeCents: 250_000, fixedExpensesCents: 200_000, employmentType: 'clt', ageBand: '25-34', uf: 'SP' };
const debts = [{ creditorName: 'Banco Segredo', kind: 'credit_card', balanceCents: 300_000, monthlyPaymentCents: 30_000, monthlyRateBps: 900, daysOverdue: 40 }];

async function buyer(products: string[], key: string, pay = true) {
  const c = client();
  const created = await c('POST', '/api/cases', { body: { profile, debts, acceptTerms: true } });
  const caseId = created.json.caseId as string;
  const order = await c('POST', '/api/orders', { body: { caseId, products }, headers: { 'idempotency-key': `${key}-pedido-0001` } });
  if (pay && order.status === 201) {
    const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
    gateway.markPaid(p.rows[0]!.provider_payment_id);
    await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  }
  return { c, caseId, order };
}

test('entrada: só e-mail autorizado recebe código; sem sessão de admin nada abre', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/gestao/dashboard')).status, 401);
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/gestao/setup-code', { body: { email: 'intruso@exemplo.com' } })).status, 200); // resposta igual, sem revelar nada
  assert.equal(mailbox.sent.length, 0);
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email: 'intruso@exemplo.com', password: PW } })).status, 401);

  const user = await adminLogin(c, 'dono@exemplo.com');
  assert.equal(user.role, 'owner');
  assert.ok(user.permissions.includes('config_usuarios'));
  assert.equal((await c('GET', '/api/gestao/me')).json.user.email, 'dono@exemplo.com');
  assert.equal((await c('POST', '/api/gestao/logout')).status, 204);
  assert.equal((await c('GET', '/api/gestao/me')).status, 401);
});

test('código errado é recusado e o assinante comum não vira administrador', async () => {
  const c = client();
  mailbox.sent.length = 0;
  await ownerClient();
  assert.equal((await c('POST', '/api/gestao/login', { body: { email: 'dono@exemplo.com', code: '000000' } })).status, 404, 'a rota de código não existe mais');
  // sessão de assinante não abre o backoffice
  const sub = client();
  mailbox.sent.length = 0;
  await sub('POST', '/api/account/login-code', { body: { email: 'cliente@exemplo.com' } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  await sub('POST', '/api/account/login', { body: { email: 'cliente@exemplo.com', code } });
  assert.equal((await sub('GET', '/api/gestao/dashboard')).status, 401);
});

test('permissões: suporte vê clientes mas não o dashboard nem as configurações; dono gerencia usuários', async () => {
  const owner = await ownerClient();
  const created = await owner('POST', '/api/gestao/usuarios', { body: { email: 'suporte@exemplo.com', name: 'Sônia', role: 'suporte' } });
  assert.equal(created.status, 201);
  assert.equal((await owner('POST', '/api/gestao/usuarios', { body: { email: 'suporte@exemplo.com', role: 'suporte' } })).status, 409);

  const sup = client();
  await adminLogin(sup, 'suporte@exemplo.com');
  assert.equal((await sup('GET', '/api/gestao/clientes/avulsos')).status, 200);
  assert.equal((await sup('GET', '/api/gestao/dashboard')).status, 403);
  assert.equal((await sup('GET', '/api/gestao/config')).status, 403);
  assert.equal((await sup('GET', '/api/gestao/usuarios')).status, 403);
  assert.equal((await sup('PUT', '/api/gestao/produtos/recovery_map', { body: { priceCents: 100 } })).status, 403);

  // dono libera o dashboard para o suporte e a permissão vale na hora
  await owner('PUT', `/api/gestao/usuarios/${created.json.id}`, { body: { permissions: ['clientes', 'assinaturas', 'jornada', 'dashboard'] } });
  assert.equal((await sup('GET', '/api/gestao/dashboard')).status, 200);

  // desativar derruba a sessão
  await owner('PUT', `/api/gestao/usuarios/${created.json.id}`, { body: { active: false } });
  assert.equal((await sup('GET', '/api/gestao/clientes/avulsos')).status, 401);
});

test('o último dono não pode ser rebaixado nem desativado', async () => {
  const owner = await ownerClient();
  const me = (await owner('GET', '/api/gestao/me')).json.user;
  assert.equal((await owner('PUT', `/api/gestao/usuarios/${me.id}`, { body: { role: 'gestor' } })).status, 409);
  assert.equal((await owner('PUT', `/api/gestao/usuarios/${me.id}`, { body: { active: false } })).status, 409);
});

test('preços: o valor editado vale para o próximo pedido, fica no histórico e aparece no catálogo público', async () => {
  const owner = await ownerClient();
  const before = await buyer(['recovery_map'], 'preco-antes', false);
  assert.equal(before.order.json.totalCents, 2900);

  const edit = await owner('PUT', '/api/gestao/produtos/recovery_map', { body: { priceCents: 3500 } });
  assert.equal(edit.status, 200);
  const pub = await client()('GET', '/api/catalog');
  assert.equal(pub.json.products.find((p: any) => p.code === 'recovery_map').priceCents, 3500);

  const after = await buyer(['recovery_map'], 'preco-depois', false);
  assert.equal(after.order.json.totalCents, 3500);
  // pedido antigo guarda o preço de quando foi feito
  const list = await owner('GET', '/api/gestao/produtos');
  const map = list.json.products.find((p: any) => p.code === 'recovery_map');
  assert.equal(map.history[0].oldCents, 2900);
  assert.equal(map.history[0].newCents, 3500);
  assert.equal(map.usesAi, true);
  assert.ok(list.json.free.length >= 4);

  // preço inválido
  assert.equal((await owner('PUT', '/api/gestao/produtos/recovery_map', { body: { priceCents: -1 } })).status, 400);
  assert.equal((await owner('PUT', '/api/gestao/produtos/sub_ousado', { body: { priceCents: 0 } })).status, 422);
  await owner('PUT', '/api/gestao/produtos/recovery_map', { body: { priceCents: 2900 } });
});

test('produto desativado não vende; vendas pausadas devolvem aviso; o aviso do site sai no catálogo', async () => {
  const owner = await ownerClient();
  await owner('PUT', '/api/gestao/produtos/calendar_30d', { body: { active: false } });
  const c = client();
  const created = await c('POST', '/api/cases', { body: { profile, debts, acceptTerms: true } });
  const blockedItem = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map', 'calendar_30d'] }, headers: { 'idempotency-key': 'inativo-pedido-0002' } });
  assert.equal(blockedItem.status, 422);
  assert.equal(blockedItem.json.error, 'product_unavailable');
  await owner('PUT', '/api/gestao/produtos/calendar_30d', { body: { active: true } });

  const cfg = await owner('PUT', '/api/gestao/config', { body: { salesPaused: true, announcement: { text: 'Manutenção rápida.', tone: 'warn' } } });
  assert.equal(cfg.json.settings.salesPaused, true);
  const c2 = client();
  const created2 = await c2('POST', '/api/cases', { body: { profile, debts, acceptTerms: true } });
  const blocked = await c2('POST', '/api/orders', { body: { caseId: created2.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'pausa-pedido-0001' } });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.json.error, 'sales_paused');
  const cat = await client()('GET', '/api/catalog');
  assert.equal(cat.json.salesPaused, true);
  assert.equal(cat.json.announcement.text, 'Manutenção rápida.');

  await owner('PUT', '/api/gestao/config', { body: { salesPaused: false, announcement: null } });
  const ok = await c2('POST', '/api/orders', { body: { caseId: created2.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'pausa-pedido-0002' } });
  assert.equal(ok.status, 201);
});

test('preço do Kit Completo é configurável', async () => {
  const owner = await ownerClient();
  await owner('PUT', '/api/gestao/config', { body: { bundlePriceCents: 4990 } });
  const c = client();
  const created = await c('POST', '/api/cases', { body: { profile, debts, acceptTerms: true } });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map', 'defense_letters', 'calendar_30d'] }, headers: { 'idempotency-key': 'kit-pedido-00001' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.totalCents, 4990);
  await owner('PUT', '/api/gestao/config', { body: { bundlePriceCents: 5990 } });
});

test('recursos ligados/desligados no backoffice valem sem reiniciar', async () => {
  const owner = await ownerClient();
  await owner('PUT', '/api/gestao/config', { body: { subscriptionsEnabled: false } });
  assert.equal((await client()('POST', '/api/account/login-code', { body: { email: 'x@exemplo.com' } })).status, 404);
  assert.equal((await client()('GET', '/api/features')).json.subscriptions, false);
  await owner('PUT', '/api/gestao/config', { body: { subscriptionsEnabled: true } });
  assert.equal((await client()('POST', '/api/account/login-code', { body: { email: 'y@exemplo.com' } })).status, 200);
  // valor inválido
  assert.equal((await owner('PUT', '/api/gestao/config', { body: { reminderDaysBefore: 99 } })).status, 400);
});

test('eventos de navegação: gravam, ignoram robôs e recusam nomes fora da lista; funil conta por sessão', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/events', { body: { name: 'view', props: { view: 'landing' }, attr: { source: 'instagram', medium: 'bio', campaign: 'lancamento', device: 'mobile' } } })).status, 204);
  assert.equal((await c('POST', '/api/events', { body: { name: 'view', props: { view: 'intake' } } })).status, 204);
  assert.equal((await c('POST', '/api/events', { body: { name: 'cta', props: { id: 'start' } } })).status, 204);
  assert.equal((await c('POST', '/api/events', { body: { name: 'hack', props: {} } })).status, 400);
  assert.equal((await c('POST', '/api/events', { body: { name: 'view', props: { view: '<script>' } } })).status, 400);
  const bot = client();
  await bot('POST', '/api/events', { body: { name: 'view', props: { view: 'landing' } }, headers: { 'user-agent': 'Googlebot/2.1' } });
  const total = await db.query<{ n: string }>(`SELECT count(*) AS n FROM app.events WHERE props->>'view' = 'landing'`);
  assert.equal(Number(total.rows[0]!.n), 1);
});

test('dashboard: funil, abandono, receita por produto e por meio de pagamento, e perfil sem dado pessoal', async () => {
  const paid = await buyer(['recovery_map', 'defense_letters'], 'dash-pago');
  assert.equal(paid.order.status, 201);
  await buyer(['recovery_map'], 'dash-abandono', false);
  const noOrder = client();
  await noOrder('POST', '/api/cases', { body: { profile, debts, acceptTerms: true } });

  const owner = await ownerClient();
  const d = (await owner('GET', '/api/gestao/dashboard?dias=30')).json;
  assert.equal(d.days, 30);
  assert.ok(d.funnel.steps.length === 6);
  const step = (k: string) => d.funnel.steps.find((s: any) => s.key === k).count;
  assert.ok(step('diagnosed') >= 3);
  assert.ok(step('paid') >= 1);
  assert.ok(d.funnel.abandonment.abandonedCheckout >= 1, 'quem gerou Pix e não pagou');
  assert.ok(d.funnel.abandonment.neverOpenedCheckout >= 1, 'quem só viu o resultado');
  assert.ok(d.revenue.grossCents >= 4800);
  assert.ok(d.revenue.byProduct.some((p: any) => p.code === 'defense_letters' && p.units >= 1));
  assert.ok(d.revenue.byMethod.some((m: any) => m.method === 'pix'));
  assert.ok(d.profile.byUf.some((u: any) => u.key === 'SP'));
  assert.ok(d.profile.totalDebtCents >= 900_000);
  assert.ok(d.profile.withOverdue >= 3);
  assert.ok(d.profile.debtKinds.some((k: any) => k.kind === 'credit_card'));
  assert.ok(d.traffic.sources.some((s: any) => s.source === 'instagram'));
  assert.ok(!JSON.stringify(d).includes('Banco Segredo'), 'nenhum nome de credor no painel');
});

test('clientes: lista e detalhe de compradores avulsos, com jornada; contato só de quem autorizou e com rastro na auditoria', async () => {
  const b = await buyer(['recovery_map', 'extra_income_plan'], 'cli-renda');
  await b.c('POST', `/api/cases/${b.caseId}/income-interview`, { body: { skills: 'Sei fazer doces', hoursBand: '10_20h', capitalCents: 10_000, hasVehicle: false, mode: 'tanto_faz', priorAttempts: '', name: 'Maria Cliente', phone: '11987654321', email: 'maria@exemplo.com', wantsPartnerContact: true } });
  const nobody = await buyer(['recovery_map', 'extra_income_plan'], 'cli-sem');
  await nobody.c('POST', `/api/cases/${nobody.caseId}/income-interview`, { body: { skills: 'Sei consertar', hoursBand: 'ate_5h', capitalCents: 0, hasVehicle: false, mode: 'online', priorAttempts: '', name: 'Sem Autorizacao', phone: '11911112222', wantsPartnerContact: false } });

  const owner = await ownerClient();
  const list = await owner('GET', '/api/gestao/clientes/avulsos?filtro=pagaram');
  const row = list.json.items.find((i: any) => i.id === b.caseId);
  assert.ok(row);
  assert.deepEqual(row.products.sort(), ['extra_income_plan', 'recovery_map']);
  assert.equal(row.leadConsent, true);
  assert.ok(!JSON.stringify(list.json).includes('Maria'), 'lista não traz dado pessoal');

  const detail = await owner('GET', `/api/gestao/clientes/avulsos/${b.caseId}`);
  assert.equal(detail.json.leadConsent.categories[0], 'empreendedorismo');
  assert.equal(detail.json.incomeInterview.hoursBand, '10_20h');
  assert.ok(detail.json.orders.some((o: any) => o.method === 'pix'));

  const journey = await owner('GET', `/api/gestao/jornada/caso/${b.caseId}`);
  const labels = journey.json.timeline.map((t: any) => t.label).join(' | ');
  assert.match(labels, /Preencheu o diagnóstico/);
  assert.match(labels, /Pagou/);
  assert.match(labels, /Autorizou contato/);

  const reveal = await owner('POST', `/api/gestao/contato/${b.caseId}`);
  assert.equal(reveal.status, 200);
  assert.equal(reveal.json.name, 'Maria Cliente');
  assert.equal(reveal.json.email, 'maria@exemplo.com');
  // quem não autorizou não aparece, nem para o dono
  assert.equal((await owner('POST', `/api/gestao/contato/${nobody.caseId}`)).status, 403);
  const audit = await owner('GET', '/api/gestao/auditoria');
  assert.ok(audit.json.items.some((a: any) => a.action === 'admin_reveal_contact' && a.entityId === b.caseId));

  // sem a permissão específica, nem a lista completa dá acesso ao contato
  const created = await owner('POST', '/api/gestao/usuarios', { body: { email: 'gestor@exemplo.com', role: 'gestor' } });
  assert.equal(created.status, 201);
  const gestor = client();
  await adminLogin(gestor, 'gestor@exemplo.com');
  assert.equal((await gestor('POST', `/api/gestao/contato/${b.caseId}`)).status, 403);
  assert.equal((await gestor('GET', '/api/gestao/parcerias')).status, 200);
});

test('assinaturas: em dia, vencendo e em débito; ações manuais com motivo e rastro', async () => {
  const mk = async (email: string, plan: string, key: string) => {
    const c = client();
    mailbox.sent.length = 0;
    await c('POST', '/api/account/login-code', { body: { email } });
    const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
    await c('POST', '/api/account/login', { body: { email, code } });
    const o = await c('POST', '/api/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': key } });
    const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
    gateway.markPaid(p.rows[0]!.provider_payment_id);
    await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  };
  await mk('em-dia@exemplo.com', 'ousado', 'sub-bo-000000001');
  await mk('vencendo@exemplo.com', 'controle', 'sub-bo-000000002');
  await mk('debito@exemplo.com', 'desbravador', 'sub-bo-000000003');
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() + interval '2 days' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'vencendo@exemplo.com')`);
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() - interval '5 days' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'debito@exemplo.com')`);

  const owner = await ownerClient();
  const all = await owner('GET', '/api/gestao/assinaturas');
  const statusOf = (email: string) => all.json.items.find((i: any) => i.email === email).status;
  assert.equal(statusOf('em-dia@exemplo.com'), 'em_dia');
  assert.equal(statusOf('vencendo@exemplo.com'), 'vencendo');
  assert.equal(statusOf('debito@exemplo.com'), 'em_debito');
  assert.ok(all.json.counts.em_debito >= 1);
  assert.equal((await owner('GET', '/api/gestao/assinaturas?status=em_debito')).json.items.every((i: any) => i.status === 'em_debito'), true);

  const sum = (await owner('GET', '/api/gestao/assinaturas/resumo')).json;
  assert.ok(sum.delinquent >= 1);
  assert.ok(sum.mrrCents >= 3999 + 1999);
  assert.ok(sum.lostMrrCents >= 5999);

  const debtor = all.json.items.find((i: any) => i.email === 'debito@exemplo.com');
  assert.equal((await owner('POST', `/api/gestao/assinaturas/${debtor.id}/acao`, { body: { type: 'extend', days: 10, reason: '' } })).status, 400);
  assert.equal((await owner('POST', `/api/gestao/assinaturas/${debtor.id}/acao`, { body: { type: 'extend', days: 10, reason: 'Cortesia por instabilidade' } })).status, 200);
  const detail = await owner('GET', `/api/gestao/assinaturas/${debtor.id}`);
  assert.equal(detail.json.status, 'em_dia');
  assert.ok(detail.json.history.some((h: any) => h.action === 'admin_subscription_extend' && h.data.reason === 'Cortesia por instabilidade'));

  const journey = await owner('GET', `/api/gestao/jornada/assinante/${debtor.id}`);
  assert.ok(journey.json.timeline.some((t: any) => /Pagou a assinatura/.test(t.label)));
});

test('preço e período da assinatura vêm do catálogo: dias por pagamento são editáveis', async () => {
  const owner = await ownerClient();
  await owner('PUT', '/api/gestao/produtos/sub_controle', { body: { accessDays: 45 } });
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email: 'dias@exemplo.com' } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  await c('POST', '/api/account/login', { body: { email: 'dias@exemplo.com', code } });
  const o = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-dias-0000001' } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: 'evt-dias', paymentId: p.rows[0]!.provider_payment_id }) });
  const acc = await c('GET', '/api/account');
  const days = Math.round((acc.json.subscription.periodEnd - Date.now()) / 86_400_000);
  assert.ok(days >= 44 && days <= 45, `esperava ~45 dias, veio ${days}`);
  await owner('PUT', '/api/gestao/produtos/sub_controle', { body: { accessDays: 30 } });
});

test('marketing: insights com evidência, públicos e quadro de planejamento', async () => {
  const owner = await ownerClient();
  const m = (await owner('GET', '/api/gestao/marketing/insights?dias=90')).json;
  assert.ok(Array.isArray(m.insights) && m.insights.length > 0);
  for (const i of m.insights) {
    assert.ok(i.title && i.evidence && i.actions.length > 0 && ['alta', 'media', 'baixa'].includes(i.priority));
  }
  assert.ok(m.audiences.some((a: any) => a.id === 'em_debito'));
  assert.ok(m.calendar.length > 3);

  const plan = await owner('POST', '/api/gestao/marketing/planos', { body: { title: 'Campanha de renovação', goal: 'Renovar 60%', segment: 'Vencendo em 7 dias', channel: 'E-mail', dueOn: '2026-10-15' } });
  assert.equal(plan.status, 201);
  assert.equal((await owner('PUT', `/api/gestao/marketing/planos/${plan.json.id}`, { body: { status: 'em_andamento' } })).status, 200);
  const listed = (await owner('GET', '/api/gestao/marketing/planos')).json.plans;
  assert.equal(listed.find((p: any) => p.id === plan.json.id).status, 'em_andamento');
  assert.equal((await owner('PUT', `/api/gestao/marketing/planos/${plan.json.id}`, { body: { status: 'inventado' } })).status, 400);
  assert.equal((await owner('DELETE', `/api/gestao/marketing/planos/${plan.json.id}`)).status, 204);
});

test('parcerias: tamanho do público e do pool com consentimento (sem listar pessoas)', async () => {
  const owner = await ownerClient();
  const p = (await owner('GET', '/api/gestao/parcerias?dias=90')).json;
  assert.ok(p.potential.cases >= 3);
  assert.ok(p.consentedByCategory.some((c: any) => c.category === 'empreendedorismo'));
  const contacts = (await owner('GET', '/api/gestao/parcerias/contatos?categoria=empreendedorismo')).json.items;
  assert.ok(contacts.length >= 1);
  assert.ok(!JSON.stringify(contacts).includes('Maria'), 'a lista só traz perfil; o nome exige a revelação auditada');
});

// ---------- segurança do login ----------
test('login só com senha: senha errada não entra e nenhum e-mail sai; código sozinho não entra', async () => {
  await ownerClient(); // dono com senha definida
  const c = client();
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email: 'dono@exemplo.com', password: 'senha-errada-123' } })).status, 401);
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email: 'intruso@exemplo.com', password: PW } })).status, 401);
  assert.equal(mailbox.sent.length, 0, 'nenhum código sai com senha errada');
  assert.equal((await c('POST', '/api/gestao/login', { body: { email: 'dono@exemplo.com', code: '123456' } })).status, 404);
  assert.equal((await c('GET', '/api/gestao/me')).status, 401);
});

test('5 senhas erradas bloqueiam por 5 minutos, até a senha certa fica recusada, e o desbloqueio libera', async () => {
  const owner = await ownerClient();
  const created = await owner('POST', '/api/gestao/usuarios', { body: { email: 'bloqueio@exemplo.com', role: 'suporte' } });
  const email = 'bloqueio@exemplo.com';
  const c = client();
  await adminSetup(c, email);
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/gestao/login-password', { body: { email, password: 'errada-errada-1' } })).status, 401);
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email, password: PW } })).status, 401, 'bloqueado mesmo com a senha certa');
  assert.equal(mailbox.sent.length, 0);
  const lock = await db.query<{ mins: number }>(`SELECT extract(epoch FROM (locked_until - now())) / 60 AS mins FROM app.admin_users WHERE id = $1`, [created.json.id]);
  assert.ok(Number(lock.rows[0]!.mins) > 3.5 && Number(lock.rows[0]!.mins) <= 5, `o bloqueio dura 5 minutos (deu ${lock.rows[0]!.mins})`);
  await db.query(`UPDATE app.admin_users SET locked_until = now() - interval '1 minute' WHERE id = $1`, [created.json.id]);
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email, password: PW } })).status, 200);
});

test('política de senha: curta, sem número, repetitiva ou com o e-mail são recusadas', async () => {
  const owner = await ownerClient();
  await owner('POST', '/api/gestao/usuarios', { body: { email: 'politica@exemplo.com', role: 'suporte' } });
  const email = 'politica@exemplo.com';
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/gestao/setup-code', { body: { email } });
  const code = lastCode();
  for (const bad of ['curta1', 'apenasletrasaqui', '123456789012', 'aaaaaaaaaaaa1', 'politica-2026-x']) {
    const res = await c('POST', '/api/gestao/setup', { body: { email, code, password: bad } });
    assert.equal(res.status, 422, bad);
  }
  assert.equal((await c('POST', '/api/gestao/setup', { body: { email, code, password: 'Uma-Senha-Boa-77' } })).status, 204);
  PASSWORDS.set(email, 'Uma-Senha-Boa-77');
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email, password: 'Uma-Senha-Boa-77' } })).status, 200);
});

test('primeiro acesso só vale uma vez: com senha definida, ninguém redefine só com o e-mail', async () => {
  await ownerClient();
  const c = client();
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/gestao/setup-code', { body: { email: 'dono@exemplo.com' } })).status, 200);
  assert.equal(mailbox.sent.length, 0, 'sem código: a senha já existe');
  assert.equal((await c('POST', '/api/gestao/setup', { body: { email: 'dono@exemplo.com', code: '123456', password: 'Outra-Senha-9999' } })).status, 401);
});

test('trocar a senha exige a atual e derruba as outras sessões; o dono libera a redefinição de outra pessoa', async () => {
  const owner = await ownerClient();
  const created = await owner('POST', '/api/gestao/usuarios', { body: { email: 'troca@exemplo.com', role: 'gestor' } });
  const email = 'troca@exemplo.com';
  const a = client();
  const b = client();
  await adminLogin(a, email);
  await adminLogin(b, email);
  assert.equal((await b('POST', '/api/gestao/password', { body: { current: 'errada', next: 'Nova-Senha-Forte-1' } })).status, 401);
  assert.equal((await b('POST', '/api/gestao/password', { body: { current: PW, next: 'fraca' } })).status, 422);
  assert.equal((await b('POST', '/api/gestao/password', { body: { current: PW, next: 'Nova-Senha-Forte-1' } })).status, 204);
  assert.equal((await b('GET', '/api/gestao/me')).status, 200, 'a sessão que trocou continua');
  assert.equal((await a('GET', '/api/gestao/me')).status, 401, 'a outra sessão cai');
  PASSWORDS.set(email, 'Nova-Senha-Forte-1');

  // dono libera redefinição: senha some, sessões caem, e a pessoa cria outra com código do e-mail
  assert.equal((await owner('PUT', `/api/gestao/usuarios/${created.json.id}`, { body: { resetPassword: true } })).status, 200);
  assert.equal((await b('GET', '/api/gestao/me')).status, 401);
  mailbox.sent.length = 0;
  assert.equal((await client()('POST', '/api/gestao/login-password', { body: { email, password: 'Nova-Senha-Forte-1' } })).status, 401);
  PASSWORDS.delete(email);
  await adminSetup(client(), email, 'Senha-Redefinida-55');
  assert.equal((await client()('POST', '/api/gestao/login-password', { body: { email, password: 'Senha-Redefinida-55' } })).status, 200);
  const list = await owner('GET', '/api/gestao/usuarios');
  assert.equal(list.json.users.find((u: any) => u.email === email).hasPassword, true);
  const audit = await owner('GET', '/api/gestao/auditoria');
  assert.ok(audit.json.items.some((x: any) => x.action === 'admin_password_reset_released'));
});

test('senha nunca aparece em resposta nem em auditoria', async () => {
  const owner = await ownerClient();
  const audit = JSON.stringify((await owner('GET', '/api/gestao/auditoria?escopo=todos')).json);
  const users = JSON.stringify((await owner('GET', '/api/gestao/usuarios')).json);
  for (const s of [PW, 'scrypt$', 'password_hash']) {
    assert.ok(!audit.includes(s) && !users.includes(s), s);
  }
});
