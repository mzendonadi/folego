import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annuityPaymentCents, impliedRateBps, resolveDebt } from '../src/rates.ts';
import { simulate } from '../src/simulate.ts';
import { RULES } from '../src/config.ts';
import { debt, prng } from './helpers.ts';
import type { DebtKind, ResolvedDebt } from '../src/types.ts';

const resolved = (partial: Parameters<typeof debt>[0]): ResolvedDebt => resolveDebt(debt(partial), RULES);

test('parcela Price: R$ 10.000 a 2% a.m. em 12x = R$ 945,60', () => {
  assert.equal(annuityPaymentCents(1_000_000, 200, 12), 94_560);
});

test('taxa implícita recupera ~2% a.m. a partir de saldo, parcela e prazo', () => {
  const r = impliedRateBps(1_000_000, 94_560, 12);
  assert.ok(r !== null && r >= 199 && r <= 200, `obtido ${r}`);
});

test('taxa implícita: parcela insuficiente para quitar no prazo => null', () => {
  assert.equal(impliedRateBps(1_000_000, 50_000, 12), null);
});

test('resolveDebt: declarada > implícita > padrão', () => {
  assert.equal(resolved({ id: 'a', monthlyRateBps: 321 }).rateSource, 'declared');
  const implied = resolved({ id: 'b', kind: 'personal_loan', balanceCents: 1_000_000, monthlyPaymentCents: 94_560, remainingInstallments: 12 });
  assert.equal(implied.rateSource, 'implied');
  const card = resolved({ id: 'c', kind: 'credit_card', balanceCents: 1_000_000, monthlyPaymentCents: 94_560, remainingInstallments: 12 });
  assert.equal(card.rateSource, 'default'); // cartão nunca usa taxa implícita
  assert.equal(card.rateBps, RULES.defaultMonthlyRateBps.credit_card);
});

test('simulação de empréstimo Price quita em 12 meses com juros ~ R$ 1.347', () => {
  const d = resolved({ id: 'l', kind: 'personal_loan', balanceCents: 1_000_000, monthlyRateBps: 200, monthlyPaymentCents: 94_560 });
  const r = simulate([d], { mode: 'independent', poolCents: 0, priority: [], maxMonths: 600 });
  assert.equal(r.months, 12);
  assert.ok(Math.abs(r.totalInterestCents - 134_715) <= 30, `juros ${r.totalInterestCents}`);
});

test('parcela abaixo dos juros (sem teto): nunca quita', () => {
  const d = resolved({ id: 'c', kind: 'personal_loan', balanceCents: 100_000, monthlyRateBps: 1400, monthlyPaymentCents: 10_000 });
  const r = simulate([d], { mode: 'independent', poolCents: 0, priority: [], maxMonths: 600 });
  assert.equal(r.months, null);
  assert.equal(r.capped, true);
  assert.ok(r.remainingBalanceCents > 100_000);
});

test('teto de juros do cartão: sem pagar nada, juros param em 100% do saldo', () => {
  const d = resolved({ id: 'c', kind: 'credit_card', balanceCents: 100_000, monthlyRateBps: 1400, monthlyPaymentCents: 0 });
  assert.equal(d.interestCapCents, 100_000);
  const r = simulate([d], { mode: 'independent', poolCents: 0, priority: [], maxMonths: 120 });
  assert.equal(r.totalInterestCents, 100_000);
  assert.equal(r.remainingBalanceCents, 200_000);
});

test('pool: parcela liberada rola para a próxima dívida', () => {
  const a = resolved({ id: 'A', balanceCents: 1000, monthlyRateBps: 0, monthlyPaymentCents: 100 });
  const b = resolved({ id: 'B', balanceCents: 1000, monthlyRateBps: 0, monthlyPaymentCents: 100 });
  const r = simulate([a, b], { mode: 'pooled', poolCents: 400, priority: ['A', 'B'], maxMonths: 600 });
  assert.equal(r.payoffMonthById.A, 4);
  assert.equal(r.payoffMonthById.B, 5);
  assert.equal(r.months, 5);
  assert.equal(r.totalPaidCents, 2000);
});

test('conservação: pago + saldo restante = saldo inicial + juros (200 cenários aleatórios)', () => {
  const rnd = prng(42);
  const kinds: DebtKind[] = ['credit_card', 'overdraft', 'personal_loan', 'store_credit', 'financing'];
  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    const debts = Array.from({ length: n }, (_, k) =>
      resolved({
        id: `d${k}`,
        kind: kinds[Math.floor(rnd() * kinds.length)]!,
        balanceCents: 10_000 + Math.floor(rnd() * 2_000_000),
        monthlyRateBps: Math.floor(rnd() * 1500),
        monthlyPaymentCents: Math.floor(rnd() * 100_000),
      }),
    );
    const initial = debts.reduce((s, d) => s + d.balanceCents, 0);
    const pool = debts.reduce((s, d) => s + d.minPaymentCents, 0) + Math.floor(rnd() * 100_000);
    for (const mode of ['independent', 'pooled'] as const) {
      const r = simulate(debts, { mode, poolCents: pool, priority: debts.map((d) => d.id), maxMonths: 600 });
      assert.equal(r.totalPaidCents + r.remainingBalanceCents, initial + r.totalInterestCents, `cenário ${i} ${mode}`);
    }
  }
});
