// Empresa (PJ) no Prumo. Contas, cartões, lançamentos e movimentos com o sócio da empresa, SEMPRE separados dos pessoais:
// tudo aqui lê e grava só nas tabelas biz_* (e nos investimentos com scope 'pj'). Nenhuma consulta pessoal lê estas tabelas.
//   Ousado ("business"): UMA conta e UM cartão da empresa, lançamentos e a visão da empresa na Visão geral.
//   Desbravador ("business_pro"): quantas contas e cartões precisar, investimentos da empresa, relatório da empresa e a leitura
//   dos movimentos entre a empresa e o sócio (pró-labore, lucros, aporte, retirada), com o espelho no lado pessoal.
import { z } from 'zod';
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { requireFeature } from './subscriptions.ts';
import { BIZ_CATEGORIES, BIZ_CATEGORY_LABEL, BIZ_MOVEMENTS, BIZ_MOVEMENT_LABEL, buildPayoffPlan, businessLimits, categorizeBiz, detectBizMovement, looksLikeCompany, movementRule, overdraftAlerts, overdraftStatus, planHas } from './engine.ts';
import type { AccountDebt, BizMovement } from './engine.ts';
import { listInvestments } from './investments.ts';
import { cardImportSchema } from './schemas.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= '2200-12-31'; }, 'Data inválida');
const money = z.number().int().min(1).max(100_000_000_000);
const uuid = z.string().uuid();
const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);

export const bizWalletSchema = z.strictObject({
  name: z.string().trim().min(2).max(40),
  kind: z.enum(['conta', 'caixa', 'poupanca', 'outra']).default('conta'),
  openingBalanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).default(0),
  /** Cheque especial (LIS) da conta da empresa: limite contratado e taxa ao mês em pontos-base (8% = 800). */
  overdraftLimitCents: z.number().int().min(0).max(100_000_000_000).optional(),
  overdraftRateBps: z.number().int().min(0).max(100_000).optional(),
  overdraftFreeDays: z.number().int().min(0).max(365).optional(),
});
export const bizWalletPatchSchema = z.strictObject({
  name: z.string().trim().min(2).max(40).optional(),
  openingBalanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).optional(),
  overdraftLimitCents: z.number().int().min(0).max(100_000_000_000).optional(),
  overdraftRateBps: z.number().int().min(0).max(100_000).optional(),
  overdraftFreeDays: z.number().int().min(0).max(365).optional(),
});
/** Extrato lido no aparelho (CSV, OFX, PDF ou foto): as linhas que a pessoa confirmou. `transfer` = pagamento de fatura (não conta como despesa). */
export const bizImportSchema = z.strictObject({
  walletId: uuid.nullable().optional(),
  entries: z.array(z.strictObject({ date: day, amountCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).refine((v) => v !== 0), note: z.string().trim().max(120), transfer: z.boolean().optional() })).min(1).max(500),
});
export const bizAnchorSchema = z.strictObject({ asOf: day, balanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000) });
export const bizCardImportSchema = cardImportSchema;
export const bizDebtSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  balanceCents: z.number().int().min(1).max(100_000_000_000),
  monthlyRateBps: z.number().int().min(0).max(100_000).optional(),
  minPaymentCents: z.number().int().min(0).max(100_000_000_000).optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
});
export const bizDebtPatchSchema = bizDebtSchema.partial();
export const bizDebtPaySchema = z.strictObject({ amountCents: money, date: day.optional(), walletId: uuid.nullable().optional(), addToLedger: z.boolean().optional() });
export const bizCardSchema = z.strictObject({
  name: z.string().trim().min(2).max(40),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra']).default('outra'),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  limitCents: z.number().int().min(0).max(100_000_000_000).default(0),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
});
/** Lançamento da empresa. `amountCents` com sinal (negativo = saída). Compra no cartão: cardId e sem walletId. Pagar fatura: cardPayment = true com walletId e cardId. */
export const bizEntrySchema = z.strictObject({
  date: day,
  amountCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).refine((v) => v !== 0, 'Informe um valor'),
  note: z.string().trim().max(120).default(''),
  category: z.enum(BIZ_CATEGORIES).optional(),
  walletId: uuid.nullable().optional(),
  cardId: uuid.nullable().optional(),
  cardPayment: z.boolean().optional(),
});
/** Movimento entre a empresa e o sócio. `mirrorPf` = lançar também do lado pessoal (a conta pessoal é opcional). */
export const bizMovementSchema = z.strictObject({
  movement: z.enum(BIZ_MOVEMENTS),
  date: day,
  amountCents: money,
  walletId: uuid,
  pfWalletId: uuid.nullable().optional(),
  mirrorPf: z.boolean().default(true),
  note: z.string().trim().max(120).optional(),
});
/** Liga um lançamento pessoal que já existe a um movimento da empresa (o Prumo sugere; a pessoa confirma). */
export const bizLinkSchema = z.strictObject({ pfEntryId: uuid, movement: z.enum(BIZ_MOVEMENTS), walletId: uuid });
export const bizMonthQuery = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const bizReportQuery = z.strictObject({ from: day, to: day });

const lastDay = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const addMonths = (month: string, n: number): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

/** Plano da pessoa: `multi` = Desbravador (contas e cartões ilimitados, investimentos, relatório e movimentos com o sócio). */
async function access(ctx: Ctx, sub: string): Promise<{ multi: boolean; limits: { wallets: number; cards: number } }> {
  const plan = await requireFeature(ctx, sub, 'business');
  const multi = planHas(plan, 'business_pro');
  return { multi, limits: businessLimits(multi) };
}
const requirePro = async (ctx: Ctx, sub: string) => { await requireFeature(ctx, sub, 'business_pro'); };

// Regras de soma da empresa (iguais em todo lugar, para os números baterem entre a Visão geral, a tela da empresa e o relatório):
//   Entrou = entradas, menos o aporte do sócio (é dinheiro dele voltando, não venda).
//   Saiu   = saídas, menos lucros e retiradas (são distribuição ao sócio, não despesa); o pró-labore conta como despesa.
//   Pagamento de fatura de cartão e aplicação financeira (transfer_kind) nunca entram.
const OPER = `b.transfer_kind IS NULL`;
//   Estorno no cartão (valor positivo com cartão) abate a despesa em vez de contar como venda.
const IN_SQL = `coalesce(sum(b.amount_cents) FILTER (WHERE b.amount_cents > 0 AND b.card_id IS NULL AND coalesce(b.movement, '') <> 'aporte'), 0)::text`;
const OUT_SQL = `coalesce(sum(-b.amount_cents) FILTER (WHERE (b.amount_cents < 0 AND coalesce(b.movement, '') NOT IN ('lucros', 'retirada')) OR (b.amount_cents > 0 AND b.card_id IS NOT NULL)), 0)::text`;

interface Sums { income: string; spend: string; n: string }
const sumsOf = (r?: Sums) => ({ incomeCents: num(r?.income ?? 0), spendCents: num(r?.spend ?? 0), resultCents: num(r?.income ?? 0) - num(r?.spend ?? 0), count: num(r?.n ?? 0) });

async function periodNumbers(ctx: Ctx, sub: string, from: string, to: string) {
  const [tot, cat, ser, par] = await Promise.all([
    ctx.db.query<Sums>(`SELECT ${IN_SQL} AS income, ${OUT_SQL} AS spend, count(*)::text AS n FROM app.biz_entries b WHERE b.subscriber_id = $1 AND ${OPER} AND b.occurred_on BETWEEN $2::date AND $3::date`, [sub, from, to]),
    ctx.db.query<{ category: string; income: string; spend: string }>(`SELECT b.category, ${IN_SQL} AS income, ${OUT_SQL} AS spend FROM app.biz_entries b WHERE b.subscriber_id = $1 AND ${OPER} AND b.occurred_on BETWEEN $2::date AND $3::date GROUP BY b.category ORDER BY sum(-b.amount_cents) FILTER (WHERE b.amount_cents < 0) DESC NULLS LAST`, [sub, from, to]),
    ctx.db.query<{ month: string; income: string; spend: string }>(`SELECT to_char(b.occurred_on, 'YYYY-MM') AS month, ${IN_SQL} AS income, ${OUT_SQL} AS spend FROM app.biz_entries b WHERE b.subscriber_id = $1 AND ${OPER} AND b.occurred_on BETWEEN $2::date AND $3::date GROUP BY 1 ORDER BY 1`, [sub, from, to]),
    ctx.db.query<{ movement: string; cents: string }>(`SELECT b.movement, sum(abs(b.amount_cents))::text AS cents FROM app.biz_entries b WHERE b.subscriber_id = $1 AND b.movement IS NOT NULL AND b.occurred_on BETWEEN $2::date AND $3::date GROUP BY b.movement`, [sub, from, to]),
  ]);
  const pm = (k: string) => num(par.rows.find((r) => r.movement === k)?.cents ?? 0);
  const proLabore = pm('pro_labore'), lucros = pm('lucros'), aporte = pm('aporte'), retirada = pm('retirada');
  return {
    ...sumsOf(tot.rows[0]),
    byCategory: cat.rows.map((r) => ({ category: r.category, label: (BIZ_CATEGORY_LABEL as Record<string, string>)[r.category] ?? r.category, incomeCents: num(r.income), spendCents: num(r.spend) })),
    series: ser.rows.map((r) => ({ month: r.month, incomeCents: num(r.income), spendCents: num(r.spend) })),
    /** Entre a empresa e o sócio: o que a empresa pagou ao sócio (pró-labore, lucros, retiradas) e o que o sócio colocou (aporte). */
    partner: { proLaboreCents: proLabore, lucrosCents: lucros, retiradaCents: retirada, aporteCents: aporte, paidToPartnerCents: proLabore + lucros + retirada, putByPartnerCents: aporte, netToPartnerCents: proLabore + lucros + retirada - aporte },
  };
}

async function walletsAndCards(ctx: Ctx, sub: string) {
  const [w, c] = await Promise.all([
    ctx.db.query<{ id: string; name: string; kind: string; opening: string; balance: string; limit_c: string; rate: number; free_days: number | null }>(
      `SELECT w.id, w.name, w.kind, w.opening_balance_cents::text AS opening, (w.opening_balance_cents + coalesce(sum(b.amount_cents), 0))::text AS balance,
              w.overdraft_limit_cents::text AS limit_c, w.overdraft_rate_bps AS rate, w.overdraft_free_days AS free_days
         FROM app.biz_wallets w LEFT JOIN app.biz_entries b ON b.wallet_id = w.id WHERE w.subscriber_id = $1 GROUP BY w.id ORDER BY w.created_at`, [sub]),
    ctx.db.query<{ id: string; name: string; brand: string; last4: string | null; limit_c: string; closing_day: number; due_day: number; spent: string; paid: string }>(
      `SELECT c.id, c.name, c.brand, c.last4, c.limit_cents::text AS limit_c, c.closing_day, c.due_day,
              coalesce(sum(-b.amount_cents) FILTER (WHERE b.transfer_kind IS NULL), 0)::text AS spent,
              coalesce(sum(-b.amount_cents) FILTER (WHERE b.transfer_kind = 'card_payment'), 0)::text AS paid
         FROM app.biz_cards c LEFT JOIN app.biz_entries b ON b.card_id = c.id WHERE c.subscriber_id = $1 GROUP BY c.id ORDER BY c.created_at`, [sub]),
  ]);
  return {
    wallets: w.rows.map((r) => ({
      id: r.id, name: r.name, kind: r.kind, openingBalanceCents: num(r.opening), balanceCents: num(r.balance),
      overdraftLimitCents: num(r.limit_c), overdraftRateBps: r.rate, overdraftFreeDays: r.free_days,
      // cheque especial (LIS): só em conta bancária, igual ao pessoal
      overdraft: r.kind === 'conta' ? overdraftStatus({ balanceCents: num(r.balance), limitCents: num(r.limit_c), rateBps: r.rate }) : null,
    })),
    cards: c.rows.map((r) => {
      const used = Math.max(0, num(r.spent) - num(r.paid)); // compras ainda não pagas
      return { id: r.id, name: r.name, brand: r.brand, last4: r.last4, limitCents: num(r.limit_c), closingDay: r.closing_day, dueDay: r.due_day, usedCents: used, availableCents: Math.max(0, num(r.limit_c) - used) };
    }),
  };
}

/** Visão da empresa no mês escolhido: contas, cartões, entrou/saiu, por categoria, série de meses e (Desbravador) movimentos com o sócio e investimentos. */
export async function businessOverview(ctx: Ctx, sub: string, month: string) {
  const { multi, limits } = await access(ctx, sub);
  const [wc, cur, past] = await Promise.all([
    walletsAndCards(ctx, sub),
    periodNumbers(ctx, sub, `${month}-01`, lastDay(month)),
    periodNumbers(ctx, sub, `${addMonths(month, -5)}-01`, lastDay(month)),
  ]);
  let investments: { positionCents: number; appliedCents: number; yieldCents: number; yieldPct: number; count: number } | null = null;
  if (multi) {
    const t = (await listInvestments(ctx, sub, 'pj')).totals;
    investments = { positionCents: t.positionCents, appliedCents: t.appliedCents, yieldCents: t.yieldCents, yieldPct: t.yieldPct, count: t.count };
  }
  const entries = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.biz_entries WHERE subscriber_id = $1`, [sub]);
  const dl = await listBizDebts(ctx, sub);
  const hasData = wc.wallets.length + wc.cards.length + num(entries.rows[0]?.n ?? 0) > 0 || (investments?.count ?? 0) > 0 || dl.debts.length > 0;
  return {
    plan: { multi, limits },
    labels: { categories: BIZ_CATEGORY_LABEL, movements: BIZ_MOVEMENT_LABEL },
    ...wc,
    /** Dívidas da empresa (inclui o cheque especial em uso) e alertas do cheque especial. Nada disso mistura com as dívidas pessoais. */
    debts: { owedCents: dl.totals.owedCents, count: dl.totals.count, progressPct: dl.totals.progressPct },
    alerts: overdraftAlerts(wc.wallets.filter((w) => w.kind === 'conta').map((w) => ({ name: w.name, balanceCents: w.balanceCents, limitCents: w.overdraftLimitCents, rateBps: w.overdraftRateBps }))),
    totals: { balanceCents: wc.wallets.reduce((s, w) => s + w.balanceCents, 0), cardUsedCents: wc.cards.reduce((s, c) => s + c.usedCents, 0) },
    month: { month, incomeCents: cur.incomeCents, spendCents: cur.spendCents, resultCents: cur.resultCents, count: cur.count, byCategory: cur.byCategory },
    series: past.series,
    partner: multi ? cur.partner : null,
    investments,
    hasData,
  };
}

// ---------------------------------------------------------------- Contas e cartões da empresa
export async function createBizWallet(ctx: Ctx, sub: string, b: z.infer<typeof bizWalletSchema>): Promise<string> {
  const { limits } = await access(ctx, sub);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.biz_wallets WHERE subscriber_id = $1`, [sub]);
  if (num(n.rows[0]?.n ?? 0) >= limits.wallets) throw new AppError(422, 'too_many', limits.wallets === 1 ? 'No plano Ousado cabe uma conta da empresa. No Desbravador você cadastra quantas precisar.' : `Limite de ${limits.wallets} contas da empresa.`);
  const isAccount = b.kind === 'conta';
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.biz_wallets(subscriber_id, name, kind, opening_balance_cents, overdraft_limit_cents, overdraft_rate_bps, overdraft_free_days) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [sub, b.name, b.kind, b.openingBalanceCents, isAccount ? (b.overdraftLimitCents ?? 0) : 0, isAccount ? (b.overdraftRateBps ?? 800) : 800, isAccount && b.overdraftFreeDays ? b.overdraftFreeDays : null],
  );
  return r.rows[0]!.id;
}

/** Ajusta nome, saldo de partida e cheque especial (LIS). Limite e taxa só valem para conta bancária. */
export async function updateBizWallet(ctx: Ctx, sub: string, id: string, p: z.infer<typeof bizWalletPatchSchema>): Promise<void> {
  await access(ctx, sub);
  const cur = await ctx.db.query<{ kind: string }>(`SELECT kind FROM app.biz_wallets WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (!cur.rows[0]) throw notFound();
  if (cur.rows[0].kind !== 'conta' && (p.overdraftLimitCents !== undefined || p.overdraftRateBps !== undefined || p.overdraftFreeDays !== undefined)) throw new AppError(422, 'not_account', 'Cheque especial só vale para conta bancária.');
  await ctx.db.query(
    `UPDATE app.biz_wallets SET name = coalesce($3, name), opening_balance_cents = coalesce($4, opening_balance_cents), overdraft_limit_cents = coalesce($5, overdraft_limit_cents),
            overdraft_rate_bps = coalesce($6, overdraft_rate_bps), overdraft_free_days = CASE WHEN $7::int IS NULL THEN overdraft_free_days WHEN $7::int = 0 THEN NULL ELSE $7::int END
      WHERE id = $1 AND subscriber_id = $2`,
    [id, sub, p.name ?? null, p.openingBalanceCents ?? null, p.overdraftLimitCents ?? null, p.overdraftRateBps ?? null, p.overdraftFreeDays ?? null],
  );
}

/** Ancora a conta da empresa ao saldo que o extrato do banco informa (mesma regra da conta pessoal): o saldo de partida é recalculado para fechar com o extrato em `asOf`. */
export async function anchorBizWallet(ctx: Ctx, sub: string, id: string, b: z.infer<typeof bizAnchorSchema>): Promise<{ openingBalanceCents: number; balanceCents: number }> {
  await access(ctx, sub);
  return ctx.db.tx(async (q) => {
    const w = await q.query<{ kind: string }>(`SELECT kind FROM app.biz_wallets WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`, [id, sub]);
    if (!w.rows[0]) throw notFound();
    if (w.rows[0].kind !== 'conta') throw new AppError(422, 'invalid_kind', 'Só uma conta bancária pode ser ajustada pelo extrato.');
    await q.query(`UPDATE app.biz_entries SET wallet_id = $2 WHERE subscriber_id = $1 AND wallet_id IS NULL AND card_id IS NULL`, [sub, id]);
    const s = await q.query<{ upto: string; later: string }>(
      `SELECT coalesce(sum(amount_cents) FILTER (WHERE occurred_on <= $2::date), 0)::text AS upto, coalesce(sum(amount_cents) FILTER (WHERE occurred_on > $2::date), 0)::text AS later FROM app.biz_entries WHERE wallet_id = $1`, [id, b.asOf]);
    const opening = b.balanceCents - num(s.rows[0]?.upto ?? 0);
    await q.query(`UPDATE app.biz_wallets SET opening_balance_cents = $3 WHERE id = $1 AND subscriber_id = $2`, [id, sub, opening]);
    return { openingBalanceCents: opening, balanceCents: b.balanceCents + num(s.rows[0]?.later ?? 0) };
  });
}

export async function deleteBizWallet(ctx: Ctx, sub: string, id: string): Promise<void> {
  await access(ctx, sub);
  const r = await ctx.db.query(`DELETE FROM app.biz_wallets WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (r.rowCount === 0) throw notFound();
}

export async function createBizCard(ctx: Ctx, sub: string, b: z.infer<typeof bizCardSchema>): Promise<string> {
  const { limits } = await access(ctx, sub);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.biz_cards WHERE subscriber_id = $1`, [sub]);
  if (num(n.rows[0]?.n ?? 0) >= limits.cards) throw new AppError(422, 'too_many', limits.cards === 1 ? 'No plano Ousado cabe um cartão da empresa. No Desbravador você cadastra quantos tiver.' : `Limite de ${limits.cards} cartões da empresa.`);
  const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.biz_cards(subscriber_id, name, brand, last4, limit_cents, closing_day, due_day) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [sub, b.name, b.brand, b.last4 ?? null, b.limitCents, b.closingDay, b.dueDay]);
  return r.rows[0]!.id;
}

export async function updateBizCard(ctx: Ctx, sub: string, id: string, b: z.infer<typeof bizCardSchema>): Promise<void> {
  await access(ctx, sub);
  const r = await ctx.db.query(`UPDATE app.biz_cards SET name = $3, brand = $4, last4 = $5, limit_cents = $6, closing_day = $7, due_day = $8 WHERE id = $1 AND subscriber_id = $2`, [id, sub, b.name, b.brand, b.last4 ?? null, b.limitCents, b.closingDay, b.dueDay]);
  if (r.rowCount === 0) throw notFound();
}

export async function deleteBizCard(ctx: Ctx, sub: string, id: string): Promise<void> {
  await access(ctx, sub);
  const r = await ctx.db.query(`DELETE FROM app.biz_cards WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (r.rowCount === 0) throw notFound();
}

// ---------------------------------------------------------------- Lançamentos da empresa
export async function listBizEntries(ctx: Ctx, sub: string, month: string) {
  await access(ctx, sub);
  const r = await ctx.db.query<{ id: string; d: Date; amount: string; category: string; note: string; wallet: string | null; card: string | null; movement: string | null; kind: string | null; pf: string | null }>(
    `SELECT b.id, b.occurred_on AS d, b.amount_cents::text AS amount, b.category, b.note, w.name AS wallet, c.name AS card, b.movement, b.transfer_kind AS kind, b.pf_entry_id::text AS pf
       FROM app.biz_entries b LEFT JOIN app.biz_wallets w ON w.id = b.wallet_id LEFT JOIN app.biz_cards c ON c.id = b.card_id
      WHERE b.subscriber_id = $1 AND b.occurred_on BETWEEN $2::date AND $3::date ORDER BY b.occurred_on DESC, b.created_at DESC LIMIT 500`,
    [sub, `${month}-01`, lastDay(month)],
  );
  return {
    entries: r.rows.map((x) => ({ id: x.id, date: iso(x.d), amountCents: num(x.amount), category: x.category, label: (BIZ_CATEGORY_LABEL as Record<string, string>)[x.category] ?? x.category, note: x.note, wallet: x.wallet, card: x.card, movement: x.movement, transferKind: x.kind, linkedToPf: x.pf !== null })),
  };
}

async function ownWallet(ctx: Ctx, sub: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const w = await ctx.db.query(`SELECT 1 FROM app.biz_wallets WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (w.rows.length === 0) throw new AppError(422, 'invalid_wallet', 'Escolha uma conta da empresa sua.');
}
async function ownCard(ctx: Ctx, sub: string, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const c = await ctx.db.query(`SELECT 1 FROM app.biz_cards WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (c.rows.length === 0) throw new AppError(422, 'invalid_card', 'Escolha um cartão da empresa seu.');
}

export async function createBizEntry(ctx: Ctx, sub: string, b: z.infer<typeof bizEntrySchema>, source: 'manual' | 'whatsapp' = 'manual'): Promise<string> {
  await access(ctx, sub);
  await ownWallet(ctx, sub, b.walletId);
  await ownCard(ctx, sub, b.cardId);
  if (b.cardPayment) {
    if (!b.walletId || !b.cardId) throw new AppError(422, 'card_payment', 'Para pagar a fatura, escolha a conta de onde saiu e o cartão.');
    if (b.amountCents > 0) throw new AppError(422, 'card_payment', 'O pagamento da fatura sai da conta: informe como saída.');
  } else if (b.cardId && b.walletId) {
    throw new AppError(422, 'card_or_wallet', 'Compra no cartão não sai da conta na hora: escolha o cartão ou a conta, não os dois.');
  } else if (b.cardId && b.amountCents > 0) {
    throw new AppError(422, 'card_entry', 'No cartão só entram compras (saídas).');
  }
  const movement = detectBizMovement(b.note); // texto de pró-labore, lucros, aporte ou retirada: o Prumo reconhece e usa o movimento
  const category = b.cardPayment ? 'dividas' : (b.category ?? categorizeBiz(b.note, b.amountCents));
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, card_id, movement, transfer_kind, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [sub, b.date, b.amountCents, category, b.note || (b.cardPayment ? 'Pagamento da fatura' : ''), b.walletId ?? null, b.cardId ?? null, b.cardPayment ? null : movement, b.cardPayment ? 'card_payment' : null, source],
  );
  return r.rows[0]!.id;
}

export async function deleteBizEntry(ctx: Ctx, sub: string, id: string): Promise<void> {
  await access(ctx, sub);
  await ctx.db.tx(async (q) => {
    const cur = await q.query<{ pf: string | null; created: boolean }>(`SELECT pf_entry_id::text AS pf, pf_created AS created FROM app.biz_entries WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
    if (!cur.rows[0]) throw notFound();
    await q.query(`DELETE FROM app.biz_entries WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
    // O lançamento pessoal criado junto some junto; o que já existia e só foi ligado continua (volta a ser um lançamento pessoal comum).
    if (cur.rows[0].pf && cur.rows[0].created) await q.query(`DELETE FROM app.ledger_entries WHERE id = $1 AND subscriber_id = $2`, [cur.rows[0].pf, sub]);
  });
}

// ---------------------------------------------------------------- Importar extrato, fatura e foto (os mesmos leitores do pessoal; só a gravação é da empresa)
/**
 * Extrato lido no aparelho (CSV, OFX, PDF) ou cupom lido de foto. Mesma regra do pessoal: lançamento idêntico no mesmo dia só é repetição
 * até a quantidade que já existe (duas cobranças iguais no dia continuam sendo duas). Pró-labore, lucros, aporte e retirada são reconhecidos pelo texto.
 */
export async function importBizEntries(ctx: Ctx, sub: string, b: z.infer<typeof bizImportSchema>, source: 'import' | 'whatsapp' = 'import'): Promise<{ added: number; duplicates: number; transfers: number }> {
  await access(ctx, sub);
  await ownWallet(ctx, sub, b.walletId);
  const cards = (await ctx.db.query<{ id: string }>(`SELECT id FROM app.biz_cards WHERE subscriber_id = $1`, [sub])).rows;
  return ctx.db.tx(async (q) => {
    const seen = new Map<string, number>();
    let added = 0, duplicates = 0, transfers = 0;
    for (const e of b.entries) {
      const note = e.note.trim().slice(0, 120);
      const sig = `${e.date}|${e.amountCents}|${note.toLowerCase()}`;
      const nth = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, nth);
      const have = await q.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app.biz_entries WHERE subscriber_id = $1 AND wallet_id IS NOT DISTINCT FROM $2::uuid AND card_id IS NULL AND occurred_on = $3 AND amount_cents = $4 AND lower(note) = lower($5)`,
        [sub, b.walletId ?? null, e.date, e.amountCents, note]);
      if (num(have.rows[0]?.n ?? 0) >= nth) { duplicates += 1; continue; }
      const pay = Boolean(e.transfer) && e.amountCents < 0;
      let movement: string | null = null;
      if (!pay) {
        const m = detectBizMovement(note);
        if (m && movementRule(m).bizSign === (e.amountCents > 0 ? 1 : -1)) movement = m;
      }
      await q.query(
        `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, card_id, movement, transfer_kind, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [sub, e.date, e.amountCents, pay ? 'dividas' : categorizeBiz(note, e.amountCents), note || (pay ? 'Pagamento da fatura' : ''), b.walletId ?? null, pay && cards.length === 1 ? cards[0]!.id : null, movement, pay ? 'card_payment' : null, source],
      );
      added += 1;
      if (pay) transfers += 1;
    }
    return { added, duplicates, transfers };
  });
}

/**
 * Fatura do cartão da empresa lida do PDF. Compras ficam no cartão (não mexem no saldo da conta), estornos abatem a fatura e o pagamento da fatura
 * anterior, se já está no extrato da conta, vira "pagamento de fatura" (não conta como despesa de novo). Atualiza limite e dias do cartão.
 */
export async function importBizInvoice(ctx: Ctx, sub: string, cardId: string, input: z.infer<typeof bizCardImportSchema>, source: 'import' | 'whatsapp' = 'import') {
  await access(ctx, sub);
  await ownCard(ctx, sub, cardId);
  const payments = input.payments ?? [];
  const key = input.invoice?.key ?? null;
  const updated: string[] = [];
  return ctx.db.tx(async (q) => {
    const c = input.card;
    if (c) {
      if (c.limitCents !== undefined) updated.push('limite');
      if (c.closingDay !== undefined) updated.push('fechamento');
      if (c.dueDay !== undefined) updated.push('vencimento');
      if (c.last4) updated.push('final');
      await q.query(
        `UPDATE app.biz_cards SET name = coalesce($3, name), limit_cents = coalesce($4, limit_cents), closing_day = coalesce($5, closing_day), due_day = coalesce($6, due_day), last4 = coalesce(last4, $7) WHERE id = $1 AND subscriber_id = $2`,
        [cardId, sub, c.name?.trim().slice(0, 40) ?? null, c.limitCents ?? null, c.closingDay ?? null, c.dueDay ?? null, c.last4 ?? null]);
    }
    let added = 0, duplicates = 0, credits = 0, transfers = 0;
    const seen = new Map<string, number>();
    const put = async (date: string, cents: number, rawNote: string, refund: boolean): Promise<boolean> => {
      const note = rawNote.trim().slice(0, 120) || (refund ? 'Estorno no cartão' : 'Compra no cartão');
      const sig = `${date}|${cents}|${note.toLowerCase()}`;
      const nth = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, nth);
      const have = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.biz_entries WHERE subscriber_id = $1 AND card_id = $2 AND occurred_on = $3 AND amount_cents = $4 AND lower(note) = lower($5)`, [sub, cardId, date, cents, note]);
      if (num(have.rows[0]?.n ?? 0) >= nth) {
        if (key) await q.query(`UPDATE app.biz_entries SET invoice_key = $6 WHERE subscriber_id = $1 AND card_id = $2 AND occurred_on = $3 AND amount_cents = $4 AND lower(note) = lower($5) AND invoice_key IS NULL`, [sub, cardId, date, cents, note, key]);
        return false;
      }
      await q.query(`INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, card_id, source, invoice_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [sub, date, cents, categorizeBiz(note, cents), note, cardId, source, key]);
      return true;
    };
    for (const e of input.entries) {
      const parcel = e.installmentNo && e.installmentTotal && e.installmentTotal >= 2 && e.installmentNo <= e.installmentTotal ? ` (${e.installmentNo}/${e.installmentTotal})` : '';
      const base = e.note.trim();
      if (await put(e.date, -e.amountCents, parcel && !base.includes(parcel.trim()) ? `${base.slice(0, 120 - parcel.length)}${parcel}` : base, false)) added += 1; else duplicates += 1;
    }
    for (const r of input.credits) if (await put(r.date, r.amountCents, r.note, true)) credits += 1;
    // pagamento da fatura anterior: se a saída já está no extrato da conta, passa a ser "pagamento de fatura" (não é despesa de novo)
    for (const p of payments) {
      const hit = await q.query<{ id: string }>(
        `SELECT id FROM app.biz_entries WHERE subscriber_id = $1 AND card_id IS NULL AND wallet_id IS NOT NULL AND transfer_kind IS NULL AND amount_cents = $2 AND occurred_on BETWEEN ($3::date - 3) AND ($3::date + 3) ORDER BY abs(occurred_on - $3::date) LIMIT 1`,
        [sub, -p.amountCents, p.date]);
      if (hit.rows[0]) {
        await q.query(`UPDATE app.biz_entries SET transfer_kind = 'card_payment', card_id = $2, category = 'dividas' WHERE id = $1`, [hit.rows[0].id, cardId]);
        transfers += 1;
      }
    }
    return { added, duplicates, credits, adopted: 0, transfers, updated };
  });
}

// ---------------------------------------------------------------- Dívidas da empresa (separadas das pessoais) + cheque especial (LIS) como dívida
const MAX_DEBTS = 30;
interface BizDebtRow { id: string; name: string; initial_cents: string; balance_cents: string; monthly_rate_bps: number; min_payment_cents: string; due_day: number | null; paid_off_at: Date | null }
const toBizDebt = (r: BizDebtRow) => ({ virtual: false, walletId: null as string | null, id: r.id, name: r.name, initialCents: num(r.initial_cents), balanceCents: num(r.balance_cents), monthlyRateBps: r.monthly_rate_bps, minPaymentCents: num(r.min_payment_cents), dueDay: r.due_day, paidOff: Boolean(r.paid_off_at) });

export async function listBizDebts(ctx: Ctx, sub: string, extraCents = 0) {
  await access(ctx, sub);
  const [r, wc] = await Promise.all([
    ctx.db.query<BizDebtRow>(`SELECT id, name, initial_cents, balance_cents, monthly_rate_bps, min_payment_cents, due_day, paid_off_at FROM app.biz_debts WHERE subscriber_id = $1 ORDER BY (paid_off_at IS NOT NULL), balance_cents DESC, created_at`, [sub]),
    walletsAndCards(ctx, sub),
  ]);
  // Conta da empresa no negativo (cheque especial) entra como dívida "virtual": mesma lista, mesmo plano de quitação. Para quitar, entre dinheiro na conta.
  const lis = wc.wallets.filter((w) => w.kind === 'conta' && w.balanceCents < 0)
    .map((w) => ({ virtual: true, walletId: w.id as string | null, id: `lis-${w.id}`, name: `Cheque especial: ${w.name}`, initialCents: -w.balanceCents, balanceCents: -w.balanceCents, monthlyRateBps: w.overdraftRateBps, minPaymentCents: 0, dueDay: null as number | null, paidOff: false }));
  const debts = [...r.rows.map(toBizDebt), ...lis];
  const open = debts.filter((d) => !d.paidOff && d.balanceCents > 0);
  const accountDebts: AccountDebt[] = open.map((d) => ({ id: d.id, name: d.name, balanceCents: d.balanceCents, monthlyRateBps: d.monthlyRateBps, minPaymentCents: d.minPaymentCents }));
  const initial = debts.reduce((s, d) => s + d.initialCents, 0);
  const remaining = debts.reduce((s, d) => s + d.balanceCents, 0);
  return {
    debts,
    totals: { owedCents: open.reduce((s, d) => s + d.balanceCents, 0), initialCents: initial, paidCents: Math.max(0, initial - remaining), progressPct: initial > 0 ? Math.round(((initial - remaining) / initial) * 100) : 0, minPaymentsCents: open.reduce((s, d) => s + d.minPaymentCents, 0), count: open.length },
    plan: open.length > 0 ? buildPayoffPlan(accountDebts, extraCents) : null,
  };
}

export async function createBizDebt(ctx: Ctx, sub: string, b: z.infer<typeof bizDebtSchema>): Promise<string> {
  await access(ctx, sub);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.biz_debts WHERE subscriber_id = $1`, [sub]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_DEBTS) throw new AppError(422, 'too_many', `Limite de ${MAX_DEBTS} dívidas da empresa.`);
  const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.biz_debts(subscriber_id, name, initial_cents, balance_cents, monthly_rate_bps, min_payment_cents, due_day) VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`, [sub, b.name.slice(0, 60), b.balanceCents, b.monthlyRateBps ?? 0, b.minPaymentCents ?? 0, b.dueDay ?? null]);
  return r.rows[0]!.id;
}

export async function updateBizDebt(ctx: Ctx, sub: string, id: string, p: z.infer<typeof bizDebtPatchSchema>): Promise<void> {
  await access(ctx, sub);
  const cur = await ctx.db.query(`SELECT 1 FROM app.biz_debts WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (cur.rows.length === 0) throw notFound();
  await ctx.db.query(
    `UPDATE app.biz_debts SET name = coalesce($3, name), monthly_rate_bps = coalesce($4, monthly_rate_bps), min_payment_cents = coalesce($5, min_payment_cents),
            due_day = CASE WHEN $6::boolean THEN $7::smallint ELSE due_day END,
            balance_cents = coalesce($8::bigint, balance_cents), initial_cents = CASE WHEN $8::bigint IS NULL THEN initial_cents ELSE GREATEST(initial_cents, $8::bigint) END,
            paid_off_at = CASE WHEN $8::bigint IS NULL THEN paid_off_at WHEN $8::bigint = 0 THEN coalesce(paid_off_at, now()) ELSE NULL END
      WHERE id = $1`,
    [id, sub, p.name?.slice(0, 60) ?? null, p.monthlyRateBps ?? null, p.minPaymentCents ?? null, p.dueDay !== undefined, p.dueDay ?? null, p.balanceCents ?? null]);
}

export async function deleteBizDebt(ctx: Ctx, sub: string, id: string): Promise<void> {
  await access(ctx, sub);
  const r = await ctx.db.query(`DELETE FROM app.biz_debts WHERE id = $1 AND subscriber_id = $2`, [id, sub]);
  if (r.rowCount === 0) throw notFound();
}

/** Pagamento: abate o saldo (não passa do que falta), guarda o histórico e, se pedido, lança a saída na conta da empresa (categoria dívidas). */
export async function payBizDebt(ctx: Ctx, sub: string, id: string, p: z.infer<typeof bizDebtPaySchema>): Promise<{ balanceCents: number; paidOff: boolean }> {
  await access(ctx, sub);
  await ownWallet(ctx, sub, p.walletId);
  return ctx.db.tx(async (q) => {
    const cur = await q.query<{ name: string; balance_cents: string }>(`SELECT name, balance_cents FROM app.biz_debts WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`, [id, sub]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    const balance = num(row.balance_cents);
    if (balance <= 0) throw new AppError(409, 'already_paid', 'Esta dívida já está quitada.');
    const paid = Math.min(p.amountCents, balance);
    const date = p.date ?? todaySaoPaulo();
    const left = balance - paid;
    await q.query(`UPDATE app.biz_debts SET balance_cents = $2::bigint, paid_off_at = CASE WHEN $2::bigint = 0 THEN now() ELSE paid_off_at END WHERE id = $1`, [id, left]);
    await q.query(`INSERT INTO app.biz_debt_payments(debt_id, subscriber_id, paid_on, amount_cents) VALUES ($1,$2,$3,$4)`, [id, sub, date, paid]);
    if (p.addToLedger) await q.query(`INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id) VALUES ($1,$2,$3,'dividas',$4,$5)`, [sub, date, -paid, `Pagamento: ${row.name}`.slice(0, 120), p.walletId ?? null]);
    return { balanceCents: left, paidOff: left === 0 };
  });
}

// ---------------------------------------------------------------- Movimentos entre a empresa e o sócio (Desbravador)
export async function createBizMovement(ctx: Ctx, sub: string, b: z.infer<typeof bizMovementSchema>): Promise<{ id: string; pfEntryId: string | null }> {
  await requirePro(ctx, sub);
  await ownWallet(ctx, sub, b.walletId);
  if (b.pfWalletId) {
    const w = await ctx.db.query(`SELECT 1 FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [b.pfWalletId, sub]);
    if (w.rows.length === 0) throw new AppError(422, 'invalid_wallet', 'Escolha uma conta pessoal sua.');
  }
  const rule = movementRule(b.movement);
  return ctx.db.tx(async (q) => {
    let pfId: string | null = null;
    if (b.mirrorPf) {
      const pf = await q.query<{ id: string }>(
        `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, wallet_id, transfer_kind) VALUES ($1,$2,$3,$4,$5,'manual',$6,$7) RETURNING id`,
        [sub, b.date, rule.pfSign * b.amountCents, rule.pfIsIncome ? 'renda' : 'outros', (b.note || rule.pfNote).slice(0, 120), b.pfWalletId ?? null, rule.pfIsIncome ? null : 'business'],
      );
      pfId = pf.rows[0]!.id;
    }
    const e = await q.query<{ id: string }>(
      `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, movement, pf_entry_id, pf_created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [sub, b.date, rule.bizSign * b.amountCents, rule.bizCategory, (b.note || rule.bizNote).slice(0, 120), b.walletId, b.movement, pfId, pfId !== null],
    );
    return { id: e.rows[0]!.id, pfEntryId: pfId };
  });
}

/** Lançamentos pessoais que parecem ser da empresa (pró-labore, lucros, aporte, retirada ou nome de empresa) e ainda não foram ligados. */
export async function businessSuggestions(ctx: Ctx, sub: string) {
  await requirePro(ctx, sub);
  const from = new Date(Date.parse(`${todaySaoPaulo()}T00:00:00Z`) - 120 * 86_400_000).toISOString().slice(0, 10);
  const r = await ctx.db.query<{ id: string; d: Date; amount: string; category: string; note: string }>(
    `SELECT l.id, l.occurred_on AS d, l.amount_cents::text AS amount, l.category, l.note FROM app.ledger_entries l
      WHERE l.subscriber_id = $1 AND l.transfer_kind IS NULL AND l.occurred_on >= $2::date
        AND NOT EXISTS (SELECT 1 FROM app.biz_entries b WHERE b.pf_entry_id = l.id)
      ORDER BY l.occurred_on DESC LIMIT 600`,
    [sub, from],
  );
  const out = r.rows.flatMap((x) => {
    const cents = num(x.amount);
    const guess = detectBizMovement(x.note);
    const company = looksLikeCompany(x.note);
    if (!guess && !company) return [];
    // O que o texto diz tem de combinar com o sinal: pró-labore e lucros entram; aporte sai; retirada entra.
    const ok = guess === null ? cents > 0 : movementRule(guess).pfSign === (cents > 0 ? 1 : -1);
    if (!ok) return [];
    return [{ id: x.id, date: iso(x.d), note: x.note, amountCents: cents, category: x.category, guess, reason: guess ? BIZ_MOVEMENT_LABEL[guess] : 'O nome parece de uma empresa: pode ser pró-labore ou distribuição de lucros.' }];
  });
  return { suggestions: out.slice(0, 20) };
}

export async function linkBizMovement(ctx: Ctx, sub: string, b: z.infer<typeof bizLinkSchema>): Promise<string> {
  await requirePro(ctx, sub);
  await ownWallet(ctx, sub, b.walletId);
  const rule = movementRule(b.movement as BizMovement);
  return ctx.db.tx(async (q) => {
    const pf = await q.query<{ d: Date; amount: string; note: string; transfer_kind: string | null }>(`SELECT occurred_on AS d, amount_cents::text AS amount, note, transfer_kind FROM app.ledger_entries WHERE id = $1 AND subscriber_id = $2`, [b.pfEntryId, sub]);
    const p = pf.rows[0];
    if (!p) throw notFound();
    const cents = num(p.amount);
    if (rule.pfSign !== (cents > 0 ? 1 : -1)) throw new AppError(422, 'wrong_direction', 'O sentido do lançamento pessoal não combina com esse movimento (pró-labore, lucros e retirada entram; aporte sai).');
    const dup = await q.query(`SELECT 1 FROM app.biz_entries WHERE pf_entry_id = $1`, [b.pfEntryId]);
    if (dup.rows.length > 0) throw new AppError(409, 'already_linked', 'Esse lançamento já está ligado a um movimento da empresa.');
    // Aporte e retirada deixam de contar como gasto ou renda pessoal (viram transferência); pró-labore e lucros continuam sendo renda.
    if (!rule.pfIsIncome && p.transfer_kind === null) await q.query(`UPDATE app.ledger_entries SET transfer_kind = 'business' WHERE id = $1 AND subscriber_id = $2`, [b.pfEntryId, sub]);
    const e = await q.query<{ id: string }>(
      `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, movement, pf_entry_id, pf_created) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING id`,
      [sub, iso(p.d), rule.bizSign * Math.abs(cents), rule.bizCategory, rule.bizNote, b.walletId, b.movement, b.pfEntryId],
    );
    return e.rows[0]!.id;
  });
}

// ---------------------------------------------------------------- Relatório da empresa (Desbravador)
export async function businessReport(ctx: Ctx, sub: string, q: z.infer<typeof bizReportQuery>) {
  await requirePro(ctx, sub);
  if (q.to < q.from) throw new AppError(422, 'invalid_range', 'A data final vem antes da inicial.');
  const span = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > 800) throw new AppError(422, 'range_too_long', 'Escolha um período de até 2 anos.');
  const prevTo = new Date(Date.parse(`${q.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(`${prevTo}T00:00:00Z`) - (span - 1) * 86_400_000).toISOString().slice(0, 10);
  const [now, before, origin, top] = await Promise.all([
    periodNumbers(ctx, sub, q.from, q.to),
    periodNumbers(ctx, sub, prevFrom, prevTo),
    ctx.db.query<{ kind: string; name: string | null; income: string; spend: string }>(
      `SELECT CASE WHEN c.id IS NOT NULL THEN 'cartao' WHEN w.id IS NOT NULL THEN 'conta' ELSE 'solto' END AS kind, coalesce(c.name, w.name) AS name, ${IN_SQL} AS income, ${OUT_SQL} AS spend
         FROM app.biz_entries b LEFT JOIN app.biz_wallets w ON w.id = b.wallet_id LEFT JOIN app.biz_cards c ON c.id = b.card_id
        WHERE b.subscriber_id = $1 AND ${OPER} AND b.occurred_on BETWEEN $2::date AND $3::date GROUP BY 1, 2 ORDER BY sum(-b.amount_cents) FILTER (WHERE b.amount_cents < 0) DESC NULLS LAST`, [sub, q.from, q.to]),
    ctx.db.query<{ d: Date; note: string; category: string; cents: string }>(
      `SELECT b.occurred_on AS d, b.note, b.category, (-b.amount_cents)::text AS cents FROM app.biz_entries b
        WHERE b.subscriber_id = $1 AND b.transfer_kind IS NULL AND b.amount_cents < 0 AND coalesce(b.movement, '') NOT IN ('lucros', 'retirada') AND b.occurred_on BETWEEN $2::date AND $3::date ORDER BY b.amount_cents ASC LIMIT 10`, [sub, q.from, q.to]),
  ]);
  return {
    from: q.from, to: q.to,
    totals: { incomeCents: now.incomeCents, spendCents: now.spendCents, resultCents: now.resultCents, count: now.count },
    previous: { from: prevFrom, to: prevTo, totals: { incomeCents: before.incomeCents, spendCents: before.spendCents, resultCents: before.resultCents } },
    byCategory: now.byCategory, series: now.series, partner: now.partner,
    byOrigin: origin.rows.map((r) => ({ kind: r.kind, name: r.name ?? 'Sem conta definida', incomeCents: num(r.income), spendCents: num(r.spend) })),
    top: top.rows.map((r) => ({ date: iso(r.d), note: r.note, category: r.category, label: (BIZ_CATEGORY_LABEL as Record<string, string>)[r.category] ?? r.category, cents: num(r.cents) })),
  };
}

/** Retrato resumido da empresa (últimos 90 dias) para a análise do Estrategista e para a FolIA: sempre separado do pessoal. Só Desbravador. */
export async function businessSnapshot(ctx: Ctx, sub: string): Promise<Record<string, unknown> | null> {
  const plan = await ctx.db.query<{ n: string }>(`SELECT ((SELECT count(*) FROM app.biz_wallets WHERE subscriber_id = $1) + (SELECT count(*) FROM app.biz_cards WHERE subscriber_id = $1) + (SELECT count(*) FROM app.biz_entries WHERE subscriber_id = $1) + (SELECT count(*) FROM app.biz_debts WHERE subscriber_id = $1))::text AS n`, [sub]);
  if (num(plan.rows[0]?.n ?? 0) === 0) return null;
  const to = todaySaoPaulo();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const [wc, p, inv, dl] = await Promise.all([walletsAndCards(ctx, sub), periodNumbers(ctx, sub, from, to), listInvestments(ctx, sub, 'pj').catch(() => null), listBizDebts(ctx, sub).catch(() => null)]);
  return {
    observacao: 'DADOS DA EMPRESA (PJ), separados dos pessoais: nunca some com o patrimônio ou a renda pessoal.',
    contas_da_empresa: wc.wallets.map((w) => ({ nome: w.name, saldo_centavos: w.balanceCents, cheque_especial_em_uso_centavos: w.overdraft?.usedCents ?? 0, cheque_especial_limite_centavos: w.overdraftLimitCents })),
    dividas_da_empresa: dl ? { total_devido_centavos: dl.totals.owedCents, lista: dl.debts.filter((d) => !d.paidOff && d.balanceCents > 0).slice(0, 8).map((d) => ({ nome: d.name, saldo_centavos: d.balanceCents, juros_ao_mes_bps: d.monthlyRateBps })) } : null,
    cartoes_da_empresa: wc.cards.map((c) => ({ nome: c.name, limite_centavos: c.limitCents, usado_centavos: c.usedCents })),
    ultimos_90_dias: { entrou_centavos: p.incomeCents, saiu_centavos: p.spendCents, resultado_centavos: p.resultCents, maiores_categorias_de_saida: p.byCategory.filter((c) => c.spendCents > 0).slice(0, 6).map((c) => ({ categoria: c.label, centavos: c.spendCents })) },
    entre_empresa_e_socio_pf: { pro_labore_centavos: p.partner.proLaboreCents, distribuicao_de_lucros_centavos: p.partner.lucrosCents, retiradas_centavos: p.partner.retiradaCents, aportes_do_socio_centavos: p.partner.aporteCents },
    investimentos_da_empresa: inv ? { posicao_centavos: inv.totals.positionCents, aplicado_centavos: inv.totals.appliedCents, rendimento_centavos: inv.totals.yieldCents } : null,
  };
}
