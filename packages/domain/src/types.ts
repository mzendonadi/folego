// Tipos públicos do motor. Valores monetários SEMPRE em centavos inteiros; taxas em bps ao mês
// (1 bps = 0,01% a.m.); datas como 'YYYY-MM-DD' (sem fuso).

export type EmploymentType = 'inss_retiree' | 'public_servant' | 'clt' | 'self_employed' | 'other';

export type DebtKind =
  | 'credit_card'
  | 'overdraft'
  | 'personal_loan'
  | 'payroll_loan'
  | 'financing'
  | 'store_credit'
  | 'utility'
  | 'rent'
  | 'other';

export interface Profile {
  netIncomeCents: number;
  fixedExpensesCents: number;
  employmentType: EmploymentType;
  ageBand: string;
  uf: string;
}

export interface DebtInput {
  id: string;
  creditorName: string;
  kind: DebtKind;
  /** Quando kind = 'other': o que a pessoa escreveu sobre a dívida (só exibição, não entra em cálculo). */
  kindNote?: string;
  balanceCents: number;
  monthlyPaymentCents?: number;
  remainingInstallments?: number;
  monthlyRateBps?: number;
  daysOverdue: number;
  firstDefaultOn?: string;
}

export interface DiagnoseInput {
  profile: Profile;
  debts: DebtInput[];
  asOf: string;
}

export type Confidence = 'high' | 'medium' | 'low';
export type RateSource = 'declared' | 'implied' | 'default';

export interface ResolvedDebt extends DebtInput {
  rateBps: number;
  rateSource: RateSource;
  minPaymentCents: number;
  interestCapCents?: number; // undefined = sem teto
}

export type PrescriptionStatus = 'not_in_default' | 'not_prescribed' | 'approaching' | 'possible';

export interface PrescriptionAssessment {
  status: PrescriptionStatus;
  yearsElapsed: number | null;
  thresholdYears: number;
  dateSource: 'declared' | 'derived' | null;
}

export type PriorityTier = 'essential_overdue' | 'by_interest' | 'verify_prescription';

export interface PrioritizedDebt {
  debtId: string;
  tier: PriorityTier;
  rank: number | null; // null = fora do cálculo (verificar prescrição antes de pagar)
}

export interface SimulationResult {
  months: number | null; // null = não quita dentro do horizonte
  capped: boolean;
  totalInterestCents: number;
  totalPaidCents: number;
  remainingBalanceCents: number;
  payoffMonthById: Record<string, number | null>;
  /** Só quando pedido (opts.traceMonths): quanto foi pago em cada dívida e o saldo ao fim de cada mês. */
  schedule?: { month: number; paidById: Record<string, number>; balanceById: Record<string, number> }[];
}

export interface BudgetSummary {
  netIncomeCents: number;
  fixedExpensesCents: number;
  declaredPaymentsCents: number;
  surplusCents: number; // pode ser negativo
  deficit: boolean;
  gapCents: number;
  extraToDebtCents: number;
  poolCents: number;
  debtServiceRatio: number;
}

export type HealthBand = 'under_control' | 'attention' | 'tight' | 'critical';

export interface HealthScore {
  score: number;
  band: HealthBand;
  penalties: { debtService: number; overdue: number; interest: number; deficit: number };
}

export interface RefinanceCandidate {
  debtId: string;
  oldMonthlyRateBps: number;
  newMonthlyRateBps: number;
  newPaymentCents: number;
  termMonths: number;
  estimatedSavingsCents: number;
}

export interface RefinanceAssessment {
  candidates: RefinanceCandidate[];
  estimatedSavingsCents: number;
  suitabilityOk: boolean;
  reason: 'ok' | 'no_payroll_eligibility' | 'no_beneficial_swap';
}

export type HeadlineKind = 'interest_saved' | 'debt_free_in' | 'too_long' | 'monthly_gap' | 'none';

export interface Headline {
  kind: HeadlineKind;
  cents?: number;
  months?: number;
}

export interface Warning {
  code:
    | 'deficit'
    | 'rates_estimated'
    | 'essential_overdue'
    | 'prescription_check_before_paying'
    | 'baseline_never_pays_off'
    | 'plan_never_pays_off'
    | 'payment_below_interest'
    | 'plan_very_long';
  debtIds?: string[];
}

export interface DebtDiagnosis {
  debtId: string;
  rateBps: number;
  rateSource: RateSource;
  prescription: PrescriptionAssessment;
  tier: PriorityTier;
  rank: number | null;
  payoffMonth: number | null;
}

/** Resultado COMPLETO (interno; conteúdo pago). Nunca enviar ao navegador antes do pagamento. */
export interface Diagnosis {
  engineVersion: string;
  asOf: string;
  budget: BudgetSummary;
  health: HealthScore;
  debts: DebtDiagnosis[];
  order: string[]; // ids na ordem de pagamento recomendada
  heldAsideIds: string[]; // possível prescrição: fora dos cálculos
  baseline: SimulationResult;
  plan: SimulationResult;
  alternatives: { avalanche: SimulationResult; snowball: SimulationResult };
  interestSavedCents: number | null;
  negotiationPotential: { lowCents: number; highCents: number };
  refinance: RefinanceAssessment;
  headline: Headline;
  warnings: Warning[];
  confidence: Confidence;
}

/** Único formato autorizado a sair antes do pagamento. */
export interface Preview {
  engineVersion: string;
  debtCount: number;
  totalBalanceCents: number;
  health: { score: number; band: HealthBand };
  headline: Headline;
  firstPriority: { creditorName: string; kind: DebtKind; balanceCents: number; tier: PriorityTier } | null;
  prescriptionTeaser: { possibleCount: number };
  /** Só contagens e sinais (nunca conteúdo pago): alimenta o cartão "tem mais no seu diagnóstico". */
  discoveries: { moreInQueue: number; negotiable: number; lettersEligible: number; essentialOverdue: boolean };
  confidence: Confidence;
  lockedSections: string[];
}
