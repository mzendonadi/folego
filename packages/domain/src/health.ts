import type { BudgetSummary, HealthBand, HealthScore, ResolvedDebt } from './types.ts';
import type { Rules } from './config.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Nota 0-100, explicável: 100 menos quatro penalidades independentes. */
export function scoreHealth(budget: BudgetSummary, allDebts: ResolvedDebt[], weightedDebts: ResolvedDebt[], rules: Rules): HealthScore {
  const h = rules.health;

  const debtService =
    clamp01((budget.debtServiceRatio - h.dsrFloor) / (h.dsrCeiling - h.dsrFloor)) * h.dsrMaxPenalty;

  const maxOverdue = allDebts.reduce((m, d) => Math.max(m, d.daysOverdue), 0);
  const overdue =
    maxOverdue === 0
      ? 0
      : maxOverdue <= 30
        ? h.overduePenalty.upTo30
        : maxOverdue <= 90
          ? h.overduePenalty.upTo90
          : h.overduePenalty.above90;

  const base = weightedDebts.length > 0 ? weightedDebts : allDebts;
  const totalBalance = base.reduce((s, d) => s + d.balanceCents, 0);
  const weightedRate =
    totalBalance > 0 ? base.reduce((s, d) => s + d.rateBps * d.balanceCents, 0) / totalBalance : 0;
  const interest = clamp01((weightedRate - h.rateFloorBps) / (h.rateCeilingBps - h.rateFloorBps)) * h.rateMaxPenalty;

  const deficit = budget.deficit ? h.deficitPenalty : 0;

  const round1 = (x: number) => Math.round(x * 10) / 10;
  const penalties = {
    debtService: round1(debtService),
    overdue,
    interest: round1(interest),
    deficit,
  };
  const score = Math.max(0, Math.min(100, Math.round(100 - debtService - overdue - interest - deficit)));

  const band: HealthBand =
    score >= h.bands.underControl
      ? 'under_control'
      : score >= h.bands.attention
        ? 'attention'
        : score >= h.bands.tight
          ? 'tight'
          : 'critical';

  return { score, band, penalties };
}
