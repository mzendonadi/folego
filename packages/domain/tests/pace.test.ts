import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPace } from '../src/pace.ts';

const e = (date: string, cents: number, note = 'x') => ({ date, amountCents: cents, note });

test('ritmo do mês: acumulado, comparação com o mês anterior no mesmo dia, maior gasto e projeção', () => {
  const entries = [
    e('2026-09-02', -10_000), e('2026-09-10', -20_000), e('2026-09-25', -50_000), // setembro: 800 no total, 300 até o dia 10
    e('2026-10-01', -5_000, 'Mercado'), e('2026-10-05', -30_000, 'Aluguel parcial'), e('2026-10-08', -1_000, 'Café'), e('2026-10-10', 200_000, 'Salário'),
    e('2026-10-20', -99_000, 'Dia que ainda não chegou'),
  ];
  const p = buildPace(entries, '2026-10', '2026-10-10');
  assert.equal(p.daysInMonth, 31);
  assert.equal(p.daysCounted, 10);
  assert.equal(p.spentSoFarCents, 36_000, 'entrada não conta e o dia 20 ainda não chegou');
  assert.equal(p.cumulative.length, 10);
  assert.equal(p.cumulative[0], 5_000);
  assert.equal(p.cumulative[9], 36_000);
  assert.equal(p.previousSameDayCents, 30_000);
  assert.equal(p.diffPct, 20, '360 contra 300 = 20% a mais');
  assert.equal(p.projectionCents, Math.round((36_000 / 10) * 31));
  assert.deepEqual(p.biggest, { note: 'Aluguel parcial', amountCents: -30_000, date: '2026-10-05' });
  assert.equal(p.spendByDay[4], 30_000);
  assert.equal(p.spendByDay[19], 0, 'dia futuro fica zerado');
});

test('ritmo do mês: mês passado conta inteiro; mês sem anterior não inventa diferença; poucos dias não projetam', () => {
  const past = buildPace([e('2026-09-30', -7_000)], '2026-09', '2026-10-24');
  assert.equal(past.daysCounted, 30);
  assert.equal(past.spentSoFarCents, 7_000);
  assert.equal(past.projectionCents, null);
  assert.equal(past.diffPct, null);
  const fresh = buildPace([e('2026-10-02', -1_000)], '2026-10', '2026-10-03');
  assert.equal(fresh.projectionCents, null, 'menos de 5 dias de dados');
  assert.equal(buildPace([], '2026-10', '2026-10-24').biggest, null);
  assert.equal(buildPace([e('2026-12-05', -100)], '2027-01', '2026-12-31').daysCounted, 0, 'mês que não começou');
  assert.equal(buildPace([e('2026-12-05', -4_000)], '2027-01', '2027-01-06').previousSameDayCents, 4_000, 'janeiro compara com dezembro do ano anterior');
});
