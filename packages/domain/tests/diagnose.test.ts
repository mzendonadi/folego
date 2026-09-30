import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnose.ts';
import { buildPreview } from '../src/preview.ts';
import { EngineInputError } from '../src/validate.ts';
import { debt, input, prng } from './helpers.ts';
import type { DebtKind } from '../src/types.ts';

const typical = () =>
  input([
    debt({ id: 'aluguel', kind: 'rent', balanceCents: 150_000, monthlyPaymentCents: 0, daysOverdue: 20, monthlyRateBps: 100 }),
    debt({ id: 'cartao', kind: 'credit_card', balanceCents: 400_000, monthlyPaymentCents: 60_000, monthlyRateBps: 1400, daysOverdue: 0 }),
    debt({ id: 'cheque', kind: 'overdraft', balanceCents: 80_000, monthlyPaymentCents: 20_000, monthlyRateBps: 800, daysOverdue: 0 }),
    debt({ id: 'velha', kind: 'store_credit', creditorName: 'CREDOR_SECRETO_VELHA', balanceCents: 90_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' }),
  ]);

test('ordem: essencial em atraso, depois juros decrescentes; possível prescrição fica fora', () => {
  const d = diagnose(typical());
  assert.deepEqual(d.order, ['aluguel', 'cartao', 'cheque']);
  assert.deepEqual(d.heldAsideIds, ['velha']);
  assert.equal(d.debts.find((x) => x.debtId === 'velha')?.rank, null);
  assert.ok(d.warnings.some((w) => w.code === 'prescription_check_before_paying'));
  assert.ok(d.warnings.some((w) => w.code === 'essential_overdue'));
});

test('plano quita antes do baseline e economiza juros quando ambos terminam', () => {
  const d = diagnose(
    input([
      debt({ id: 'emp', kind: 'personal_loan', balanceCents: 600_000, monthlyPaymentCents: 30_000, remainingInstallments: 24 }),
      debt({ id: 'cartao', kind: 'credit_card', balanceCents: 100_000, monthlyPaymentCents: 20_000, monthlyRateBps: 1000 }),
    ]),
  );
  assert.ok(d.baseline.months !== null && d.plan.months !== null);
  assert.ok(d.plan.months! < d.baseline.months!);
  assert.ok(d.interestSavedCents !== null && d.interestSavedCents > 0);
  assert.equal(d.headline.kind, 'interest_saved');
});

test('déficit: sem extra, lacuna calculada e manchete de lacuna mensal', () => {
  const d = diagnose(
    input([debt({ id: 'a', monthlyRateBps: 500, monthlyPaymentCents: 20_000, balanceCents: 300_000 })], {
      netIncomeCents: 100_000,
      fixedExpensesCents: 90_000,
    }),
  );
  assert.equal(d.budget.surplusCents, -10_000);
  assert.equal(d.budget.gapCents, 10_000);
  assert.equal(d.budget.extraToDebtCents, 0);
  assert.equal(d.headline.kind, 'monthly_gap');
  assert.ok(d.warnings.some((w) => w.code === 'deficit'));
});

test('taxas estimadas geram aviso e reduzem a confiança', () => {
  const d = diagnose(input([debt({ id: 'a', balanceCents: 200_000, monthlyPaymentCents: 40_000 })]));
  assert.equal(d.debts[0]!.rateSource, 'default');
  assert.equal(d.confidence, 'low');
  assert.ok(d.warnings.some((w) => w.code === 'rates_estimated'));
});

test('sem dívidas: nota alta e sem manchete', () => {
  const d = diagnose(input([]));
  assert.equal(d.health.score, 100);
  assert.equal(d.health.band, 'under_control');
  assert.equal(d.headline.kind, 'none');
});

test('refinanciamento: CLT com cartão caro tem troca vantajosa; autônomo não é elegível', () => {
  const debts = [debt({ id: 'cartao', balanceCents: 500_000, monthlyPaymentCents: 30_000, monthlyRateBps: 1400 })];
  const clt = diagnose(input(debts, { netIncomeCents: 400_000, fixedExpensesCents: 200_000, employmentType: 'clt' }));
  assert.equal(clt.refinance.suitabilityOk, true);
  assert.ok(clt.refinance.estimatedSavingsCents > 0);
  const auto = diagnose(input(debts, { netIncomeCents: 400_000, fixedExpensesCents: 200_000, employmentType: 'self_employed' }));
  assert.equal(auto.refinance.suitabilityOk, false);
  assert.equal(auto.refinance.reason, 'no_payroll_eligibility');
});

test('regressão: economia estimada de troca nunca passa do saldo da dívida (sem números absurdos)', () => {
  const d = diagnose(
    input([debt({ id: 'cartao', balanceCents: 420_000, monthlyPaymentCents: 42_000 })], { netIncomeCents: 320_000, fixedExpensesCents: 170_000 }),
  );
  assert.ok(d.refinance.estimatedSavingsCents > 0);
  assert.ok(d.refinance.estimatedSavingsCents < 420_000, `economia ${d.refinance.estimatedSavingsCents}`);
});

test('refinanciamento não aprovado quando estouraria o orçamento', () => {
  const debts = [debt({ id: 'cartao', balanceCents: 500_000, monthlyPaymentCents: 0, monthlyRateBps: 1400 })];
  const r = diagnose(input(debts, { netIncomeCents: 200_000, fixedExpensesCents: 199_000 }));
  assert.equal(r.refinance.suitabilityOk, false);
});

test('preview não vaza conteúdo pago', () => {
  const inp = typical();
  const d = diagnose(inp);
  const p = buildPreview(d, inp.debts);
  const json = JSON.stringify(p);
  for (const key of ['"order"', '"plan"', '"baseline"', '"negotiationPotential"', '"refinance"', '"budget"', '"alternatives"', '"debts"']) {
    assert.ok(!json.includes(key), `preview contém ${key}`);
  }
  assert.ok(!json.includes('CREDOR_SECRETO_VELHA'), 'vazou credor fora da fila');
  assert.equal(p.firstPriority?.creditorName, 'Credor aluguel');
  assert.equal(p.prescriptionTeaser.possibleCount, 1);
  assert.ok(p.lockedSections.length > 0);
});

test('determinismo: mesma entrada, mesma saída', () => {
  assert.deepEqual(diagnose(typical()), diagnose(typical()));
});

test('validação rejeita entradas inválidas', () => {
  assert.throws(() => diagnose(input([debt({ id: 'a', balanceCents: -1 })])), EngineInputError);
  assert.throws(() => diagnose(input([debt({ id: 'a' }), debt({ id: 'a' })])), EngineInputError);
  assert.throws(() => diagnose(input([debt({ id: 'a', daysOverdue: 5, firstDefaultOn: '2030-01-01' })])), EngineInputError);
  assert.throws(() => diagnose(input([debt({ id: 'a', balanceCents: 10.5 })])), EngineInputError);
});

test('propriedade: o plano nunca paga mais juros que o baseline (quando ambos quitam)', () => {
  const rnd = prng(7);
  const kinds: DebtKind[] = ['credit_card', 'overdraft', 'personal_loan', 'store_credit', 'financing', 'rent'];
  let compared = 0;
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rnd() * 5);
    const debts = Array.from({ length: n }, (_, k) =>
      debt({
        id: `d${k}`,
        kind: kinds[Math.floor(rnd() * kinds.length)]!,
        balanceCents: 20_000 + Math.floor(rnd() * 1_500_000),
        monthlyRateBps: Math.floor(rnd() * 1400),
        monthlyPaymentCents: 5_000 + Math.floor(rnd() * 80_000),
        daysOverdue: rnd() < 0.3 ? Math.floor(rnd() * 200) : 0,
      }),
    );
    const d = diagnose(input(debts, { netIncomeCents: 800_000, fixedExpensesCents: 300_000 }));
    if (d.baseline.months !== null && d.plan.months !== null) {
      compared++;
      assert.ok(d.plan.totalInterestCents <= d.baseline.totalInterestCents, `cenário ${i}`);
      assert.ok(d.plan.months <= d.baseline.months, `prazo, cenário ${i}`);
    }
  }
  assert.ok(compared > 30, `poucos cenários comparáveis: ${compared}`);
});

test('preview traz só contagens do que há a mais, sem revelar quais dívidas nem valores', () => {
  const inp = typical();
  const p = buildPreview(diagnose(inp), inp.debts);
  assert.deepEqual(p.discoveries, { moreInQueue: 2, negotiable: 0, lettersEligible: 2, essentialOverdue: true });
  const json = JSON.stringify(p.discoveries);
  assert.ok(!/cartao|cheque|aluguel|CREDOR/i.test(json));
  assert.deepEqual(Object.keys(p.discoveries).sort(), ['essentialOverdue', 'lettersEligible', 'moreInQueue', 'negotiable']);
});
