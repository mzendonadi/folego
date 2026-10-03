import { z } from 'zod';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const EMPLOYMENT_TYPES = ['inss_retiree', 'public_servant', 'clt', 'self_employed', 'other'] as const;
const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65-74', '75+'] as const;
const KINDS = ['credit_card', 'overdraft', 'personal_loan', 'payroll_loan', 'financing', 'store_credit', 'utility', 'rent', 'other'] as const;

const cents = z.number().int().min(0).max(100_000_000_000);

export const debtSchema = z.object({
  creditorName: z.string().trim().min(1).max(60),
  kind: z.enum(KINDS),
  kindNote: z.string().trim().max(60).optional(),
  balanceCents: cents.min(1),
  monthlyPaymentCents: cents.optional(),
  remainingInstallments: z.number().int().min(1).max(600).optional(),
  monthlyRateBps: z.number().int().min(0).max(10_000).optional(),
  daysOverdue: z.number().int().min(0).max(36_500),
  firstDefaultOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createCaseSchema = z.object({
  profile: z.object({
    netIncomeCents: cents,
    fixedExpensesCents: cents,
    employmentType: z.enum(['inss_retiree', 'public_servant', 'clt', 'self_employed', 'other']),
    ageBand: z.enum(AGE_BANDS),
    uf: z.enum(UFS),
  }),
  debts: z.array(debtSchema).min(1).max(30),
  acceptTerms: z.literal(true),
});

export const createOrderSchema = z.object({
  caseId: z.string().uuid(),
  withLetters: z.boolean().default(false),
  products: z.array(z.enum(['recovery_map', 'defense_letters', 'calendar_30d', 'extra_income_plan', 'collection_translator'])).min(1).max(4).optional(),
});

export const translationSchema = z.object({ text: z.string().trim().min(8).max(4000), acceptTerms: z.literal(true) });

export const emailLinkSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export const leadSchema = z.object({
  name: z.string().trim().min(3).max(120),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(200).optional(),
  categories: z.array(z.enum(['consignado', 'renegotiation'])).min(1).max(2),
  consent: z.literal(true),
});

export const incomeInterviewSchema = z.object({
  skills: z.string().trim().min(5).max(500),
  hoursBand: z.enum(['ate_5h', '5_10h', '10_20h', 'mais_20h']),
  capitalCents: z.number().int().min(0).max(1_000_000_00),
  hasVehicle: z.boolean(),
  mode: z.enum(['presencial', 'online', 'tanto_faz']),
  priorAttempts: z.string().trim().max(500).optional(),
  name: z.string().trim().min(3).max(120),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(200).optional(),
  wantsPartnerContact: z.boolean(),
});
export type IncomeInterviewInput = z.infer<typeof incomeInterviewSchema>;
export const toggleIncomeTaskSchema = z.object({ key: z.string().min(1).max(20), done: z.boolean() });

export const partnerLoginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
export const partnerStatusSchema = z.object({ status: z.enum(['contacted', 'converted', 'rejected']) });
export const newPartnerSchema = z.object({
  legalName: z.string().trim().min(3).max(200),
  cnpj: z.string().regex(/^\d{14}$/),
  category: z.enum(['consignado', 'bank', 'fintech', 'renegotiation']),
  email: z.string().trim().toLowerCase().email().max(200),
  campaign: z.object({
    name: z.string().trim().min(2).max(100),
    consentCategory: z.enum(['consignado', 'renegotiation']),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).max(5).default([]),
    ufs: z.array(z.enum(UFS)).max(27).default([]),
    minIncomeCents: z.number().int().nonnegative().optional(),
    maxIncomeCents: z.number().int().nonnegative().optional(),
    pricePerLeadCents: z.number().int().nonnegative().max(1_000_000),
    dailyCap: z.number().int().positive().max(10_000).default(50),
    monthlyBudgetCents: z.number().int().positive().optional(),
    webhookUrl: z.string().url().max(500),
  }),
});

export const emailOnlySchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
export const loginCodeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().regex(/^\d{6}$/) });
export const subscriptionOrderSchema = z.object({ plan: z.enum(['controle', 'ousado', 'desbravador']) });
export const cancelSchema = z.object({ cancel: z.boolean() });

const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 100_000_000_00),
  note: z.string().trim().max(120).default(''),
  category: z.string().max(30).optional(),
  walletId: z.string().uuid().nullable().optional(),
  source: z.enum(['manual', 'import']).optional(),
});
export const addEntriesSchema = z.object({ entries: z.array(entrySchema).min(1).max(500) });
export const setCategorySchema = z.object({ category: z.string().max(30) });
export const walletSchema = z.object({ name: z.string().trim().min(1).max(40), kind: z.enum(['dinheiro', 'conta', 'cartao', 'poupanca', 'outra']) });
export const entryWalletSchema = z.object({ walletId: z.string().uuid().nullable() });
export const reminderSchema = z.object({
  title: z.string().trim().min(2).max(80),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(1).max(100_000_000_00).nullable().optional(),
  repeatMonthly: z.boolean().optional(),
  emailDaysBefore: z.number().int().min(0).max(10).optional(),
});
export const reminderPatchSchema = reminderSchema.partial().extend({ done: z.boolean().optional() });
export const accountDebtSchema = z.object({
  name: z.string().trim().min(1).max(60),
  balanceCents: z.number().int().min(1).max(100_000_000_00),
  monthlyRateBps: z.number().int().min(0).max(10_000).optional(),
  minPaymentCents: z.number().int().min(0).max(100_000_000_00).optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
});
export const accountDebtPatchSchema = accountDebtSchema.partial();
export const debtPaymentSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000_00),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  addToLedger: z.boolean().optional(),
});
export const objectiveSchema = z.object({ objective: z.enum(['organizar', 'sair_do_vermelho', 'reserva', 'investir']) });
export const plannerSchema = z.object({ question: z.string().trim().min(5).max(500) });
export const monthLimitSchema = z.object({ limitCents: z.number().int().positive().max(100_000_000_00).nullable() });
export const setLimitSchema = z.object({ limitCents: z.number().int().positive().max(100_000_000_00).nullable() });
export const goalSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  targetCents: z.number().int().positive().max(100_000_000_00),
  savedCents: z.number().int().min(0).max(100_000_000_00).default(0),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export const contributionSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000_00),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(120).optional(),
});
export const simulateSchema = z.object({
  initialCents: z.number().int().min(0).max(100_000_000_00),
  monthlyCents: z.number().int().min(0).max(100_000_000_00),
  months: z.number().int().min(1).max(600),
  scenarios: z.array(z.object({ name: z.string().trim().min(1).max(40), annualPct: z.number().min(-50).max(100) })).min(1).max(5),
  inflationAnnualPct: z.number().min(0).max(50).default(0),
});

export const accessSchema = z.object({ token: z.string().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/) });

export const uuidParam = z.string().uuid();

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
