import { buildIncomePlanTemplate, rateText } from '../engine.ts';
import type { IncomeFacts, IncomePlanContent } from '../engine.ts';
import { INCOME_WEEK_TEMPLATES, INCOME_CAUTIONS } from '../engine.ts';
import type { IncomePlanCore } from './income-schema.ts';

/**
 * Monta a entrega final. Números, semanas e plataformas vêm sempre de código (packages/domain); quando a
 * IA participou, ela só contribui com texto (nota de abertura, o "porquê" personalizado, uma frase extra
 * por semana e um incentivo final) — nunca escolhe um número nem cita uma plataforma nova.
 */
export function assembleIncomePlan(core: IncomePlanCore | null, facts: IncomeFacts, source: 'ai' | 'template'): IncomePlanContent {
  if (source === 'template' || !core) return buildIncomePlanTemplate(facts);

  const idea = facts.candidates.find((c) => c.id === core.ideaId) ?? facts.candidates[0];
  if (!idea) throw new Error('nenhuma ideia candidata combina com o perfil informado');
  const cat = idea.category;

  return {
    version: 1,
    source: 'ai',
    openingNote: core.openingNote,
    encouragement: core.encouragement,
    target: facts.target,
    idea: {
      title: idea.title,
      category: cat,
      why: core.personalizedWhy,
      platforms: facts.platformsByCategory[cat],
      rateNote: rateText(cat, facts),
      projected: facts.projectedByCategory[cat] ?? null,
    },
    weeks: INCOME_WEEK_TEMPLATES[cat].map((w, i) => ({ week: i + 1, title: w.title, tasks: [...w.tasks, core.weekNotes[i]!] })),
    cautions: INCOME_CAUTIONS,
  };
}
