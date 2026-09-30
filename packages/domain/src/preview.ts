import type { DebtInput, Diagnosis, Preview } from './types.ts';

export const LOCKED_SECTIONS = [
  'full_priority_order',
  'monthly_budget',
  'negotiation_scripts',
  'per_debt_payoff_timeline',
  'prescription_details',
  'refinance_simulation',
] as const;

/**
 * Único ponto de saída de dados antes do pagamento. Monta o preview por CONSTRUÇÃO (lista branca),
 * nunca por remoção de campos do resultado completo.
 */
const ESSENTIAL_KINDS = new Set(['rent', 'utility', 'financing']);

export function buildPreview(diagnosis: Diagnosis, debts: DebtInput[]): Preview {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const inQueue = new Set(diagnosis.order);
  const held = new Set(diagnosis.heldAsideIds);
  const firstId = diagnosis.order[0];
  const first = firstId !== undefined ? byId.get(firstId) : undefined;
  const firstDiag = diagnosis.debts.find((d) => d.debtId === firstId);

  return {
    engineVersion: diagnosis.engineVersion,
    debtCount: debts.length,
    totalBalanceCents: debts.reduce((s, d) => s + d.balanceCents, 0),
    health: { score: diagnosis.health.score, band: diagnosis.health.band },
    headline: { ...diagnosis.headline },
    firstPriority:
      first && firstDiag
        ? { creditorName: first.creditorName, kind: first.kind, balanceCents: first.balanceCents, tier: firstDiag.tier }
        : null,
    prescriptionTeaser: { possibleCount: diagnosis.heldAsideIds.length },
    discoveries: {
      moreInQueue: Math.max(0, diagnosis.order.length - 1),
      negotiable: debts.filter((d) => inQueue.has(d.id) && d.daysOverdue > 0 && !ESSENTIAL_KINDS.has(d.kind)).length,
      lettersEligible: debts.filter((d) => d.daysOverdue > 0 || held.has(d.id)).length,
      essentialOverdue: diagnosis.warnings.some((w) => w.code === 'essential_overdue'),
    },
    confidence: diagnosis.confidence,
    lockedSections: [...LOCKED_SECTIONS],
  };
}
