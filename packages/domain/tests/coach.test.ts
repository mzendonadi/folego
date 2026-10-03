import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyChallenges, compareMonths, healthScore, evaluatePrograms, applyMethods, marketInsights, annualFromMonthlyPct } from '../src/coach.ts';
import type { CoachFacts, Indicators } from '../src/coach.ts';

const base: CoachFacts = { incomeCents: 500_000, spentCents: 400_000, avgMonthlySpendCents: 400_000, daysLogged7: 5, daysLogged14: 10, limitsCount: 3, overLimitCount: 0, remindersCount: 3, walletsCount: 1, goalsCount: 1, goalContributions: 2, savedCents: 800_000, debtsCount: 0, openDebtsCount: 0, paidOffCount: 0, debtPaymentsCount: 0, debtOwedCents: 0, debtInitialCents: 0, debtMinPaymentsCents: 0, expensiveDebtsOpen: 0, debtPayments7: 0, goalContribs7: 1, streakDays: 3 };

test('saúde: pessoa organizada, com reserva de 2 meses e sem dívida, passa de 60; quem gasta mais do que ganha e deve caro fica crítico', () => {
  const good = healthScore(base);
  assert.ok(good.score >= 60 && good.parts.length === 4);
  const bad = healthScore({ ...base, spentCents: 650_000, savedCents: 0, daysLogged14: 1, limitsCount: 0, openDebtsCount: 2, debtsCount: 2, debtMinPaymentsCents: 300_000, expensiveDebtsOpen: 2 });
  assert.equal(bad.level, 'critico');
  assert.ok(bad.score < good.score);
  assert.equal(healthScore({ ...base, incomeCents: 0, spentCents: 0 }).hasData, false);
});

test('jornadas: missões se confirmam pelos dados e o plano controla o acesso', () => {
  const p = evaluatePrograms(base, 'controle');
  const org = p.find((x) => x.id === 'organizar')!;
  assert.equal(org.locked, false);
  assert.equal(org.progressPct, 100);
  assert.equal(p.find((x) => x.id === 'sair_do_vermelho')!.locked, true);
  assert.equal(p.find((x) => x.id === 'investir')!.locked, true);
  const reserva = evaluatePrograms(base, 'ousado').find((x) => x.id === 'reserva')!;
  assert.deepEqual(reserva.missions.map((m) => m.done), [true, true, true, false, false]);
  assert.equal(evaluatePrograms(base, 'desbravador').find((x) => x.id === 'investir')!.missions[3]!.done, false);
  assert.equal(evaluatePrograms(base, 'desbravador', new Set(['i4'])).find((x) => x.id === 'investir')!.missions[3]!.done, true);
});

test('métodos aplicam a renda da pessoa e respeitam o plano', () => {
  const m = applyMethods(base, 'controle');
  assert.match(m.find((x) => x.id === '50_30_20')!.yours!, /2\.500/);
  assert.equal(m.find((x) => x.id === 'avalanche')!.locked, true);
  assert.equal(applyMethods(base, 'desbravador').every((x) => !x.locked), true);
});

test('cenário: juro mensal vira anual e a dívida cara é comparada ao CDI', () => {
  assert.ok(Math.abs(annualFromMonthlyPct(1) - 12.68) < 0.01);
  const ind: Indicators = { selicPct: 14.75, ipca12Pct: 5.2, cdiPct: 14.65, usdBrl: 5.4, selicTrend: -0.5, ipcaTrend: 0, usdTrend: 0.1 };
  const list = marketInsights(ind, { ...base, expensiveDebtsOpen: 1 }, [1250]);
  assert.ok(list.some((i) => i.id === 'divida_vs_cdi' && /12,5% ao mês/.test(i.text)));
  assert.ok(list.some((i) => i.id === 'renegociar'));
  assert.ok(list.some((i) => i.id === 'juro_real' && i.tone === 'good'));
  assert.equal(marketInsights({ selicPct: null, ipca12Pct: null, cdiPct: null, usdBrl: null, selicTrend: null, ipcaTrend: null, usdTrend: null }, base).length, 0);
});

test('desafios da semana: só os aplicáveis, 3 no máximo, rodam por semana; comparação de meses acha o que mudou', () => {
  const sem = weeklyChallenges(base, 2960);
  assert.ok(sem.length >= 1 && sem.length <= 3);
  assert.equal(sem[0].id, 'w_registrar');
  assert.ok(!weeklyChallenges(base, 1).some((c) => c.id === 'w_divida'), 'sem dívida aberta não propõe pagar dívida');
  assert.notDeepEqual(weeklyChallenges(base, 1).map((c) => c.id), weeklyChallenges(base, 2).map((c) => c.id));
  const cmp = compareMonths({ mercado: 80_000, lazer: 20_000 }, { mercado: 50_000, lazer: 40_000 });
  assert.equal(cmp.verdict, 'mais');
  assert.equal(cmp.changes[0].category, 'mercado');
  assert.equal(cmp.changes[0].deltaPct, 60);
  assert.equal(compareMonths({ a: 100 }, {}).verdict, 'sem_base');
  assert.equal(compareMonths({ a: 50_000 }, { a: 100_000 }).verdict, 'menos');
});
