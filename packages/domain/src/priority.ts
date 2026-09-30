import type { PrescriptionAssessment, PrioritizedDebt, PriorityTier, ResolvedDebt } from './types.ts';

const ESSENTIAL_KINDS = new Set(['rent', 'utility', 'financing']);

export type PriorityStrategy = 'recommended' | 'avalanche' | 'snowball';

function tierOf(debt: ResolvedDebt, prescription: PrescriptionAssessment): PriorityTier {
  if (prescription.status === 'possible') return 'verify_prescription';
  if (ESSENTIAL_KINDS.has(debt.kind) && debt.daysOverdue > 0) return 'essential_overdue';
  return 'by_interest';
}

/**
 * Ordem de pagamento.
 * recommended: (1) essenciais em atraso (moradia, serviços, bem financiado), mais atrasadas primeiro;
 *              (2) demais por juros decrescentes (desempate: menor saldo);
 *              dívidas com possível prescrição ficam FORA da fila (rank null): verificar antes de pagar.
 * avalanche/snowball: estratégias clássicas, usadas só para comparação.
 */
export function prioritize(
  debts: ResolvedDebt[],
  prescriptions: Map<string, PrescriptionAssessment>,
  strategy: PriorityStrategy = 'recommended',
): PrioritizedDebt[] {
  const annotated = debts.map((d) => {
    const p = prescriptions.get(d.id);
    if (!p) throw new Error(`Sem avaliação de prescrição para ${d.id}`);
    return { d, tier: tierOf(d, p) };
  });

  const included = annotated.filter((a) => a.tier !== 'verify_prescription');
  const held = annotated.filter((a) => a.tier === 'verify_prescription');

  const byRate = (a: (typeof annotated)[number], b: (typeof annotated)[number]) =>
    b.d.rateBps - a.d.rateBps || a.d.balanceCents - b.d.balanceCents || a.d.id.localeCompare(b.d.id);

  let sorted: typeof included;
  if (strategy === 'snowball') {
    sorted = [...included].sort((a, b) => a.d.balanceCents - b.d.balanceCents || a.d.id.localeCompare(b.d.id));
  } else if (strategy === 'avalanche') {
    sorted = [...included].sort(byRate);
  } else {
    const essential = included
      .filter((a) => a.tier === 'essential_overdue')
      .sort((a, b) => b.d.daysOverdue - a.d.daysOverdue || a.d.id.localeCompare(b.d.id));
    const rest = included.filter((a) => a.tier !== 'essential_overdue').sort(byRate);
    sorted = [...essential, ...rest];
  }

  return [
    ...sorted.map((a, i) => ({ debtId: a.d.id, tier: a.tier, rank: i + 1 })),
    ...held.map((a) => ({ debtId: a.d.id, tier: a.tier, rank: null })),
  ];
}
