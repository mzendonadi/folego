import type { PrescriptionAssessment, ResolvedDebt } from './types.ts';
import type { Rules } from './config.ts';

const DAY_MS = 86_400_000;

export function parseIsoDate(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`Data inválida: ${value}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`Data inexistente: ${value}`);
  }
  return t;
}

/**
 * Avalia se a cobrança PODE estar prescrita. Sempre indicativo, nunca conclusivo:
 * - conta a partir da data do primeiro atraso (cada parcela tem a sua data; a mais antiga é a que prescreve primeiro);
 * - reconhecimento da dívida, negociação, pagamento parcial ou ação judicial podem interromper/reiniciar o prazo.
 */
export function assessPrescription(debt: ResolvedDebt, asOf: string, rules: Rules): PrescriptionAssessment {
  const thresholdYears = rules.prescriptionYears[debt.kind];
  const asOfMs = parseIsoDate(asOf);

  let defaultMs: number | null = null;
  let dateSource: PrescriptionAssessment['dateSource'] = null;
  if (debt.firstDefaultOn !== undefined) {
    defaultMs = parseIsoDate(debt.firstDefaultOn);
    dateSource = 'declared';
  } else if (debt.daysOverdue > 0) {
    defaultMs = asOfMs - debt.daysOverdue * DAY_MS;
    dateSource = 'derived';
  }

  if (defaultMs === null) {
    return { status: 'not_in_default', yearsElapsed: null, thresholdYears, dateSource };
  }

  const yearsElapsed = (asOfMs - defaultMs) / DAY_MS / 365.25;
  let status: PrescriptionAssessment['status'] = 'not_prescribed';
  if (yearsElapsed >= thresholdYears) status = 'possible';
  else if (yearsElapsed >= thresholdYears - rules.approachingWindowYears) status = 'approaching';

  return { status, yearsElapsed: Math.round(yearsElapsed * 100) / 100, thresholdYears, dateSource };
}
