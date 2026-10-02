import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategies, diagnose } from '../src/index.ts';
import type { DiagnoseInput } from '../src/index.ts';

const base: DiagnoseInput = {
  asOf: '2026-10-01',
  profile: { netIncomeCents: 400_000, fixedExpensesCents: 250_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [
    { id: 'd1', creditorName: 'Cartão A', kind: 'credit_card', balanceCents: 300_000, monthlyPaymentCents: 30_000, monthlyRateBps: 1200, daysOverdue: 0 },
    { id: 'd2', creditorName: 'Loja B', kind: 'store_credit', balanceCents: 80_000, monthlyPaymentCents: 10_000, monthlyRateBps: 500, daysOverdue: 90 },
    { id: 'd3', creditorName: 'Banco C', kind: 'personal_loan', balanceCents: 500_000, monthlyPaymentCents: 35_000, monthlyRateBps: 350, daysOverdue: 0 },
  ],
};

test('comparação traz os 4 caminhos, com o plano recomendado e os mesmos números do diagnóstico', () => {
  const d = diagnose(base);
  const s = buildStrategies(base);
  assert.deepEqual(s.comparison.map((c) => c.id), ['baseline', 'plan', 'avalanche', 'snowball']);
  const plan = s.comparison.find((c) => c.id === 'plan')!;
  assert.equal(plan.recommended, true);
  assert.equal(plan.months, d.plan.months);
  assert.equal(plan.interestCents, d.plan.totalInterestCents);
  assert.ok(s.verdict.length > 20);
});

test('cada real a mais nunca piora: mais extra = menos (ou iguais) meses e juros', () => {
  const s = buildStrategies(base);
  assert.equal(s.whatIfExtra.length, 4);
  for (let i = 1; i < s.whatIfExtra.length; i++) {
    assert.ok((s.whatIfExtra[i]!.months ?? 0) <= (s.whatIfExtra[i - 1]!.months ?? 0));
    assert.ok((s.whatIfExtra[i]!.interestSavedCents ?? 0) >= (s.whatIfExtra[i - 1]!.interestSavedCents ?? 0));
  }
  assert.ok(s.whatIfExtra[0]!.interestSavedCents! > 0);
});

test('plano mês a mês: soma do mês bate com o valor disponível e segue a ordem do plano', () => {
  const d = diagnose(base);
  const s = buildStrategies(base);
  assert.equal(s.schedule.length, 6);
  assert.equal(s.schedule[0]!.ym, '2026-11');
  assert.equal(s.schedule[0]!.totalCents, d.budget.poolCents);
  const first = s.schedule[0]!.payments.find((p) => p.debtId === d.order[0])!;
  const minimum = base.debts.find((x) => x.id === d.order[0])!.monthlyPaymentCents!;
  assert.ok(first.cents > minimum, 'a dívida da vez recebe mais do que a parcela');
  assert.ok(s.schedule[5]!.remainingCents < s.schedule[0]!.remainingCents);
});

test('marcos: uma quitação por dívida, em ordem, terminando em "livre das dívidas"', () => {
  const d = diagnose(base);
  const s = buildStrategies(base);
  assert.equal(s.milestones.filter((m) => m.kind === 'payoff').length, 3);
  assert.equal(s.milestones.at(-1)!.kind, 'debt_free');
  assert.equal(s.milestones.at(-1)!.month, d.plan.months);
  for (let i = 1; i < s.milestones.length; i++) assert.ok(s.milestones[i]!.month >= s.milestones[i - 1]!.month);
});

test('quitação com desconto só para dívida em atraso; dinheiro extra aplicado na ordem do plano', () => {
  const s = buildStrategies(base);
  assert.deepEqual(s.settlements.map((x) => x.debtId), ['d2']);
  assert.equal(s.settlements[0]!.bestCaseCents, 40_000);
  assert.equal(s.settlements[0]!.worstCaseCents, 72_000);
  assert.equal(s.lumpSum!.lumpCents, 400_000);
  assert.ok(s.lumpSum!.interestSavedCents! > 0);
  assert.ok(s.lumpSum!.appliedTo.length >= 1);
});

test('roteiro: rotativo caro, desconto à vista e consignado aparecem; orçamento negativo muda o foco', () => {
  const ids = buildStrategies(base).playbook.map((p) => p.id);
  assert.ok(ids.includes('sair_do_rotativo'));
  assert.ok(ids.includes('quitar_com_desconto'));
  assert.ok(ids.includes('trocar_por_consignado'));
  assert.ok(!ids.includes('fechar_conta'));

  const tight = buildStrategies({ ...base, profile: { ...base.profile, netIncomeCents: 300_000 } });
  const tightIds = tight.playbook.map((p) => p.id);
  assert.equal(tightIds[0], 'fechar_conta');
  assert.ok(tightIds.includes('superendividamento'));
  assert.equal(tight.schedule.length, 0);
  assert.equal(tight.milestones.length, 0);
  assert.match(tight.verdict, /faltam/);
});

test('sem dívida na fila (tudo possivelmente prescrito) não quebra', () => {
  const s = buildStrategies({ ...base, debts: [{ id: 'd1', creditorName: 'Antiga', kind: 'credit_card', balanceCents: 100_000, daysOverdue: 2500, firstDefaultOn: '2019-01-01' }] });
  assert.equal(s.comparison.length, 0);
  assert.ok(s.playbook.some((p) => p.id === 'prescricao'));
});
