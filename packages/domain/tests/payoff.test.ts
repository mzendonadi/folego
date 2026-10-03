import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayoffPlan } from '../src/payoff.ts';

const debts = [
  { id: 'a', name: 'Cartão', balanceCents: 500_000, monthlyRateBps: 1200, minPaymentCents: 50_000 },
  { id: 'b', name: 'Loja', balanceCents: 100_000, monthlyRateBps: 300, minPaymentCents: 20_000 },
];

test('avalanche paga menos juros que bola de neve e escolhe o cartão como foco', () => {
  const p = buildPayoffPlan(debts, 50_000);
  assert.ok(p.avalanche.totalInterestCents <= p.snowball.totalInterestCents);
  assert.equal(p.recommended, 'avalanche');
  assert.equal(p.focusId, 'a');
  assert.equal(p.avalanche.order.length, 2);
  assert.ok(p.avalanche.months > 0 && !p.avalanche.neverPaysOff);
});

test('mais extra quita mais rápido; parcela abaixo dos juros nunca quita', () => {
  assert.ok(buildPayoffPlan(debts, 200_000).avalanche.months < buildPayoffPlan(debts, 0).avalanche.months);
  const stuck = buildPayoffPlan([{ id: 'x', name: 'X', balanceCents: 1_000_000, monthlyRateBps: 1500, minPaymentCents: 10_000 }], 0);
  assert.equal(stuck.avalanche.neverPaysOff, true);
});

test('sem dívida aberta: 0 meses e sem foco', () => {
  const p = buildPayoffPlan([{ id: 'z', name: 'Z', balanceCents: 0, monthlyRateBps: 100, minPaymentCents: 1000 }], 0);
  assert.equal(p.avalanche.months, 0);
  assert.equal(p.focusId, null);
});
