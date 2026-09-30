import type { ResolvedDebt, SimulationResult } from './types.ts';

export interface SimOptions {
  /**
   * pooled: há um valor mensal fixo (pool) para as dívidas; parcelas mínimas são pagas primeiro e o
   *         restante vai para a fila de prioridade. Parcela liberada por dívida quitada "rola" sozinha.
   * independent: cada dívida paga só a própria parcela (retrato de "seguir como está").
   */
  mode: 'pooled' | 'independent';
  poolCents: number;
  priority: string[];
  maxMonths: number;
}

const OVERFLOW_GUARD_CENTS = 1e13;

/** Simulação mensal determinística. Juros arredondados por dívida, por mês, em centavos. */
export function simulate(debts: ResolvedDebt[], opts: SimOptions): SimulationResult {
  const balance = new Map<string, number>();
  const accrued = new Map<string, number>();
  const payoffMonthById: Record<string, number | null> = {};
  for (const d of debts) {
    balance.set(d.id, d.balanceCents);
    accrued.set(d.id, 0);
    payoffMonthById[d.id] = d.balanceCents === 0 ? 0 : null;
  }

  let totalInterest = 0;
  let totalPaid = 0;

  const sumBalance = () => {
    let s = 0;
    for (const v of balance.values()) s += v;
    return s;
  };

  if (sumBalance() === 0) {
    return { months: 0, capped: false, totalInterestCents: 0, totalPaidCents: 0, remainingBalanceCents: 0, payoffMonthById };
  }

  let months: number | null = null;

  for (let m = 1; m <= opts.maxMonths; m++) {
    for (const d of debts) {
      const b = balance.get(d.id) ?? 0;
      if (b > 0) {
        let interest = Math.round((b * d.rateBps) / 10_000);
        const soFar = accrued.get(d.id) ?? 0;
        if (d.interestCapCents !== undefined) interest = Math.min(interest, Math.max(0, d.interestCapCents - soFar));
        accrued.set(d.id, soFar + interest);
        balance.set(d.id, b + interest);
        totalInterest += interest;
      }
    }

    let paidMinimums = 0;
    for (const d of debts) {
      const b = balance.get(d.id) ?? 0;
      if (b > 0 && d.minPaymentCents > 0) {
        const pay = Math.min(d.minPaymentCents, b);
        balance.set(d.id, b - pay);
        paidMinimums += pay;
        totalPaid += pay;
      }
    }

    if (opts.mode === 'pooled') {
      let extra = Math.max(0, opts.poolCents - paidMinimums);
      for (const id of opts.priority) {
        if (extra <= 0) break;
        const b = balance.get(id) ?? 0;
        if (b > 0) {
          const pay = Math.min(extra, b);
          balance.set(id, b - pay);
          extra -= pay;
          totalPaid += pay;
        }
      }
    }

    for (const d of debts) {
      if ((balance.get(d.id) ?? 0) === 0 && payoffMonthById[d.id] === null) payoffMonthById[d.id] = m;
    }

    const remaining = sumBalance();
    if (remaining === 0) {
      months = m;
      break;
    }
    if (remaining > OVERFLOW_GUARD_CENTS) break;
  }

  return {
    months,
    capped: months === null,
    totalInterestCents: totalInterest,
    totalPaidCents: totalPaid,
    remainingBalanceCents: sumBalance(),
    payoffMonthById,
  };
}
