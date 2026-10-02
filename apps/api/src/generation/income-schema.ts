import { z } from 'zod';

/**
 * O que a IA escreve (v2): escolhe a MELHOR ideia entre as candidatas e escreve o plano INTEIRO sob medida
 * para o que a pessoa contou (oferta, cliente, como cobrar, as 4 semanas, a primeira mensagem, os riscos).
 * Números e plataformas continuam vindo de CÓDIGO (packages/domain/src/income.ts): o verificador reprova
 * qualquer valor ou plataforma que não esteja na lista permitida.
 * Limites de tamanho folgados de propósito: um texto um pouco longo não pode derrubar a IA para o modelo fixo.
 */
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

export const incomeWeekSchema = z.object({
  title: text(3, 90),
  goal: text(5, 300),
  tasks: z.array(text(5, 400)).min(3).max(6),
});

export const incomePlanCoreSchema = z.object({
  ideaId: z.string().min(1).max(40),
  headline: text(5, 140),
  openingNote: text(20, 1200),
  personalizedWhy: text(20, 1400),
  offer: z.object({
    whatYouSell: text(10, 600),
    idealCustomer: text(10, 600),
    pricingApproach: text(10, 900),
  }),
  weeks: z.array(incomeWeekSchema).length(4),
  firstMessage: text(20, 900),
  risks: z.array(text(10, 400)).min(2).max(5),
  encouragement: text(10, 600),
});

export type IncomePlanCore = z.infer<typeof incomePlanCoreSchema>;
