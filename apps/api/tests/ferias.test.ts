// Planejar férias: formulário e checklist no Ousado, roteiro com IA no Desbravador (IA simulada). Dados inventados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook, todaySaoPaulo } from '../src/services.ts';
import { cleanItinerary } from '../src/trips.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, anthropicApiKey: 'sk-ant-de-mentira' as string | null };
const ctx = () => ({ db, config, gateway, email: mailbox });
const realFetch = globalThis.fetch;
let answers: Record<string, unknown>[] = [];
let askedFor: string[] = [];

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      askedFor.push(String((JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[0]!.content));
      const next = answers.shift();
      if (!next) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'montar_roteiro', input: next }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url as never, init);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
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
    return { status: res.statusCode, json };
  };
}
type Client = ReturnType<typeof client>;
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
async function assinante(email: string, plan: 'controle' | 'ousado' | 'desbravador'): Promise<Client> {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan, acceptTerms: true } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [co.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${co.json.orderId}`, paymentId: p.rows[0]!.provider_payment_id });
  return c;
}
const plusDays = (n: number) => new Date(Date.parse(`${todaySaoPaulo()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const viagem = (extra: Record<string, unknown> = {}) => ({
  name: 'Férias em família', destination: 'Florianópolis', origin: 'Uberlândia', startDate: plusDays(40), endDate: plusDays(46), kind: 'carro',
  adults: 2, children: 2, seniors: false, pets: true, lodging: 'casa', international: false, budgetCents: 700_000, notes: 'Gostamos de praia calma', ...extra,
});
const roteiro = (dias: number, extra: Record<string, unknown> = {}) => ({
  summary: 'Uma viagem tranquila de carro, com paradas para descansar e praias calmas.',
  route_notes: ['Saia cedo para fazer o trecho mais longo com luz do dia.'],
  days: Array.from({ length: dias }, (_, i) => ({ day: i + 1, title: `Dia ${i + 1}`, morning: 'Café sem pressa e saída.', afternoon: 'Passeio curto perto da hospedagem.', evening: 'Jantar leve e descanso.', stay: 'Casa de temporada na região.', tip: 'Confira horários antes de sair.' })),
  extra_checklist: [{ group: 'Do roteiro', text: 'Baixar o mapa offline da região' }],
  warnings: ['Confira as condições da estrada antes de cada trecho.'],
  ...extra,
});

test('férias: o plano do Controle não tem o planejador; o Ousado cria, vê, edita, marca o checklist e apaga', async () => {
  const c0 = await assinante('ferias-controle@exemplo.com', 'controle');
  assert.equal((await c0('GET', '/api/account/trips')).json.error, 'plan_upgrade');
  assert.equal((await c0('POST', '/api/account/trips', { body: viagem() })).status, 403);

  const c = await assinante('ferias-ousado@exemplo.com', 'ousado');
  assert.equal((await c('GET', '/api/account/trips')).json.trips.length, 0);
  const made = await c('POST', '/api/account/trips', { body: viagem() });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.id as string;

  const t = (await c('GET', `/api/account/trips/${id}`)).json;
  assert.deepEqual([t.plan.days, t.plan.nights, t.plan.people], [7, 6, 4]);
  assert.equal(t.plan.budget.reduce((s: number, l: any) => s + l.cents, 0), 700_000);
  assert.ok(t.plan.checklist.some((x: any) => x.id === 'pet-vacinas'), 'bicho de estimação entra no checklist');
  assert.ok(t.plan.checklist.some((x: any) => x.id === 'car-cadeirinha'), 'criança no carro: cadeirinha');
  assert.ok(t.plan.saving.perMonthCents > 0);
  assert.equal(t.ai.available, true);

  assert.equal((await c('POST', `/api/account/trips/${id}/check`, { body: { itemId: 'doc-id', done: true } })).status, 200);
  assert.equal((await c('POST', `/api/account/trips/${id}/check`, { body: { itemId: 'nao-existe', done: true } })).status, 422);
  const list = (await c('GET', '/api/account/trips')).json.trips;
  assert.equal(list[0].checklist.done, 1);
  assert.equal(list[0].name, 'Férias em família');

  // mudar para avião troca os itens do carro pelos do avião; o que já estava marcado e continua existindo fica marcado
  assert.equal((await c('PUT', `/api/account/trips/${id}`, { body: viagem({ kind: 'aviao' }) })).status, 200);
  const t2 = (await c('GET', `/api/account/trips/${id}`)).json;
  assert.ok(t2.plan.checklist.some((x: any) => x.id === 'av-checkin'));
  assert.ok(!t2.plan.checklist.some((x: any) => x.id === 'car-revisao'));
  assert.equal(t2.checked['doc-id'], true);

  // validações explicadas em português
  const ruim = await c('POST', '/api/account/trips', { body: viagem({ endDate: plusDays(30) }) });
  assert.equal(ruim.status, 422);
  assert.match(ruim.json.message, /volta/);
  assert.equal((await c('POST', '/api/account/trips', { body: { ...viagem(), kind: 'foguete' } })).status, 400);

  // Ousado não tem o roteiro por IA
  assert.equal((await c('POST', `/api/account/trips/${id}/itinerary`)).status, 403);

  // outra conta não enxerga
  const outro = await assinante('ferias-ousado2@exemplo.com', 'ousado');
  assert.equal((await outro('GET', `/api/account/trips/${id}`)).status, 404);
  assert.equal((await outro('DELETE', `/api/account/trips/${id}`)).status, 404);

  assert.equal((await c('DELETE', `/api/account/trips/${id}`)).status, 204);
  assert.equal((await c('GET', '/api/account/trips')).json.trips.length, 0);
});

test('férias: no máximo 12 viagens por conta', async () => {
  const c = await assinante('ferias-max@exemplo.com', 'ousado');
  for (let i = 0; i < 12; i += 1) assert.equal((await c('POST', '/api/account/trips', { body: viagem({ name: `Viagem ${i}` }) })).status, 201);
  const extra = await c('POST', '/api/account/trips', { body: viagem({ name: 'Uma a mais' }) });
  assert.equal(extra.status, 422);
  assert.equal(extra.json.error, 'too_many');
});

test('roteiro com IA: um item por dia, vira checklist extra, respeita o tipo de viagem e o limite do dia', async () => {
  const c = await assinante('ferias-desb@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/trips', { body: viagem({ kind: 'motorhome', lodging: 'camping', pets: false }) })).json.id as string;
  answers = [roteiro(7)];
  askedFor = [];
  const r = await c('POST', `/api/account/trips/${id}/itinerary`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.itinerary.days.length, 7);
  assert.match(askedFor[0]!, /motorhome ou trailer/i, 'o pedido leva o tipo de viagem');
  assert.match(askedFor[0]!, /campings ou pontos de apoio/, 'e as regras dele');
  const t = (await c('GET', `/api/account/trips/${id}`)).json;
  assert.equal(t.itinerary.extraChecklist[0].id, 'ai-1');
  assert.equal((await c('POST', `/api/account/trips/${id}/check`, { body: { itemId: 'ai-1', done: true } })).status, 200);
  assert.equal((await c('GET', '/api/account/trips')).json.trips[0].hasItinerary, true);

  // mudar o formulário joga fora o roteiro antigo
  await c('PUT', `/api/account/trips/${id}`, { body: viagem({ kind: 'motorhome', lodging: 'camping', pets: false, destination: 'Gramado' }) });
  assert.equal((await c('GET', `/api/account/trips/${id}`)).json.itinerary, null);

  // a IA citou preço: reprovado e tenta de novo; a segunda resposta passa
  answers = [roteiro(7, { summary: 'Viagem por R$ 5.000,00 no total, tranquila.' }), roteiro(7)];
  const ok = await c('POST', `/api/account/trips/${id}/itinerary`);
  assert.equal(ok.status, 200);
  assert.equal(answers.length, 0, 'usou as duas respostas');

  // número de dias errado nas duas tentativas: falha com mensagem clara e sem estragar o que existia
  answers = [roteiro(3), roteiro(3)];
  const falha = await c('POST', `/api/account/trips/${id}/itinerary`);
  assert.equal(falha.status, 502);
  assert.equal(falha.json.error, 'ai_failed');
  assert.ok((await c('GET', `/api/account/trips/${id}`)).json.itinerary, 'o roteiro anterior continua');

  // IA fora do ar
  answers = [];
  assert.equal((await c('POST', `/api/account/trips/${id}/itinerary`)).status, 502);

  // limite diário
  const sub = (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = 'ferias-desb@exemplo.com'`)).rows[0]!.id;
  await db.query(`INSERT INTO app.trip_ai_log(subscriber_id) SELECT $1 FROM generate_series(1, 6)`, [sub]);
  answers = [roteiro(7)];
  const limite = await c('POST', `/api/account/trips/${id}/itinerary`);
  assert.equal(limite.status, 429);
  assert.equal(limite.json.error, 'trip_ai_limit');
});

test('roteiro com IA: sem a chave o checklist continua e a resposta é honesta; viagem longa pede para dividir', async () => {
  const c = await assinante('ferias-semchave@exemplo.com', 'desbravador');
  const id = (await c('POST', '/api/account/trips', { body: viagem() })).json.id as string;
  config.anthropicApiKey = null;
  const r = await c('POST', `/api/account/trips/${id}/itinerary`);
  config.anthropicApiKey = 'sk-ant-de-mentira';
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'ai_off');

  const longa = (await c('POST', '/api/account/trips', { body: viagem({ name: 'Volta ao Brasil', startDate: plusDays(40), endDate: plusDays(40 + 44) }) })).json.id as string;
  const l = await c('POST', `/api/account/trips/${longa}/itinerary`);
  assert.equal(l.status, 422);
  assert.equal(l.json.error, 'too_long');
});

test('roteiro com IA: a conferência recusa dia faltando, link e telefone e devolve o texto limpo', () => {
  assert.equal(cleanItinerary(roteiro(2) as never, 3).ok, false);
  const link = cleanItinerary(roteiro(2, { warnings: ['Veja em https://exemplo.com para detalhes'] }) as never, 2);
  assert.equal(link.ok, false);
  const bom = cleanItinerary(roteiro(2, { summary: '  Resumo   com espaços  ' }) as never, 2);
  assert.ok(bom.ok);
  if (bom.ok) {
    assert.equal(bom.itinerary.summary, 'Resumo com espaços');
    assert.deepEqual(bom.itinerary.days.map((d) => d.day), [1, 2]);
  }
});
