// Coach da Assinatura: junta os fatos da conta, a nota de saúde, as jornadas e os métodos (motor em packages/domain)
// e o cenário econômico (indicadores do Banco Central). Plano manda no que aparece: ver `planAtLeast` / `minPlan`.
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { OBJECTIVES, goalTemplates, PROGRAMS, applyMethods, compareMonths, evaluatePrograms, healthScore, marketInsights, monthOf, planAtLeast, weekIndexOf, weeklyChallenges } from './engine.ts';
import type { CoachFacts, CoachPlan } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { listDebts, monthLimits } from './account-debts.ts';
import { loadIndicators, refreshIfNeeded, marketStatus } from './market.ts';
import { layout } from './email.ts';
import { planByCode } from './engine.ts';

const ymd = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

export async function loadCoachFacts(ctx: Ctx, subscriberId: string): Promise<{ facts: CoachFacts; openRatesBps: number[] }> {
  const today = todaySaoPaulo();
  const month = monthOf(today);
  const q = ctx.db;
  const [sums, avg, days, base, cat, rem, wal, goals, contribs, poup, recent, pay7, gc7] = await Promise.all([
    q.query<{ income: string; spent: string }>(`SELECT coalesce(sum(amount_cents) FILTER (WHERE amount_cents > 0), 0)::text AS income, coalesce(-sum(amount_cents) FILTER (WHERE amount_cents < 0), 0)::text AS spent FROM app.ledger_entries WHERE subscriber_id = $1 AND to_char(occurred_on, 'YYYY-MM') = $2`, [subscriberId, month]),
    q.query<{ spent: string }>(`SELECT coalesce(-sum(amount_cents), 0)::text AS spent FROM app.ledger_entries WHERE subscriber_id = $1 AND amount_cents < 0 AND occurred_on > ($2::date - 90)`, [subscriberId, today]),
    q.query<{ d7: string; d14: string }>(`SELECT count(DISTINCT occurred_on) FILTER (WHERE occurred_on > ($2::date - 7))::text AS d7, count(DISTINCT occurred_on) FILTER (WHERE occurred_on > ($2::date - 14))::text AS d14 FROM app.ledger_entries WHERE subscriber_id = $1`, [subscriberId, today]),
    q.query<{ category: string; limit_cents: string }>(`SELECT category, limit_cents FROM app.budget_limits WHERE subscriber_id = $1`, [subscriberId]),
    q.query<{ category: string; total: string }>(`SELECT category, (-sum(amount_cents))::text AS total FROM app.ledger_entries WHERE subscriber_id = $1 AND to_char(occurred_on, 'YYYY-MM') = $2 AND amount_cents < 0 GROUP BY category`, [subscriberId, month]),
    q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.reminders WHERE subscriber_id = $1`, [subscriberId]),
    q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wallets WHERE subscriber_id = $1`, [subscriberId]),
    q.query<{ n: string; saved: string }>(`SELECT count(*)::text AS n, coalesce(sum(g.saved_cents + coalesce((SELECT sum(c.amount_cents) FROM app.goal_contributions c WHERE c.goal_id = g.id), 0)), 0)::text AS saved FROM app.goals g WHERE g.subscriber_id = $1`, [subscriberId]),
    q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.goal_contributions WHERE subscriber_id = $1`, [subscriberId]),
    q.query<{ b: string }>(`SELECT coalesce(sum(l.amount_cents), 0)::text AS b FROM app.ledger_entries l JOIN app.wallets w ON w.id = l.wallet_id WHERE l.subscriber_id = $1 AND w.kind = 'poupanca'`, [subscriberId]),
    q.query<{ d: Date | string }>(`SELECT DISTINCT occurred_on AS d FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on > ($2::date - 60) AND occurred_on <= $2::date ORDER BY d DESC`, [subscriberId, today]),
    q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.account_debt_payments WHERE subscriber_id = $1 AND paid_on > ($2::date - 7)`, [subscriberId, today]),
    q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.goal_contributions WHERE subscriber_id = $1 AND occurred_on > ($2::date - 7)`, [subscriberId, today]),
  ]);
  const daySet = new Set(recent.rows.map((r) => ymd(r.d)));
  const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let streak = 0;
  for (let cursor = daySet.has(today) ? today : dayBefore(today); daySet.has(cursor); cursor = dayBefore(cursor)) streak += 1;
  const limits = { ...Object.fromEntries(base.rows.map((r) => [r.category, num(r.limit_cents)])), ...(await monthLimits(ctx, subscriberId, month)) };
  const spentBy = Object.fromEntries(cat.rows.map((r) => [r.category, num(r.total)]));
  const overLimitCount = Object.entries(limits).filter(([c, lim]) => (spentBy[c] ?? 0) > lim).length;
  const d = await listDebts(ctx, subscriberId);
  const open = d.debts.filter((x) => !x.paidOff && x.balanceCents > 0);
  const payments = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.account_debt_payments WHERE subscriber_id = $1`, [subscriberId]);
  const facts: CoachFacts = {
    incomeCents: num(sums.rows[0]?.income ?? 0),
    spentCents: num(sums.rows[0]?.spent ?? 0),
    avgMonthlySpendCents: Math.round(num(avg.rows[0]?.spent ?? 0) / 3),
    daysLogged7: num(days.rows[0]?.d7 ?? 0),
    daysLogged14: num(days.rows[0]?.d14 ?? 0),
    limitsCount: Object.keys(limits).length,
    overLimitCount,
    remindersCount: num(rem.rows[0]?.n ?? 0),
    walletsCount: num(wal.rows[0]?.n ?? 0),
    goalsCount: num(goals.rows[0]?.n ?? 0),
    goalContributions: num(contribs.rows[0]?.n ?? 0),
    savedCents: num(goals.rows[0]?.saved ?? 0) + Math.max(0, num(poup.rows[0]?.b ?? 0)),
    debtsCount: d.debts.length,
    openDebtsCount: open.length,
    paidOffCount: d.debts.filter((x) => x.paidOff).length,
    debtPaymentsCount: num(payments.rows[0]?.n ?? 0),
    debtOwedCents: d.debts.reduce((s, x) => s + x.balanceCents, 0),
    debtInitialCents: d.totals.initialCents,
    debtMinPaymentsCents: d.totals.minPaymentsCents,
    expensiveDebtsOpen: open.filter((x) => x.monthlyRateBps >= 300).length,
    debtPayments7: num(pay7.rows[0]?.n ?? 0),
    goalContribs7: num(gc7.rows[0]?.n ?? 0),
    streakDays: streak,
  };
  return { facts, openRatesBps: open.map((x) => x.monthlyRateBps) };
}

async function planOf(ctx: Ctx, subscriberId: string): Promise<CoachPlan> {
  return (await requireFeature(ctx, subscriberId, 'ledger')) as CoachPlan;
}

/** Painel do coach: nota, jornadas (com a ativa), métodos aplicados à renda e o que fazer hoje. */
export async function coachOverview(ctx: Ctx, subscriberId: string) {
  const plan = await planOf(ctx, subscriberId);
  const { facts } = await loadCoachFacts(ctx, subscriberId);
  const active = await ctx.db.query<{ program: string; started_at: Date }>(`SELECT program, started_at FROM app.journeys WHERE subscriber_id = $1 ORDER BY started_at`, [subscriberId]);
  const manual = await ctx.db.query<{ mission_id: string }>(`SELECT mission_id FROM app.journey_done WHERE subscriber_id = $1`, [subscriberId]);
  const started = new Set(active.rows.map((r) => r.program));
  const obj = await ctx.db.query<{ objective: string | null }>(`SELECT objective FROM app.subscribers WHERE id = $1`, [subscriberId]);
  const journeys = evaluatePrograms(facts, plan, new Set(manual.rows.map((r) => r.mission_id))).map((j) => ({ ...j, started: started.has(j.id), complete: j.progressPct === 100 }));
  const health = healthScore(facts);
  const today = todaySaoPaulo();
  const due = await ctx.db.query<{ title: string; due_on: Date | string }>(`SELECT title, due_on FROM app.reminders WHERE subscriber_id = $1 AND done_at IS NULL AND due_on BETWEEN $2::date AND ($2::date + 7) ORDER BY due_on LIMIT 3`, [subscriberId, today]);
  // O foco do dia: a próxima missão da jornada em andamento; sem jornada, a parte mais fraca da nota.
  const running = journeys.find((j) => j.started && !j.complete && !j.locked);
  const weakest = [...health.parts].sort((a, b) => a.score / a.max - b.score / b.max)[0]!;
  const focus = running?.nextMission
    ? { kind: 'missao' as const, text: running.nextMission, tab: running.missions.find((m) => !m.done)?.tab ?? null, journey: running.title }
    : { kind: 'nota' as const, text: weakest.tip, tab: null, journey: null };
  const cmp = await ctx.db.query<{ m: string; category: string; total: string }>(
    `SELECT CASE WHEN to_char(occurred_on, 'YYYY-MM') = $2 THEN 'cur' ELSE 'prev' END AS m, category, (-sum(amount_cents))::text AS total
       FROM app.ledger_entries
      WHERE subscriber_id = $1 AND amount_cents < 0
        AND ((to_char(occurred_on, 'YYYY-MM') = $2 AND occurred_on <= $3::date)
          OR (to_char(occurred_on, 'YYYY-MM') = $4 AND extract(day FROM occurred_on) <= extract(day FROM $3::date)))
      GROUP BY 1, 2`,
    [subscriberId, monthOf(today), today, monthOf(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10))],
  );
  const side = (m: string) => Object.fromEntries(cmp.rows.filter((r) => r.m === m).map((r) => [r.category, num(r.total)]));
  return {
    plan,
    health,
    objective: obj.rows[0]?.objective ?? null,
    objectives: OBJECTIVES.map((o) => ({ ...o, locked: !planAtLeast(plan, PROGRAMS.find((p) => p.id === o.id)!.minPlan) })),
    streak: facts.streakDays,
    challenges: weeklyChallenges(facts, weekIndexOf(today)),
    compare: compareMonths(side('cur'), side('prev')),
    journeys,
    methods: applyMethods(facts, plan),
    focus,
    upcoming: due.rows.map((r) => ({ title: r.title, dueOn: ymd(r.due_on) })),
  };
}

export async function startJourney(ctx: Ctx, subscriberId: string, program: string): Promise<void> {
  const plan = await planOf(ctx, subscriberId);
  const p = PROGRAMS.find((x) => x.id === program);
  if (!p) throw new AppError(422, 'invalid_program', 'Jornada inexistente.');
  if (!planAtLeast(plan, p.minPlan)) throw new AppError(403, 'plan_upgrade', 'Esta jornada é de um plano acima do seu.');
  await ctx.db.query(`INSERT INTO app.journeys(subscriber_id, program) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [subscriberId, program]);
}

export async function stopJourney(ctx: Ctx, subscriberId: string, program: string): Promise<void> {
  await planOf(ctx, subscriberId);
  await ctx.db.query(`DELETE FROM app.journeys WHERE subscriber_id = $1 AND program = $2`, [subscriberId, program]);
}

/** Missão que só se confirma por evento (ex.: usou o simulador). Só aceita ids de missões que existem. */
export async function markMissionDone(ctx: Ctx, subscriberId: string, missionId: string): Promise<void> {
  if (!PROGRAMS.some((p) => p.missions.some((m) => m.id === missionId))) return;
  await ctx.db.query(`INSERT INTO app.journey_done(subscriber_id, mission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [subscriberId, missionId]);
}

/** Cenário econômico. Controle: os números e o que significam; Ousado: leitura personalizada; Desbravador: séries de 12 meses. */
export async function marketView(ctx: Ctx, subscriberId: string) {
  const plan = await planOf(ctx, subscriberId);
  await refreshIfNeeded(ctx).catch(() => undefined);
  const { indicators, updatedAt, history } = await loadIndicators(ctx);
  const { facts, openRatesBps } = await loadCoachFacts(ctx, subscriberId);
  const insights = marketInsights(indicators, facts, openRatesBps).map((i) => { const locked = !planAtLeast(plan, i.minPlan); return { ...i, locked, text: locked ? '' : i.text }; });
  return {
    plan,
    indicators: planAtLeast(plan, 'desbravador') ? indicators : { ...indicators, usdBrl: null, usdTrend: null },
    updatedAt,
    source: 'Banco Central do Brasil (SGS)',
    insights,
    history: planAtLeast(plan, 'desbravador') ? history : null,
    hasData: updatedAt !== null,
    status: updatedAt === null ? ((await marketStatus(ctx))?.errors ?? null) : null,
  };
}

/** Worker: boas-vindas uma única vez, logo depois que a assinatura fica ativa. É e-mail de conta (a pessoa acabou de assinar). */
export async function sendWelcomes(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) return 0;
  const who = await ctx.db.query<{ id: string; email: string; plan: string }>(
    `SELECT b.id, b.email::text AS email, s.plan FROM app.subscribers b
       JOIN app.subscriptions s ON s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now()
      WHERE b.deleted_at IS NULL AND b.welcome_sent_at IS NULL LIMIT 30`,
  );
  let sent = 0;
  for (const b of who.rows) {
    const plan = planByCode(b.plan);
    const first = b.plan === 'controle' ? 'Organizar o mês' : 'Sair do vermelho';
    const body = layout(`Bem-vindo ao Fôlego, plano ${plan?.name ?? ''}`, [
      'Sua conta está ativa. Para tirar o máximo, faça só isto hoje (5 minutos):',
      `1. Abra a aba Coach e veja a sua nota de saúde financeira.\n2. Comece a jornada "${first}": as missões se confirmam sozinhas conforme você usa o Fôlego.\n3. Lance os gastos de hoje. Todo dia que você lança entra na sua sequência.`,
      'Toda semana o Coach traz 3 desafios novos, e você recebe um resumo por e-mail aos domingos.',
    ], { label: 'Abrir o meu Coach', url: `${ctx.config.publicUrl}/#/conta` });
    try {
      await ctx.email.send({ to: b.email, subject: 'Sua conta no Fôlego está pronta: comece por aqui', ...body });
      await ctx.db.query(`UPDATE app.subscribers SET welcome_sent_at = now() WHERE id = $1`, [b.id]);
      sent += 1;
    } catch {
      opts.log?.({ evento: 'boas_vindas_falhou' });
    }
  }
  return sent;
}

/** Guarda o objetivo e liga a jornada correspondente (se o plano não permitir, cai na jornada Organizar o mês). */
export async function setObjective(ctx: Ctx, subscriberId: string, objective: string): Promise<{ journey: string }> {
  const plan = await planOf(ctx, subscriberId);
  const p = PROGRAMS.find((x) => x.id === objective);
  if (!p) throw new AppError(422, 'invalid_objective', 'Objetivo inválido.');
  const journey = planAtLeast(plan, p.minPlan) ? p.id : 'organizar';
  await ctx.db.query(`UPDATE app.subscribers SET objective = $2 WHERE id = $1`, [subscriberId, objective]);
  await ctx.db.query(`INSERT INTO app.journeys(subscriber_id, program) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [subscriberId, journey]);
  return { journey };
}

export async function goalTemplatesFor(ctx: Ctx, subscriberId: string) {
  await requireFeature(ctx, subscriberId, 'goals');
  const { facts } = await loadCoachFacts(ctx, subscriberId);
  return { templates: goalTemplates(facts) };
}
