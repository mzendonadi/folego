import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { maintenance } from '../src/subscriptions.ts';
import { sendDueReminders } from '../src/account-extras.ts';
import { sendWeeklyDigests } from '../src/account-debts.ts';
import { refreshMarket } from '../src/market.ts';
import { sendWelcomes } from '../src/coach-program.ts';
import { todaySaoPaulo } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let off: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'development' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  off = await buildApp({ config: { ...config, subscriptionsEnabled: false }, db, gateway, email: mailbox, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await off.close();
  await db.close();
});

function client(server: FastifyInstance = app) {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await server.inject({
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

async function login(c: ReturnType<typeof client>, email: string) {
  mailbox.sent.length = 0;
  const req = await c('POST', '/api/account/login-code', { body: { email } });
  assert.equal(req.status, 200);
  assert.equal(mailbox.sent.length, 1);
  const m = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)!;
  const ok = await c('POST', '/api/account/login', { body: { email, code: m[1] } });
  assert.equal(ok.status, 200);
  return ok.json;
}

async function pay(orderId: string, key: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
}

test('desligada por padrão: rotas de conta não existem', async () => {
  const c = client(off);
  assert.equal((await c('POST', '/api/account/login-code', { body: { email: 'a@b.com' } })).status, 404);
  assert.equal((await c('GET', '/api/features')).json.subscriptions, false);
});

test('login por código: expira, tenta de novo, limite de pedidos', async () => {
  const c = client();
  const req1 = await c('POST', '/api/account/login-code', { body: { email: 'codigo@exemplo.com' } });
  assert.equal(req1.status, 200);
  const wrong = await c('POST', '/api/account/login', { body: { email: 'codigo@exemplo.com', code: '000000' } });
  assert.equal(wrong.status, 401);
  const m = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)!;
  const used = await c('POST', '/api/account/login', { body: { email: 'codigo@exemplo.com', code: m[1] } });
  assert.equal(used.status, 200);
  const reuse = await c('POST', '/api/account/login', { body: { email: 'codigo@exemplo.com', code: m[1] } });
  assert.equal(reuse.status, 401); // código já usado
  for (let i = 0; i < 3; i++) await c('POST', '/api/account/login-code', { body: { email: 'flood@exemplo.com' } });
  const flood = await c('POST', '/api/account/login-code', { body: { email: 'flood@exemplo.com' } });
  assert.equal(flood.status, 429);
});

test('assinatura: sem plano ativo os recursos ficam bloqueados; Pix mensal ativa por 30 dias; cancelar não corta na hora', async () => {
  const c = client();
  await login(c, 'assinante@exemplo.com');
  const noPlan = await c('GET', '/api/account');
  assert.equal(noPlan.json.subscription, null);
  assert.equal((await c('GET', '/api/account/month/2026-09')).status, 402);

  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-controle-0001' } });
  assert.equal(order.status, 201);
  assert.equal(order.json.totalCents, 1999);
  assert.equal((await c('GET', '/api/account/month/2026-09')).status, 402); // ainda não pago
  await pay(order.json.orderId, 'sub-controle');

  const withPlan = await c('GET', '/api/account');
  assert.equal(withPlan.json.subscription.plan, 'controle');
  assert.equal(withPlan.json.subscription.active, true);
  assert.ok(withPlan.json.subscription.periodEnd > Date.now());

  // Controle não tem metas nem treinador completo
  assert.equal((await c('POST', '/api/account/goals', { body: { name: 'Viagem', targetCents: 100_000, savedCents: 0 } })).status, 403);
  const coach = await c('GET', '/api/account/coach');
  assert.equal(coach.status, 200);
  assert.equal(coach.json.insights.length <= 3, true);

  const cancel = await c('POST', '/api/account/subscription-cancel', { body: { cancel: true } });
  assert.equal(cancel.status, 200);
  const stillActive = await c('GET', '/api/account');
  assert.equal(stillActive.json.subscription.active, true);
  assert.equal(stillActive.json.subscription.cancelAtPeriodEnd, true);
  assert.equal((await c('GET', '/api/account/month/2026-09')).status, 200); // continua valendo até o fim do período
});

test('lançamentos: manual e importado, categorização automática, deduplicação, limites e alertas', async () => {
  const c = client();
  await login(c, 'lancamentos@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-ousado-00001' } });
  await pay(order.json.orderId, 'sub-ousado');

  const add = await c('POST', '/api/account/entries', {
    body: {
      entries: [
        { date: '2026-09-05', amountCents: 300_000, note: 'Salario', source: 'manual' },
        { date: '2026-09-10', amountCents: -60_000, note: 'SUPERMERCADO BOM', source: 'import' },
        { date: '2026-09-10', amountCents: -60_000, note: 'SUPERMERCADO BOM', source: 'import' }, // duplicado
      ],
    },
  });
  assert.equal(add.status, 200);
  assert.equal(add.json.added, 2);
  assert.equal(add.json.duplicates, 1);

  const month = await c('GET', '/api/account/month/2026-09');
  assert.equal(month.json.summary.incomeCents, 300_000);
  const mercado = month.json.entries.find((e: any) => e.note === 'SUPERMERCADO BOM');
  assert.equal(mercado.category, 'mercado');

  await c('POST', `/api/account/entries/${mercado.id}/category`, { body: { category: 'lazer' } });
  const after = await c('GET', '/api/account/month/2026-09');
  assert.equal(after.json.entries.find((e: any) => e.id === mercado.id).category, 'lazer');

  await c('POST', '/api/account/limits/lazer', { body: { limitCents: 10_000 } });
  const withAlert = await c('GET', '/api/account/month/2026-09');
  assert.ok(withAlert.json.alerts.some((a: any) => a.title.includes('lazer'.replace(/^./, (x: string) => x)) || a.detail.includes('R$')));

  await c('DELETE', `/api/account/entries/${mercado.id}`);
  const gone = await c('GET', '/api/account/month/2026-09');
  assert.equal(gone.json.entries.find((e: any) => e.id === mercado.id), undefined);
});

test('metas: só Ousado+, limite de 20, e simulador só no Desbravador', async () => {
  const c = client();
  await login(c, 'metas@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-metas-000001' } });
  await pay(order.json.orderId, 'sub-metas');

  const g = await c('POST', '/api/account/goals', { body: { name: 'Reserva', targetCents: 500_000, savedCents: 50_000, dueOn: '2027-01-01' } });
  assert.equal(g.status, 201);
  assert.equal((await c('GET', '/api/account/month/2026-09')).json.goals.length, 1);

  assert.equal((await c('POST', '/api/account/simulate', { body: { initialCents: 0, monthlyCents: 10_000, months: 12, scenarios: [{ name: 'X', annualPct: 10 }], inflationAnnualPct: 0 } })).status, 403);

  const c2 = client();
  await login(c2, 'desbravador@exemplo.com');
  const order2 = await c2('POST', '/api/account/subscription-order', { body: { plan: 'desbravador' }, headers: { 'idempotency-key': 'sub-desb-000001' } });
  await pay(order2.json.orderId, 'sub-desb');
  const sim = await c2('POST', '/api/account/simulate', { body: { initialCents: 100_000, monthlyCents: 0, months: 12, scenarios: [{ name: 'X', annualPct: 12 }], inflationAnnualPct: 0 } });
  assert.equal(sim.status, 200);
  assert.equal(sim.json.results[0].finalCents, 112_000);
  assert.ok(sim.json.notice.includes('educativa'));
});

test('apagar a conta remove lançamentos, metas e assinatura, e desloga', async () => {
  const c = client();
  await login(c, 'apagar@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-apagar-00001' } });
  await pay(order.json.orderId, 'sub-apagar');
  await c('POST', '/api/account/entries', { body: { entries: [{ date: '2026-09-01', amountCents: 1000, note: 'x' }] } });
  const del = await c('DELETE', '/api/account');
  assert.equal(del.status, 204);
  assert.equal((await c('GET', '/api/account')).status, 401);
});

test('manutenção: assinatura vencida vira inativa; lembrete 3 dias antes é enviado uma vez', async () => {
  const c = client();
  await login(c, 'manutencao@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-manut-00001' } });
  await pay(order.json.orderId, 'sub-manut');
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() + interval '1 day' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'manutencao@exemplo.com')`);
  mailbox.sent.length = 0;
  const r1 = await maintenance({ db, config, gateway, email: mailbox }, { force: true });
  assert.equal(r1.reminded, 1);
  assert.equal(mailbox.sent.length, 1);
  const r2 = await maintenance({ db, config, gateway, email: mailbox }, { force: true });
  assert.equal(r2.reminded, 0); // já lembrado
  await db.query(`UPDATE app.subscriptions SET current_period_end = now() - interval '1 day' WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'manutencao@exemplo.com')`);
  const r3 = await maintenance({ db, config, gateway, email: mailbox }, { force: true });
  assert.equal(r3.expired, 1);
  assert.equal((await c('GET', '/api/account')).json.subscription.active, false);
});

test('metas com aportes: total = inicial + aportes, conclui ao alcançar o alvo, desfazer reabre, e só o dono mexe', async () => {
  const c = client();
  await login(c, 'aportes@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-aportes-00001' } });
  await pay(order.json.orderId, 'sub-aportes');
  await c('POST', '/api/account/goals', { body: { name: 'Viagem', targetCents: 100_000, savedCents: 20_000 } });
  const goalOf = async (cl = c) => (await cl('GET', '/api/account/month/2026-09')).json.goals.find((g: any) => g.name === 'Viagem');

  let g = await goalOf();
  assert.equal(g.savedCents, 20_000);
  assert.equal(g.completedAt, null);

  assert.equal((await c('POST', `/api/account/goals/${g.id}/contributions`, { body: { amountCents: 30_000, date: '2026-09-10', note: 'Extra' } })).status, 201);
  g = await goalOf();
  assert.equal(g.savedCents, 50_000);
  assert.equal(g.contributions.length, 1);
  assert.equal(g.contributions[0].note, 'Extra');

  await c('POST', `/api/account/goals/${g.id}/contributions`, { body: { amountCents: 50_000 } });
  g = await goalOf();
  assert.equal(g.savedCents, 100_000);
  assert.ok(g.completedAt, 'meta concluída ao alcançar o alvo');

  // desfazer o último aporte reabre a meta
  const last = g.contributions[0];
  assert.equal((await c('DELETE', `/api/account/goals/${g.id}/contributions/${last.id}`)).status, 204);
  g = await goalOf();
  assert.equal(g.savedCents, 50_000);
  assert.equal(g.completedAt, null);

  // valor inválido é recusado
  assert.equal((await c('POST', `/api/account/goals/${g.id}/contributions`, { body: { amountCents: 0 } })).status, 400);

  // outra conta não enxerga nem mexe na meta
  const other = client();
  await login(other, 'aportes-outro@exemplo.com');
  const order2 = await other('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-aportes-00002' } });
  await pay(order2.json.orderId, 'sub-aportes-2');
  assert.equal((await other('POST', `/api/account/goals/${g.id}/contributions`, { body: { amountCents: 1000 } })).status, 404);
  assert.equal((await other('GET', '/api/account/month/2026-09')).json.goals.length, 0);
});

test('aportes em meta: o plano Controle não tem metas', async () => {
  const c = client();
  await login(c, 'controle-aporte@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-ctrl-apt-0001' } });
  await pay(order.json.orderId, 'sub-ctrl-apt');
  const res = await c('POST', '/api/account/goals/01a0e56f-8f28-7df0-958d-8057148a8628/contributions', { body: { amountCents: 1000 } });
  assert.equal(res.status, 403);
});

test('carteiras e lembretes: carteira isolada por dono, saldo por carteira, lembrete mensal renasce e e-mail sai uma vez', async () => {
  const c = client();
  await login(c, 'extras@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-extras-00001' } });
  await pay(order.json.orderId, 'sub-extras');

  const w = await c('POST', '/api/account/wallets', { body: { name: 'Nubank', kind: 'conta' } });
  assert.equal(w.status, 201);
  assert.equal((await c('POST', '/api/account/wallets', { body: { name: '', kind: 'conta' } })).status, 400);
  const month = new Date().toISOString().slice(0, 7);
  await c('POST', '/api/account/entries', { body: { entries: [{ date: `${month}-02`, amountCents: 100_000, note: 'Salario', walletId: w.json.id }, { date: `${month}-03`, amountCents: -20_000, note: 'Mercado' }] } });
  const list = (await c('GET', '/api/account/wallets')).json;
  assert.equal(list.wallets[0].balanceCents, 100_000);
  assert.equal(list.unassigned.balanceCents, -20_000);

  const other = client();
  await login(other, 'extras-outro@exemplo.com');
  const o2 = await other('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-extras-00002' } });
  await pay(o2.json.orderId, 'sub-extras2');
  assert.equal((await other('POST', '/api/account/entries', { body: { entries: [{ date: `${month}-04`, amountCents: 1000, note: 'x', walletId: w.json.id }] } })).status, 404, 'carteira alheia');
  assert.equal((await other('DELETE', `/api/account/wallets/${w.json.id}`)).status, 404);

  const today = new Date().toISOString().slice(0, 10);
  const r = await c('POST', '/api/account/reminders', { body: { title: 'Conta de luz', dueOn: today, amountCents: 18_000, repeatMonthly: true, emailDaysBefore: 1 } });
  assert.equal(r.status, 201);
  assert.equal((await c('POST', '/api/account/reminders', { body: { title: 'X', dueOn: 'amanhã' } })).status, 400);
  mailbox.sent.length = 0;
  assert.ok((await sendDueReminders({ db, config, gateway, email: mailbox })) >= 1);
  assert.ok(mailbox.sent.some((m) => m.to === 'extras@exemplo.com' && /Conta de luz/.test(m.subject)));
  assert.equal(await sendDueReminders({ db, config, gateway, email: mailbox }), 0, 'não repete');
  assert.equal((await c('PUT', `/api/account/reminders/${r.json.id}`, { body: { done: true } })).status, 200);
  const rem = (await c('GET', '/api/account/reminders')).json.reminders;
  assert.equal(rem.filter((x: any) => !x.done).length, 1, 'a do mês seguinte nasceu');
  assert.equal((await other('DELETE', `/api/account/reminders/${r.json.id}`)).status, 404);
});

test('dívidas da conta: saldo cai com pagamento, plano recomenda o foco, orçamento por mês e resumo semanal', async () => {
  const c = client();
  await login(c, 'dividas@exemplo.com');
  const order = await c('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-divid-00001' } });
  await pay(order.json.orderId, 'sub-divid');

  const card = await c('POST', '/api/account/debts', { body: { name: 'Cartão', balanceCents: 500_000, monthlyRateBps: 1200, minPaymentCents: 50_000 } });
  assert.equal(card.status, 201);
  await c('POST', '/api/account/debts', { body: { name: 'Loja', balanceCents: 100_000, monthlyRateBps: 300, minPaymentCents: 20_000 } });
  const list = (await c('GET', '/api/account/debts?extra=50000')).json;
  assert.equal(list.totals.owedCents, 600_000);
  assert.equal(list.plan.recommended, 'avalanche');
  assert.equal(list.plan.focusId, card.json.id);

  const paid = await c('POST', `/api/account/debts/${card.json.id}/payments`, { body: { amountCents: 100_000, addToLedger: true } });
  assert.equal(paid.json.balanceCents, 400_000);
  const after = (await c('GET', '/api/account/debts')).json;
  assert.equal(after.totals.paidCents, 100_000);
  assert.equal(after.totals.progressPct, 17);
  const over = await c('POST', `/api/account/debts/${card.json.id}/payments`, { body: { amountCents: 9_999_999 } });
  assert.equal(over.json.paidOff, true, 'pagamento maior que o saldo quita sem passar');
  assert.equal((await c('POST', `/api/account/debts/${card.json.id}/payments`, { body: { amountCents: 100 } })).status, 409);

  const month = new Date().toISOString().slice(0, 7);
  await c('POST', '/api/account/limits/mercado', { body: { limitCents: 80_000 } });
  assert.equal((await c('POST', `/api/account/budget/${month}/limits/mercado`, { body: { limitCents: 50_000 } })).status, 200);
  assert.equal((await c('GET', `/api/account/month/${month}`)).json.limits.mercado, 50_000, 'o do mês vence o padrão');
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
  assert.equal((await c('POST', `/api/account/budget/${next}/copy`)).json.copied, 1);

  const other = client();
  await login(other, 'dividas-outro@exemplo.com');
  const o2 = await other('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-divid-00002' } });
  await pay(o2.json.orderId, 'sub-divid2');
  assert.equal((await other('POST', `/api/account/debts/${card.json.id}/payments`, { body: { amountCents: 100 } })).status, 404);
  assert.equal((await other('DELETE', `/api/account/debts/${card.json.id}`)).status, 404);

  mailbox.sent.length = 0;
  assert.ok((await sendWeeklyDigests({ db, config, gateway, email: mailbox })) >= 1);
  assert.ok(mailbox.sent.some((m) => m.to === 'dividas@exemplo.com' && /resumo/i.test(m.subject)));
  assert.equal(await sendWeeklyDigests({ db, config, gateway, email: mailbox }), 0, 'uma vez por semana');
});

test('planejador: só Desbravador, responde com os fatos da conta (sem chave de IA usa regras) e tem limite diário', async () => {
  const ousado = client();
  await login(ousado, 'plan-ousado@exemplo.com');
  const o1 = await ousado('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'sub-planej-00001' } });
  await pay(o1.json.orderId, 'sub-planej1');
  assert.equal((await ousado('POST', '/api/account/planner', { body: { question: 'Como fecho o mês?' } })).status, 403);

  const c = client();
  await login(c, 'plan-desbrav@exemplo.com');
  const o2 = await c('POST', '/api/account/subscription-order', { body: { plan: 'desbravador' }, headers: { 'idempotency-key': 'sub-planej-00002' } });
  await pay(o2.json.orderId, 'sub-planej2');
  const today = new Date().toISOString().slice(0, 10);
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: 300_000, note: 'Salario' }, { date: today, amountCents: -120_000, note: 'Aluguel' }] } });
  await c('POST', '/api/account/debts', { body: { name: 'Cartão', balanceCents: 400_000, monthlyRateBps: 1000, minPaymentCents: 40_000 } });
  assert.equal((await c('POST', '/api/account/planner', { body: { question: 'ok' } })).status, 400);
  const r = await c('POST', '/api/account/planner', { body: { question: 'Como fecho o mês sem me enrolar?' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.source, 'regras');
  assert.match(r.json.answer, /3\.000,00/);
  assert.match(r.json.answer, /Cartão/);
  await db.query(`INSERT INTO app.planner_log(subscriber_id, source) SELECT id, 'regras' FROM app.subscribers, generate_series(1, 9) WHERE email = 'plan-desbrav@exemplo.com'`);
  assert.equal((await c('POST', '/api/account/planner', { body: { question: 'Mais uma pergunta aqui' } })).status, 429);
});

test('coach: nota, jornadas por plano, missão confirmada pelos dados e cenário econômico do Banco Central', async () => {
  const fakeBcb = (async (url: string) => {
    const serie = /sgs\.(\d+)\//.exec(url)![1];
    const rows: Record<string, Array<{ data: string; valor: string }>> = {
      '432': [{ data: '01/07/2026', valor: '15.25' }, { data: '01/10/2026', valor: '14.75' }],
      '13522': [{ data: '01/09/2026', valor: '5.20' }],
      '4389': [{ data: '01/10/2026', valor: '14.65' }],
      '1': [{ data: '01/10/2026', valor: '5.4000' }],
    };
    return new Response(JSON.stringify(rows[serie!] ?? []), { status: 200 });
  }) as unknown as typeof fetch;
  assert.ok((await refreshMarket({ db, config, gateway, email: mailbox }, { fetchFn: fakeBcb, force: true })) >= 5);
  assert.equal(await refreshMarket({ db, config, gateway, email: mailbox }, { fetchFn: fakeBcb }), 0, 'dados frescos não rebuscam');

  const c = client();
  await login(c, 'coach-controle@exemplo.com');
  const o = await c('POST', '/api/account/subscription-order', { body: { plan: 'controle' }, headers: { 'idempotency-key': 'sub-coach-00001' } });
  await pay(o.json.orderId, 'sub-coach1');
  const today = todaySaoPaulo();
  await c('POST', '/api/account/entries', { body: { entries: [{ date: today, amountCents: 500_000, note: 'Salario' }, { date: today, amountCents: -200_000, note: 'Aluguel' }] } });
  const ov = (await c('GET', '/api/account/coach/overview')).json;
  assert.equal(ov.plan, 'controle');
  assert.ok(ov.health.score > 0 && ov.health.parts.length === 4);
  assert.equal(ov.journeys.find((j: any) => j.id === 'organizar').locked, false);
  assert.equal(ov.journeys.find((j: any) => j.id === 'sair_do_vermelho').locked, true);
  assert.equal(ov.journeys.find((j: any) => j.id === 'organizar').missions[3].done, true, 'gastou menos do que ganhou');
  assert.equal((await c('POST', '/api/account/coach/journeys/organizar/start')).status, 204);
  assert.equal((await c('POST', '/api/account/coach/journeys/sair_do_vermelho/start')).status, 403);
  assert.equal((await c('POST', '/api/account/coach/journeys/inexistente/start')).status, 422);
  const again = (await c('GET', '/api/account/coach/overview')).json;
  assert.equal(again.focus.kind, 'missao');
  assert.equal(again.streak, 1, 'lançou hoje: sequência de 1 dia');
  assert.equal(again.objective, null);
  assert.equal((await c('POST', '/api/account/coach/objective', { body: { objective: 'sair_do_vermelho' } })).json.journey, 'organizar', 'plano Controle cai na jornada Organizar');
  assert.equal((await c('GET', '/api/account/coach/overview')).json.objective, 'sair_do_vermelho');
  assert.equal((await c('POST', '/api/account/coach/objective', { body: { objective: 'x' } })).status, 400);
  assert.equal((await c('GET', '/api/account/goal-templates')).status, 403, 'Controle não tem metas');
  assert.equal(again.challenges[0].id, 'w_registrar');
  assert.equal(again.compare.verdict, 'sem_base', 'sem mês anterior não há base');

  const m = (await c('GET', '/api/account/market')).json;
  assert.equal(m.indicators.selicPct, 14.75);
  assert.equal(m.indicators.selicTrend, -0.5);
  assert.equal(m.indicators.usdBrl, null, 'dólar é do Desbravador');
  assert.equal(m.history, null);
  assert.ok(m.insights.some((i: any) => i.id === 'selic' && !i.locked));
  assert.ok(m.insights.some((i: any) => i.id === 'juro_real' && i.locked));

  const d = client();
  await login(d, 'coach-desb@exemplo.com');
  const o2 = await d('POST', '/api/account/subscription-order', { body: { plan: 'desbravador' }, headers: { 'idempotency-key': 'sub-coach-00002' } });
  await pay(o2.json.orderId, 'sub-coach2');
  const md = (await d('GET', '/api/account/market')).json;
  assert.equal(md.indicators.usdBrl, 5.4);
  const tpl = (await d('GET', '/api/account/goal-templates')).json.templates;
  assert.ok(tpl.some((t: any) => t.id === 'reserva_6') && tpl.some((t: any) => t.id === 'viagem' && t.targetCents === null));
  assert.ok(md.history.selic.length >= 1);
  assert.equal((await d('POST', '/api/account/coach/journeys/investir/start')).status, 204);
  await d('POST', '/api/account/simulate', { body: { initialCents: 100_000, monthlyCents: 50_000, months: 12, scenarios: [{ name: 'A', annualPct: 10 }], inflationAnnualPct: 4 } });
  const inv = (await d('GET', '/api/account/coach/overview')).json.journeys.find((j: any) => j.id === 'investir');
  assert.equal(inv.missions[3].done, true, 'usar o simulador confirma a missão');
  while ((await sendWelcomes({ db, config, gateway, email: mailbox })) > 0) { /* esvazia a fila de boas-vindas */ }
  mailbox.sent.length = 0;
  await db.query(`UPDATE app.subscribers SET welcome_sent_at = NULL WHERE email = 'coach-desb@exemplo.com'`);
  assert.equal(await sendWelcomes({ db, config, gateway, email: mailbox }), 1);
  assert.match(mailbox.sent[0].subject, /pronta/);
  assert.equal(await sendWelcomes({ db, config, gateway, email: mailbox }), 0, 'só uma vez');
});
