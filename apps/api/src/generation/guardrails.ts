import type { CaseFacts } from './facts.ts';
import type { ScriptsCore } from './schema.ts';
import type { IncomePlanCore } from './income-schema.ts';
import type { IncomeFacts } from '../engine.ts';

/** Junta todo texto de um objeto (recursivo). */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}

const MONEY = /R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g;
const PERCENT = /(\d{1,3}(?:,\d{1,2})?)\s?%/g;

function moneyMentionsCents(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(MONEY)) {
    const reais = Number((m[1] ?? '0').replace(/\./g, ''));
    const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
    found.push(reais * 100 + cents);
  }
  return found;
}

/** Regras comuns a qualquer texto gerado por IA neste projeto (D-009: números vêm de código, nunca da IA). */
function checkCommonRules(texts: string[], allowedAmountsCents: number[], allowedPercents: number[] | null): string[] {
  const issues: string[] = [];
  const allowedWhole = new Set(allowedAmountsCents.map((c) => Math.round(c / 100) * 100));
  for (const t of texts) {
    for (const cents of moneyMentionsCents(t)) {
      const ok = allowedAmountsCents.some((a) => Math.abs(a - cents) <= 1) || allowedWhole.has(cents);
      if (!ok) issues.push(`Valor não autorizado no texto: R$ ${(cents / 100).toFixed(2)}. Use SOMENTE os valores fornecidos.`);
    }
    if (allowedPercents) {
      for (const m of t.matchAll(PERCENT)) {
        const pct = Number((m[1] ?? '0').replace(',', '.'));
        if (!allowedPercents.some((p) => Math.abs(p - pct) < 0.011)) issues.push(`Porcentagem não autorizada: ${m[1]}%.`);
      }
    }
    if (/https?:\/\/|www\.|@[a-z0-9]/i.test(t)) issues.push('Não inclua links, e-mails ou @ nos textos.');
    if (/\bgarant(o|imos|ido|ida|ia)\b|sem risco|100% seguro/i.test(t)) issues.push('Não faça promessas nem garantias.');
    if (/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\(\d{2}\)\s?\d{4,5}-?\d{4}/.test(t)) issues.push('Não inclua CPF ou telefones.');
  }
  return issues;
}

/**
 * Regras que o texto gerado por IA precisa cumprir. Devolve a lista de violações (vazia = aprovado).
 * Princípio (D-009): números e citações legais vêm de código/modelos revisados, nunca da IA.
 */
export function checkGeneratedText(core: ScriptsCore, facts: CaseFacts, expectedIds: string[]): string[] {
  const issues: string[] = [];

  const got = core.dividas.map((d) => d.id).sort();
  const want = [...expectedIds].sort();
  if (got.length !== want.length || got.some((id, i) => id !== want[i])) {
    issues.push(`As dívidas devem ser exatamente ${want.join(', ')} (uma vez cada); recebi ${got.join(', ')}.`);
  }

  const text = collectStrings(core);
  issues.push(...checkCommonRules(text, [...facts.allowedAmountsCents], [...facts.allowedPercents]));
  for (const t of text) {
    if (/\b(art\.?|artigo)\s*\d+|\blei\s*(n[º°.]?\s*)?\d|súmula|stj|stf|cdc\b/i.test(t)) issues.push('Não cite artigos de lei, súmulas ou tribunais.');
    if (/limp(ar|o|amos)\s+(o\s+)?(seu\s+)?nome|nome limpo|tirar (o )?nome do (spc|serasa)/i.test(t)) issues.push('Não prometa "limpar o nome".');
    if (/\b(advogad[oa] (vai|irá|deve)|processar|processo judicial)\b/i.test(t) && /ameaç/i.test(t)) issues.push('Não sugira ameaças.');
  }
  return [...new Set(issues)];
}

/**
 * Verificador do plano de renda extra: mesma disciplina dos roteiros de negociação, mais dois pontos
 * específicos deste produto: (1) só pode citar plataformas da lista permitida (nunca inventar um nome de
 * app ou site), e (2) o tom precisa ser de "empreender" — nunca insistir só em "vender", nunca prometer
 * ficar rico ou renda fácil.
 */
export function checkIncomeText(core: IncomePlanCore, facts: IncomeFacts): string[] {
  const issues: string[] = [];
  if (!facts.candidates.some((c) => c.id === core.ideaId)) {
    issues.push(`ideaId deve ser uma das ideias candidatas fornecidas; recebi "${core.ideaId}".`);
  }
  if (core.weeks.length !== 4) issues.push('weeks precisa ter exatamente 4 semanas.');
  const text = collectStrings(core);
  issues.push(...checkCommonRules(text, facts.allowedAmountsCents, null));

  // Lista de plataformas conhecidas que a IA poderia citar por conta própria (alucinação); qualquer uma
  // dessas que apareça no texto sem estar na lista permitida (facts.allowedPlatforms) é reprovada.
  const KNOWN_PLATFORMS = [
    'OLX', 'Enjoei', 'Facebook Marketplace', 'Mercado Livre', 'Shopee', 'Etsy', 'Amazon', 'Instagram', 'WhatsApp Business',
    'GetNinjas', 'iFood', 'Rappi', '99Entregas', 'Uber', 'Uber Eats', '99', 'TikTok Shop', 'Airbnb', 'Workana', '99Freelas',
  ];
  const allowedPlatformsLower = new Set(facts.allowedPlatforms.map((p) => p.toLowerCase()));
  for (const t of text) {
    for (const platform of KNOWN_PLATFORMS) {
      if (allowedPlatformsLower.has(platform.toLowerCase())) continue;
      if (new RegExp(`\\b${platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) {
        issues.push(`Plataforma não autorizada: "${platform}". Use SOMENTE as plataformas fornecidas.`);
      }
    }
    if (/\b(fic(ar|ou)|vai ficar)\s+ric[oa]|renda (f[áa]cil|passiva de verdade)|dinheiro (f[áa]cil|r[áa]pido)\b/i.test(t)) issues.push('Não prometa "ficar rico" nem "renda fácil".');
    if (/pirâmide|esquema/i.test(t)) issues.push('Não sugira esquemas de pirâmide.');
  }
  return [...new Set(issues)];
}
