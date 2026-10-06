// Refazer com novos dados: todo produto pago no Pix vale por 30 dias (o prazo vem do produto) e, nesse período, a pessoa pode
// informar dados novos e receber o resultado de novo, quantas vezes precisar, sem pagar outra vez. O prazo NÃO muda ao refazer.
// Mapa, tradutor e guias seguem a regra de sempre: o que a pessoa digita não fica guardado, só o resultado (o Mapa guarda os dados do caso, como já fazia).
import { z } from 'zod';
import { AppError, notFound } from './errors.ts';
import { buildGuided, guidedKindOfCode } from './guided.ts';
import type { GuidedKind } from './guided.ts';
import { analyzeCollectionText, buildPreview, buildTranslatorPreview, diagnose } from './engine.ts';
import type { DebtInput } from './engine.ts';
import { createCaseSchema } from './schemas.ts';
import type { Ctx } from './services.ts';
import { audit, orderOf, todaySaoPaulo } from './services.ts';

/** Teto de proteção (não de negócio): evita um laço automático. Uma pessoa real não chega perto. */
export const MAX_REDO = 200;

export const redoMapSchema = createCaseSchema.omit({ acceptTerms: true });
export const redoTranslatorSchema = z.strictObject({ text: z.string().trim().min(8).max(4000) });
export const redoGuidedSchema = z.strictObject({ input: z.unknown() });

export type RedoKind = 'map' | 'translator' | GuidedKind;

interface Target {
  caseId: string;
  kind: RedoKind;
  productCode: string;
  expiresAt: number;
  redoCount: number;
}

/** Descobre o que está sendo refeito e confere se o acesso ainda vale. */
async function target(ctx: Ctx, sessionId: string, orderId: string): Promise<Target> {
  const o = await ctx.db.query<{ status: string; case_id: string; product_kind: string | null }>(
    `SELECT o.status, o.case_id, c.product_kind FROM app.orders o JOIN app.cases c ON c.id = o.case_id AND c.status <> 'purged' WHERE o.id = $1 AND ${orderOf('o', '$2')}`,
    [orderId, sessionId],
  );
  const order = o.rows[0];
  if (!order) throw notFound();
  if (order.status !== 'paid') throw new AppError(402, 'payment_required', 'Pagamento ainda não confirmado');
  const wanted = order.product_kind === 'translator' ? 'collection_translator' : order.product_kind === 'guided' ? 'guide\\_%' : 'recovery_map';
  const e = await ctx.db.query<{ product_code: string; expires_at: Date | string; redo_count: number }>(
    `SELECT product_code, expires_at, redo_count FROM app.entitlements WHERE case_id = $1 AND product_code LIKE $2 AND expires_at > now() ORDER BY granted_at LIMIT 1`,
    [order.case_id, wanted],
  );
  const ent = e.rows[0];
  if (!ent) throw new AppError(403, 'access_expired', 'O prazo de acesso acabou. Para refazer, é preciso um novo pedido.');
  const kind: RedoKind = order.product_kind === 'translator' ? 'translator' : order.product_kind === 'guided' ? (guidedKindOfCode(ent.product_code) ?? 'financing') : 'map';
  return { caseId: order.case_id, kind, productCode: ent.product_code, expiresAt: new Date(ent.expires_at).getTime(), redoCount: ent.redo_count };
}

async function bump(q: Ctx['db'], t: Target, sessionId: string): Promise<void> {
  if (t.redoCount >= MAX_REDO) throw new AppError(429, 'redo_limit', 'Você já refez muitas vezes neste acesso. Se precisar de ajuda, fale com a gente.');
  await q.query(`UPDATE app.entitlements SET redo_count = redo_count + 1, last_redo_at = now() WHERE case_id = $1 AND product_code = $2`, [t.caseId, t.productCode]);
  await audit(q, `session:${sessionId}`, 'access_redo', 'case', t.caseId, { kind: t.kind, count: t.redoCount + 1 });
}

export interface RedoResult {
  kind: RedoKind;
  accessUntil: number;
  redoCount: number;
  /** Só tradutor e guias: a prévia nova (o conteúdo completo é lido de novo pela rota de sempre). */
  preview?: unknown;
}

export async function redoMap(ctx: Ctx, sessionId: string, orderId: string, raw: unknown): Promise<RedoResult> {
  const t = await target(ctx, sessionId, orderId);
  if (t.kind !== 'map') throw new AppError(409, 'wrong_kind', 'Este pedido não é de um Mapa.');
  const input = redoMapSchema.parse(raw);
  const debts: DebtInput[] = input.debts.map((d, i) => ({ id: `d${i + 1}`, ...d }));
  const { employmentNote, cltContract, ...engineProfile } = input.profile;
  const asOf = todaySaoPaulo();
  const diagnosis = diagnose({ asOf, profile: engineProfile, debts });
  const preview = buildPreview(diagnosis, debts);
  await ctx.db.tx(async (q) => {
    await bump(q as Ctx['db'], t, sessionId);
    await q.query(
      `UPDATE app.cases SET employment_type = $2, net_income_cents = $3, fixed_expenses_cents = $4, age_band = $5, uf = $6, inputs = $7::jsonb,
              debt_total_cents = $8, debt_count = $9, has_overdue = $10, debt_kinds = $11, updated_at = now() WHERE id = $1`,
      [t.caseId, input.profile.employmentType, input.profile.netIncomeCents, input.profile.fixedExpensesCents, input.profile.ageBand, input.profile.uf,
        JSON.stringify({ asOf, debts, ...(employmentNote && input.profile.employmentType === 'other' ? { employmentNote } : {}), ...(cltContract && input.profile.employmentType === 'clt' ? { cltContract } : {}) }),
        debts.reduce((s, x) => s + x.balanceCents, 0), debts.length, debts.some((x) => x.daysOverdue > 0), [...new Set(debts.map((x) => x.kind))]],
    );
    await q.query(`DELETE FROM app.debts WHERE case_id = $1`, [t.caseId]);
    for (const d of debts) {
      await q.query(
        `INSERT INTO app.debts(case_id, creditor_name, kind, balance_cents, monthly_payment_cents, remaining_installments, monthly_rate_bps, days_overdue, first_default_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [t.caseId, d.creditorName, d.kind, d.balanceCents, d.monthlyPaymentCents ?? null, d.remainingInstallments ?? null, d.monthlyRateBps ?? null, d.daysOverdue, d.firstDefaultOn ?? null],
      );
    }
    await q.query(`UPDATE app.diagnoses SET engine_version = $2, preview = $3::jsonb WHERE case_id = $1`, [t.caseId, diagnosis.engineVersion, JSON.stringify(preview)]);
    await q.query(`UPDATE app.deliverables SET content = $2::jsonb, status = 'ready', generated_at = now() WHERE case_id = $1 AND product_code = 'recovery_map'`, [t.caseId, JSON.stringify(diagnosis)]);
    // Roteiros e cartas dependem das dívidas: voltam para a fila e o worker gera de novo com os dados novos.
    await q.query(`UPDATE app.deliverables SET status = 'pending', content = NULL, generation_meta = '{}'::jsonb, updated_at = now() WHERE case_id = $1 AND product_code IN ('negotiation_scripts', 'defense_letters')`, [t.caseId]);
  });
  return { kind: 'map', accessUntil: t.expiresAt, redoCount: t.redoCount + 1 };
}

export async function redoTranslator(ctx: Ctx, sessionId: string, orderId: string, raw: unknown): Promise<RedoResult> {
  const t = await target(ctx, sessionId, orderId);
  if (t.kind !== 'translator') throw new AppError(409, 'wrong_kind', 'Este pedido não é de um tradutor.');
  const { text } = redoTranslatorSchema.parse(raw);
  const analysis = analyzeCollectionText(text);
  const preview = buildTranslatorPreview(analysis);
  await ctx.db.tx(async (q) => {
    await bump(q as Ctx['db'], t, sessionId);
    await q.query(`UPDATE app.diagnoses SET preview = $2::jsonb WHERE case_id = $1`, [t.caseId, JSON.stringify(preview)]);
    await q.query(`UPDATE app.deliverables SET content = $2::jsonb, status = 'ready', generated_at = now() WHERE case_id = $1 AND product_code = 'collection_translator'`, [t.caseId, JSON.stringify(analysis)]);
  });
  return { kind: 'translator', accessUntil: t.expiresAt, redoCount: t.redoCount + 1, preview };
}

export async function redoGuided(ctx: Ctx, sessionId: string, orderId: string, raw: unknown): Promise<RedoResult> {
  const t = await target(ctx, sessionId, orderId);
  if (t.kind === 'map' || t.kind === 'translator') throw new AppError(409, 'wrong_kind', 'Este pedido não é de um guia.');
  const { input } = redoGuidedSchema.parse(raw);
  const { full, preview } = buildGuided(t.kind, input);
  await ctx.db.tx(async (q) => {
    await bump(q as Ctx['db'], t, sessionId);
    await q.query(`UPDATE app.diagnoses SET preview = $2::jsonb WHERE case_id = $1`, [t.caseId, JSON.stringify(preview)]);
    await q.query(`UPDATE app.deliverables SET content = $2::jsonb, status = 'ready', generated_at = now() WHERE case_id = $1 AND product_code = $3`, [t.caseId, JSON.stringify(full), t.productCode]);
  });
  return { kind: t.kind, accessUntil: t.expiresAt, redoCount: t.redoCount + 1, preview };
}
