import type {
  Confidence,
  DebtDiagnosis,
  Diagnosis,
  DiagnoseInput,
  Headline,
  PrescriptionAssessment,
  Warning,
} from './types.ts';
import { ENGINE_VERSION, RULES } from './config.ts';
import type { Rules } from './config.ts';
import { resolveDebt } from './rates.ts';
import { assessPrescription } from './prescription.ts';
import { prioritize } from './priority.ts';
import { buildBudget } from './budget.ts';
import { scoreHealth } from './health.ts';
import { assessRefinance } from './refinance.ts';
import { simulate } from './simulate.ts';
import { validateInput } from './validate.ts';

/** Ponto de entrada do motor: função pura, sem I/O, sem relógio, sem IA. */
export function diagnose(input: DiagnoseInput, rules: Rules = RULES): Diagnosis {
  validateInput(input);
  const { profile, asOf } = input;

  const resolved = input.debts.map((d) => resolveDebt(d, rules));
  const prescriptions = new Map<string, PrescriptionAssessment>(
    resolved.map((d) => [d.id, assessPrescription(d, asOf, rules)]),
  );

  const recommended = prioritize(resolved, prescriptions, 'recommended');
  const rankById = new Map(recommended.map((p) => [p.debtId, p]));
  const heldAsideIds = recommended.filter((p) => p.rank === null).map((p) => p.debtId);
  const order = recommended.filter((p) => p.rank !== null).map((p) => p.debtId);
  const included = resolved.filter((d) => rankById.get(d.id)?.rank !== null);

  const budget = buildBudget(profile, resolved, included, rules);
  const health = scoreHealth(budget, resolved, included, rules);

  const baseline = simulate(included, { mode: 'independent', poolCents: 0, priority: [], maxMonths: rules.maxMonths });
  const runPooled = (priority: string[]) =>
    simulate(included, { mode: 'pooled', poolCents: budget.poolCents, priority, maxMonths: rules.maxMonths });

  const plan = runPooled(order);
  const idsOf = (strategy: 'avalanche' | 'snowball') =>
    prioritize(included, prescriptions, strategy)
      .filter((p) => p.rank !== null)
      .map((p) => p.debtId);
  const alternatives = { avalanche: runPooled(idsOf('avalanche')), snowball: runPooled(idsOf('snowball')) };

  const interestSavedCents =
    baseline.months !== null && plan.months !== null ? baseline.totalInterestCents - plan.totalInterestCents : null;

  let low = 0;
  let high = 0;
  for (const d of included) {
    if (d.daysOverdue > 0) {
      low += Math.round(d.balanceCents * rules.negotiationDiscount.lowPct);
      high += Math.round(d.balanceCents * rules.negotiationDiscount.highPct);
    }
  }

  const refinance = assessRefinance(profile, included, budget, rules);

  const debts: DebtDiagnosis[] = resolved.map((d) => {
    const p = rankById.get(d.id);
    const prescription = prescriptions.get(d.id);
    if (!p || !prescription) throw new Error(`Estado inconsistente para ${d.id}`);
    return {
      debtId: d.id,
      rateBps: d.rateBps,
      rateSource: d.rateSource,
      prescription,
      tier: p.tier,
      rank: p.rank,
      payoffMonth: p.rank === null ? null : (plan.payoffMonthById[d.id] ?? null),
    };
  });

  const warnings: Warning[] = [];
  if (budget.deficit) warnings.push({ code: 'deficit' });
  const estimated = resolved.filter((d) => d.rateSource === 'default').map((d) => d.id);
  if (estimated.length > 0) warnings.push({ code: 'rates_estimated', debtIds: estimated });
  const essential = recommended.filter((p) => p.tier === 'essential_overdue').map((p) => p.debtId);
  if (essential.length > 0) warnings.push({ code: 'essential_overdue', debtIds: essential });
  const prescriptionFlags = resolved
    .filter((d) => {
      const s = prescriptions.get(d.id)?.status;
      return s === 'possible' || s === 'approaching';
    })
    .map((d) => d.id);
  if (prescriptionFlags.length > 0) warnings.push({ code: 'prescription_check_before_paying', debtIds: prescriptionFlags });
  if (included.length > 0 && baseline.months === null) warnings.push({ code: 'baseline_never_pays_off' });
  if (included.length > 0 && plan.months === null) warnings.push({ code: 'plan_never_pays_off' });
  // Parcela menor que os juros do mês: a dívida só cresce (o teto de juros esconde isso no prazo, que vira décadas).
  const belowInterest = included
    .filter((d) => d.balanceCents > 0 && d.minPaymentCents < Math.round((d.balanceCents * d.rateBps) / 10_000))
    .map((d) => d.id);
  if (belowInterest.length > 0) warnings.push({ code: 'payment_below_interest', debtIds: belowInterest });
  const veryLong = included.length > 0 && (plan.months === null || plan.months > rules.longHorizonMonths);
  if (veryLong) warnings.push({ code: 'plan_very_long' });

  const includedBalance = included.reduce((s, d) => s + d.balanceCents, 0);
  const estimatedBalance = included.filter((d) => d.rateSource === 'default').reduce((s, d) => s + d.balanceCents, 0);
  const share = includedBalance > 0 ? estimatedBalance / includedBalance : 0;
  const confidence: Confidence = share === 0 ? 'high' : share < 0.5 ? 'medium' : 'low';

  let headline: Headline = { kind: 'none' };
  if (included.length > 0) {
    if (budget.deficit) headline = { kind: 'monthly_gap', cents: budget.gapCents };
    else if (veryLong) headline = plan.months === null ? { kind: 'too_long' } : { kind: 'too_long', months: plan.months };
    else if (interestSavedCents !== null && interestSavedCents > 0) headline = { kind: 'interest_saved', cents: interestSavedCents };
    else if (plan.months !== null) headline = { kind: 'debt_free_in', months: plan.months };
  }

  return {
    engineVersion: ENGINE_VERSION,
    asOf,
    budget,
    health,
    debts,
    order,
    heldAsideIds,
    baseline,
    plan,
    alternatives,
    interestSavedCents,
    negotiationPotential: { lowCents: low, highCents: high },
    refinance,
    headline,
    warnings,
    confidence,
  };
}
