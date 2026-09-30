import { RULES } from '../engine.ts';
import type { DebtInput, Diagnosis } from '../engine.ts';

const nf = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (cents: number): string => nf.format(cents / 100);

export interface Offer {
  openingCents: number;
  targetCents: number;
  limitCents: number;
  openingPct: number;
  targetPct: number;
  limitPct: number;
}

export interface DebtFacts {
  id: string;
  kind: string;
  balanceCents: number;
  monthlyPaymentCents: number | null;
  monthlyRatePct: number;
  rateSource: string;
  daysOverdue: number;
  overdue: boolean;
  tier: string;
  rank: number | null;
  payoffMonth: number | null;
  prescription: string;
  yearsElapsed: number | null;
  offer: Offer | null;
}

export interface CaseFacts {
  capacityCents: number;
  surplusCents: number;
  deficit: boolean;
  debts: DebtFacts[];
  heldAsideIds: string[];
  /** Todos os valores em centavos que um texto gerado pode citar. */
  allowedAmountsCents: Set<number>;
  /** Todas as porcentagens que um texto gerado pode citar. */
  allowedPercents: Set<number>;
}

const ESSENTIAL = new Set(['rent', 'utility', 'financing']);

/**
 * Fatos calculados por CÓDIGO a partir do diagnóstico. É a única fonte de números dos textos.
 * Nada aqui contém nome de credor, nem qualquer texto digitado livremente pelo usuário.
 */
export function buildFacts(debts: DebtInput[], diagnosis: Diagnosis): CaseFacts {
  const { lowPct, highPct } = RULES.negotiationDiscount;
  const midPct = (lowPct + highPct) / 2;
  const byId = new Map(debts.map((d) => [d.id, d]));
  const allowedAmounts = new Set<number>();
  const allowedPercents = new Set<number>();
  const capacityCents = diagnosis.budget.extraToDebtCents;
  allowedAmounts.add(capacityCents);

  const facts: DebtFacts[] = diagnosis.debts.map((dg) => {
    const d = byId.get(dg.debtId);
    if (!d) throw new Error(`dívida ${dg.debtId} ausente da entrada`);
    const overdue = d.daysOverdue > 0;
    let offer: Offer | null = null;
    if (dg.rank !== null && overdue && !ESSENTIAL.has(d.kind)) {
      const pay = (pct: number) => Math.round(d.balanceCents * (1 - pct));
      offer = {
        openingCents: pay(highPct),
        targetCents: pay(midPct),
        limitCents: pay(lowPct),
        openingPct: Math.round(highPct * 100),
        targetPct: Math.round(midPct * 100),
        limitPct: Math.round(lowPct * 100),
      };
      for (const c of [offer.openingCents, offer.targetCents, offer.limitCents]) allowedAmounts.add(c);
      for (const p of [offer.openingPct, offer.targetPct, offer.limitPct]) allowedPercents.add(p);
    }
    allowedAmounts.add(d.balanceCents);
    if (d.monthlyPaymentCents) allowedAmounts.add(d.monthlyPaymentCents);
    const ratePct = Math.round(dg.rateBps) / 100;
    allowedPercents.add(ratePct);
    return {
      id: d.id,
      kind: d.kind,
      balanceCents: d.balanceCents,
      monthlyPaymentCents: d.monthlyPaymentCents ?? null,
      monthlyRatePct: ratePct,
      rateSource: dg.rateSource,
      daysOverdue: d.daysOverdue,
      overdue,
      tier: dg.tier,
      rank: dg.rank,
      payoffMonth: dg.payoffMonth,
      prescription: dg.prescription.status,
      yearsElapsed: dg.prescription.yearsElapsed,
      offer,
    };
  });

  return {
    capacityCents,
    surplusCents: diagnosis.budget.surplusCents,
    deficit: diagnosis.budget.deficit,
    debts: facts,
    heldAsideIds: diagnosis.heldAsideIds,
    allowedAmountsCents: allowedAmounts,
    allowedPercents,
  };
}

export const KIND_LABEL: Record<string, string> = {
  credit_card: 'cartão de crédito',
  overdraft: 'cheque especial',
  personal_loan: 'empréstimo pessoal',
  payroll_loan: 'empréstimo consignado',
  financing: 'financiamento',
  store_credit: 'crediário de loja',
  utility: 'conta de casa',
  rent: 'aluguel ou condomínio',
  other: 'dívida',
};
