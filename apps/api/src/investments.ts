// Aba Investimentos (Desbravador): a pessoa lança o que aplicou; o Prumo mostra total investido, rendimento e imposto estimado.
// Os números vêm do motor (viewInvestment/summarizeInvestments); aqui só persistência e regra de dono.
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { summarizeInvestments, viewInvestment } from './engine.ts';
import type { InvestIndexer, InvestStatus, InvestmentInput } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { loadIndicators } from './market.ts';

const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);
const MAX_INVESTMENTS = 60;

interface Row {
  id: string; name: string; kind: string; indexer: InvestIndexer; rate_bp: number; applied_cents: string; position_cents: string | null;
  applied_on: Date | string; matures_on: Date | string | null; liquidity: 'diaria' | 'vencimento'; status: InvestStatus; note: string | null;
  position_on: Date | string | null;
  scope?: 'pf' | 'pj';
}

export type InvestScope = 'pf' | 'pj';

export interface InvestmentBody {
  name: string; kind: string; indexer: InvestIndexer; ratePct: number; appliedCents: number; positionCents?: number | null | undefined;
  appliedOn: string; maturesOn?: string | null | undefined; liquidity: 'diaria' | 'vencimento'; status: InvestStatus; note?: string | null | undefined;
  /** 'pf' (pessoal, padrão) ou 'pj' (da empresa): nunca se misturam. */
  scope?: 'pf' | 'pj' | undefined;
}

export const inputOf = (r: Row): InvestmentInput => ({
  appliedCents: num(r.applied_cents), indexer: r.indexer, ratePct: r.rate_bp / 100, appliedOn: iso(r.applied_on), status: r.status,
  positionCents: r.position_cents === null ? null : num(r.position_cents),
  positionOn: r.position_on ? iso(r.position_on) : null,
});

/** Aplicações da pessoa (scope 'pf', o padrão) ou da empresa (scope 'pj'): uma consulta nunca traz as duas. */
export async function loadInvestmentRows(ctx: Ctx, subscriberId: string, scope: InvestScope = 'pf'): Promise<Row[]> {
  const r = await ctx.db.query<Row>(
    `SELECT id, name, kind, indexer, rate_bp, applied_cents::text AS applied_cents, position_cents::text AS position_cents, position_on, applied_on, matures_on, liquidity, status, note
       FROM app.investments WHERE subscriber_id = $1 AND scope = $2 ORDER BY (status = 'resgatado'), applied_on ASC, created_at ASC`, // da aplicação mais antiga (em cima) para a mais recente (embaixo)
    [subscriberId, scope],
  );
  return r.rows;
}

export async function listInvestments(ctx: Ctx, subscriberId: string, scope: InvestScope = 'pf') {
  await requireFeature(ctx, subscriberId, scope === 'pj' ? 'business_pro' : 'investments');
  const today = todaySaoPaulo();
  const rows = await loadInvestmentRows(ctx, subscriberId, scope);
  const rates = await loadIndicators(ctx).then((m) => ({ cdiAnnualPct: m.indicators.cdiPct, ipcaAnnualPct: m.indicators.ipca12Pct })).catch(() => ({ cdiAnnualPct: null, ipcaAnnualPct: null }));
  const items = rows.map((r) => {
    const input = inputOf(r);
    return {
      id: r.id, name: r.name, kind: r.kind, indexer: r.indexer, ratePct: r.rate_bp / 100, appliedCents: input.appliedCents, positionInformedCents: input.positionCents ?? null, positionOn: input.positionOn ?? null,
      appliedOn: input.appliedOn, maturesOn: r.matures_on ? iso(r.matures_on) : null, liquidity: r.liquidity, status: r.status, note: r.note,
      view: r.status === 'resgatado' ? null : viewInvestment(input, today, rates),
    };
  });
  return { investments: items, totals: summarizeInvestments(rows.map((r) => ({ input: inputOf(r) })), today, rates), cdiAnnualPct: rates.cdiAnnualPct };
}

const params = (subscriberId: string, b: InvestmentBody) => [
  subscriberId, b.name.trim().slice(0, 80), b.kind, b.indexer, Math.round(b.ratePct * 100), b.appliedCents, b.positionCents ?? null, b.appliedOn, b.maturesOn ?? null, b.liquidity, b.status, b.note?.trim() || null,
];

export async function createInvestment(ctx: Ctx, subscriberId: string, b: InvestmentBody): Promise<string> {
  const scope: InvestScope = b.scope ?? 'pf';
  await requireFeature(ctx, subscriberId, scope === 'pj' ? 'business_pro' : 'investments');
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.investments WHERE subscriber_id = $1`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_INVESTMENTS) throw new AppError(422, 'too_many', `Limite de ${MAX_INVESTMENTS} aplicações. Apague as resgatadas que não precisa mais.`);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.investments(subscriber_id, name, kind, indexer, rate_bp, applied_cents, position_cents, applied_on, matures_on, liquidity, status, note, position_on, scope) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [...params(subscriberId, b), b.positionCents == null ? null : todaySaoPaulo(), scope], // posição informada vale a partir de hoje
  );
  return r.rows[0]!.id;
}

export async function updateInvestment(ctx: Ctx, subscriberId: string, id: string, b: InvestmentBody): Promise<void> {
  await requireFeature(ctx, subscriberId, 'investments');
  const cur = await ctx.db.query<Row>(
    `SELECT id, name, kind, indexer, rate_bp, applied_cents::text AS applied_cents, position_cents::text AS position_cents, position_on, applied_on, matures_on, liquidity, status, note FROM app.investments WHERE id = $1 AND subscriber_id = $2`,
    [id, subscriberId],
  );
  const old = cur.rows[0];
  if (!old) throw notFound();
  const was = inputOf(old);
  const termsChanged = was.appliedCents !== b.appliedCents || was.appliedOn !== b.appliedOn || was.indexer !== b.indexer || Math.round(was.ratePct * 100) !== Math.round(b.ratePct * 100);
  // A posição informada é um marco com data. Valor novo = marco de hoje. Se a pessoa mudou valor, data ou taxa e deixou a posição
  // de antes, ela deixa de valer (era o retrato das condições antigas) e o Prumo recalcula pelas condições novas.
  let positionCents: number | null = b.positionCents ?? null;
  let positionOn: string | null = null;
  if (positionCents !== null) {
    if (positionCents !== was.positionCents) positionOn = todaySaoPaulo();
    else if (termsChanged) positionCents = null;
    else positionOn = was.positionOn ?? todaySaoPaulo();
  }
  const r = await ctx.db.query(
    `UPDATE app.investments SET name = $2, kind = $3, indexer = $4, rate_bp = $5, applied_cents = $6, position_cents = $7, applied_on = $8, matures_on = $9, liquidity = $10, status = $11, note = $12, position_on = $13, updated_at = now()
      WHERE id = $14 AND subscriber_id = $1`,
    [...params(subscriberId, { ...b, positionCents }), positionOn, id],
  );
  if (r.rowCount === 0) throw notFound();
}

/**
 * Resgate: o valor entra a crédito na conta escolhida (como transferência: não é receita) e a aplicação baixa.
 * Resgate de quase tudo (a partir de 99,5% da posição) encerra a aplicação; menos que isso é parcial e a aplicação continua, proporcionalmente menor.
 */
export async function redeemInvestment(ctx: Ctx, subscriberId: string, id: string, p: { amountCents: number; date: string; walletId: string }): Promise<{ closed: boolean; remainingCents: number }> {
  await requireFeature(ctx, subscriberId, 'investments');
  const today = todaySaoPaulo();
  if (p.date > today) throw new AppError(422, 'future_date', 'O resgate não pode ter data futura.');
  const rates = await loadIndicators(ctx).then((m) => ({ cdiAnnualPct: m.indicators.cdiPct, ipcaAnnualPct: m.indicators.ipca12Pct })).catch(() => ({ cdiAnnualPct: null, ipcaAnnualPct: null }));
  return ctx.db.tx(async (q) => {
    const cur = await q.query<Row>(
      `SELECT id, name, kind, indexer, rate_bp, applied_cents::text AS applied_cents, position_cents::text AS position_cents, position_on, applied_on, matures_on, liquidity, status, note, scope FROM app.investments WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`,
      [id, subscriberId],
    );
    const r = cur.rows[0];
    if (!r) throw notFound();
    if (r.status !== 'ativo') throw new AppError(422, 'not_active', 'Só dá para resgatar uma aplicação ativa.');
    const pj = r.scope === 'pj'; // aplicação da empresa: o dinheiro volta para uma conta da EMPRESA, nunca para uma pessoal
    const wallet = await q.query(pj ? `SELECT 1 FROM app.biz_wallets WHERE id = $1 AND subscriber_id = $2` : `SELECT 1 FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [p.walletId, subscriberId]);
    if (wallet.rows.length === 0) throw new AppError(422, 'invalid_wallet', 'Escolha a conta em que o dinheiro entrou.');
    const input = inputOf(r);
    const position = viewInvestment(input, today, rates).positionCents;
    if (p.amountCents > Math.round(position * 1.2) + 100) throw new AppError(422, 'too_much', 'O valor passa do que a aplicação tem. Confira o valor ou atualize a posição ao editar.');
    const full = p.amountCents >= Math.round(position * 0.995);
    const ratio = full ? 1 : p.amountCents / position;
    if (full) {
      await q.query(`UPDATE app.investments SET status = 'resgatado', updated_at = now() WHERE id = $1`, [id]);
    } else {
      const applied = Math.max(1, Math.round(input.appliedCents * (1 - ratio)));
      const informed = input.positionCents == null ? null : Math.max(0, Math.round(input.positionCents * (1 - ratio)));
      await q.query(`UPDATE app.investments SET applied_cents = $2, position_cents = $3, updated_at = now() WHERE id = $1`, [id, applied, informed]);
    }
    if (pj) {
      await q.query(
        `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, transfer_kind) VALUES ($1,$2,$3,'outros',$4,$5,'investment')`,
        [subscriberId, p.date, p.amountCents, `Resgate ${r.name}`.slice(0, 100), p.walletId],
      );
    } else {
      await q.query(
        `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, wallet_id, transfer_kind) VALUES ($1,$2,$3,'outros',$4,'manual',$5,'investment_redeem')`,
        [subscriberId, p.date, p.amountCents, `Resgate ${r.name}`.slice(0, 100), p.walletId],
      );
    }
    return { closed: full, remainingCents: full ? 0 : Math.max(0, position - p.amountCents) };
  });
}

/** Aplicação que estava processando e foi creditada: passa a valer como ativa a partir do dia informado. */
export async function processInvestment(ctx: Ctx, subscriberId: string, id: string, date: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'investments');
  if (date > todaySaoPaulo()) throw new AppError(422, 'future_date', 'O dia do processamento não pode ser futuro.');
  const r = await ctx.db.query(`UPDATE app.investments SET status = 'ativo', applied_on = $3, updated_at = now() WHERE id = $1 AND subscriber_id = $2 AND status = 'processando'`, [id, subscriberId, date]);
  if (r.rowCount === 0) throw new AppError(422, 'not_processing', 'Esta aplicação não está processando.');
}

export async function deleteInvestment(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'investments');
  const r = await ctx.db.query(`DELETE FROM app.investments WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}
