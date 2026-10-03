// Assinatura: plano de quitação das dívidas da conta (avalanche x bola de neve). Cálculo puro, em centavos inteiros.
// Juros mensais em pontos-base (bps, 1% = 100). A parcela mínima de cada dívida continua sendo paga; o "extra" vai
// para a dívida-alvo da estratégia, e a parcela liberada de uma dívida quitada "rola" para a próxima.

export interface AccountDebt {
  id: string;
  name: string;
  balanceCents: number;
  monthlyRateBps: number;
  minPaymentCents: number;
}

export type PayoffMethod = 'avalanche' | 'snowball';

export interface PayoffResult {
  method: PayoffMethod;
  months: number; // 0 = nada a pagar; MAX_MONTHS = não quita neste ritmo
  totalInterestCents: number;
  totalPaidCents: number;
  order: { id: string; name: string; paidOffInMonth: number }[];
  neverPaysOff: boolean;
}

export interface PayoffPlan {
  extraCents: number;
  avalanche: PayoffResult;
  snowball: PayoffResult;
  /** Quanto a avalanche economiza de juros em relação à bola de neve (>= 0 quando a avalanche é a melhor). */
  savingsCents: number;
  recommended: PayoffMethod;
  /** Dívida para atacar primeiro com o extra, pela estratégia recomendada. */
  focusId: string | null;
}

export const MAX_PAYOFF_MONTHS = 600;

function run(debts: AccountDebt[], extraCents: number, method: PayoffMethod): PayoffResult {
  const live = debts.filter((d) => d.balanceCents > 0).map((d) => ({ ...d }));
  const order: PayoffResult['order'] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;
  const budget = live.reduce((s, d) => s + d.minPaymentCents, 0) + Math.max(0, extraCents);
  const pick = (a: AccountDebt, b: AccountDebt) => (method === 'avalanche' ? b.monthlyRateBps - a.monthlyRateBps || a.balanceCents - b.balanceCents : a.balanceCents - b.balanceCents || b.monthlyRateBps - a.monthlyRateBps);
  while (live.some((d) => d.balanceCents > 0) && month < MAX_PAYOFF_MONTHS) {
    month += 1;
    for (const d of live) {
      if (d.balanceCents <= 0) continue;
      const interest = Math.round((d.balanceCents * d.monthlyRateBps) / 10_000);
      d.balanceCents += interest;
      totalInterest += interest;
    }
    let left = budget;
    // 1) mínimas de quem ainda deve
    for (const d of live) {
      if (d.balanceCents <= 0) continue;
      const pay = Math.min(d.balanceCents, d.minPaymentCents, left);
      d.balanceCents -= pay;
      left -= pay;
      totalPaid += pay;
    }
    // 2) o que sobrou (extra + parcelas liberadas) ataca a dívida-alvo
    for (const d of [...live].filter((x) => x.balanceCents > 0).sort(pick)) {
      if (left <= 0) break;
      const pay = Math.min(d.balanceCents, left);
      d.balanceCents -= pay;
      left -= pay;
      totalPaid += pay;
    }
    for (const d of live) {
      if (d.balanceCents <= 0 && !order.some((o) => o.id === d.id)) order.push({ id: d.id, name: d.name, paidOffInMonth: month });
    }
    if (budget <= 0) break;
  }
  const neverPaysOff = live.some((d) => d.balanceCents > 0);
  return { method, months: neverPaysOff ? MAX_PAYOFF_MONTHS : month, totalInterestCents: totalInterest, totalPaidCents: totalPaid, order, neverPaysOff };
}

export function buildPayoffPlan(debts: AccountDebt[], extraCents = 0): PayoffPlan {
  const avalanche = run(debts, extraCents, 'avalanche');
  const snowball = run(debts, extraCents, 'snowball');
  const savingsCents = snowball.totalInterestCents - avalanche.totalInterestCents;
  // Avalanche é matematicamente melhor; a bola de neve só é recomendada quando custa o mesmo (motivação de graça).
  const recommended: PayoffMethod = savingsCents > 0 || avalanche.months <= snowball.months ? 'avalanche' : 'snowball';
  const open = debts.filter((d) => d.balanceCents > 0);
  const focus = [...open].sort((a, b) => (recommended === 'avalanche' ? b.monthlyRateBps - a.monthlyRateBps || a.balanceCents - b.balanceCents : a.balanceCents - b.balanceCents))[0];
  return { extraCents: Math.max(0, extraCents), avalanche, snowball, savingsCents, recommended, focusId: focus?.id ?? null };
}
