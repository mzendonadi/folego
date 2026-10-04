import type { DebtKind } from './types.ts';

export const ENGINE_VERSION = '0.1.0';

export interface Rules {
  /** Taxas padrão quando o usuário não sabe. PLACEHOLDER: validar com as séries do BCB antes do lançamento. */
  defaultMonthlyRateBps: Record<DebtKind, number>;
  /** Prazo prescricional presumido por tipo. Baixa confiança: validar com advogado. */
  prescriptionYears: Record<DebtKind, number>;
  approachingWindowYears: number;
  /**
   * Teto de juros acumulados como fração do saldo declarado (1 = 100%). Evita crescimento exponencial irreal.
   * Cartão: teto legal de 100% do valor original (Lei 14.690/2023; validar). Demais: premissa de produto.
   * Limitação: usamos o saldo atual como proxy do valor original.
   */
  interestCapShare: Partial<Record<DebtKind, number>>;
  /** Parcela do excedente mensal destinada às dívidas (o resto fica de reserva). Parâmetro de produto. */
  extraToDebtShare: number;
  maxMonths: number;
  /** Acima disso (em meses), "quitar em X" deixa de ser uma promessa honesta: vira aviso de que o ritmo atual não resolve. */
  longHorizonMonths: number;
  /** Faixa de desconto esperada em negociação de dívida em atraso. Premissa de produto, não promessa. */
  negotiationDiscount: { lowPct: number; highPct: number };
  refinance: {
    minRateBps: number;
    termMonths: number;
    payrollRateBps: number; // taxa de referência do crédito consignado
    marginMaxShare: number; // teto de comprometimento da renda com consignado
  };
  health: {
    dsrFloor: number;
    dsrCeiling: number;
    dsrMaxPenalty: number;
    rateFloorBps: number;
    rateCeilingBps: number;
    rateMaxPenalty: number;
    deficitPenalty: number;
    overduePenalty: { upTo30: number; upTo90: number; above90: number };
    bands: { underControl: number; attention: number; tight: number };
  };
}

export const RULES: Rules = {
  defaultMonthlyRateBps: {
    credit_card: 1400,
    overdraft: 800,
    personal_loan: 550,
    payroll_loan: 180,
    financing: 200,
    store_credit: 1000,
    utility: 100,
    rent: 100,
    other: 300,
  },
  prescriptionYears: {
    credit_card: 5,
    overdraft: 5,
    personal_loan: 5,
    payroll_loan: 5,
    financing: 5,
    store_credit: 5,
    utility: 5,
    rent: 3,
    other: 5,
  },
  approachingWindowYears: 1,
  interestCapShare: { credit_card: 1, overdraft: 1, store_credit: 1 },
  extraToDebtShare: 0.9,
  maxMonths: 600,
  longHorizonMonths: 120,
  negotiationDiscount: { lowPct: 0.1, highPct: 0.5 },
  refinance: { minRateBps: 400, termMonths: 36, payrollRateBps: 200, marginMaxShare: 0.35 },
  health: {
    dsrFloor: 0.15,
    dsrCeiling: 0.55,
    dsrMaxPenalty: 40,
    rateFloorBps: 200,
    rateCeilingBps: 1000,
    rateMaxPenalty: 20,
    deficitPenalty: 15,
    overduePenalty: { upTo30: 8, upTo90: 16, above90: 25 },
    bands: { underControl: 75, attention: 50, tight: 25 },
  },
};
