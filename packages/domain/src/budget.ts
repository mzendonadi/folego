import type { BudgetSummary, Profile, ResolvedDebt } from './types.ts';
import type { Rules } from './config.ts';

/**
 * Orçamento mensal.
 * Premissa conservadora: as parcelas declaradas de TODAS as dívidas seguem sendo pagas (inclusive as que
 * ficaram "de lado" por possível prescrição), então o dinheiro delas não é redirecionado ao pool.
 */
export function buildBudget(
  profile: Profile,
  allDebts: ResolvedDebt[],
  includedDebts: ResolvedDebt[],
  rules: Rules,
): BudgetSummary {
  const declaredPaymentsCents = allDebts.reduce((s, d) => s + d.minPaymentCents, 0);
  const includedPaymentsCents = includedDebts.reduce((s, d) => s + d.minPaymentCents, 0);
  const surplusCents = profile.netIncomeCents - profile.fixedExpensesCents - declaredPaymentsCents;
  const deficit = surplusCents < 0;
  const extraToDebtCents = deficit ? 0 : Math.floor(surplusCents * rules.extraToDebtShare);
  const debtServiceRatio =
    profile.netIncomeCents > 0
      ? declaredPaymentsCents / profile.netIncomeCents
      : declaredPaymentsCents > 0 || allDebts.some((d) => d.balanceCents > 0)
        ? 1 // sem renda e com dívida: pior caso (antes a razão virava 0 e a nota ficava alta)
        : 0;

  return {
    netIncomeCents: profile.netIncomeCents,
    fixedExpensesCents: profile.fixedExpensesCents,
    declaredPaymentsCents,
    surplusCents,
    deficit,
    gapCents: deficit ? -surplusCents : 0,
    extraToDebtCents,
    poolCents: includedPaymentsCents + extraToDebtCents,
    debtServiceRatio,
  };
}
