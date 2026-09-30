import type { BudgetSummary, Profile, RefinanceAssessment, RefinanceCandidate, ResolvedDebt } from './types.ts';
import type { Rules } from './config.ts';
import { annuityPaymentCents } from './rates.ts';
import { simulate } from './simulate.ts';

const PAYROLL_ELIGIBLE = new Set(['inss_retiree', 'public_servant', 'clt']);

/**
 * Troca de dívida cara por crédito consignado (estimativa com taxa de referência; NÃO é oferta).
 * Também é o filtro de adequação dos leads: só é "ok" se a troca reduz o custo, cabe na margem
 * consignável e não deixa o orçamento negativo.
 */
export function assessRefinance(
  profile: Profile,
  included: ResolvedDebt[],
  budget: BudgetSummary,
  rules: Rules,
): RefinanceAssessment {
  if (!PAYROLL_ELIGIBLE.has(profile.employmentType)) {
    return { candidates: [], estimatedSavingsCents: 0, suitabilityOk: false, reason: 'no_payroll_eligibility' };
  }

  const { termMonths, payrollRateBps, minRateBps, marginMaxShare } = rules.refinance;

  const evaluated: RefinanceCandidate[] = [];
  for (const d of included) {
    if (d.kind === 'payroll_loan' || d.rateBps < minRateBps || d.balanceCents <= 0) continue;
    const newPaymentCents = annuityPaymentCents(d.balanceCents, payrollRateBps, termMonths);
    const newCost = newPaymentCents * termMonths;
    const old = simulate([d], { mode: 'independent', poolCents: 0, priority: [], maxMonths: termMonths });
    const oldCost = old.totalPaidCents + old.remainingBalanceCents;
    const estimatedSavingsCents = oldCost - newCost;
    if (estimatedSavingsCents > 0) {
      evaluated.push({
        debtId: d.id,
        oldMonthlyRateBps: d.rateBps,
        newMonthlyRateBps: payrollRateBps,
        newPaymentCents,
        termMonths,
        estimatedSavingsCents,
      });
    }
  }
  evaluated.sort((a, b) => b.estimatedSavingsCents - a.estimatedSavingsCents || a.debtId.localeCompare(b.debtId));

  const existingPayroll = included.filter((d) => d.kind === 'payroll_loan').reduce((s, d) => s + d.minPaymentCents, 0);
  const marginCents = Math.floor(profile.netIncomeCents * marginMaxShare) - existingPayroll;

  const byId = new Map(included.map((d) => [d.id, d]));
  const accepted: RefinanceCandidate[] = [];
  let payrollAdded = 0;
  let surplus = budget.surplusCents;
  for (const c of evaluated) {
    const replaced = byId.get(c.debtId)?.minPaymentCents ?? 0;
    const nextSurplus = surplus + replaced - c.newPaymentCents;
    if (payrollAdded + c.newPaymentCents <= marginCents && nextSurplus >= 0) {
      accepted.push(c);
      payrollAdded += c.newPaymentCents;
      surplus = nextSurplus;
    }
  }

  const estimatedSavingsCents = accepted.reduce((s, c) => s + c.estimatedSavingsCents, 0);
  return {
    candidates: accepted,
    estimatedSavingsCents,
    suitabilityOk: accepted.length > 0,
    reason: accepted.length > 0 ? 'ok' : 'no_beneficial_swap',
  };
}
