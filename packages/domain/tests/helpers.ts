import type { DebtInput, DiagnoseInput, Profile } from '../src/types.ts';

export const AS_OF = '2026-09-26';

export function debt(partial: Partial<DebtInput> & Pick<DebtInput, 'id'>): DebtInput {
  return {
    creditorName: `Credor ${partial.id}`,
    kind: 'credit_card',
    balanceCents: 100_000,
    daysOverdue: 0,
    ...partial,
  };
}

export function profile(partial: Partial<Profile> = {}): Profile {
  return {
    netIncomeCents: 300_000,
    fixedExpensesCents: 150_000,
    employmentType: 'clt',
    ageBand: '35-44',
    uf: 'SP',
    ...partial,
  };
}

export function input(debts: DebtInput[], p: Partial<Profile> = {}): DiagnoseInput {
  return { profile: profile(p), debts, asOf: AS_OF };
}

/** PRNG determinístico (mulberry32) para testes de propriedade reprodutíveis. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
