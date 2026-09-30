import { z } from 'zod';

/** Roteiro de UMA dívida. A IA e os modelos determinísticos produzem exatamente este formato. */
export const debtScriptSchema = z.object({
  id: z.string().min(1).max(20),
  resumo: z.string().min(10).max(400),
  antes_de_ligar: z.array(z.string().min(3).max(260)).min(1).max(5),
  abertura: z.string().min(10).max(600),
  argumentos: z.array(z.string().min(3).max(360)).min(2).max(5),
  proposta: z.string().min(10).max(700),
  mensagem_whatsapp: z.string().min(20).max(800),
  evitar: z.array(z.string().min(3).max(260)).min(1).max(5),
  se_recusarem: z.string().min(10).max(500),
});

export const scriptsCoreSchema = z.object({
  dividas: z.array(debtScriptSchema).min(1).max(30),
  dicas_gerais: z.array(z.string().min(3).max(300)).min(2).max(6),
});

export type DebtScript = z.infer<typeof debtScriptSchema>;
export type ScriptsCore = z.infer<typeof scriptsCoreSchema>;

/** Formato final gravado em deliverables.content (com nomes reais e números estruturados calculados por código). */
export interface ScriptsContent {
  version: 1;
  source: 'ai' | 'template';
  general: string[];
  debts: Array<
    DebtScript & {
      creditorName: string;
      kind: string;
      tier: string;
      oferta: { openingCents: number; targetCents: number; limitCents: number; openingPct: number; targetPct: number; limitPct: number } | null;
    }
  >;
  held: Array<{ id: string; creditorName: string; aviso: string }>;
  capacityCents: number;
}

export interface Letter {
  id: string;
  tipo: 'prescricao' | 'informacoes' | 'contestacao';
  titulo: string;
  destinatario: string;
  assunto: string;
  corpo: string;
  anexos: string[];
  como_enviar: string[];
  avisos: string[];
}

export interface LettersContent {
  version: 1;
  source: 'template';
  letters: Letter[];
  general: string[];
}
