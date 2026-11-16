// Mapa da Virada grátis para todos (interruptor do backoffice): sem Pix, 30 dias, com e-mail e celular; banner de parceiro no topo e no fim.
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
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };

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
  return async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
const caseBody = {
  profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }],
  acceptTerms: true,
};
const contact = { email: 'visitante@exemplo.com', phone: '(34) 99837-5296', adsConsent: false };

test('com o interruptor desligado, o Mapa continua pago no Pix', async () => {
  config.mapFree = false;
  assert.equal((await client()('GET', '/api/catalog')).json.mapFree, false);
  const c = client();
  const created = await c('POST', '/api/cases', caseBody);
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'], contact }, { 'idempotency-key': 'gratis-off-0001' });
  assert.equal(order.status, 201);
  assert.equal(order.json.status, 'pending');
  assert.ok(order.json.totalCents > 0);
});

test('Mapa grátis: exige e-mail e celular, abre na hora por 30 dias, sem cobrança e sem evento de venda', async () => {
  config.mapFree = true;
  assert.equal((await client()('GET', '/api/catalog')).json.mapFree, true);
  const c = client();
  const created = await c('POST', '/api/cases', caseBody);
  const caseId = created.json.caseId;

  const semContato = await c('POST', '/api/orders', { caseId, products: ['recovery_map'] }, { 'idempotency-key': 'gratis-on-0001' });
  assert.equal(semContato.status, 422);
  assert.equal(semContato.json.error, 'contact_required');

  const order = await c('POST', '/api/orders', { caseId, products: ['recovery_map'], contact }, { 'idempotency-key': 'gratis-on-0002' });
  assert.equal(order.status, 201);
  assert.equal(order.json.status, 'paid');
  assert.equal(order.json.totalCents, 0);
  const pay = await db.query<{ provider: string; amount_cents: string }>(`SELECT provider, amount_cents::text FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  assert.deepEqual(pay.rows.map((r) => [r.provider, r.amount_cents]), [['free', '0']]);

  const delivery = await c('GET', `/api/orders/${order.json.orderId}/delivery`);
  assert.equal(delivery.status, 200);
  const days = (delivery.json.accessUntil - Date.now()) / 86_400_000;
  assert.ok(days > 29.5 && days <= 30.01, `30 dias de acesso (veio ${days.toFixed(2)})`);
  assert.equal(delivery.json.banner, null, 'sem parceiro com banner, nada aparece');

  // o contato ficou guardado cifrado no caso (é o que permite enviar o acesso)
  const row = await db.query<{ contact_email_enc: Buffer }>(`SELECT contact_email_enc FROM app.cases WHERE id = $1`, [caseId]);
  assert.ok(row.rows[0]!.contact_email_enc && !row.rows[0]!.contact_email_enc.includes(Buffer.from('visitante@')), 'e-mail cifrado');
  // quem já tem o Mapa não gera outro pedido do mesmo diagnóstico
  assert.equal((await c('POST', '/api/orders', { caseId, products: ['recovery_map'], contact }, { 'idempotency-key': 'gratis-on-0003' })).status, 409);
});

test('banner do parceiro: só campanha ativa, parceiro ativo e banner ligado; link sempre https', async () => {
  config.mapFree = true;
  const p = await db.query<{ id: string }>(`INSERT INTO app.partners(legal_name, cnpj, category, status, trade_name) VALUES ('Banco Exemplo SA','11222333000181','consignado','active','Banco Exemplo') RETURNING id`);
  const partnerId = p.rows[0]!.id;
  const camp = await db.query<{ id: string }>(
    `INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, employment_types, ufs, price_per_lead_cents, commission_bps, daily_cap, banner_on, banner_title, banner_text, banner_cta, banner_url)
     VALUES ($1,'Campanha teste','active','consignado',ARRAY['clt']::text[],ARRAY['SP']::char(2)[],1000,0,10,true,'Compare propostas','Veja as condições do parceiro antes de decidir.','Ver condições','https://parceiro.exemplo.com/oferta?utm=folego') RETURNING id`,
    [partnerId],
  );
  await assert.rejects(db.query(`UPDATE app.partner_campaigns SET banner_url = 'http://inseguro.exemplo.com' WHERE id = $1`, [camp.rows[0]!.id]), 'link sem https é recusado pelo banco');

  const c = client();
  const created = await c('POST', '/api/cases', { ...caseBody, debts: [{ ...caseBody.debts[0], creditorName: 'Banco Y' }] });
  const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'], contact: { ...contact, email: 'outra@exemplo.com' } }, { 'idempotency-key': 'gratis-banner-1' });
  const withBanner = (await c('GET', `/api/orders/${order.json.orderId}/delivery`)).json.banner;
  assert.equal(withBanner.title, 'Compare propostas');
  assert.equal(withBanner.partner, 'Banco Exemplo');
  assert.equal(withBanner.url, 'https://parceiro.exemplo.com/oferta?utm=folego');
  assert.ok(!JSON.stringify(withBanner).includes('outra@exemplo.com'), 'o banner não leva dado da pessoa');

  await db.query(`UPDATE app.partner_campaigns SET banner_on = false WHERE id = $1`, [camp.rows[0]!.id]);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).json.banner, null, 'banner desligado não aparece');
  await db.query(`UPDATE app.partner_campaigns SET banner_on = true WHERE id = $1`, [camp.rows[0]!.id]);
  await db.query(`UPDATE app.partners SET status = 'suspended' WHERE id = $1`, [partnerId]);
  assert.equal((await c('GET', `/api/orders/${order.json.orderId}/delivery`)).json.banner, null, 'parceiro suspenso não aparece');
});

test('Ousado também recebe o Mapa grátis quando o interruptor está ligado (sem o preço especial)', async () => {
  const { handleWebhook } = await import('../src/services.ts');
  const gw = new FakeGateway(config.webhookSecret);
  const app2 = await buildApp({ config, db, gateway: gw, email: mailbox, rateLimits: 'relaxed' });
  try {
    let cookie = '';
    const c = async (method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app2.inject({ method, url, headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers['set-cookie'];
      const raw = Array.isArray(set) ? set[0] : set;
      if (raw) cookie = raw.split(';')[0]!;
      let json: any = null;
      try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
      return { status: res.statusCode, json };
    };
    mailbox.sent.length = 0;
    await c('POST', '/api/account/login-code', { email: 'ousado-gratis@exemplo.com' });
    await c('POST', '/api/account/login', { email: 'ousado-gratis@exemplo.com', code: /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1] });
    const co = await c('POST', '/api/account/subscription-checkout', { plan: 'ousado', acceptTerms: true });
    const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
    gw.markPaid(p.rows[0]!.provider_payment_id);
    await handleWebhook({ db, config, gateway: gw, email: mailbox }, { 'x-webhook-secret': config.webhookSecret }, { eventId: 'evt-ousado-gratis', paymentId: p.rows[0]!.provider_payment_id });

    config.mapFree = true;
    assert.equal((await c('GET', '/api/account/map-offer')).json.eligible, false, 'sem oferta especial: vale o fluxo grátis de todos');
    const created = await c('POST', '/api/cases', caseBody);
    const order = await c('POST', '/api/orders', { caseId: created.json.caseId, products: ['recovery_map'], contact: { ...contact, email: 'ousado-gratis@exemplo.com' } }, { 'idempotency-key': 'gratis-ousado-1' });
    assert.equal(order.json.status, 'paid');
    assert.equal(order.json.totalCents, 0);
    config.mapFree = false;
    assert.equal((await c('GET', '/api/account/map-offer')).json.priceCents, config.subscriberMapPriceCents, 'desligado, o preço especial do Ousado volta');
  } finally {
    await app2.close();
  }
});
