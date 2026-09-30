import { z } from 'zod';

/**
 * O que a IA escreve: escolhe a MELHOR ideia entre as candidatas (usando a habilidade que a pessoa
 * descreveu) e personaliza o texto. Números, plataformas e a estrutura das 4 semanas vêm de CÓDIGO
 * (packages/domain/src/income.ts) — a IA nunca inventa valor nem nome de plataforma.
 */
export const incomePlanCoreSchema = z.object({
  ideaId: z.string().min(1).max(40),
  openingNote: z.string().min(20).max(400),
  personalizedWhy: z.string().min(20).max(400),
  weekNotes: z.array(z.string().min(5).max(240)).length(4),
  encouragement: z.string().min(10).max(300),
});

export type IncomePlanCore = z.infer<typeof incomePlanCoreSchema>;
