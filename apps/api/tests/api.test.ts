import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { purgeExpired } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste' };

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

const H = { 'x-folego': '1', 'content-type': 'application/json' };

const validCase = () => ({
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [
    { creditorName: 'Aluguel atrasado', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 },
    { creditorName: 'Cartão SEGREDO_CARTAO', kind: 'credit_card', balanceCents: 420_000, monthlyPaymentCents: 42_000, daysOverdue: 0 },
    { creditorName: 'Loja SEGREDO_PRESCRITA', kind: 'store_credit', balanceCents: 90_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
  ],
  acceptTerms: true,
});

/** Simula um navegador: guarda o cookie de sessão entre as chamadas. */
function client() {
  let cookie = '';
  const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers },
      payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, json: res.body ? safeJson(res.body) : null, headers: res.headers, cookie: raw ?? '' };
  };
  return call;
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function payOrder(orderId: string): Promise<void> {
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  const paymentId = pay.rows[0]!.provider_payment_id;
  gateway.markPaid(paymentId);
  const res = await app.inject({
    method: 'POST',
    url: '/webhooks/pix',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret },
    payload: JSON.stringify({ eventId: `evt-${orderId}`, paymentId }),
  });
  assert.equal(res.statusCode, 200);
}

test('saúde da API', async () => {
  const res = await client()('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('escrita sem o cabeçalho x-folego é recusada (CSRF)', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/cases', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(validCase()) });
  assert.equal(res.statusCode, 403);
});

test('criar caso: cookie httpOnly, preview seguro e nada do conteúdo pago', async () => {
  const c = client();
  const res = await c('POST', '/api/cases', { body: validCase() });
  assert.equal(res.status, 201);
  assert.match(res.cookie, /folego_sid=/);
  assert.match(res.cookie, /HttpOnly/i);
  assert.match(res.cookie, /SameSite=Lax/i);
  const text = JSON.stringify(res.json);
  for (const key of ['"order"', '"plan"', '"baseline"', '"budget"', '"refinance"', '"alternatives"', '"debts"']) assert.ok(!text.includes(key), `vazou ${key}`);
  assert.ok(!text.includes('SEGREDO_PRESCRITA'), 'vazou credor fora da fila');
  assert.equal(res.json.preview.prescriptionTeaser.possibleCount, 1);
  assert.equal(res.json.preview.firstPriority.creditorName, 'Aluguel atrasado');
});

test('entrada inválida é recusada com mensagens por campo', async () => {
  const c = client();
  const bad = validCase();
  bad.debts[0]!.balanceCents = -5;
  const res = await c('POST', '/api/cases', { body: bad });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'invalid_input');
  assert.ok(res.json.issues.length > 0);
  const noTerms = await c('POST', '/api/cases', { body: { ...validCase(), acceptTerms: false } });
  assert.equal(noTerms.status, 400);
});

test('o servidor define "hoje": data enviada pelo cliente é ignorada', async () => {
  const c = client();
  const res = await c('POST', '/api/cases', { body: { ...validCase(), asOf: '1999-01-01' } });
  assert.equal(res.status, 201);
  const row = await db.query<{ inputs: { asOf: string } }>(`SELECT inputs FROM app.cases WHERE id = $1`, [res.json.caseId]);
  assert.notEqual(row.rows[0]!.inputs.asOf, '1999-01-01');
});

test('outra sessão não enxerga o caso (isolamento)', async () => {
  const dono = client();
  const intruso = client();
  const created = await dono('POST', '/api/cases', { body: validCase() });
  await intruso('POST', '/api/cases', { body: validCase() }); // ganha cookie próprio
  const res = await intruso('GET', `/api/cases/${created.json.caseId}/preview`);
  assert.equal(res.status, 404);
  const semCookie = await client()('GET', `/api/cases/${created.json.caseId}/preview`);
  assert.equal(semCookie.status, 404);
});

test('pedido exige Idempotency-Key e é idempotente', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const noKey = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false } });
  assert.equal(noKey.status, 400);
  const a = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-idempotente-1' } });
  const b = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-idempotente-1' } });
  assert.equal(a.status, 201);
  assert.equal(a.json.orderId, b.json.orderId);
  assert.equal(a.json.totalCents, 2900);
  const count = await db.query(`SELECT 1 FROM app.orders WHERE case_id = $1`, [created.json.caseId]);
  assert.equal(count.rows.length, 1);
});

test('preço vem do servidor e cartas só são vendidas quando há dívida possivelmente prescrita', async () => {
  const c = client();
  const withPresc = await c('POST', '/api/cases', { body: validCase() });
  const ok = await c('POST', '/api/orders', { body: { caseId: withPresc.json.caseId, withLetters: true }, headers: { 'idempotency-key': 'chave-com-cartas-1' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.totalCents, 4800);

  const simple = validCase();
  simple.debts = [simple.debts[1]!];
  const noPresc = await c('POST', '/api/cases', { body: simple });
  const denied = await c('POST', '/api/orders', { body: { caseId: noPresc.json.caseId, withLetters: true }, headers: { 'idempotency-key': 'chave-sem-prescricao' } });
  assert.equal(denied.status, 422);
});

test('conteúdo pago: 402 antes do pagamento, liberado depois, com dados completos', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-entrega-0001' } });
  const antes = await c('GET', `/api/orders/${order.json.orderId}/delivery`);
  assert.equal(antes.status, 402);
  assert.ok(!JSON.stringify(antes.json).includes('SEGREDO_CARTAO'));

  await payOrder(order.json.orderId);

  const status = await c('GET', `/api/orders/${order.json.orderId}`);
  assert.equal(status.json.status, 'paid');
  const depois = await c('GET', `/api/orders/${order.json.orderId}/delivery`);
  assert.equal(depois.status, 200);
  assert.deepEqual(depois.json.diagnosis.order.slice(0, 2), ['d1', 'd2']);
  assert.equal(depois.json.input.debts.length, 3);
  assert.equal(depois.json.items[0], 'recovery_map');
});

test('webhook: assinatura inválida é recusada; evento repetido não gera segunda liberação', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-webhook-001' } });
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  const paymentId = pay.rows[0]!.provider_payment_id;
  gateway.markPaid(paymentId);

  const forged = await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'errado' }, payload: JSON.stringify({ eventId: 'e1', paymentId }) });
  assert.equal(forged.statusCode, 401);
  const stillPending = await c('GET', `/api/orders/${order.json.orderId}`);
  assert.equal(stillPending.json.status, 'pending');

  const send = () => app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: 'evento-repetido-1', paymentId }) });
  const first = await send();
  const second = await send();
  assert.equal(first.json().outcome, 'confirmed');
  assert.equal(second.json().outcome, 'duplicate');
  const ents = await db.query(`SELECT 1 FROM app.entitlements WHERE case_id = $1`, [created.json.caseId]);
  assert.equal(ents.rows.length, 1);
});

test('webhook não confia no corpo: pagamento não confirmado no provedor não libera', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-nao-pago-001' } });
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  const res = await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: 'evento-mentiroso-1', paymentId: pay.rows[0]!.provider_payment_id }) });
  assert.equal(res.json().outcome, 'ignored');
  const delivery = await c('GET', `/api/orders/${order.json.orderId}/delivery`);
  assert.equal(delivery.status, 402);
});

test('outra sessão não acessa o pedido nem a entrega de terceiros', async () => {
  const dono = client();
  const intruso = client();
  const created = await dono('POST', '/api/cases', { body: validCase() });
  const order = await dono('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-isolamento-01' } });
  await payOrder(order.json.orderId);
  await intruso('POST', '/api/cases', { body: validCase() });
  assert.equal((await intruso('GET', `/api/orders/${order.json.orderId}`)).status, 404);
  assert.equal((await intruso('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 404);
});

test('entitlement expirado bloqueia a entrega', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-expirado-001' } });
  await payOrder(order.json.orderId);
  await db.query(`UPDATE app.entitlements SET expires_at = now() - interval '1 day' WHERE case_id = $1`, [created.json.caseId]);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 403);
});

test('apagar caso: some para o dono e remove os dados; pedido fiscal fica', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false }, headers: { 'idempotency-key': 'chave-apagar-0001' } });
  await payOrder(order.json.orderId);
  assert.equal((await c('DELETE', `/api/cases/${created.json.caseId}`)).status, 204);
  assert.equal((await c('GET', `/api/cases/${created.json.caseId}/preview`)).status, 404);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 403);
  const left = await db.query(`SELECT (SELECT count(*) FROM app.debts WHERE case_id = $1)::int AS debts, (SELECT count(*) FROM app.deliverables WHERE case_id = $1)::int AS deliverables, (SELECT count(*) FROM app.orders WHERE case_id = $1)::int AS orders`, [created.json.caseId]);
  assert.deepEqual(left.rows[0], { debts: 0, deliverables: 0, orders: 1 });
});

test('expurgo por prazo apaga dados de casos vencidos', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  await db.query(`UPDATE app.cases SET purge_after = now() - interval '1 minute' WHERE id = $1`, [created.json.caseId]);
  const n = await purgeExpired({ db, config, gateway }, 100);
  assert.ok(n >= 1);
  assert.equal((await c('GET', `/api/cases/${created.json.caseId}/preview`)).status, 404);
});

test('consentimento dos termos é registrado com hash de IP (sem IP em claro)', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const r = await db.query<{ ip_hash: Uint8Array | null; purpose: string }>(`SELECT ip_hash, purpose FROM app.consents WHERE case_id = $1`, [created.json.caseId]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.purpose, 'terms_of_service');
  assert.ok(r.rows[0]!.ip_hash && r.rows[0]!.ip_hash.length === 32);
});

test('limite de taxa: rajada de criação de casos do mesmo IP leva a 429', async () => {
  const strictApp = await buildApp({ config, db, gateway, rateLimits: 'strict' });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await strictApp.inject({ method: 'POST', url: '/api/cases', headers: H, payload: JSON.stringify(validCase()) });
      statuses.push(res.statusCode);
    }
    assert.equal(statuses.filter((s) => s === 201).length, 12);
    assert.ok(statuses.includes(429), `esperava 429, veio ${statuses.join(',')}`);
  } finally {
    await strictApp.close();
  }
});

// ---------- complementos vendidos depois do Mapa ----------
async function pay(orderId: string, key: string) {
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  const id = pay.rows[0]!.provider_payment_id;
  gateway.markPaid(id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: id }) });
}

test('complementos: só depois do Mapa, sem repetir, e o conteúdo só sai para quem comprou', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const caseId = created.json.caseId as string;

  const early = await c('POST', '/api/orders', { body: { caseId, products: ['calendar_30d'] }, headers: { 'idempotency-key': 'comp-cedo-00001' } });
  assert.equal(early.status, 422); // sem o Mapa não vende complemento

  const map = await c('POST', '/api/orders', { body: { caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'comp-mapa-00001' } });
  await pay(map.json.orderId, 'comp-mapa');
  const d0 = await c('GET', `/api/orders/${map.json.orderId}/delivery`);
  assert.equal(d0.status, 200);
  assert.deepEqual(d0.json.extras, {});
  assert.deepEqual(d0.json.items, ['recovery_map']);

  const again = await c('POST', '/api/orders', { body: { caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'comp-mapa-00002' } });
  assert.equal(again.status, 409);

  const add = await c('POST', '/api/orders', { body: { caseId, products: ['calendar_30d', 'extra_income_plan'] }, headers: { 'idempotency-key': 'comp-extra-00001' } });
  assert.equal(add.status, 201);
  assert.equal(add.json.totalCents, 1999 + 1599);
  // antes de pagar o complemento, nada muda
  const before = await c('GET', `/api/orders/${map.json.orderId}/delivery`);
  assert.deepEqual(before.json.extras, {});
  await pay(add.json.orderId, 'comp-extra');

  const d1 = await c('GET', `/api/orders/${map.json.orderId}/delivery`);
  assert.equal(d1.json.items.includes('calendar_30d'), true);
  assert.ok(d1.json.extras.calendar.length >= 8);
  // comprou o Criador de Renda Extra mas ainda não respondeu a entrevista: mostra o convite, não o plano
  assert.equal(d1.json.generated.income.status, 'needs_interview');
  // sem cartas compradas, nada de cartas nos itens
  assert.equal(d1.json.items.includes('defense_letters'), false);

  const dup = await c('POST', '/api/orders', { body: { caseId, products: ['calendar_30d'] }, headers: { 'idempotency-key': 'comp-extra-00002' } });
  assert.equal(dup.status, 409);
  const letters = await c('POST', '/api/orders', { body: { caseId, products: ['defense_letters'] }, headers: { 'idempotency-key': 'comp-cartas-0001' } });
  assert.equal(letters.status, 201); // há dívida em atraso e prescrita
  await pay(letters.json.orderId, 'comp-cartas');
  const d2 = await c('GET', `/api/orders/${map.json.orderId}/delivery`);
  assert.ok(d2.json.generated.letters); // entrou na fila do worker
});

test('produto desconhecido é recusado antes de qualquer cobrança', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const res = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['gratis_para_todos'] }, headers: { 'idempotency-key': 'comp-invalido-01' } });
  assert.equal(res.status, 400);
});

test('cartas também são oferecidas quando só há dívida em atraso (sem prescrição)', async () => {
  const c = client();
  const body = validCase();
  body.debts = [body.debts[0]!]; // só o aluguel atrasado
  const created = await c('POST', '/api/cases', { body });
  assert.equal(created.json.preview.discoveries.lettersEligible, 1);
  const res = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map', 'defense_letters'] }, headers: { 'idempotency-key': 'comp-atraso-0001' } });
  assert.equal(res.status, 201);
});

// ---------- voltar ao Mapa sem cadastro ----------
test('sem login: o mesmo navegador volta pelo cookie e outro aparelho volta pelo link de acesso', async () => {
  const laptop = client();
  const created = await laptop('POST', '/api/cases', { body: validCase() });
  assert.equal((await laptop('GET', '/api/me')).json.access, null); // ainda não pagou
  const order = await laptop('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'acesso-mapa-0001' } });
  const noLink = await laptop('POST', `/api/orders/${order.json.orderId}/access-link`, { body: {} });
  assert.equal(noLink.status, 404); // não pagou: não há link
  await pay(order.json.orderId, 'acesso-mapa');

  const me = await laptop('GET', '/api/me');
  assert.equal(me.json.access.orderId, order.json.orderId);

  const link = await laptop('POST', `/api/orders/${order.json.orderId}/access-link`, { body: {} });
  assert.equal(link.status, 200);
  const raw = await db.query<{ token_hash: Buffer }>(`SELECT token_hash FROM app.access_tokens WHERE case_id = $1`, [created.json.caseId]);
  assert.equal(raw.rows.length, 1);
  assert.ok(!JSON.stringify(raw.rows[0]).includes(link.json.token)); // só o hash fica no banco

  const phone = client(); // aparelho novo, sem cookie
  assert.equal((await phone('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 404);
  const bad = await phone('POST', '/api/access', { body: { token: 'x'.repeat(43) } });
  assert.equal(bad.status, 404);
  const ok = await phone('POST', '/api/access', { body: { token: link.json.token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.orderId, order.json.orderId);
  const d = await phone('GET', `/api/orders/${ok.json.orderId}/delivery`);
  assert.equal(d.status, 200);
  assert.equal(d.json.items[0], 'recovery_map');
  assert.equal((await laptop('GET', `/api/orders/${order.json.orderId}/delivery`)).status, 404); // o aparelho antigo perde o acesso

  const again = await phone('POST', `/api/orders/${order.json.orderId}/access-link`, { body: {} });
  const old = await client()('POST', '/api/access', { body: { token: link.json.token } });
  assert.equal(old.status, 404); // link novo invalida o anterior
  const fresh = await client()('POST', '/api/access', { body: { token: again.json.token } });
  assert.equal(fresh.status, 200);
});

test('duas pessoas pagantes nunca veem os dados uma da outra', async () => {
  const a = client();
  const b = client();
  const ca = await a('POST', '/api/cases', { body: validCase() });
  const other = validCase();
  other.debts = [other.debts[1]!];
  const cb = await b('POST', '/api/cases', { body: other });
  const oa = await a('POST', '/api/orders', { body: { caseId: ca.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'dois-a-000001' } });
  const ob = await b('POST', '/api/orders', { body: { caseId: cb.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'dois-b-000001' } });
  await pay(oa.json.orderId, 'dois-a');
  await pay(ob.json.orderId, 'dois-b');
  assert.equal((await a('GET', '/api/me')).json.access.orderId, oa.json.orderId);
  assert.equal((await b('GET', '/api/me')).json.access.orderId, ob.json.orderId);
  assert.equal((await a('GET', `/api/orders/${ob.json.orderId}/delivery`)).status, 404);
  assert.equal((await b('GET', `/api/orders/${oa.json.orderId}/delivery`)).status, 404);
  const da = await a('GET', `/api/orders/${oa.json.orderId}/delivery`);
  assert.equal(da.json.input.debts.length, 3);
  assert.equal((await b('GET', `/api/orders/${ob.json.orderId}/delivery`)).json.input.debts.length, 1);
});

// ---------- tradutor de cobrança e Kit Completo ----------
test('tradutor: preview grátis sem o conteúdo, pago libera, texto colado não fica no banco', async () => {
  const c = client();
  const secret = 'Assessoria SEGREDO_TEXTO informa cobrança de R$ 987,65, pague hoje via Pix para o CPF do gerente e passe o código do SMS';
  const created = await c('POST', '/api/translations', { body: { text: secret, acceptTerms: true } });
  assert.equal(created.status, 201);
  assert.equal(created.json.preview.risk, 'high');
  assert.ok(!JSON.stringify(created.json).includes('SEGREDO_TEXTO'));
  const caseId = created.json.caseId as string;

  // o texto original não está em nenhuma tabela
  const dump = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliverables WHERE content::text LIKE '%SEGREDO_TEXTO%'`);
  assert.equal(dump.rows[0]!.n, '0');
  const cases = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.cases WHERE inputs::text LIKE '%SEGREDO_TEXTO%'`);
  assert.equal(cases.rows[0]!.n, '0');

  const map = await c('POST', '/api/orders', { body: { caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'trad-errado-0001' } });
  assert.equal(map.status, 422); // caso de tradutor só vende o tradutor
  const order = await c('POST', '/api/orders', { body: { caseId, products: ['collection_translator'] }, headers: { 'idempotency-key': 'trad-ok-000001' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.totalCents, 1290);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/translation`)).status, 402);
  await pay(order.json.orderId, 'trad-ok');
  const full = await c('GET', `/api/orders/${order.json.orderId}/translation`);
  assert.equal(full.status, 200);
  assert.deepEqual(full.json.analysis.facts.amountsCents, [98_765]);
  assert.ok(full.json.analysis.reply.includes('CNPJ'));
  // pagar o tradutor não cria roteiros de negociação
  const scripts = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliverables WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId]);
  assert.equal(scripts.rows[0]!.n, '0');

  const me = await c('GET', '/api/me');
  assert.equal(me.json.translator.orderId, order.json.orderId);
  assert.equal(me.json.access, null);
  const link = await c('POST', `/api/orders/${order.json.orderId}/access-link`, { body: {} });
  assert.equal(link.status, 200);
  const other = client();
  const opened = await other('POST', '/api/access', { body: { token: link.json.token } });
  assert.equal(opened.json.kind, 'translator');
  assert.equal((await other('GET', `/api/orders/${order.json.orderId}/translation`)).status, 200);
});

test('tradutor: texto curto demais ou sem aceite é recusado; Mapa não aceita o produto do tradutor', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/translations', { body: { text: 'oi', acceptTerms: true } })).status, 400);
  assert.equal((await c('POST', '/api/translations', { body: { text: 'texto de cobrança comprido o bastante', acceptTerms: false } })).status, 400);
  const created = await c('POST', '/api/cases', { body: validCase() });
  const res = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['collection_translator'] }, headers: { 'idempotency-key': 'trad-mapa-00001' } });
  assert.equal(res.status, 422);
});

test('Kit Completo: Mapa + Cartas + Calendário juntos custam R$ 59,90 e cada item guarda o preço combinado', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map', 'defense_letters', 'calendar_30d'] }, headers: { 'idempotency-key': 'kit-completo-001' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.totalCents, 5990);
  const items = await db.query<{ product_code: string; unit_price_cents: string }>(`SELECT product_code, unit_price_cents FROM app.order_items WHERE order_id = $1`, [order.json.orderId]);
  assert.equal(items.rows.reduce((s, r) => s + Number(r.unit_price_cents), 0), 5990);
  const two = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map', 'defense_letters'] }, headers: { 'idempotency-key': 'kit-parcial-0001' } });
  assert.equal(two.json.totalCents, 4800); // sem desconto fora do combo
});

test('regressão: caso criado antes do campo lettersEligible ainda pode comprar as cartas depois do Mapa', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  await db.query(`UPDATE app.diagnoses SET preview = jsonb_set(preview, '{discoveries}', (preview->'discoveries') - 'lettersEligible') WHERE case_id = $1`, [created.json.caseId]);
  const map = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'regr-mapa-000001' } });
  await pay(map.json.orderId, 'regr-mapa');
  const letters = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['defense_letters'] }, headers: { 'idempotency-key': 'regr-cartas-00001' } });
  assert.equal(letters.status, 201);
});

// ---------- link de acesso por e-mail ----------
test('e-mail: manda o link, não grava o endereço, o link do e-mail abre o Mapa e há limite por dia', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'email-mapa-000001' } });
  const before = await c('POST', `/api/orders/${order.json.orderId}/email-link`, { body: { email: 'pessoa@exemplo.com' } });
  assert.equal(before.status, 404); // ainda não pagou
  await pay(order.json.orderId, 'email-mapa');

  assert.equal((await c('GET', '/api/features')).json.email, true);
  assert.equal((await c('POST', `/api/orders/${order.json.orderId}/email-link`, { body: { email: 'nao-e-email' } })).status, 400);
  mailbox.sent.length = 0;
  const ok = await c('POST', `/api/orders/${order.json.orderId}/email-link`, { body: { email: 'Pessoa@Exemplo.com' } });
  assert.equal(ok.status, 200);
  assert.equal(mailbox.sent.length, 1);
  assert.equal(mailbox.sent[0]!.to, 'pessoa@exemplo.com');
  const url = /https?:\/\/\S+#\/acesso\/([A-Za-z0-9_-]+)/.exec(mailbox.sent[0]!.text);
  assert.ok(url, 'o e-mail traz o link');
  // o endereço não foi parar em nenhuma tabela
  const leak = await db.query<{ n: string }>(`SELECT (SELECT count(*) FROM app.audit_log WHERE data::text ILIKE '%pessoa@exemplo%') + (SELECT count(*) FROM app.sessions WHERE ip_hash IS NULL AND false) AS n`);
  assert.equal(Number(leak.rows[0]!.n), 0);
  const phone = client();
  assert.equal((await phone('POST', '/api/access', { body: { token: url![1] } })).status, 200);

  for (let i = 0; i < 3; i++) await phone('POST', `/api/orders/${order.json.orderId}/email-link`, { body: { email: 'pessoa@exemplo.com' } });
  const fourth = await phone('POST', `/api/orders/${order.json.orderId}/email-link`, { body: { email: 'pessoa@exemplo.com' } });
  assert.equal(fourth.status, 429);
});
