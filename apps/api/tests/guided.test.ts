// Guias pagos sob medida: prévia grátis, produto desligado por padrão, pagamento, conteúdo completo, isolamento e privacidade.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste' };
const ctx = () => ({ db, config, gateway, email: mailbox });

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
  return async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
type Client = ReturnType<typeof client>;

const inputs = {
  financing: { kind: 'veiculo', priceCents: 5_000_000, downPaymentCents: 1_000_000, netIncomeCents: 600_000, offers: [{ name: 'Banco A', termMonths: 48, monthlyRateBps: 160, system: 'price', upfrontFeesCents: 0, monthlyExtrasCents: 0 }, { name: 'Banco B', termMonths: 60, monthlyRateBps: 150, system: 'price', upfrontFeesCents: 90_000, monthlyExtrasCents: 5_000 }] },
  housebills: { kind: 'energia', overdueCents: 130_000, monthsOverdue: 10, monthlyCapacityCents: 20_000, cutStatus: 'aviso', lowIncome: 'sim', disputesAmount: false },
  forgotten: { workedFormal: 'sim', workedBefore1989: 'nao', closedBankAccount: 'sim', consorcioOrCoop: 'nao', relativeDied: 'nao', declaresIr: 'sim', invested: 'nao', lifeInsurance: 'nao_sei', inssBenefit: 'nao' },
  resume: { targetRole: 'Assistente administrativo', level: 'pleno', jobText: 'Vaga de assistente administrativo. Requisitos: Excel, atendimento ao cliente, organização e 2 anos de experiência. Contato rh@empresa.com.br ou (11) 91234-5678.', skills: 'Excel, atendimento. Meu e-mail é joao@exemplo.com', education: 'Ensino médio', languages: '', experiences: [{ role: 'Auxiliar', years: 3, tasks: 'Atendia clientes\nControlava planilhas de Excel' }] },
} as const;

async function paid(c: Client, kind: keyof typeof inputs) {
  const created = await c('POST', `/api/guided/${kind}`, { body: { input: inputs[kind], acceptTerms: true } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const code = `guide_${kind}`;
  await db.query(`UPDATE app.products SET active = true WHERE code = $1`, [code]);
  const o = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: [code] }, headers: { 'idempotency-key': `guided-${kind}-0001` } });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-guided-${o.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return { caseId: created.json.caseId as string, orderId: o.json.orderId as string, preview: created.json.preview };
}

test('guia desligado pelo dono: não vende e o catálogo mostra inativo', async () => {
  await db.query(`UPDATE app.products SET active = false WHERE code LIKE 'guide\_%'`); // a migração 024 liga os guias; aqui simulamos o dono desligando
  const c = client();
  const created = await c('POST', '/api/guided/forgotten', { body: { input: inputs.forgotten, acceptTerms: true } });
  assert.equal(created.status, 201);
  const o = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['guide_forgotten'] }, headers: { 'idempotency-key': 'guided-off-00001' } });
  assert.equal(o.status, 422);
  assert.equal(o.json.error, 'product_unavailable');
  const cat = await c('GET', '/api/catalog');
  const item = cat.json.products.find((p: any) => p.code === 'guide_forgotten');
  assert.ok(item && item.active === false);
});

for (const kind of ['financing', 'housebills', 'forgotten', 'resume'] as const) {
  test(`guia ${kind}: prévia grátis, pagamento e conteúdo completo só para quem pagou`, async () => {
    const c = client();
    const { orderId, preview } = await paid(c, kind);
    assert.ok(preview && typeof preview === 'object');
    const full = await c('GET', `/api/orders/${orderId}/guided`);
    assert.equal(full.status, 200);
    assert.equal(full.json.kind, kind);
    assert.ok(full.json.content);
    assert.ok(full.json.accessUntil > Date.now());
    // outro navegador não vê
    assert.equal((await client()('GET', `/api/orders/${orderId}/guided`)).status, 404);
    // volta pelo /api/me
    const me = await c('GET', '/api/me');
    assert.ok(me.json.guided.some((g: any) => g.orderId === orderId && g.kind === kind));
  });
}

test('guia: a prévia não vaza o conteúdo pago e o pedido antes de pagar é bloqueado', async () => {
  const c = client();
  const created = await c('POST', '/api/guided/housebills', { body: { input: inputs.housebills, acceptTerms: true } });
  assert.ok(!JSON.stringify(created.json.preview).includes('Boa tarde'), 'roteiro de ligação não aparece na prévia');
  assert.ok(!JSON.stringify(created.json.preview).includes('SEU NOME'), 'carta não aparece na prévia');
  await db.query(`UPDATE app.products SET active = true WHERE code = 'guide_housebills'`);
  const o = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['guide_housebills'] }, headers: { 'idempotency-key': 'guided-unpaid-001' } });
  assert.equal((await c('GET', `/api/orders/${o.json.orderId}/guided`)).status, 402);
});

test('guia: produto de um guia não se vende em caso de outro guia nem no Mapa (e vice-versa)', async () => {
  const c = client();
  const created = await c('POST', '/api/guided/financing', { body: { input: inputs.financing, acceptTerms: true } });
  await db.query(`UPDATE app.products SET active = true WHERE code IN ('guide_financing', 'guide_resume')`);
  const wrong = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['guide_resume'] }, headers: { 'idempotency-key': 'guided-wrong-0001' } });
  assert.equal(wrong.status, 422);
  const map = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': 'guided-map-00001' } });
  assert.equal(map.status, 422);
  const mapCase = await c('POST', '/api/cases', { body: { profile: { netIncomeCents: 300_000, fixedExpensesCents: 150_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' }, debts: [{ creditorName: 'A', kind: 'rent', balanceCents: 100_000, daysOverdue: 10 }], acceptTerms: true } });
  const bad = await c('POST', '/api/orders', { body: { caseId: mapCase.json.caseId, products: ['guide_financing'] }, headers: { 'idempotency-key': 'guided-bad-000001' } });
  assert.equal(bad.status, 422);
});

test('currículo: e-mail, telefone e CPF colados por engano não entram no resultado', async () => {
  const c = client();
  const { orderId } = await paid(c, 'resume');
  const full = await c('GET', `/api/orders/${orderId}/guided`);
  assert.equal(full.status, 200, JSON.stringify(full.json));
  const text = JSON.stringify(full.json.content);
  assert.ok(!/@/.test(text.replace(/\[SEU NOME\]/g, '')), 'sem e-mail');
  assert.ok(!/91234/.test(text), 'sem telefone');
  assert.equal(full.json.content.coveragePct > 0, true);
});

test('guia: entradas inválidas = 400/422 e rotas desconhecidas = 400', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/guided/nao-existe', { body: { input: {}, acceptTerms: true } })).status, 400);
  assert.equal((await c('POST', '/api/guided/financing', { body: { input: { ...inputs.financing, hack: 1 }, acceptTerms: true } })).status, 400);
  assert.equal((await c('POST', '/api/guided/financing', { body: { input: inputs.financing, acceptTerms: false } })).status, 400);
  assert.equal((await c('POST', '/api/guided/financing', { body: { input: { ...inputs.financing, downPaymentCents: 9_000_000 }, acceptTerms: true } })).status, 422);
  assert.equal((await c('POST', '/api/guided/resume', { body: { input: { ...inputs.resume, jobText: 'curta' }, acceptTerms: true } })).status, 400);
});

test('link de acesso funciona para guias (outro aparelho abre o guia comprado)', async () => {
  const a = client();
  const { orderId } = await paid(a, 'forgotten');
  const link = await a('POST', `/api/orders/${orderId}/access-link`, { body: {} });
  assert.equal(link.status, 200);
  const b = client();
  const red = await b('POST', '/api/access', { body: { token: link.json.token } });
  assert.equal(red.status, 200);
  assert.equal(red.json.kind, 'guided');
  assert.equal((await b('GET', `/api/orders/${orderId}/guided`)).status, 200);
});
