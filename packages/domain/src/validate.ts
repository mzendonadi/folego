import type { DiagnoseInput } from './types.ts';
import { parseIsoDate } from './prescription.ts';

export class EngineInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Entrada inválida: ${issues.join('; ')}`);
    this.name = 'EngineInputError';
    this.issues = issues;
  }
}

const isCents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Invariantes que o motor exige. A validação de formato/UX fica na camada de contratos (Zod). */
export function validateInput(input: DiagnoseInput): void {
  const issues: string[] = [];
  const { profile, debts, asOf } = input;

  let asOfMs = NaN;
  try {
    asOfMs = parseIsoDate(asOf);
  } catch {
    issues.push('asOf inválido');
  }

  if (!isCents(profile.netIncomeCents)) issues.push('renda inválida');
  if (!isCents(profile.fixedExpensesCents)) issues.push('gastos fixos inválidos');

  const seen = new Set<string>();
  for (const d of debts) {
    const tag = `dívida ${d.id}`;
    if (seen.has(d.id)) issues.push(`${tag}: id duplicado`);
    seen.add(d.id);
    if (!isCents(d.balanceCents)) issues.push(`${tag}: saldo inválido`);
    if (d.monthlyPaymentCents !== undefined && !isCents(d.monthlyPaymentCents)) issues.push(`${tag}: parcela inválida`);
    if (d.remainingInstallments !== undefined && !(Number.isInteger(d.remainingInstallments) && d.remainingInstallments > 0)) {
      issues.push(`${tag}: parcelas restantes inválidas`);
    }
    if (d.monthlyRateBps !== undefined && !(Number.isInteger(d.monthlyRateBps) && d.monthlyRateBps >= 0 && d.monthlyRateBps <= 10_000)) {
      issues.push(`${tag}: taxa inválida`);
    }
    if (!(Number.isInteger(d.daysOverdue) && d.daysOverdue >= 0)) issues.push(`${tag}: dias em atraso inválidos`);
    if (d.firstDefaultOn !== undefined) {
      try {
        if (!Number.isNaN(asOfMs) && parseIsoDate(d.firstDefaultOn) > asOfMs) issues.push(`${tag}: atraso no futuro`);
      } catch {
        issues.push(`${tag}: data de atraso inválida`);
      }
    }
  }

  if (issues.length > 0) throw new EngineInputError(issues);
}
