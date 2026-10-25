import { z } from 'zod';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
const EMPLOYMENT_TYPES = ['inss_retiree', 'public_servant', 'clt', 'self_employed', 'other'] as const;
const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65-74', '75+'] as const;
const KINDS = ['credit_card', 'overdraft', 'personal_loan', 'payroll_loan', 'financing', 'store_credit', 'utility', 'rent', 'other'] as const;

const cents = z.number().int().min(0).max(100_000_000_000);

/** Data de calendário de verdade (2026-02-31 não existe) e entre 1900 e 2200: o banco recusa o resto com erro 500. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= '2200-12-31';
  }, 'Data inválida');
/** Quando começou o atraso: não pode ser no futuro (com um dia de folga para o fuso horário). */
const pastDate = isoDate.refine((v) => v <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'A data não pode ser no futuro');

/** Mês no formato AAAA-MM, de 01 a 12. */
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido');

export const debtSchema = z.strictObject({
  creditorName: z.string().trim().min(1).max(60),
  kind: z.enum(KINDS),
  kindNote: z.string().trim().max(60).optional(),
  balanceCents: cents.min(1),
  monthlyPaymentCents: cents.optional(),
  remainingInstallments: z.number().int().min(1).max(600).optional(),
  monthlyRateBps: z.number().int().min(0).max(10_000).optional(),
  daysOverdue: z.number().int().min(0).max(36_500),
  firstDefaultOn: pastDate.optional(),
});

export const createCaseSchema = z.object({
  profile: z.strictObject({
    netIncomeCents: cents,
    fixedExpensesCents: cents,
    employmentType: z.enum(['inss_retiree', 'public_servant', 'clt', 'self_employed', 'other']),
    /** Só com vínculo "outra situação": como o dinheiro entra, em poucas palavras (opcional). */
    employmentNote: z.string().trim().max(60).optional(),
    /** Só com vínculo CLT: contrato por prazo determinado (temporário) ou indeterminado. Descritivo; fica no caso. */
    cltContract: z.enum(['temporary', 'permanent']).optional(),
    ageBand: z.enum(AGE_BANDS),
    uf: z.enum(UFS),
  }),
  debts: z.array(debtSchema).min(1).max(30),
  acceptTerms: z.literal(true),
});

/** Cookies da Meta: _fbp (navegador) e _fbc (clique no anúncio). */
export const FBP_RE = z.string().regex(/^fb\.1\.\d{10,14}\.\d{5,20}$/);
export const FBC_RE = z.string().regex(/^fb\.1\.\d{10,14}\.[A-Za-z0-9_-]{6,200}$/);

/** Contato de quem vai pagar o Pix: e-mail e celular com DDD; adsConsent é o aceite separado (opcional, desmarcado). */
export const orderContactSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((d) => /^\d{10,11}$/.test(d), 'Celular inválido'),
  adsConsent: z.boolean().default(true), // o aceite vem dos termos aceitos no diagnóstico; o campo não aparece mais na tela
  fbc: FBC_RE.optional(),
  fbp: FBP_RE.optional(),
});

export const createOrderSchema = z.object({
  caseId: z.string().uuid(),
  contact: orderContactSchema.optional(),
  withLetters: z.boolean().default(false),
  products: z.array(z.enum(['recovery_map', 'defense_letters', 'calendar_30d', 'extra_income_plan', 'collection_translator', 'guide_financing', 'guide_housebills', 'guide_forgotten', 'guide_resume'])).min(1).max(4).optional(),
});

export const guidedSchema = z.strictObject({ input: z.unknown(), acceptTerms: z.literal(true) });
/**
 * Texto de cobrança vindo de FOTO (OCR) sai sujo e comprido: caracteres de controle, "lixo" unicode, páginas inteiras.
 * Em vez de recusar, limpamos e usamos os primeiros 4000 caracteres: a leitura da cobrança nunca pode falhar por isso.
 */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
export const cleanCollectionText = (raw: string): string => {
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, ' ')
    .replace(LONE_SURROGATE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.slice(0, 4000).replace(LONE_SURROGATE, '').trim();
};
export const translationSchema = z.object({ text: z.string().max(200_000).transform(cleanCollectionText).pipe(z.string().min(8)), acceptTerms: z.literal(true) });

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
  tradeName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
  uf: z.enum(UFS).optional(),
  address: z.string().trim().max(200).optional(),
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
    /** Comissão do Fôlego sobre o contrato fechado, em pontos-base (1000 = 10%). Soma-se ao valor por contato. */
    commissionBps: z.number().int().min(0).max(10_000).default(0),
    /** Sem webhook, o contato aparece só no portal do parceiro. */
    webhookUrl: z.string().url().max(500).optional(),
  }),
});

export const emailOnlySchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
export const loginCodeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().regex(/^\d{6}$/) });
export const subscriptionOrderSchema = z.object({ plan: z.enum(['controle', 'ousado', 'desbravador']) });
/** CPF com dígitos verificadores válidos; aceita pontos e traço e devolve só os 11 dígitos. */
export const cpfSchema = z.string().trim().transform((v) => v.replace(/[.\-\s]/g, '')).refine((d) => {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}, 'CPF inválido');
export const checkoutSchema = z.object({ plan: z.enum(['controle', 'ousado', 'desbravador']), acceptTerms: z.literal(true), cpf: cpfSchema.optional(), adsConsent: z.boolean().optional(), fbc: z.string().regex(/^fb\.1\.\d{10,14}\.[A-Za-z0-9_-]{6,200}$/).optional(), name: z.string().trim().min(5).max(100).regex(/\S+\s+\S+/, 'Informe nome e sobrenome').optional(), phone: z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((d) => /^\d{10,11}$/.test(d), 'Celular inválido').optional(), referralCode: z.string().trim().toLowerCase().max(40).optional() });
export const referralLeadSchema = z.object({ friendEmail: z.string().trim().toLowerCase().email().max(200), yourName: z.string().trim().min(2).max(40) });
export const referralInviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
export const referralWhatsappSchema = z.object({ phone: z.string().trim().min(8).max(24), friendName: z.string().trim().min(2).max(40), confirmed: z.boolean() });
export const creditAdjustSchema = z.object({ subscriberId: z.string().uuid(), delta: z.number().int().min(-12).max(12), reason: z.string().trim().min(3).max(200) });
export const ebookPatchSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), active: z.boolean().optional() });
export const ebookTestSchema = z.object({ to: z.string().trim().toLowerCase().email().max(200).optional() });
export const profileSchema = z.object({ displayName: z.string().trim().max(60).nullable().optional(), notifyDigest: z.boolean().optional(), notifyReminders: z.boolean().optional(), marketing: z.boolean().optional() });
export const purgeSchema = z.object({ confirmEmail: z.string().trim().max(200) });
export const cancelSchema = z.object({ cancel: z.boolean() });

const entrySchema = z.strictObject({
  date: isoDate,
  amountCents: z.number().int().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 100_000_000_00),
  note: z.string().trim().max(120).default(''),
  category: z.string().max(30).optional(),
  walletId: z.string().uuid().nullable().optional(),
  source: z.enum(['manual', 'import']).optional(),
  transfer: z.boolean().optional(),
});
export const addEntriesSchema = z.object({ entries: z.array(entrySchema).min(1).max(500) });
export const setCategorySchema = z.object({ category: z.string().max(30) });
export const categoryNameSchema = z.strictObject({ name: z.string().trim().min(2).max(30) });
const signedCents = z.number().int().min(-10_000_000_000).max(10_000_000_000);
export const walletSchema = z.strictObject({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['dinheiro', 'conta', 'cartao', 'poupanca', 'outra']),
  /** Saldo de partida (negativo = já está no cheque especial). */
  openingBalanceCents: signedCents.optional(),
  /** Cheque especial (LIS): limite contratado e taxa ao mês em pontos-base (8% = 800). Só faz sentido em conta bancária. */
  overdraftLimitCents: z.number().int().min(0).max(10_000_000_000).optional(),
  overdraftRateBps: z.number().int().min(0).max(2000).optional(),
});
export const walletPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  openingBalanceCents: signedCents.optional(),
  overdraftLimitCents: z.number().int().min(0).max(10_000_000_000).optional(),
  overdraftRateBps: z.number().int().min(0).max(2000).optional(),
});
export const entryWalletSchema = z.object({ walletId: z.string().uuid().nullable() });
export const reminderSchema = z.strictObject({
  title: z.string().trim().min(2).max(80),
  dueOn: isoDate,
  amountCents: z.number().int().min(1).max(100_000_000_00).nullable().optional(),
  repeatMonthly: z.boolean().optional(),
  emailDaysBefore: z.number().int().min(0).max(10).optional(),
});
export const reminderPatchSchema = reminderSchema.partial().extend({ done: z.boolean().optional() });
export const accountDebtSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  balanceCents: z.number().int().min(1).max(100_000_000_00),
  monthlyRateBps: z.number().int().min(0).max(10_000).optional(),
  minPaymentCents: z.number().int().min(0).max(100_000_000_00).optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
});
export const accountDebtPatchSchema = accountDebtSchema.partial();
export const debtPaymentSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000_00),
  date: isoDate.optional(),
  addToLedger: z.boolean().optional(),
});
export const objectiveSchema = z.object({ objective: z.enum(['organizar', 'sair_do_vermelho', 'reserva', 'investir']) });
export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), access: z.enum(['edita', 'consulta']).default('edita') });
export const memberAccessSchema = z.strictObject({ access: z.enum(['edita', 'consulta']) });
export const recurringDecisionSchema = z.object({ status: z.enum(['keep', 'cancel']).nullable() });
export const plannerSchema = z.object({ question: z.string().trim().min(5).max(500) });
export const monthLimitSchema = z.object({ limitCents: z.number().int().positive().max(100_000_000_00).nullable() });
export const setLimitSchema = z.object({ limitCents: z.number().int().positive().max(100_000_000_00).nullable() });
export const goalSchema = z.strictObject({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  targetCents: z.number().int().positive().max(100_000_000_00),
  savedCents: z.number().int().min(0).max(100_000_000_00).default(0),
  dueOn: isoDate.nullable().optional(),
});
export const contributionSchema = z.strictObject({
  amountCents: z.number().int().min(1).max(100_000_000_00),
  date: isoDate.optional(),
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

// Cartões de crédito (Prumo): cadastro, compra (com parcelas), pagamento da fatura e fatura lida do PDF.
const cardCents = z.number().int().min(1).max(100_000_000_00);
export const cardSchema = z.strictObject({
  name: z.string().trim().min(2).max(40),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra']).optional(),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  limitCents: z.number().int().min(0).max(100_000_000_000),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  /** Juros do rotativo ao mês em pontos-base (14% = 1400). Só serve para simular o custo de pagar parte da fatura. */
  revolvingRateBps: z.number().int().min(0).max(3000).optional(),
});
export const cardPatchSchema = cardSchema.partial();
export const cardPurchaseSchema = z.strictObject({
  date: isoDate,
  amountCents: cardCents,
  note: z.string().trim().max(100).default(''),
  category: z.string().max(30).optional(),
  installments: z.number().int().min(1).max(60).optional(),
});
export const cardPaymentSchema = z.strictObject({
  paidOn: isoDate.optional(),
  amountCents: cardCents,
  walletId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(100).optional(),
});
export const cardImportSchema = z.strictObject({
  entries: z.array(z.strictObject({
    date: isoDate,
    amountCents: cardCents,
    note: z.string().trim().max(120),
    installmentNo: z.number().int().min(1).max(60).nullable().optional(),
    installmentTotal: z.number().int().min(2).max(60).nullable().optional(),
    category: z.string().max(30).optional(),
  })).max(500),
  credits: z.array(z.strictObject({ date: isoDate, amountCents: cardCents, note: z.string().trim().max(120) })).max(200),
  /** Pagamentos do topo da fatura: quitam a fatura anterior. */
  payments: z.array(z.strictObject({ date: isoDate, amountCents: cardCents, note: z.string().trim().max(120) })).max(50).optional(),
  invoice: z.strictObject({
    key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    periodStart: isoDate.nullable().optional(),
    closingOn: isoDate,
    dueOn: isoDate.nullable().optional(),
    totalCents: z.number().int().min(0).max(100_000_000_00),
    minPaymentCents: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
    previousCents: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
    previousKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
    history: z.array(z.strictObject({
      key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      periodStart: isoDate,
      closingOn: isoDate,
      totalCents: z.number().int().min(0).max(100_000_000_00),
      paidCents: z.number().int().min(0).max(100_000_000_00).nullable(),
    })).max(12).optional(),
  }).optional(),
  card: z.strictObject({
    name: z.string().trim().min(1).max(40).optional(),
    limitCents: z.number().int().min(0).max(100_000_000_000).optional(),
    closingDay: z.number().int().min(1).max(31).optional(),
    dueDay: z.number().int().min(1).max(31).optional(),
    last4: z.string().regex(/^\d{4}$/).nullable().optional(),
    availableCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  }).optional(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
