// Guias pagos "sob medida" (fases futuras do roteiro): comparador de financiamento, renegociador de contas de casa,
// dinheiro esquecido e currículo por vaga. Cada guia é um atendimento próprio (como o tradutor): a pessoa preenche, vê uma
// prévia grátis e libera o conteúdo completo por Pix. Todo o cálculo mora em packages/domain; aqui só validação e registro.
import { z } from 'zod';
import {
  buildFinancingPreview, buildForgottenGuide, buildForgottenPreview, buildHouseBillPlan, buildHouseBillPreview, buildResume, buildResumePreview,
  compareFinancing, FinancingInputError, ForgottenInputError, HouseBillInputError, MAX_JOB_CHARS, ResumeInputError,
} from './engine.ts';
import { AppError } from './errors.ts';

export const GUIDED_KINDS = ['financing', 'housebills', 'forgotten', 'resume'] as const;
export type GuidedKind = (typeof GUIDED_KINDS)[number];
export const GUIDED_PRODUCT: Record<GuidedKind, string> = { financing: 'guide_financing', housebills: 'guide_housebills', forgotten: 'guide_forgotten', resume: 'guide_resume' };
export const GUIDED_CODES: readonly string[] = Object.values(GUIDED_PRODUCT);
export const guidedKindOfCode = (code: string): GuidedKind | null => (GUIDED_KINDS.find((k) => GUIDED_PRODUCT[k] === code) ?? null);

const cents = (max: number) => z.number().int().min(0).max(max);
const money = cents(100_000_000_000);

const financingSchema = z.strictObject({
  kind: z.enum(['veiculo', 'imovel', 'pessoal', 'outro']),
  priceCents: money.min(1),
  downPaymentCents: money,
  netIncomeCents: money.optional(),
  savingMonthlyCents: money.optional(),
  offers: z.array(z.strictObject({
    name: z.string().trim().min(1).max(40),
    termMonths: z.number().int().min(1).max(480),
    monthlyRateBps: z.number().int().min(0).max(3000),
    system: z.enum(['price', 'sac']),
    upfrontFeesCents: cents(10_000_000_000),
    monthlyExtrasCents: cents(1_000_000_000),
  })).min(1).max(4),
});

const houseBillsSchema = z.strictObject({
  kind: z.enum(['energia', 'agua', 'gas', 'internet', 'celular', 'tv']),
  overdueCents: money.min(1),
  monthsOverdue: z.number().int().min(1).max(120),
  monthlyCapacityCents: money.min(1),
  netIncomeCents: money.optional(),
  cutStatus: z.enum(['nao', 'aviso', 'cortado']),
  lowIncome: z.enum(['sim', 'nao', 'nao_sei']),
  disputesAmount: z.boolean(),
});

const yn = z.enum(['sim', 'nao']);
const ynm = z.enum(['sim', 'nao', 'nao_sei']);
const forgottenSchema = z.strictObject({
  workedFormal: yn, workedBefore1989: yn, closedBankAccount: ynm, consorcioOrCoop: ynm, relativeDied: yn, declaresIr: yn, invested: yn, lifeInsurance: ynm, inssBenefit: yn,
});

/** O currículo NÃO recebe dado de contato: se a pessoa colar e-mail, telefone ou CPF por engano, tiramos antes de processar. */
const PII = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const clean = (t: string) => t.replace(PII, ' ').replace(/[ \t]{2,}/g, ' ').trim();
const resumeSchema = z.strictObject({
  targetRole: z.string().trim().min(3).max(80),
  level: z.enum(['entrada', 'pleno', 'senior']),
  jobText: z.string().min(40).max(MAX_JOB_CHARS),
  skills: z.string().max(500),
  education: z.string().max(200),
  languages: z.string().max(120),
  experiences: z.array(z.strictObject({ role: z.string().trim().min(2).max(80), years: z.number().int().min(0).max(60), tasks: z.string().max(800) })).max(6),
});

interface Spec {
  schema: z.ZodType<any>;
  build: (input: any) => { full: unknown; preview: unknown };
}

export const REGISTRY: Record<GuidedKind, Spec> = {
  financing: {
    schema: financingSchema,
    build: (i) => {
      const full = compareFinancing(i);
      return { full, preview: buildFinancingPreview(full) };
    },
  },
  housebills: {
    schema: houseBillsSchema,
    build: (i) => {
      const full = buildHouseBillPlan(i);
      return { full, preview: buildHouseBillPreview(full) };
    },
  },
  forgotten: {
    schema: forgottenSchema,
    build: (i) => {
      const full = buildForgottenGuide(i);
      return { full, preview: buildForgottenPreview(full) };
    },
  },
  resume: {
    schema: resumeSchema,
    build: (i) => {
      const full = buildResume({ ...i, jobText: clean(i.jobText), skills: clean(i.skills), education: clean(i.education), languages: clean(i.languages), experiences: i.experiences.map((e: any) => ({ ...e, role: clean(e.role), tasks: clean(e.tasks) })) });
      return { full, preview: buildResumePreview(full) };
    },
  },
};

/** Valida a entrada e calcula. Erro de dado do cliente vira 422 com a lista do que está errado. */
export function buildGuided(kind: GuidedKind, raw: unknown): { full: unknown; preview: unknown } {
  const spec = REGISTRY[kind];
  const input = spec.schema.parse(raw);
  try {
    return spec.build(input);
  } catch (error) {
    if (error instanceof FinancingInputError || error instanceof HouseBillInputError || error instanceof ForgottenInputError || error instanceof ResumeInputError) {
      throw new AppError(422, 'invalid_input', `Confira os dados: ${error.issues.join('; ')}.`);
    }
    throw error;
  }
}
