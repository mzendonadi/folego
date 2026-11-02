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
import { BIZ_CATEGORIES, BIZ_CATEGORY_LABEL, BIZ_MOVEMENTS, BIZ_MOVEMENT_LABEL, businessLimits, categorizeBiz, detectBizMovement, looksLikeCompany, movementRule, planHas } from './engine.ts';
import type { BizMovement } from './engine.ts';
import { listInvestments } from './investments.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => { const t = Date.parse(`${v}T00:00:00Z`); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= '2200-12-31'; }, 'Data inválida');
const money = z.number().int().min(1).max(100_000_000_000);
const uuid = z.string().uuid();
const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);

export const bizWalletSchema = z.strictObject({
  name: z.string().trim().min(2).max(40),
  kind: z.enum(['conta', 'caixa', 'poupanca', 'outra']).default('conta'),
  openingBalanceCents: z.number().int().min(-100_000_000_000).max(100_000_000_000).default(0),
});
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
const IN_SQL = `coalesce(sum(b.amount_cents) FILTER (WHERE b.amount_cents > 0 AND coalesce(b.movement, '') <> 'aporte'), 0)::text`;
const OUT_SQL = `coalesce(sum(-b.amount_cents) FILTER (WHERE b.amount_cents < 0 AND coalesce(b.movement, '') NOT IN ('lucros', 'retirada')), 0)::text`;

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
    ctx.db.query<{ id: string; name: string; kind: string; opening: string; balance: string }>(
      `SELECT w.id, w.name, w.kind, w.opening_balance_cents::text AS opening, (w.opening_balance_cents + coalesce(sum(b.amount_cents), 0))::text AS balance
         FROM app.biz_wallets w LEFT JOIN app.biz_entries b ON b.wallet_id = w.id WHERE w.subscriber_id = $1 GROUP BY w.id ORDER BY w.created_at`, [sub]),
    ctx.db.query<{ id: string; name: string; brand: string; last4: string | null; limit_c: string; closing_day: number; due_day: number; spent: string; paid: string }>(
      `SELECT c.id, c.name, c.brand, c.last4, c.limit_cents::text AS limit_c, c.closing_day, c.due_day,
              coalesce(sum(-b.amount_cents) FILTER (WHERE b.transfer_kind IS NULL), 0)::text AS spent,
              coalesce(sum(-b.amount_cents) FILTER (WHERE b.transfer_kind = 'card_payment'), 0)::text AS paid
         FROM app.biz_cards c LEFT JOIN app.biz_entries b ON b.card_id = c.id WHERE c.subscriber_id = $1 GROUP BY c.id ORDER BY c.created_at`, [sub]),
  ]);
  return {
    wallets: w.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, openingBalanceCents: num(r.opening), balanceCents: num(r.balance) })),
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
  const hasData = wc.wallets.length + wc.cards.length + num(entries.rows[0]?.n ?? 0) > 0 || (investments?.count ?? 0) > 0;
  return {
    plan: { multi, limits },
    labels: { categories: BIZ_CATEGORY_LABEL, movements: BIZ_MOVEMENT_LABEL },
    ...wc,
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
  const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.biz_wallets(subscriber_id, name, kind, opening_balance_cents) VALUES ($1,$2,$3,$4) RETURNING id`, [sub, b.name, b.kind, b.openingBalanceCents]);
  return r.rows[0]!.id;
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

export async function createBizEntry(ctx: Ctx, sub: string, b: z.infer<typeof bizEntrySchema>): Promise<string> {
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
    `INSERT INTO app.biz_entries(subscriber_id, occurred_on, amount_cents, category, note, wallet_id, card_id, movement, transfer_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [sub, b.date, b.amountCents, category, b.note || (b.cardPayment ? 'Pagamento da fatura' : ''), b.walletId ?? null, b.cardId ?? null, b.cardPayment ? null : movement, b.cardPayment ? 'card_payment' : null],
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
  const plan = await ctx.db.query<{ n: string }>(`SELECT ((SELECT count(*) FROM app.biz_wallets WHERE subscriber_id = $1) + (SELECT count(*) FROM app.biz_cards WHERE subscriber_id = $1) + (SELECT count(*) FROM app.biz_entries WHERE subscriber_id = $1))::text AS n`, [sub]);
  if (num(plan.rows[0]?.n ?? 0) === 0) return null;
  const to = todaySaoPaulo();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86_400_000).toISOString().slice(0, 10);
  const [wc, p, inv] = await Promise.all([walletsAndCards(ctx, sub), periodNumbers(ctx, sub, from, to), listInvestments(ctx, sub, 'pj').catch(() => null)]);
  return {
    observacao: 'DADOS DA EMPRESA (PJ), separados dos pessoais: nunca some com o patrimônio ou a renda pessoal.',
    contas_da_empresa: wc.wallets.map((w) => ({ nome: w.name, saldo_centavos: w.balanceCents })),
    cartoes_da_empresa: wc.cards.map((c) => ({ nome: c.name, limite_centavos: c.limitCents, usado_centavos: c.usedCents })),
    ultimos_90_dias: { entrou_centavos: p.incomeCents, saiu_centavos: p.spendCents, resultado_centavos: p.resultCents, maiores_categorias_de_saida: p.byCategory.filter((c) => c.spendCents > 0).slice(0, 6).map((c) => ({ categoria: c.label, centavos: c.spendCents })) },
    entre_empresa_e_socio_pf: { pro_labore_centavos: p.partner.proLaboreCents, distribuicao_de_lucros_centavos: p.partner.lucrosCents, retiradas_centavos: p.partner.retiradaCents, aportes_do_socio_centavos: p.partner.aporteCents },
    investimentos_da_empresa: inv ? { posicao_centavos: inv.totals.positionCents, aplicado_centavos: inv.totals.appliedCents, rendimento_centavos: inv.totals.yieldCents } : null,
  };
}
