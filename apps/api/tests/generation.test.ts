import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { diagnose } from '../src/engine.ts';
import type { DebtInput } from '../src/engine.ts';
import { buildFacts } from '../src/generation/facts.ts';
import { templateScripts, templateLetters } from '../src/generation/templates.ts';
import { checkGeneratedText } from '../src/generation/guardrails.ts';
import { AnthropicGenerator, buildUserPayload } from '../src/generation/ai.ts';
import type { AiResult, ScriptGenerator } from '../src/generation/ai.ts';
import { processNext } from '../src/generation/worker.ts';
import type { ScriptsCore } from '../src/generation/schema.ts';

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

const debts: DebtInput[] = [
  { id: 'd1', creditorName: 'SEGREDO_ALUGUEL', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 },
  { id: 'd2', creditorName: 'SEGREDO_CARTAO', kind: 'credit_card', balanceCents: 420_000, monthlyPaymentCents: 42_000, monthlyRateBps: 1400, daysOverdue: 0 },
  { id: 'd3', creditorName: 'SEGREDO_LOJA', kind: 'store_credit', balanceCents: 90_000, monthlyRateBps: 1000, daysOverdue: 400 },
  { id: 'd4', creditorName: 'SEGREDO_PRESCRITA', kind: 'store_credit', balanceCents: 70_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
];
const profile = { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt' as const, ageBand: '35-44', uf: 'SP' };
const diagnosis = diagnose({ asOf: '2026-09-26', profile, debts });
const facts = buildFacts(debts, diagnosis);
const names = new Map(debts.map((d) => [d.id, d.creditorName]));

// ---------- privacidade e fatos ----------
test('o texto enviado à IA não contém nomes de credores nem dados pessoais', () => {
  const payload = buildUserPayload(facts);
  assert.ok(!payload.includes('SEGREDO'), 'vazou nome de credor');
  assert.ok(!/cpf|telefone|@/i.test(payload));
  assert.ok(payload.includes('R$'), 'deveria trazer os valores formatados');
  assert.ok(!payload.includes('d4'), 'dívida possivelmente prescrita não vai para a IA');
});

test('propostas numéricas só existem para dívida em atraso que não é conta essencial', () => {
  const byId = new Map(facts.debts.map((d) => [d.id, d]));
  assert.equal(byId.get('d1')?.offer, null); // aluguel (essencial)
  assert.equal(byId.get('d2')?.offer, null); // cartão em dia
  assert.ok(byId.get('d3')?.offer); // loja em atraso
  assert.equal(byId.get('d3')?.offer?.openingCents, 45_000); // 50% de 90.000
});

// ---------- modelos determinísticos passam no verificador ----------
test('os modelos determinísticos passam no mesmo verificador da IA', () => {
  const core = templateScripts(facts);
  const expected = facts.debts.filter((d) => d.rank !== null).map((d) => d.id);
  assert.deepEqual(checkGeneratedText(core, facts, expected), []);
  assert.ok(!expected.includes('d4'));
});

// ---------- verificador ----------
const goodCore = (): ScriptsCore => JSON.parse(JSON.stringify(templateScripts(facts)));
const expectedIds = facts.debts.filter((d) => d.rank !== null).map((d) => d.id);

test('verificador rejeita valor inventado, porcentagem inventada, lei, promessa, link e id errado', () => {
  const inject = (patch: (c: ScriptsCore) => void) => {
    const c = goodCore();
    patch(c);
    return checkGeneratedText(c, facts, expectedIds).join(' | ');
  };
  assert.match(inject((c) => (c.dividas[0]!.proposta = 'Ofereça R$ 999,00 e pronto, sem discutir.')), /Valor não autorizado/);
  assert.match(inject((c) => (c.dividas[0]!.proposta = 'Peça 73% de desconto, é o justo para o caso.')), /Porcentagem não autorizada/);
  assert.match(inject((c) => (c.dividas[0]!.argumentos[0] = 'Segundo o art. 42 do CDC você tem esse direito.')), /artigos de lei/);
  assert.match(inject((c) => (c.dividas[0]!.abertura = 'Eu garanto que vão aceitar essa proposta hoje mesmo.')), /promessas/);
  assert.match(inject((c) => (c.dividas[0]!.mensagem_whatsapp = 'Veja em https://exemplo.com para mais detalhes do acordo.')), /links/);
  assert.match(inject((c) => (c.dividas[0]!.se_recusarem = 'Diga que vamos limpar seu nome depois do pagamento.')), /limpar o nome/);
  assert.match(inject((c) => (c.dividas[0]!.id = 'd9')), /exatamente/);
  assert.match(inject((c) => c.dividas.pop()), /exatamente/);
});

test('verificador aceita os valores autorizados em qualquer formato pt-BR', () => {
  const c = goodCore();
  c.dividas[0]!.proposta = `Tenha até ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(facts.capacityCents / 100)} por mês e siga.`;
  assert.deepEqual(checkGeneratedText(c, facts, expectedIds), []);
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
const toolUse = (input: unknown) => new Response(JSON.stringify({ id: 'msg_1', type: 'message', model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 'toolu_1', name: 'entregar_roteiros', input }], usage: { input_tokens: 900, output_tokens: 1400 } }), { status: 200 });

test('cliente do Claude: requisição sem dados pessoais, ferramenta obrigatória e resposta validada', async () => {
  const stub = stubFetch(() => toolUse(goodCore()));
  const gen = new AnthropicGenerator({ apiKey: 'sk-teste', model: 'claude-sonnet-5', fetchFn: stub.fn });
  const r = await gen.generate(facts, []);
  const call = stub.calls[0]!;
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'sk-teste');
  assert.equal(call.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.body.model, 'claude-sonnet-5');
  assert.deepEqual(call.body.tool_choice, { type: 'tool', name: 'entregar_roteiros' });
  assert.ok(!JSON.stringify(call.body).includes('SEGREDO'), 'nome de credor foi para a IA');
  assert.equal(r.inputTokens, 900);
  assert.equal(r.core.dividas.length, expectedIds.length);
});

test('cliente do Claude: erro HTTP, ausência de tool_use e formato inválido viram exceção', async () => {
  const mk = (h: () => Response) => new AnthropicGenerator({ apiKey: 'k', model: 'm', fetchFn: stubFetch(h).fn });
  await assert.rejects(mk(() => new Response('{"error":"CHAVE-SECRETA"}', { status: 529 })).generate(facts, []), /anthropic_http_529/);
  await assert.rejects(mk(() => new Response(JSON.stringify({ content: [{ type: 'text', text: 'oi' }] }), { status: 200 })).generate(facts, []), /sem_tool_use/);
  await assert.rejects(mk(() => toolUse({ dividas: [], dicas_gerais: [] })).generate(facts, []), /formato_invalido/);
});

test('o feedback do verificador é reenviado à IA na segunda tentativa', async () => {
  const stub = stubFetch(() => toolUse(goodCore()));
  await new AnthropicGenerator({ apiKey: 'k', model: 'm', fetchFn: stub.fn }).generate(facts, ['Valor não autorizado no texto: R$ 999.00']);
  assert.match(stub.calls[0]!.body.messages[0].content, /REPROVADA[\s\S]*R\$ 999/);
});

// ---------- worker ponta a ponta ----------
const H = { 'x-folego': '1', 'content-type': 'application/json' };
async function paidOrder(withLetters: boolean, key: string) {
  let cookie = '';
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await app.inject({ method, url, headers: { ...(body === undefined ? { 'x-folego': '1' } : H), ...(cookie ? { cookie } : {}), ...extra }, payload: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const created = await call('POST', '/api/cases', {
    profile,
    debts: debts.map(({ id, ...d }) => d),
    acceptTerms: true,
  });
  const order = await call('POST', '/api/orders', { caseId: created.json.caseId, withLetters }, { 'idempotency-key': key });
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  gateway.markPaid(pay.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: pay.rows[0]!.provider_payment_id }) });
  return { call, orderId: order.json.orderId as string, caseId: created.json.caseId as string };
}

/** Envelhece o trabalho de propósito. O gatilho touch_updated_at reescreveria updated_at, então é desligado só aqui. */
async function backdate(caseId: string, status: string, interval: string) {
  await db.exec('ALTER TABLE app.deliverables DISABLE TRIGGER deliverables_touch');
  try {
    await db.query(`UPDATE app.deliverables SET status = $2, updated_at = now() - $3::interval WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId, status, interval]);
  } finally {
    await db.exec('ALTER TABLE app.deliverables ENABLE TRIGGER deliverables_touch');
  }
}
const noAi = { generator: null, maxAiCallsPerDay: 100 };
const validAi = (): ScriptGenerator => ({ name: 'stub', generate: async (f): Promise<AiResult> => ({ core: templateScripts(f), model: 'stub-model', inputTokens: 10, outputTokens: 20 }) });

test('pagamento cria o roteiro pendente; entrega mostra "pending" até o worker rodar', async () => {
  const { call, orderId } = await paidOrder(false, 'gen-chave-0001');
  const before = await call('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(before.status, 200);
  assert.equal(before.json.generated.scripts.status, 'pending');
  assert.equal(before.json.generated.scripts.content, null);
  assert.equal(before.json.generated.letters, undefined);
  assert.equal(await processNext(ctx(), noAi), true);
  const after = await call('GET', `/api/orders/${orderId}/delivery`);
  assert.equal(after.json.generated.scripts.status, 'ready');
  assert.equal(after.json.generated.scripts.source, 'template');
});

test('roteiro pronto: nomes reais no lugar de {{credor}}, ordem de prioridade e dívida prescrita só como aviso', async () => {
  const { call, orderId } = await paidOrder(false, 'gen-chave-0002');
  while (await processNext(ctx(), noAi)) { /* esvazia a fila */ }
  const content = (await call('GET', `/api/orders/${orderId}/delivery`)).json.generated.scripts.content;
  const text = JSON.stringify(content);
  assert.ok(!text.includes('{{credor}}'), 'placeholder sem substituir');
  assert.ok(text.includes('SEGREDO_ALUGUEL') && text.includes('SEGREDO_CARTAO'));
  assert.equal(content.debts[0].creditorName, 'SEGREDO_ALUGUEL'); // essencial em atraso vem primeiro
  assert.ok(content.debts.every((d: any) => d.creditorName !== 'SEGREDO_PRESCRITA'));
  assert.equal(content.held.length, 1);
  assert.equal(content.held[0].creditorName, 'SEGREDO_PRESCRITA');
  assert.match(content.held[0].aviso, /prescrita/);
  const loja = content.debts.find((d: any) => d.creditorName === 'SEGREDO_LOJA');
  assert.equal(loja.oferta.openingCents, 45_000);
});

test('IA válida é usada e registrada (origem, modelo e tokens)', async () => {
  const { call, orderId, caseId } = await paidOrder(false, 'gen-chave-0003');
  while (await processNext(ctx(), { generator: validAi(), maxAiCallsPerDay: 100 })) { /* fila */ }
  const d = (await call('GET', `/api/orders/${orderId}/delivery`)).json.generated.scripts;
  assert.equal(d.source, 'ai');
  const meta = await db.query<{ generation_meta: any }>(`SELECT generation_meta FROM app.deliverables WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId]);
  assert.equal(meta.rows[0]!.generation_meta.model, 'stub-model');
  assert.equal(meta.rows[0]!.generation_meta.outputTokens, 20);
});

test('IA reprovada no verificador: tenta de novo com feedback e, se persistir, entrega o modelo determinístico', async () => {
  const { call, orderId } = await paidOrder(false, 'gen-chave-0004');
  const feedbacks: string[][] = [];
  const bad: ScriptGenerator = {
    name: 'ruim',
    generate: async (f, fb) => {
      feedbacks.push(fb);
      const core = templateScripts(f);
      core.dividas[0]!.proposta = 'Ofereça R$ 12,34 e não aceite menos que isso, combinado.';
      return { core, model: 'm', inputTokens: 1, outputTokens: 1 };
    },
  };
  while (await processNext(ctx(), { generator: bad, maxAiCallsPerDay: 100 })) { /* fila */ }
  assert.equal(feedbacks.length, 2);
  assert.deepEqual(feedbacks[0], []);
  assert.match(feedbacks[1]!.join(' '), /Valor não autorizado/);
  const s = (await call('GET', `/api/orders/${orderId}/delivery`)).json.generated.scripts;
  assert.equal(s.status, 'ready');
  assert.equal(s.source, 'template');
  assert.ok(!JSON.stringify(s.content).includes('12,34'));
});

test('IA fora do ar ou com erro: cai no modelo determinístico e o cliente recebe o conteúdo', async () => {
  const { call, orderId } = await paidOrder(false, 'gen-chave-0005');
  const down: ScriptGenerator = { name: 'caiu', generate: async () => { throw new Error('anthropic_http_529'); } };
  while (await processNext(ctx(), { generator: down, maxAiCallsPerDay: 100 })) { /* fila */ }
  const s = (await call('GET', `/api/orders/${orderId}/delivery`)).json.generated.scripts;
  assert.equal(s.status, 'ready');
  assert.equal(s.source, 'template');
});

test('teto diário de chamadas à IA: acima dele usa o modelo determinístico', async () => {
  const { call, orderId } = await paidOrder(false, 'gen-chave-0006');
  let called = 0;
  const counting: ScriptGenerator = { name: 'c', generate: async (f) => { called++; return { core: templateScripts(f), model: 'm', inputTokens: 1, outputTokens: 1 }; } };
  while (await processNext(ctx(), { generator: counting, maxAiCallsPerDay: 0 })) { /* fila */ }
  assert.equal(called, 0);
  assert.equal((await call('GET', `/api/orders/${orderId}/delivery`)).json.generated.scripts.source, 'template');
});

test('cartas: só com o Kit comprado, sem IA, com prescrição, informações e contestação e sem reconhecer dívida', async () => {
  const semKit = await paidOrder(false, 'gen-chave-0007');
  while (await processNext(ctx(), noAi)) { /* fila */ }
  assert.equal((await semKit.call('GET', `/api/orders/${semKit.orderId}/delivery`)).json.generated.letters, undefined);

  const comKit = await paidOrder(true, 'gen-chave-0008');
  const ai = { generator: { name: 'nunca', generate: async () => { throw new Error('cartas não podem usar IA'); } } as ScriptGenerator, maxAiCallsPerDay: 100 };
  while (await processNext(ctx(), ai)) { /* fila */ }
  const l = (await comKit.call('GET', `/api/orders/${comKit.orderId}/delivery`)).json.generated.letters;
  assert.equal(l.status, 'ready');
  assert.equal(l.source, 'template');
  const tipos = l.content.letters.map((x: any) => `${x.id}:${x.tipo}`);
  assert.ok(tipos.includes('d4-prescricao:prescricao'));
  assert.ok(tipos.includes('d2-informacoes:informacoes') === false, 'cartão em dia não gera pedido de informações');
  assert.ok(tipos.includes('d3-informacoes:informacoes'));
  assert.ok(tipos.includes('d3-contestacao:contestacao'));
  const presc = l.content.letters.find((x: any) => x.tipo === 'prescricao');
  assert.match(presc.corpo, /não constitui reconhecimento de dívida/);
  assert.match(presc.corpo, /\[SEU NOME COMPLETO\]/);
  assert.match(presc.corpo, /SEGREDO_PRESCRITA/);
  assert.match(presc.avisos.join(' '), /advogado/);
});

test('trabalho que falha: volta para a fila com espera e, depois de 5 tentativas, vira "failed"', async () => {
  const { orderId, caseId } = await paidOrder(false, 'gen-chave-0009');
  await db.query(`UPDATE app.cases SET inputs = '{}'::jsonb WHERE id = $1`, [caseId]); // dados corrompidos de propósito
  await processNext(ctx(), noAi);
  let row = await db.query<{ status: string; attempts: number }>(`SELECT status, (generation_meta->>'attempts')::int AS attempts FROM app.deliverables WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId]);
  assert.equal(row.rows[0]!.status, 'pending');
  assert.equal(row.rows[0]!.attempts, 1);
  assert.equal(await processNext(ctx(), noAi), false, 'ainda está em espera (backoff)');
  for (let i = 2; i <= 5; i++) {
    await backdate(caseId, 'pending', '10 minutes');
    await processNext(ctx(), noAi);
  }
  row = await db.query(`SELECT status, (generation_meta->>'attempts')::int AS attempts FROM app.deliverables WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId]);
  assert.equal(row.rows[0]!.status, 'failed');
  assert.ok(orderId);
});

test('trabalho "generating" travado há mais de 10 minutos é retomado', async () => {
  const { caseId } = await paidOrder(false, 'gen-chave-0010');
  await backdate(caseId, 'generating', '11 minutes');
  assert.equal(await processNext(ctx(), noAi), true);
  const r = await db.query<{ status: string }>(`SELECT status FROM app.deliverables WHERE case_id = $1 AND product_code = 'negotiation_scripts'`, [caseId]);
  assert.equal(r.rows[0]!.status, 'ready');
});

test('cartas modelo: função pura gera as mesmas cartas do worker', () => {
  const l = templateLetters(facts, names, new Map([['d4', '01/2019']]));
  assert.ok(l.letters.length >= 3);
  assert.match(l.letters.find((x) => x.tipo === 'prescricao')!.corpo, /desde 01\/2019/);
});
