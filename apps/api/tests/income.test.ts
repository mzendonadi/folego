import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { diagnose, buildIncomeFacts } from '../src/engine.ts';
import type { DebtInput, IncomeFacts } from '../src/engine.ts';
import { buildIncomeUserPayload, AnthropicIncomeGenerator } from '../src/generation/income-ai.ts';
import type { IncomeAiResult, IncomePlanGenerator } from '../src/generation/income-ai.ts';
import { checkIncomeText } from '../src/generation/guardrails.ts';
import { assembleIncomePlan } from '../src/generation/income-templates.ts';
import { processNext } from '../src/generation/worker.ts';
import type { IncomePlanCore } from '../src/generation/income-schema.ts';

const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste' };
let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const ctx = () => ({ db, config, gateway });

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

const debts: DebtInput[] = [{ id: 'd1', creditorName: 'SEGREDO_CARTAO', kind: 'credit_card', balanceCents: 300_000, monthlyPaymentCents: 30_000, monthlyRateBps: 900, daysOverdue: 0 }];
const profile = { netIncomeCents: 300_000, fixedExpensesCents: 250_000, employmentType: 'self_employed' as const, ageBand: '35-44', uf: 'SP' };
const diagnosis = diagnose({ asOf: '2026-09-27', profile, debts });
const interview = { skills: 'Sei fazer doces e organizar festas de aniversário', hoursBand: '10_20h' as const, capitalCents: 30_000, hasVehicle: false, mode: 'tanto_faz' as const, priorAttempts: '' };
const facts: IncomeFacts = buildIncomeFacts(diagnosis, profile, interview);

// ---------- fatos e privacidade ----------
test('o texto enviado à IA leva as habilidades da pessoa, mas nunca nome, telefone ou e-mail', () => {
  const payload = buildIncomeUserPayload(facts);
  assert.ok(payload.includes('doces'));
  assert.ok(!/telefone|@|cpf/i.test(payload));
  assert.ok(payload.includes('R$'));
});

test('projeção mensal e faixa de referência só existem para categorias por hora, e crescem com mais horas', () => {
  const factsPouco = buildIncomeFacts(diagnosis, profile, { ...interview, hoursBand: 'ate_5h' });
  const factsMuito = buildIncomeFacts(diagnosis, profile, { ...interview, hoursBand: 'mais_20h' });
  assert.ok(factsMuito.projectedByCategory.servico!.lowCents > factsPouco.projectedByCategory.servico!.lowCents);
  assert.equal(factsPouco.projectedByCategory.venda_usados, undefined); // margem, não por hora
});

// ---------- verificador ----------
const goodCore = (): IncomePlanCore => ({
  ideaId: facts.candidates[0]!.id,
  openingNote: 'Você contou que sabe fazer doces e organizar festas — dá pra transformar isso em uma renda extra real.',
  personalizedWhy: 'Encomendas de doces combinam com o tempo que você tem e com o que você já sabe fazer.',
  weekNotes: ['Comece por um sabor que você já domina.', 'Peça pra quem experimentou indicar mais gente.', 'Anote o que mais pediram.', 'Veja se o ritmo cabe na sua semana.'],
  encouragement: 'Vai com calma: o primeiro mês é para testar, não para virar sua renda principal.',
});

test('verificador aprova o modelo determinístico', () => {
  const template = assembleIncomePlan(null, facts, 'template');
  assert.equal(checkIncomeText({ ideaId: facts.candidates[0]!.id, openingNote: 'x'.repeat(25), personalizedWhy: template.idea.why, weekNotes: template.weeks.map((w) => w.tasks[0]!), encouragement: 'y'.repeat(15) }, facts).length, 0);
});

test('verificador rejeita ideaId inválido, valor inventado, plataforma não autorizada e promessa de ficar rico', () => {
  const inject = (patch: (c: IncomePlanCore) => void) => {
    const c = goodCore();
    patch(c);
    return checkIncomeText(c, facts).join(' | ');
  };
  assert.match(inject((c) => (c.ideaId = 'ideia-que-nao-existe')), /ideaId deve ser uma/);
  assert.match(inject((c) => (c.personalizedWhy = 'Você pode ganhar R$ 999,00 por semana fácil.')), /Valor não autorizado/);
  assert.match(inject((c) => (c.openingNote = 'Anuncie tudo no Shopee, que é ótimo pra isso.')), /Plataforma não autorizada/);
  assert.match(inject((c) => (c.encouragement = 'Com isso você vai ficar rico rapidinho.')), /ficar rico/);
  assert.match(inject((c) => (c.weekNotes = ['só uma nota'])), /weekNotes precisa ter exatamente 4/);
});

// ---------- cliente do Claude ----------
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ url: String(input), headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return { calls, fn };
}
const toolUse = (input: unknown) => new Response(JSON.stringify({ id: 'msg_1', type: 'message', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'toolu_1', name: 'entregar_plano_de_renda_extra', input }], usage: { input_tokens: 700, output_tokens: 300 } }), { status: 200 });

test('cliente do Claude: ferramenta obrigatória, sem dado pessoal, resposta validada', async () => {
  const stub = stubFetch(() => toolUse(goodCore()));
  const gen = new AnthropicIncomeGenerator({ apiKey: 'sk-teste', model: 'claude-sonnet-5', fetchFn: stub.fn });
  const r = await gen.generate(facts, []);
  const call = stub.calls[0]!;
  assert.deepEqual(call.body.tool_choice, { type: 'tool', name: 'entregar_plano_de_renda_extra' });
  assert.ok(!JSON.stringify(call.body).includes('SEGREDO'));
  assert.equal(r.core.ideaId, facts.candidates[0]!.id);
});

test('feedback do verificador é reenviado na segunda tentativa', async () => {
  const stub = stubFetch(() => toolUse(goodCore()));
  await new AnthropicIncomeGenerator({ apiKey: 'k', model: 'm', fetchFn: stub.fn }).generate(facts, ['Plataforma não autorizada: "Shopee".']);
  assert.match(stub.calls[0]!.body.messages[0].content, /REPROVADA[\s\S]*Shopee/);
});

// ---------- ponta a ponta ----------
const H = { 'x-folego': '1', 'content-type': 'application/json' };
async function paidMapPlusIncome(key: string) {
  let cookie = '';
  const call = async (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, extraHeaders?: Record<string, string>) => {
    const res = await app.inject({ method, url, headers: { ...(body === undefined ? { 'x-folego': '1' } : H), ...(cookie ? { cookie } : {}), ...extraHeaders }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const created = await call('POST', '/api/cases', { profile, debts: debts.map(({ id, ...d }) => d), acceptTerms: true });
  const caseId = created.json.caseId as string;
  const map = await call('POST', '/api/orders', { caseId, products: ['recovery_map'] }, { 'idempotency-key': `${key}-mapa-pedido` });
  const payOrder = async (orderId: string, evt: string) => {
    const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
    gateway.markPaid(pay.rows[0]!.provider_payment_id);
    await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: evt, paymentId: pay.rows[0]!.provider_payment_id }) });
  };
  await payOrder(map.json.orderId, `${key}-mapa`);
  const income = await call('POST', '/api/orders', { caseId, products: ['extra_income_plan'] }, { 'idempotency-key': `${key}-income-pedido` });
  await payOrder(income.json.orderId, `${key}-income`);
  return { call, caseId, mapOrderId: map.json.orderId as string };
}

const noAi = { generator: null, incomeGenerator: null, maxAiCallsPerDay: 100 };
const goodInterviewBody = { skills: 'Sei fazer doces e organizar festas de aniversário', hoursBand: '10_20h', capitalCents: 30_000, hasVehicle: false, mode: 'tanto_faz', priorAttempts: '', name: 'Maria da Silva', phone: '11987654321', email: 'maria@exemplo.com', wantsPartnerContact: false };

test('sem entrevista: aparece "needs_interview"; entrevista dispara a fila; sem IA entrega o modelo determinístico', async () => {
  const { call, caseId, mapOrderId } = await paidMapPlusIncome('inc-fluxo');
  const before = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(before.json.generated.income.status, 'needs_interview');

  const submit = await call('POST', `/api/cases/${caseId}/income-interview`, goodInterviewBody);
  assert.equal(submit.status, 202);

  const pending = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(pending.json.generated.income.status, 'pending');

  while (await processNext(ctx(), noAi)) { /* drena a fila: a compra do Mapa também gera os roteiros de negociação */ }
  const ready = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(ready.json.generated.income.status, 'ready');
  assert.equal(ready.json.generated.income.source, 'template');
  assert.equal(ready.json.generated.income.content.weeks.length, 4);
  assert.deepEqual(ready.json.generated.income.progress, {});

  // contato ficou criptografado, nunca em texto puro
  const raw = await db.query<{ full_name_enc: Buffer }>(`SELECT full_name_enc FROM app.lead_contacts WHERE case_id = $1`, [caseId]);
  assert.ok(!Buffer.from(raw.rows[0]!.full_name_enc).toString('utf8').includes('Maria'));
  // sem marcar a caixa de parceiros, não gera consentimento de compartilhamento
  const consents = await db.query(`SELECT 1 FROM app.consents WHERE case_id = $1 AND purpose = 'lead_sharing'`, [caseId]);
  assert.equal(consents.rows.length, 0);
});

test('marcar a caixa de parceiros gera consentimento específico da categoria empreendedorismo', async () => {
  const { call, caseId } = await paidMapPlusIncome('inc-consent');
  await call('POST', `/api/cases/${caseId}/income-interview`, { ...goodInterviewBody, wantsPartnerContact: true });
  const consents = await db.query<{ scope: { categories: string[] } }>(`SELECT scope FROM app.consents WHERE case_id = $1 AND purpose = 'lead_sharing'`, [caseId]);
  assert.equal(consents.rows.length, 1);
  assert.deepEqual(consents.rows[0]!.scope.categories, ['empreendedorismo']);
});

test('sem ter comprado o produto, a entrevista é recusada', async () => {
  let cookie = '';
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: { ...(body === undefined ? { 'x-folego': '1' } : H), ...(cookie ? { cookie } : {}) }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const created = await call('POST', '/api/cases', { profile, debts: debts.map(({ id, ...d }) => d), acceptTerms: true });
  const res = await call('POST', `/api/cases/${created.json.caseId}/income-interview`, goodInterviewBody);
  assert.equal(res.status, 403);
});

test('IA válida é usada; IA reprovada cai no modelo; reenviar a entrevista refaz o plano do zero', async () => {
  const { call, caseId, mapOrderId } = await paidMapPlusIncome('inc-ia');
  await call('POST', `/api/cases/${caseId}/income-interview`, goodInterviewBody);

  const validAi: IncomePlanGenerator = { name: 'stub', generate: async (f): Promise<IncomeAiResult> => ({ core: { ...goodCore(), ideaId: f.candidates[0]!.id }, model: 'stub-model', inputTokens: 5, outputTokens: 5 }) };
  while (await processNext(ctx(), { generator: null, incomeGenerator: validAi, maxAiCallsPerDay: 100 })) { /* drena a fila: a compra do Mapa também gera os roteiros de negociação */ }
  const withAi = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(withAi.json.generated.income.source, 'ai');
  assert.equal(withAi.json.generated.income.content.openingNote, goodCore().openingNote);

  // reenviar a entrevista some com o plano antigo e refaz do zero
  await call('POST', `/api/cases/${caseId}/income-interview`, { ...goodInterviewBody, skills: 'Agora sei consertar bicicletas' });
  const afterResubmit = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(afterResubmit.json.generated.income.status, 'pending');

  const badAi: IncomePlanGenerator = { name: 'ruim', generate: async (f) => ({ core: { ...goodCore(), ideaId: f.candidates[0]!.id, openingNote: 'Anuncie no Shopee agora mesmo, é fácil.' }, model: 'm', inputTokens: 1, outputTokens: 1 }) };
  while (await processNext(ctx(), { generator: null, incomeGenerator: badAi, maxAiCallsPerDay: 100 })) { /* fila */ }
  const s = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.equal(s.json.generated.income.source, 'template');
});

test('progresso: só depois de pronto, chave inválida é recusada, e o estado persiste na entrega', async () => {
  const { call, caseId, mapOrderId } = await paidMapPlusIncome('inc-progress');
  await call('POST', `/api/cases/${caseId}/income-interview`, goodInterviewBody);
  const tooSoon = await call('POST', `/api/cases/${caseId}/income-progress`, { key: 'w1t0', done: true });
  assert.equal(tooSoon.status, 404);

  while (await processNext(ctx(), noAi)) { /* fila */ }
  const bad = await call('POST', `/api/cases/${caseId}/income-progress`, { key: 'semana-1', done: true });
  assert.equal(bad.status, 422);
  const ok = await call('POST', `/api/cases/${caseId}/income-progress`, { key: 'w1t0', done: true });
  assert.equal(ok.status, 200);
  const d = await call('GET', `/api/orders/${mapOrderId}/delivery`);
  assert.deepEqual(d.json.generated.income.progress, { w1t0: true });
});

test('cabeçalho do workspace da Anthropic só é enviado quando configurado', async () => {
  const withWs = stubFetch(() => toolUse(goodCore()));
  await new AnthropicIncomeGenerator({ apiKey: 'k', model: 'm', workspaceId: 'wrkspc_teste', fetchFn: withWs.fn }).generate(facts, []);
  assert.equal(withWs.calls[0]!.headers['anthropic-workspace-id'], 'wrkspc_teste');
  const without = stubFetch(() => toolUse(goodCore()));
  await new AnthropicIncomeGenerator({ apiKey: 'k', model: 'm', fetchFn: without.fn }).generate(facts, []);
  assert.equal(without.calls[0]!.headers['anthropic-workspace-id'], undefined);
});

test('o pedido ao Claude não envia "temperature" (descontinuado nos modelos novos)', async () => {
  const stub = stubFetch(() => toolUse(goodCore()));
  await new AnthropicIncomeGenerator({ apiKey: 'k', model: 'm', fetchFn: stub.fn }).generate(facts, []);
  assert.equal('temperature' in stub.calls[0]!.body, false);
});
