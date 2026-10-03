// Assinatura (plano Desbravador): "Pergunte ao Fôlego". Os FATOS (receita, gastos, dívidas, prazos) saem do banco e do
// motor; a IA só escreve a resposta em texto, e o verificador reprova qualquer valor que não esteja nos fatos
// (mesma regra D-009 dos roteiros). Sem chave de IA, ou se a IA errar, responde por regras com os mesmos fatos.
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { CATEGORY_LABEL, formatBrl, monthOf } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { listDebts } from './account-debts.ts';
import { checkCommonRules } from './generation/guardrails.ts';

const DAILY_LIMIT = 10;

export interface PlannerFacts {
  month: string;
  incomeCents: number;
  spentCents: number;
  balanceCents: number;
  topCategories: { label: string; cents: number }[];
  debts: { name: string; balanceCents: number; ratePct: number; minPaymentCents: number }[];
  debtMonths: number | null;
  debtFocus: string | null;
  upcoming: { title: string; dueOn: string; amountCents: number | null }[];
  allowedAmountsCents: number[];
}

export interface PlannerAnswer {
  answer: string;
  nextSteps: string[];
  source: 'ia' | 'regras';
}

export async function buildPlannerFacts(ctx: Ctx, subscriberId: string): Promise<PlannerFacts> {
  const today = todaySaoPaulo();
  const month = monthOf(today);
  const sums = await ctx.db.query<{ income: string; spent: string }>(
    `SELECT coalesce(sum(amount_cents) FILTER (WHERE amount_cents > 0), 0)::text AS income, coalesce(-sum(amount_cents) FILTER (WHERE amount_cents < 0), 0)::text AS spent
       FROM app.ledger_entries WHERE subscriber_id = $1 AND to_char(occurred_on, 'YYYY-MM') = $2`,
    [subscriberId, month],
  );
  const cats = await ctx.db.query<{ category: string; total: string }>(
    `SELECT category, (-sum(amount_cents))::text AS total FROM app.ledger_entries WHERE subscriber_id = $1 AND to_char(occurred_on, 'YYYY-MM') = $2 AND amount_cents < 0 GROUP BY category ORDER BY sum(amount_cents) LIMIT 4`,
    [subscriberId, month],
  );
  const rem = await ctx.db.query<{ title: string; due_on: Date | string; amount_cents: string | null }>(
    `SELECT title, due_on, amount_cents FROM app.reminders WHERE subscriber_id = $1 AND done_at IS NULL AND due_on BETWEEN $2::date AND ($2::date + 21) ORDER BY due_on LIMIT 6`,
    [subscriberId, today],
  );
  const d = await listDebts(ctx, subscriberId);
  const open = d.debts.filter((x) => !x.paidOff && x.balanceCents > 0);
  const income = num(sums.rows[0]?.income ?? 0);
  const spent = num(sums.rows[0]?.spent ?? 0);
  const topCategories = cats.rows.map((c) => ({ label: CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL] ?? c.category, cents: num(c.total) }));
  const upcoming = rem.rows.map((r) => ({ title: r.title, dueOn: new Date(r.due_on as string).toISOString().slice(0, 10), amountCents: r.amount_cents === null ? null : num(r.amount_cents) }));
  const debtMonths = d.plan ? d.plan[d.plan.recommended].months : null;
  const focus = open.find((x) => x.id === d.plan?.focusId);
  const allowed = [income, spent, income - spent, ...topCategories.map((c) => c.cents), ...open.flatMap((x) => [x.balanceCents, x.minPaymentCents]), ...upcoming.flatMap((u) => (u.amountCents ? [u.amountCents] : [])), d.totals.owedCents, d.totals.paidCents, d.totals.minPaymentsCents].filter((v) => v > 0);
  return {
    month,
    incomeCents: income,
    spentCents: spent,
    balanceCents: income - spent,
    topCategories,
    debts: open.map((x) => ({ name: x.name, balanceCents: x.balanceCents, ratePct: x.monthlyRateBps / 100, minPaymentCents: x.minPaymentCents })),
    debtMonths,
    debtFocus: focus?.name ?? null,
    upcoming,
    allowedAmountsCents: [...new Set(allowed)],
  };
}

/** Resposta por regras (sem IA): honesta e útil com os mesmos fatos. */
export function rulesAnswer(f: PlannerFacts): PlannerAnswer {
  const parts: string[] = [];
  if (f.incomeCents > 0 || f.spentCents > 0) parts.push(`Neste mês entrou ${formatBrl(f.incomeCents)} e saiu ${formatBrl(f.spentCents)}, o que deixa ${f.balanceCents >= 0 ? 'um saldo de' : 'um buraco de'} ${formatBrl(Math.abs(f.balanceCents))}.`);
  else parts.push('Você ainda não lançou nada neste mês, então não consigo olhar o seu fluxo.');
  if (f.topCategories[0]) parts.push(`O que mais pesa é ${f.topCategories[0].label} (${formatBrl(f.topCategories[0].cents)}).`);
  if (f.debtFocus) parts.push(`Nas dívidas, o foco é ${f.debtFocus}${f.debtMonths ? `, e no ritmo atual tudo fica quitado em ${f.debtMonths} meses` : ''}.`);
  const steps: string[] = [];
  if (f.balanceCents < 0) steps.push('Corte primeiro a categoria que mais pesa antes de mexer no resto.');
  if (f.debtFocus) steps.push(`Todo dinheiro extra vai para ${f.debtFocus}; nas outras dívidas pague só a mínima.`);
  if (f.upcoming.length) steps.push(`Separe o dinheiro de ${f.upcoming[0]!.title} antes do vencimento.`);
  if (steps.length === 0) steps.push('Registre seus gastos desta semana para eu poder te orientar melhor.');
  return { answer: parts.join(' '), nextSteps: steps.slice(0, 4), source: 'regras' };
}

const TOOL = {
  name: 'responder_ao_assinante',
  description: 'Responde a pergunta de finanças pessoais da pessoa usando SOMENTE os fatos fornecidos.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'Resposta direta e acolhedora em português do Brasil, até 1200 caracteres. Só cite valores em reais que estejam nos fatos, exatamente como estão.' },
      nextSteps: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', description: 'Próximo passo prático, começando com verbo (até 220 caracteres).' } },
    },
    required: ['answer', 'nextSteps'],
  },
};

const SYSTEM = `Você é o Fôlego, um organizador de finanças pessoais brasileiro: 80% amiga esperta, 20% consultoria séria.
Regras: (1) use SOMENTE os fatos do JSON; não invente números, taxas, produtos financeiros, bancos, links nem leis. (2) Valores em reais só os que aparecem nos fatos. (3) Nada de promessa nem garantia, nada de "ficar rico". (4) Não recomende investimentos específicos nem dê aconselhamento financeiro licenciado: oriente organização, corte de gastos, ordem de pagamento de dívidas e hábitos. (5) Se a pergunta fugir de finanças pessoais ou faltar dado, diga isso com gentileza e peça o que falta.`;

async function askClaude(ctx: Ctx, facts: PlannerFacts, question: string, feedback: string[]): Promise<{ answer: string; nextSteps: string[] }> {
  const user = `Pergunta da pessoa: ${question}\n\nFatos (valores em centavos; ${'formate como R$ ao responder'}):\n${JSON.stringify({ ...facts, allowedAmountsCents: undefined }, null, 1)}${feedback.length ? `\n\nSua resposta anterior foi REPROVADA: ${feedback.join('; ')}. Corrija.` : ''}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ctx.config.anthropicApiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(ctx.config.anthropicWorkspaceId ? { 'anthropic-workspace-id': ctx.config.anthropicWorkspaceId } : {}) },
    body: JSON.stringify({ model: ctx.config.aiModel, max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: user }], tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name } }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`anthropic_http_${res.status}`);
  const data = (await res.json()) as { content?: Array<{ type: string; name?: string; input?: { answer?: unknown; nextSteps?: unknown } }> };
  const block = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL.name);
  const input = block?.input;
  if (!input || typeof input.answer !== 'string' || !Array.isArray(input.nextSteps)) throw new Error('anthropic_formato_invalido');
  return { answer: input.answer.slice(0, 1500), nextSteps: input.nextSteps.filter((s): s is string => typeof s === 'string').slice(0, 4) };
}

export async function askPlanner(ctx: Ctx, subscriberId: string, question: string): Promise<PlannerAnswer> {
  await requireFeature(ctx, subscriberId, 'planner');
  const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.planner_log WHERE subscriber_id = $1 AND created_at > now() - interval '24 hours'`, [subscriberId]);
  if (num(used.rows[0]?.n ?? 0) >= DAILY_LIMIT) throw new AppError(429, 'planner_limit', `Você usou as ${DAILY_LIMIT} perguntas de hoje. Volte amanhã.`);
  const facts = await buildPlannerFacts(ctx, subscriberId);
  let out: PlannerAnswer = rulesAnswer(facts);
  if (ctx.config.anthropicApiKey) {
    let feedback: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const r = await askClaude(ctx, facts, question, feedback);
        feedback = checkCommonRules([r.answer, ...r.nextSteps], facts.allowedAmountsCents, null);
        if (feedback.length === 0 && r.nextSteps.length > 0) {
          out = { ...r, source: 'ia' };
          break;
        }
      } catch {
        break;
      }
    }
  }
  // A pergunta é guardada só para o limite diário (sem o texto).
  await ctx.db.query(`INSERT INTO app.planner_log(subscriber_id, source) VALUES ($1,$2)`, [subscriberId, out.source]);
  return out;
}
