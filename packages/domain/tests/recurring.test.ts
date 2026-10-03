import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, merchantKey } from '../src/recurring.ts';
import { simulateScenario, DEFAULT_CHANGE } from '../src/scenario.ts';

const mk = (note: string, cents: number, dates: string[]) => dates.map((date) => ({ date, amountCents: -cents, note }));

test('chave do estabelecimento ignora números, datas e ruído', () => {
  assert.equal(merchantKey('NETFLIX.COM 12/09 *4421'), 'NETFLIX');
  assert.equal(merchantKey('Compra no cartão - SPOTIFY 10/08'), 'SPOTIFY');
  assert.equal(merchantKey('PIX ENVIADO 123'), '');
});

test('detecta assinaturas mensais, aumento de preço e cobrança em duplicidade', () => {
  const entries = [
    ...mk('NETFLIX 05/06', 3990, ['2026-06-05', '2026-07-05', '2026-08-05']),
    ...mk('NETFLIX 05/09', 4990, ['2026-09-05']),
    ...mk('SPOTIFY', 2190, ['2026-07-10', '2026-08-10', '2026-09-10', '2026-09-12']),
    ...mk('ACADEMIA SMART', 11900, ['2026-07-01', '2026-08-01', '2026-09-01']),
    ...mk('MERCADO BOM', 8000, ['2026-09-02']),
    ...mk('SEGURO CELULAR', 3000, ['2025-09-20', '2026-09-20']),
    { date: '2026-09-15', amountCents: 500000, note: 'SALARIO' },
  ];
  const r = detectRecurring(entries, '2026-10-02');
  const by = (n: string) => r.items.find((i) => i.key.startsWith(n))!;
  assert.ok(by('NETFLIX').priceChange);
  assert.equal(by('NETFLIX').priceChange!.pct, 25);
  assert.equal(by('NETFLIX').cadence, 'mensal');
  assert.ok(by('SPOTIFY').duplicate, 'duas cobranças iguais em 2 dias');
  assert.equal(by('SEGURO').cadence, 'anual');
  assert.equal(by('SEGURO').monthlyCents, 250);
  assert.ok(!r.items.some((i) => i.key.startsWith('MERCADO')), 'compra solta não é recorrência');
  assert.equal(r.monthlyTotalCents, r.items.reduce((s, i) => s + i.monthlyCents, 0));
  assert.equal(r.priceIncreases.length, 1);
  assert.equal(r.duplicates.length, 1);
});

test('cobrança que parou há meses sai da lista', () => {
  const r = detectRecurring(mk('SERVICO ANTIGO', 5000, ['2026-01-05', '2026-02-05', '2026-03-05']), '2026-10-02');
  assert.equal(r.items.length, 0);
});

test('cenário: novo emprego com transição, ponto de equilíbrio e alerta de reserva', () => {
  const base = { incomeCents: 400000, essentialCents: 220000, flexibleCents: 80000, debtPaymentsCents: 40000, reserveCents: 300000 };
  const same = simulateScenario(base, DEFAULT_CHANGE);
  assert.equal(same.verdict, 'igual');
  assert.equal(same.deltaMonthlyCents, 0);
  const r = simulateScenario(base, { ...DEFAULT_CHANGE, newIncomeCents: 520000, essentialDeltaCents: 20000, gapMonths: 2, oneTimeCostCents: 50000, months: 24 });
  assert.equal(r.beforeMonthlyCents, 60000);
  assert.equal(r.afterMonthlyCents, 520000 - 240000 - 80000 - 40000);
  assert.equal(r.verdict, 'melhora');
  assert.equal(r.timeline.length, 25);
  assert.ok(r.breakEvenMonth !== null && r.breakEvenMonth > 2);
  assert.ok(r.lowestAfterCents < base.reserveCents, 'a transição afunda o saldo antes de melhorar');
  const broke = simulateScenario({ ...base, reserveCents: 100000 }, { ...DEFAULT_CHANGE, newIncomeCents: 450000, gapMonths: 3 });
  assert.ok(broke.reserveRunsOutMonth !== null);
  assert.ok(broke.warnings.some((w) => /reserva atual não cobre/.test(w)));
  const worse = simulateScenario(base, { ...DEFAULT_CHANGE, newIncomeCents: 300000 });
  assert.equal(worse.verdict, 'piora');
  assert.ok(worse.warnings.some((w) => /vermelho/.test(w)));
});
