import type { Ctx } from '../services.ts';
import { deliverPendingLeads } from '../leads.ts';
import { processWhatsAppQueue } from '../whatsapp.ts';
import { processBirdQueue, syncBirdStatuses } from '../bird.ts';
import { maintenance } from '../subscriptions.ts';
import { refreshRuntime } from '../runtime.ts';
import { workerBeat } from '../health.ts';
import { consentCheck, syncDueConnections } from '../openfinance.ts';
import { dispatchCampaigns } from '../admin/campaigns.ts';
import { sendDueReminders } from '../account-extras.ts';
import { sendWeeklyDigests } from '../account-debts.ts';
import { refreshMarket } from '../market.ts';
import { sendWelcomes } from '../coach-program.ts';
import { purgeCanceledExpired } from '../account-data.ts';
import { sendEbookGifts } from '../ebook.ts';
import { notifyCredits, syncPrices } from '../referrals.ts';
import type { DebtInput, Diagnosis, IncomeInterview, Profile } from '../engine.ts';
import { buildIncomeFacts } from '../engine.ts';
import { buildFacts } from './facts.ts';
import { assembleScripts, templateLetters, templateScripts } from './templates.ts';
import { assembleIncomePlan } from './income-templates.ts';
import { checkGeneratedText, checkIncomeText } from './guardrails.ts';
import type { ScriptGenerator } from './ai.ts';
import type { IncomePlanGenerator } from './income-ai.ts';
import type { ScriptsContent } from './schema.ts';

const MAX_ATTEMPTS = 5;

export interface WorkerOptions {
  /** Sem gerador: usa só os modelos determinísticos. */
  generator: ScriptGenerator | null;
  /** Idem, para o plano de renda extra (produto separado, prompt/verificador próprios). Ausente = sem IA. */
  incomeGenerator?: IncomePlanGenerator | null;
  /** Teto de chamadas à IA por dia (controle de custo). Acima disso, modelos determinísticos. */
  maxAiCallsPerDay: number;
  log?: (event: Record<string, unknown>) => void;
}

interface Claimed {
  id: string;
  case_id: string;
  product_code: string;
  attempts: number;
}

/**
 * Pega UM entregável pendente (FOR UPDATE SKIP LOCKED: vários workers não pegam o mesmo), gera e grava.
 * Retorna true se havia trabalho. A fila é a própria tabela app.deliverables (sem dependência extra).
 */
export async function processNext(ctx: Ctx, opts: WorkerOptions): Promise<boolean> {
  const log = opts.log ?? (() => undefined);
  await refreshRuntime(ctx.db, ctx.config); // o dono muda IA, teto e lembretes pelo backoffice sem reiniciar o worker
  const claimed = await ctx.db.query<Claimed>(
    `UPDATE app.deliverables
        SET status = 'generating', updated_at = now(),
            generation_meta = jsonb_set(coalesce(generation_meta, '{}'::jsonb), '{attempts}', to_jsonb(coalesce((generation_meta->>'attempts')::int, 0) + 1))
      WHERE id = (
        SELECT id FROM app.deliverables
         WHERE product_code IN ('negotiation_scripts', 'defense_letters', 'extra_income_plan')
           AND ( (status = 'pending' AND (coalesce((generation_meta->>'attempts')::int, 0) = 0
                                       OR updated_at < now() - make_interval(secs => coalesce((generation_meta->>'attempts')::int, 0) * 30)))
              OR (status = 'generating' AND updated_at < now() - interval '10 minutes') )
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, case_id, product_code, coalesce((generation_meta->>'attempts')::int, 1) AS attempts`,
  );
  const job = claimed.rows[0];
  if (!job) return false;

  const started = Date.now();
  try {
    const { content, meta } = await generate(ctx, opts, job);
    await ctx.db.query(
      `UPDATE app.deliverables
          SET status = 'ready', content = $2::jsonb, generated_at = now(), updated_at = now(),
              generation_meta = coalesce(generation_meta, '{}'::jsonb) || $3::jsonb
        WHERE id = $1`,
      [job.id, JSON.stringify(content), JSON.stringify({ ...meta, ms: Date.now() - started })],
    );
    log({ evento: 'entregavel_pronto', produto: job.product_code, origem: meta.source, ms: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'erro';
    const giveUp = Number(job.attempts) >= MAX_ATTEMPTS;
    await ctx.db.query(
      `UPDATE app.deliverables SET status = $2, updated_at = now(), generation_meta = coalesce(generation_meta, '{}'::jsonb) || $3::jsonb WHERE id = $1`,
      [job.id, giveUp ? 'failed' : 'pending', JSON.stringify({ lastError: message })],
    );
    log({ evento: 'entregavel_erro', produto: job.product_code, tentativa: job.attempts, desistiu: giveUp, erro: message });
  }
  return true;
}

interface Generated {
  content: unknown;
  meta: Record<string, unknown>;
}

async function generate(ctx: Ctx, opts: WorkerOptions, job: Claimed): Promise<Generated> {
  if (job.product_code === 'extra_income_plan') return generateIncome(ctx, opts, job);

  const c = await ctx.db.query<{ inputs: { debts: DebtInput[] }; diagnosis: Diagnosis }>(
    `SELECT c.inputs, (SELECT d.content FROM app.deliverables d WHERE d.case_id = c.id AND d.product_code = 'recovery_map') AS diagnosis FROM app.cases c WHERE c.id = $1`,
    [job.case_id],
  );
  const row = c.rows[0];
  if (!row || !row.diagnosis || !Array.isArray(row.inputs?.debts)) throw new Error('caso_sem_dados');
  const debts = row.inputs.debts;
  const names = new Map(debts.map((d) => [d.id, d.creditorName]));
  const facts = buildFacts(debts, row.diagnosis);

  if (job.product_code === 'defense_letters') {
    const firstDefault = new Map(debts.map((d) => [d.id, d.firstDefaultOn ? d.firstDefaultOn.slice(0, 7).split('-').reverse().join('/') : undefined]));
    return { content: templateLetters(facts, names, firstDefault), meta: { source: 'template' } };
  }

  // negotiation_scripts
  const expectedIds = facts.debts.filter((d) => d.rank !== null).map((d) => d.id);
  let content: ScriptsContent | null = null;
  let meta: Record<string, unknown> = { source: 'template' };

  if (opts.generator && ctx.config.aiEnabled && expectedIds.length > 0) {
    const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliverables WHERE generation_meta->>'source' = 'ai' AND generated_at >= date_trunc('day', now())`);
    if (Number(used.rows[0]?.n ?? 0) < Math.min(opts.maxAiCallsPerDay, ctx.config.aiMaxCallsPerDay)) {
      let feedback: string[] = [];
      for (let attempt = 1; attempt <= 3 && !content; attempt++) {
        try {
          const ai = await opts.generator.generate(facts, feedback);
          const issues = checkGeneratedText(ai.core, facts, expectedIds);
          if (issues.length === 0) {
            content = assembleScripts(ai.core, facts, names, 'ai');
            meta = { source: 'ai', model: ai.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, aiAttempts: attempt };
          } else {
            feedback = issues;
            opts.log?.({ evento: 'ia_reprovada_no_verificador', tentativa: attempt, problemas: issues.length, detalhe: issues.slice(0, 3).join(' | ').slice(0, 300) });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'erro';
          opts.log?.({ evento: 'ia_falhou', tentativa: attempt, erro: msg.slice(0, 200) });
          // Formato fora do esperado (ex.: texto longo demais): tenta de novo dizendo o que corrigir. Erro de rede: modelo fixo.
          if (msg.startsWith('anthropic_formato_invalido')) { feedback = [msg.slice(0, 400)]; continue; }
          break;
        }
      }
      if (!content) meta = { source: 'template', motivo: 'ia_indisponivel_ou_reprovada' };
    } else {
      meta = { source: 'template', motivo: 'teto_diario_de_ia' };
    }
  }

  if (!content) content = assembleScripts(templateScripts(facts), facts, names, 'template');
  return { content, meta };
}

async function generateIncome(ctx: Ctx, opts: WorkerOptions, job: Claimed): Promise<Generated> {
  const c = await ctx.db.query<{
    inputs: { asOf: string };
    employment_type: Profile['employmentType'];
    net_income_cents: string;
    fixed_expenses_cents: string;
    age_band: string;
    uf: string;
    diagnosis: Diagnosis;
    skills: string;
    hours_band: IncomeInterview['hoursBand'];
    capital_cents: string;
    has_vehicle: boolean;
    mode: IncomeInterview['mode'];
    prior_attempts: string;
  }>(
    `SELECT c.inputs, c.employment_type, c.net_income_cents, c.fixed_expenses_cents, c.age_band, c.uf,
            (SELECT d.content FROM app.deliverables d WHERE d.case_id = c.id AND d.product_code = 'recovery_map') AS diagnosis,
            i.skills, i.hours_band, i.capital_cents, i.has_vehicle, i.mode, i.prior_attempts
       FROM app.cases c JOIN app.income_interviews i ON i.case_id = c.id
      WHERE c.id = $1`,
    [job.case_id],
  );
  const row = c.rows[0];
  if (!row || !row.diagnosis) throw new Error('caso_sem_entrevista_ou_diagnostico');
  const profile: Profile = {
    netIncomeCents: Number(row.net_income_cents),
    fixedExpensesCents: Number(row.fixed_expenses_cents),
    employmentType: row.employment_type,
    ageBand: row.age_band,
    uf: row.uf,
  };
  const interview: IncomeInterview = {
    skills: row.skills,
    hoursBand: row.hours_band,
    capitalCents: Number(row.capital_cents),
    hasVehicle: row.has_vehicle,
    mode: row.mode,
    priorAttempts: row.prior_attempts,
  };
  const facts = buildIncomeFacts(row.diagnosis, profile, interview);

  let content = null as ReturnType<typeof assembleIncomePlan> | null;
  let meta: Record<string, unknown> = { source: 'template' };

  if (opts.incomeGenerator && ctx.config.aiEnabled) {
    const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliverables WHERE generation_meta->>'source' = 'ai' AND generated_at >= date_trunc('day', now())`);
    if (Number(used.rows[0]?.n ?? 0) < Math.min(opts.maxAiCallsPerDay, ctx.config.aiMaxCallsPerDay)) {
      let feedback: string[] = [];
      for (let attempt = 1; attempt <= 3 && !content; attempt++) {
        try {
          const ai = await opts.incomeGenerator.generate(facts, feedback);
          const issues = checkIncomeText(ai.core, facts);
          if (issues.length === 0) {
            content = assembleIncomePlan(ai.core, facts, 'ai');
            meta = { source: 'ai', model: ai.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens, aiAttempts: attempt };
          } else {
            feedback = issues;
            opts.log?.({ evento: 'ia_reprovada_no_verificador', produto: 'extra_income_plan', tentativa: attempt, problemas: issues.length, detalhe: issues.slice(0, 3).join(' | ').slice(0, 300) });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'erro';
          opts.log?.({ evento: 'ia_falhou', produto: 'extra_income_plan', tentativa: attempt, erro: msg.slice(0, 200) });
          if (msg.startsWith('anthropic_formato_invalido')) { feedback = [msg.slice(0, 400)]; continue; }
          break;
        }
      }
      if (!content) meta = { source: 'template', motivo: 'ia_indisponivel_ou_reprovada' };
    } else {
      meta = { source: 'template', motivo: 'teto_diario_de_ia' };
    }
  }

  if (!content) content = assembleIncomePlan(null, facts, 'template');
  return { content, meta };
}

/** Laço do worker: processa até esvaziar a fila e dorme quando não há nada. */
export async function runWorker(ctx: Ctx, opts: WorkerOptions, control: { stopped: boolean }, idleMs = 3000): Promise<void> {
  let lastBeat = 0;
  while (!control.stopped) {
    let did = false;
    if (Date.now() - lastBeat > 30_000) {
      lastBeat = Date.now();
      await workerBeat(ctx);
    }
    await refreshRuntime(ctx.db, ctx.config); // lê de novo o que o dono mudou em Configurações (indicações, teto de e-mails etc.)
    try {
      did = await processNext(ctx, opts);
    } catch (error) {
      opts.log?.({ evento: 'worker_erro', erro: error instanceof Error ? error.message.slice(0, 200) : 'erro' });
    }
    // Cada trabalho roda isolado: se um falha, os outros continuam (antes um erro derrubava a fila inteira).
    const log = opts.log ? { log: opts.log } : {};
    const jobs: Array<[string, () => Promise<unknown>]> = [
      ['leads', () => deliverPendingLeads(ctx, log)],
      ['whatsapp', () => processWhatsAppQueue(ctx, log)],
      ['whatsapp_folego', () => processBirdQueue(ctx, log)],
      ['whatsapp_status', () => syncBirdStatuses(ctx)],
      ['campanhas', () => dispatchCampaigns(ctx, log)],
      ['lembretes', () => sendDueReminders(ctx, log)],
      ['resumo_semanal', () => sendWeeklyDigests(ctx, log)],
      ['expurgo_cancelados', () => purgeCanceledExpired(ctx, log)],
      ['ebook_presente', () => sendEbookGifts(ctx, log)],
      ['avisos_indicacao', () => notifyCredits(ctx, log)],
      ['valores_assinatura', () => syncPrices(ctx, log)],
      ['boas_vindas', () => sendWelcomes(ctx, log)],
      ['indicadores_mercado', () => refreshMarket(ctx, log)],
      ['manutencao', () => maintenance(ctx, log)],
      ['open_finance', () => syncDueConnections(ctx, log)],
      ['consentimento_open_finance', () => consentCheck(ctx, log)],
    ];
    for (const [name, job] of jobs) {
      try {
        const r = await job();
        if (r === true || (typeof r === 'number' && r > 0)) did = true;
      } catch (error) {
        opts.log?.({ evento: 'trabalho_erro', trabalho: name, erro: error instanceof Error ? error.message.slice(0, 200) : 'erro' });
      }
    }
    if (!did) await new Promise((r) => setTimeout(r, idleMs));
  }
}
