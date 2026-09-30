import type { DebtInput, DebtKind, ResolvedDebt } from './types.ts';
import type { Rules } from './config.ts';

// Só faz sentido inferir a taxa a partir de parcela+prazo em dívidas parceladas.
const INSTALLMENT_KINDS: ReadonlySet<DebtKind> = new Set([
  'personal_loan',
  'payroll_loan',
  'financing',
  'store_credit',
  'other',
]);

/** Parcela de uma tabela Price, arredondada para cima em centavos. */
export function annuityPaymentCents(balanceCents: number, monthlyRateBps: number, months: number): number {
  if (months <= 0) return balanceCents;
  const r = monthlyRateBps / 10_000;
  if (r === 0) return Math.ceil(balanceCents / months);
  return Math.ceil((balanceCents * r) / (1 - Math.pow(1 + r, -months)));
}

/**
 * Taxa mensal (bps) que faz `payment` quitar `balance` em `months` parcelas.
 * Retorna null se os dados forem inconsistentes (parcela insuficiente para quitar no prazo).
 */
export function impliedRateBps(balanceCents: number, paymentCents: number, months: number): number | null {
  if (balanceCents <= 0 || paymentCents <= 0 || months <= 0) return null;
  if (paymentCents * months < balanceCents) return null;
  const pv = (r: number) => (r === 0 ? paymentCents * months : (paymentCents * (1 - Math.pow(1 + r, -months))) / r);
  let lo = 0;
  let hi = 1; // 100% ao mês é teto de sanidade
  if (pv(hi) > balanceCents) return Math.round(hi * 10_000);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > balanceCents) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10_000);
}

export function resolveDebt(debt: DebtInput, rules: Rules): ResolvedDebt {
  const resolved = resolveRate(debt, rules);
  const capShare = rules.interestCapShare[debt.kind];
  return capShare === undefined ? resolved : { ...resolved, interestCapCents: Math.round(debt.balanceCents * capShare) };
}

function resolveRate(debt: DebtInput, rules: Rules): ResolvedDebt {
  const minPaymentCents = debt.monthlyPaymentCents ?? 0;

  if (debt.monthlyRateBps !== undefined) {
    return { ...debt, rateBps: debt.monthlyRateBps, rateSource: 'declared', minPaymentCents };
  }

  if (
    INSTALLMENT_KINDS.has(debt.kind) &&
    debt.monthlyPaymentCents !== undefined &&
    debt.remainingInstallments !== undefined
  ) {
    const implied = impliedRateBps(debt.balanceCents, debt.monthlyPaymentCents, debt.remainingInstallments);
    if (implied !== null && implied > 0) {
      return { ...debt, rateBps: implied, rateSource: 'implied', minPaymentCents };
    }
  }

  return {
    ...debt,
    rateBps: rules.defaultMonthlyRateBps[debt.kind],
    rateSource: 'default',
    minPaymentCents,
  };
}
