import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { AsaasGateway } from '../src/gateway.ts';

const TOKEN = 'token-do-webhook-com-mais-de-trinta-e-dois-caracteres';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Provedor simulado com as formas de resposta descritas na documentação do Asaas. */
function fakeAsaas() {
  const calls: Call[] = [];
  const state = { payments: [] as Array<{ status: string; value: number }>, failNext: false, seq: 0 };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ method: init?.method ?? 'GET', url, headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (state.failNext) {
      state.failNext = false;
      throw new Error('rede caiu');
    }
    if (url.endsWith('/pix/qrCodes/static')) {
      state.seq += 1;
      return new Response(JSON.stringify({ id: `qr_${state.seq}`, payload: `00020126PAYLOAD${state.seq}`, allowsMultiplePayments: false }), { status: 200 });
    }
    if (url.includes('/payments?pixQrCodeId=')) return new Response(JSON.stringify({ object: 'list', data: state.payments }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { calls, state, fetchFn };
}

let db: Db;
let app: FastifyInstance;
let gateway: AsaasGateway;
let stub: ReturnType<typeof fakeAsaas>;

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  stub = fakeAsaas();
  gateway = new AsaasGateway({ apiKey: 'chave-secreta-da-api', baseUrl: 'https://api-sandbox.asaas.com/v3', pixKey: 'chave-pix-evp', webhookToken: TOKEN, fetchFn: stub.fetchFn });
  const config = { ...loadConfig({ NODE_ENV: 'test' }), paymentProvider: 'asaas' as const };
  app = await buildApp({ config, db, gateway, rateLimits: 'relaxed' });
});

after(async () => {
  await app.close();
  await db.close();
});

const validCase = () => ({
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão', kind: 'credit_card', balanceCents: 420_000, monthlyPaymentCents: 42_000, daysOverdue: 0 }],
  acceptTerms: true,
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers },
      payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
}

async function novoPedido(key: string) {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, withLetters: false, contact: { email: 'cliente@exemplo.com', phone: '11912345678', adsConsent: false } }, headers: { 'idempotency-key': key } });
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  return { c, order: order.json, qrId: pay.rows[0]!.provider_payment_id };
}

const webhook = (eventId: string, qrId: string, event = 'PAYMENT_RECEIVED', token = TOKEN) =>
  app.inject({
    method: 'POST',
    url: '/webhooks/pix',
    headers: { 'content-type': 'application/json', 'asaas-access-token': token },
    payload: JSON.stringify({ id: eventId, event, payment: { id: 'pay_1', pixQrCodeId: qrId, status: 'RECEIVED', value: 29 } }),
  });

test('cria o QR Pix estático de uso único, valor fixo e sem cliente/CPF', async () => {
  const { order } = await novoPedido('asaas-chave-0001');
  const call = stub.calls.filter((x) => x.url.endsWith('/pix/qrCodes/static')).at(-1)!;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://api-sandbox.asaas.com/v3/pix/qrCodes/static');
  assert.equal(call.headers.access_token, 'chave-secreta-da-api');
  assert.match(call.headers['User-Agent'] ?? '', /Folego/);
  const body = call.body as Record<string, unknown>;
  assert.equal(body.addressKey, 'chave-pix-evp');
  assert.equal(body.value, 29);
  assert.equal(body.allowsMultiplePayments, false);
  assert.equal(body.externalReference, order.orderId);
  assert.ok(!JSON.stringify(body).match(/cpf|customer/i), 'não pode pedir CPF nem cliente');
  assert.match(order.pixCode, /^00020126PAYLOAD/);
});

test('pagamento confirmado no Asaas com o valor certo libera o Mapa', async () => {
  const { c, order, qrId } = await novoPedido('asaas-chave-0002');
  stub.state.payments = [{ status: 'RECEIVED', value: 29 }];
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 402);
  const res = await webhook('evt-ok-1', qrId);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, 'confirmed');
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 200);
});

test('valor pago menor que o do pedido NÃO libera; quando o valor bate, a retentativa libera', async () => {
  const { c, order, qrId } = await novoPedido('asaas-chave-0003');
  stub.state.payments = [{ status: 'RECEIVED', value: 10 }];
  const first = await webhook('evt-valor-1', qrId);
  assert.equal(first.json().outcome, 'ignored');
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 402);
  stub.state.payments = [{ status: 'RECEIVED', value: 29 }];
  const retry = await webhook('evt-valor-1', qrId); // mesmo evento reenviado pelo provedor
  assert.equal(retry.json().outcome, 'confirmed');
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 200);
});

test('provedor fora do ar durante o webhook: responde erro (o Asaas reenvia) e a retentativa funciona', async () => {
  const { c, order, qrId } = await novoPedido('asaas-chave-0004');
  stub.state.payments = [{ status: 'CONFIRMED', value: 29 }];
  stub.state.failNext = true;
  const down = await webhook('evt-queda-1', qrId);
  assert.equal(down.statusCode, 502);
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 402);
  const again = await webhook('evt-queda-1', qrId);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().outcome, 'confirmed');
  assert.equal((await c('GET', `/api/orders/${order.orderId}/delivery`)).status, 200);
});

test('evento repetido depois de resolvido é duplicata', async () => {
  const { qrId } = await novoPedido('asaas-chave-0005');
  stub.state.payments = [{ status: 'RECEIVED', value: 29 }];
  assert.equal((await webhook('evt-dup-1', qrId)).json().outcome, 'confirmed');
  assert.equal((await webhook('evt-dup-1', qrId)).json().outcome, 'duplicate');
});

test('token do webhook errado é recusado e eventos irrelevantes são ignorados com 200', async () => {
  const { qrId } = await novoPedido('asaas-chave-0006');
  assert.equal((await webhook('evt-x', qrId, 'PAYMENT_RECEIVED', 'token-errado')).statusCode, 401);
  const other = await webhook('evt-y', qrId, 'PAYMENT_CREATED');
  assert.equal(other.statusCode, 200);
  assert.equal(other.json().outcome, 'ignored');
});

test('erro do provedor ao criar o Pix vira 502 sem vazar detalhes', async () => {
  const c = client();
  const created = await c('POST', '/api/cases', { body: validCase() });
  const broken = new AsaasGateway({ apiKey: 'k', baseUrl: 'https://x.test/v3', pixKey: 'p', webhookToken: TOKEN, fetchFn: (async () => new Response(JSON.stringify({ errors: [{ description: 'CHAVE-INTERNA-SECRETA' }] }), { status: 400 })) as typeof fetch });
  const config = { ...loadConfig({ NODE_ENV: 'test' }), paymentProvider: 'asaas' as const };
  const app2 = await buildApp({ config, db, gateway: broken, rateLimits: 'relaxed' });
  try {
    const cookieRes = await app2.inject({ method: 'POST', url: '/api/cases', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: JSON.stringify(validCase()) });
    const cookie = String(cookieRes.headers['set-cookie']).split(';')[0]!;
    const caseId = JSON.parse(cookieRes.body).caseId;
    const res = await app2.inject({ method: 'POST', url: '/api/orders', headers: { 'x-folego': '1', 'content-type': 'application/json', cookie, 'idempotency-key': 'asaas-erro-0001' }, payload: JSON.stringify({ contact: { email: 'cliente@exemplo.com', phone: '11912345678', adsConsent: false }, caseId, withLetters: false }) });
    assert.equal(res.statusCode, 502);
    assert.ok(!res.body.includes('CHAVE-INTERNA-SECRETA'));
    const orphan = await db.query(`SELECT 1 FROM app.orders WHERE idempotency_key = 'asaas-erro-0001'`);
    assert.equal(orphan.rows.length, 0, 'pedido não pode ficar órfão quando o Pix falha');
  } finally {
    await app2.close();
  }
  assert.ok(created.json.caseId);
});

test('configuração: produção não aceita o provedor de mentira sem autorização; Asaas exige variáveis', () => {
  const base = { NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h/db' };
  assert.throws(() => loadConfig({ ...base }), /fake/);
  assert.doesNotThrow(() => loadConfig({ ...base, ALLOW_FAKE_GATEWAY_IN_PRODUCTION: '1', WEBHOOK_SECRET: 'w'.repeat(30) }));
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'asaas' }), /ASAAS_API_KEY/);
  assert.throws(() => loadConfig({ ...base, PAYMENT_PROVIDER: 'asaas', ASAAS_API_KEY: 'a', ASAAS_PIX_KEY: 'b', ASAAS_WEBHOOK_TOKEN: 'curto' }), /32/);
  const ok = loadConfig({ ...base, PAYMENT_PROVIDER: 'asaas', ASAAS_API_KEY: 'a', ASAAS_PIX_KEY: 'b', ASAAS_WEBHOOK_TOKEN: 't'.repeat(40) });
  assert.equal(ok.asaas?.baseUrl, 'https://api.asaas.com/v3');
});
