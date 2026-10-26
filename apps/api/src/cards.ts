// Cartões de crédito do Prumo. Ousado: cadastro, limite, fatura, vencimento, parcelas e pagamento da fatura.
// Desbravador: tudo isso mais importar a fatura em PDF, comparação entre faturas e estratégias.
// A compra no cartão é um lançamento normal (conta como gasto no mês da compra); pagar a fatura NÃO é gasto novo (fica em card_payments).
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import { addMonthsIso, cardPaymentHint, cardStrategies, categorize, dueInstallments, installmentCommitments, invoiceDates, invoiceKeyOf, limitLevel, planByCode, revolvingOptions, summarizeCard } from './engine.ts';
import type { CardCharge, CardPayment, CardStrategy, CardSummary, InstallmentPlan, OfficialInvoice } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { isAllowedCategory } from './categories.ts';
import { ownedWalletId } from './account-extras.ts';
import type { Queryable } from './db.ts';

export const CARD_BRANDS = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra'] as const;
const MAX_CARDS: Record<string, number> = { ousado: 3, desbravador: 10 };
const WINDOW_DAYS = 730;
const MAX_IMPORT = 500;
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export interface CardInput {
  name: string;
  brand?: string | undefined;
  last4?: string | null | undefined;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  revolvingRateBps?: number | undefined;
}

interface CardRow {
  id: string;
  name: string;
  brand: string;
  last4: string | null;
  limit_cents: string;
  closing_day: number;
  due_day: number;
  revolving_rate_bps: number;
  connection_id: string | null;
  available_cents?: string | null;
  bank_synced_at?: Date | string | null;
}

// ---------------------------------------------------------------------------
// Parcelas: lança uma por mês, na data certa (as futuras nunca aparecem antes da hora)
// ---------------------------------------------------------------------------
export async function materializeInstallments(ctx: Ctx, subscriberId: string): Promise<number> {
  const today = todaySaoPaulo();
  const plans = await ctx.db.query<{ id: string; card_id: string; note: string; category: string; per_cents: string; total_n: number; posted_n: number; first_on: Date | string }>(
    `SELECT id, card_id, note, category, per_cents, total_n, posted_n, first_on FROM app.card_installments WHERE subscriber_id = $1 AND posted_n < total_n`,
    [subscriberId],
  );
  let posted = 0;
  for (const p of plans.rows) {
    const plan: InstallmentPlan = { perCents: num(p.per_cents), totalN: p.total_n, postedN: p.posted_n, firstOn: iso(p.first_on) };
    const due = dueInstallments(plan, today);
    if (due.length === 0) continue;
    await ctx.db.tx(async (q) => {
      for (const d of due) {
        await q.query(
          `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, installment_plan)
           VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9)`,
          [subscriberId, d.date, -plan.perCents, p.category, p.note, p.card_id, d.no, p.total_n, p.id],
        );
        posted += 1;
      }
      await q.query(`UPDATE app.card_installments SET posted_n = $2 WHERE id = $1`, [p.id, due[due.length - 1]!.no]);
    });
  }
  return posted;
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------
async function loadAll(ctx: Ctx, subscriberId: string, today: string) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [cards, charges, pays, plans, invoices] = await Promise.all([
    ctx.db.query<CardRow>(`SELECT id, name, brand, last4, limit_cents, closing_day, due_day, revolving_rate_bps, connection_id, available_cents::text AS available_cents, bank_synced_at FROM app.credit_cards WHERE subscriber_id = $1 ORDER BY created_at`, [subscriberId]),
    ctx.db.query<{ id: string; card_id: string; occurred_on: Date | string; cents: string; category: string; note: string; installment_no: number | null; installment_total: number | null; invoice_key: string | null }>(
      `SELECT id, card_id, occurred_on, (-amount_cents)::text AS cents, category, note, installment_no, installment_total, invoice_key FROM app.ledger_entries
        WHERE subscriber_id = $1 AND card_id IS NOT NULL AND amount_cents < 0 AND occurred_on >= $2 ORDER BY occurred_on, created_at`,
      [subscriberId, since],
    ),
    ctx.db.query<{ id: string; card_id: string; paid_on: Date | string; amount_cents: string; wallet_id: string | null; note: string; invoice_key: string | null; kind: string }>(
      `SELECT id, card_id, paid_on, amount_cents, wallet_id, note, invoice_key, kind FROM app.card_payments WHERE subscriber_id = $1 AND paid_on >= $2 ORDER BY paid_on`,
      [subscriberId, since],
    ),
    ctx.db.query<{ id: string; card_id: string; note: string; per_cents: string; total_n: number; posted_n: number; first_on: Date | string }>(
      `SELECT id, card_id, note, per_cents, total_n, posted_n, first_on FROM app.card_installments WHERE subscriber_id = $1 ORDER BY created_at`,
      [subscriberId],
    ),
    ctx.db.query<{ card_id: string; invoice_key: string; closing_on: Date | string; due_on: Date | string | null; total_cents: string; paid_cents: string | null; min_payment_cents: string | null; previous_cents: string | null; period_start: Date | string | null }>(
      `SELECT card_id, invoice_key, closing_on, due_on, total_cents, paid_cents, min_payment_cents, previous_cents, period_start FROM app.card_invoices WHERE subscriber_id = $1`,
      [subscriberId],
    ),
  ]);
  return { cards: cards.rows, charges: charges.rows, pays: pays.rows, plans: plans.rows, invoices: invoices.rows };
}

type Loaded = Awaited<ReturnType<typeof loadAll>>;

function chargesOf(l: Loaded, cardId: string): CardCharge[] {
  return l.charges.filter((c) => c.card_id === cardId).map((c) => ({ date: iso(c.occurred_on), amountCents: num(c.cents), category: c.category, note: c.note, installmentNo: c.installment_no, installmentTotal: c.installment_total, invoiceKey: c.invoice_key }));
}
const paymentsOf = (l: Loaded, cardId: string): CardPayment[] => l.pays.filter((p) => p.card_id === cardId).map((p) => ({ date: iso(p.paid_on), amountCents: num(p.amount_cents), invoiceKey: p.invoice_key }));
const officialOf = (l: Loaded, cardId: string): OfficialInvoice[] => l.invoices.filter((i) => i.card_id === cardId).map((i) => ({ key: i.invoice_key, closingOn: iso(i.closing_on), dueOn: i.due_on ? iso(i.due_on) : null, totalCents: num(i.total_cents), paidCents: i.paid_cents === null ? null : num(i.paid_cents) }));
const plansOf = (l: Loaded, cardId: string): InstallmentPlan[] => l.plans.filter((p) => p.card_id === cardId).map((p) => ({ perCents: num(p.per_cents), totalN: p.total_n, postedN: p.posted_n, firstOn: iso(p.first_on), note: p.note }));

async function averageIncome(ctx: Ctx, subscriberId: string, today: string): Promise<number | null> {
  const r = await ctx.db.query<{ s: string }>(`SELECT coalesce(sum(amount_cents), 0)::text AS s FROM app.ledger_entries WHERE subscriber_id = $1 AND amount_cents > 0 AND card_id IS NULL AND occurred_on > ($2::date - 92) AND occurred_on <= $2::date`, [subscriberId, today]);
  const v = Math.round(num(r.rows[0]?.s ?? 0) / 3);
  return v > 0 ? v : null;
}

export async function listCards(ctx: Ctx, subscriberId: string) {
  const plan = await requireFeature(ctx, subscriberId, 'cards');
  await materializeInstallments(ctx, subscriberId);
  const today = todaySaoPaulo();
  const l = await loadAll(ctx, subscriberId, today);
  const pro = plan === 'desbravador';
  const views = l.cards.map((c) => {
    const terms = { closingDay: c.closing_day, dueDay: c.due_day };
    let summary: CardSummary = summarizeCard({ ...terms, limitCents: num(c.limit_cents) }, chargesOf(l, c.id), paymentsOf(l, c.id), plansOf(l, c.id), today, officialOf(l, c.id));
    // Cartão conectado ao banco: o limite disponível que o banco informa vale mais que a nossa conta (ela só enxerga uma janela de tempo)
    const bank = c.available_cents != null && c.bank_synced_at != null && Date.now() - new Date(c.bank_synced_at).getTime() < 3 * 86_400_000;
    if (bank) {
      const limit = num(c.limit_cents);
      const avail = Math.min(num(c.available_cents), limit);
      const used = Math.max(0, limit - avail);
      summary = { ...summary, usedCents: used, availableCents: avail, usedPct: limit > 0 ? Math.round((used / limit) * 100) : null, level: limitLevel(used, limit) };
    }
    return {
      id: c.id, name: c.name, brand: c.brand, last4: c.last4, limitCents: num(c.limit_cents), closingDay: c.closing_day, dueDay: c.due_day,
      revolvingRateBps: c.revolving_rate_bps, connected: Boolean(c.connection_id), bankReported: bank, summary,
      installments: l.plans.filter((p) => p.card_id === c.id && p.posted_n < p.total_n).map((p) => ({ id: p.id, note: p.note, perCents: num(p.per_cents), totalN: p.total_n, postedN: p.posted_n, remainingCents: num(p.per_cents) * (p.total_n - p.posted_n) })),
      payments: l.pays.filter((p) => p.card_id === c.id).slice(-5).reverse().map((p) => ({ id: p.id, paidOn: iso(p.paid_on), amountCents: num(p.amount_cents), note: p.note, invoiceKey: p.invoice_key, kind: p.kind })),
    };
  });
  const allPlans = l.plans.map((p) => ({ perCents: num(p.per_cents), totalN: p.total_n, postedN: p.posted_n, firstOn: iso(p.first_on) }));
  const commitments = installmentCommitments(allPlans, today, 12);
  let strategies: CardStrategy[] = [];
  if (pro && views.length > 0) {
    const incomeCents = await averageIncome(ctx, subscriberId, today);
    strategies = cardStrategies(views.map((v) => ({ id: v.id, name: v.name, terms: { closingDay: v.closingDay, dueDay: v.dueDay }, rateBps: v.revolvingRateBps, summary: v.summary })), { today, incomeCents, commitments });
  }
  const total = views.reduce((s, v) => ({ limit: s.limit + v.limitCents, used: s.used + v.summary.usedCents }), { limit: 0, used: 0 });
  return {
    pro,
    maxCards: MAX_CARDS[plan] ?? 3,
    today,
    cards: views,
    totals: { limitCents: total.limit, usedCents: total.used, availableCents: Math.max(0, total.limit - total.used), usedPct: total.limit > 0 ? Math.round((total.used / total.limit) * 100) : null },
    commitments: pro ? commitments : commitments.filter((c) => c.cents > 0).slice(0, 3),
    strategies,
    // Alertas simples (os dois planos): fatura vencida ou perto de vencer, limite quase no fim
    alerts: views.flatMap((v) => {
      const out: { level: 'alert' | 'warn'; text: string; cardId: string }[] = [];
      const d = v.summary.due;
      if (d?.status === 'overdue') out.push({ level: 'alert', cardId: v.id, text: `A fatura do ${v.name} venceu em ${d.dueOn.slice(8, 10)}/${d.dueOn.slice(5, 7)}.` });
      else if (d?.status === 'closed' && d.daysToDue <= 5) out.push({ level: 'warn', cardId: v.id, text: `A fatura do ${v.name} vence ${d.daysToDue <= 0 ? 'hoje' : d.daysToDue === 1 ? 'amanhã' : `em ${d.daysToDue} dias`}.` });
      if (v.summary.level === 'high' || v.summary.level === 'over') out.push({ level: 'warn', cardId: v.id, text: `O ${v.name} está com ${v.summary.usedPct}% do limite usado.` });
      return out;
    }),
  };
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------
function validateInput(input: Partial<CardInput>): void {
  if (input.brand !== undefined && !(CARD_BRANDS as readonly string[]).includes(input.brand)) throw new AppError(422, 'invalid_brand', 'Bandeira inválida.');
  if (input.last4 && !/^\d{4}$/.test(input.last4)) throw new AppError(422, 'invalid_last4', 'Informe só os 4 últimos dígitos.');
  for (const k of ['closingDay', 'dueDay'] as const) {
    const v = input[k];
    if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 31)) throw new AppError(422, 'invalid_day', 'Os dias de fechamento e vencimento vão de 1 a 31.');
  }
}

export async function createCard(ctx: Ctx, subscriberId: string, input: CardInput): Promise<string> {
  const plan = await requireFeature(ctx, subscriberId, 'cards');
  validateInput(input);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.credit_cards WHERE subscriber_id = $1`, [subscriberId]);
  const max = MAX_CARDS[plan] ?? 3;
  if (num(n.rows[0]?.n ?? 0) >= max) throw new AppError(422, 'too_many', plan === 'desbravador' ? `Limite de ${max} cartões.` : `Seu plano comporta ${max} cartões. O Desbravador comporta ${MAX_CARDS.desbravador}.`);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.credit_cards(subscriber_id, name, brand, last4, limit_cents, closing_day, due_day, revolving_rate_bps) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [subscriberId, input.name.trim().slice(0, 40), input.brand ?? 'outra', input.last4 ?? null, input.limitCents, input.closingDay, input.dueDay, input.revolvingRateBps ?? 1400],
  );
  await audit(ctx.db, `subscriber:${subscriberId}`, 'card_created', 'subscriber', subscriberId);
  return r.rows[0]!.id;
}

export async function updateCard(ctx: Ctx, subscriberId: string, id: string, patch: Partial<CardInput>): Promise<void> {
  await requireFeature(ctx, subscriberId, 'cards');
  validateInput(patch);
  const r = await ctx.db.query(
    `UPDATE app.credit_cards SET name = coalesce($3, name), brand = coalesce($4, brand), last4 = CASE WHEN $5::boolean THEN $6 ELSE last4 END,
            limit_cents = coalesce($7, limit_cents), closing_day = coalesce($8, closing_day), due_day = coalesce($9, due_day), revolving_rate_bps = coalesce($10, revolving_rate_bps)
      WHERE id = $1 AND subscriber_id = $2`,
    [id, subscriberId, patch.name?.trim().slice(0, 40) ?? null, patch.brand ?? null, patch.last4 !== undefined, patch.last4 ?? null, patch.limitCents ?? null, patch.closingDay ?? null, patch.dueDay ?? null, patch.revolvingRateBps ?? null],
  );
  if (r.rowCount === 0) throw notFound();
}

/** Apagar o cartão não apaga os gastos: eles continuam nos lançamentos, sem cartão. As parcelas futuras e os pagamentos do cartão saem. */
export async function deleteCard(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'cards');
  const r = await ctx.db.query(`DELETE FROM app.credit_cards WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `subscriber:${subscriberId}`, 'card_deleted', 'subscriber', subscriberId);
}

async function ownedCard(q: Queryable, subscriberId: string, id: string): Promise<CardRow> {
  const r = await q.query<CardRow>(`SELECT id, name, brand, last4, limit_cents, closing_day, due_day, revolving_rate_bps, connection_id FROM app.credit_cards WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

// ---------------------------------------------------------------------------
// Compras e parcelas
// ---------------------------------------------------------------------------
export interface PurchaseInput {
  date: string;
  /** Valor total da compra (gasto, positivo). */
  amountCents: number;
  note: string;
  category?: string | undefined;
  installments?: number | undefined;
}

export async function addPurchase(ctx: Ctx, subscriberId: string, cardId: string, p: PurchaseInput): Promise<{ installments: number; perCents: number }> {
  await requireFeature(ctx, subscriberId, 'cards');
  const today = todaySaoPaulo();
  if (p.date > today) throw new AppError(422, 'future_date', 'A data da compra não pode ser no futuro. As parcelas seguintes entram sozinhas, mês a mês.');
  const n = Math.max(1, Math.min(60, Math.round(p.installments ?? 1)));
  const per = Math.round(p.amountCents / n);
  if (per <= 0) throw new AppError(422, 'invalid_amount', 'Valor inválido.');
  await ctx.db.tx(async (q) => {
    await ownedCard(q, subscriberId, cardId);
    const note = p.note.trim().slice(0, 100) || 'Compra no cartão';
    const category = p.category && (await isAllowedCategory(q, subscriberId, p.category)) ? p.category : categorize(note, -per);
    let planId: string | null = null;
    if (n >= 2) {
      const plan = await q.query<{ id: string }>(
        `INSERT INTO app.card_installments(subscriber_id, card_id, note, category, per_cents, total_n, posted_n, first_on) VALUES ($1,$2,$3,$4,$5,$6,1,$7) RETURNING id`,
        [subscriberId, cardId, note, category, per, n, p.date],
      );
      planId = plan.rows[0]!.id;
    }
    await q.query(
      `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, installment_plan)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9)`,
      [subscriberId, p.date, -per, category, note, cardId, n >= 2 ? 1 : null, n >= 2 ? n : null, planId],
    );
  });
  return { installments: n, perCents: per };
}

/** Cancela as parcelas que ainda não chegaram (as já lançadas ficam). */
export async function cancelInstallments(ctx: Ctx, subscriberId: string, cardId: string, planId: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'cards');
  const r = await ctx.db.query(`DELETE FROM app.card_installments WHERE id = $1 AND card_id = $2 AND subscriber_id = $3`, [planId, cardId, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

// ---------------------------------------------------------------------------
// Pagamento da fatura
// ---------------------------------------------------------------------------
export async function addCardPayment(ctx: Ctx, subscriberId: string, cardId: string, p: { paidOn?: string | undefined; amountCents: number; walletId?: string | null | undefined; note?: string | undefined }): Promise<string> {
  await requireFeature(ctx, subscriberId, 'cards');
  const today = todaySaoPaulo();
  const paidOn = p.paidOn ?? today;
  if (paidOn > today) throw new AppError(422, 'future_date', 'A data do pagamento não pode ser no futuro.');
  return ctx.db.tx(async (q) => {
    await ownedCard(q, subscriberId, cardId);
    const walletId = p.walletId ? await ownedWalletId({ ...ctx, db: q as never }, subscriberId, p.walletId) : null;
    if (walletId) {
      const kind = await q.query<{ kind: string }>(`SELECT kind FROM app.wallets WHERE id = $1`, [walletId]);
      if (kind.rows[0]?.kind === 'poupanca') throw new AppError(422, 'invalid_wallet', 'Escolha uma conta ou o dinheiro, não a poupança.');
    }
    const r = await q.query<{ id: string }>(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, wallet_id, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [subscriberId, cardId, paidOn, p.amountCents, walletId, (p.note ?? '').slice(0, 100)]);
    return r.rows[0]!.id;
  });
}

export async function deleteCardPayment(ctx: Ctx, subscriberId: string, cardId: string, paymentId: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'cards');
  const r = await ctx.db.query(`DELETE FROM app.card_payments WHERE id = $1 AND card_id = $2 AND subscriber_id = $3`, [paymentId, cardId, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

// ---------------------------------------------------------------------------
// Fatura em detalhe
// ---------------------------------------------------------------------------
export async function invoiceDetail(ctx: Ctx, subscriberId: string, cardId: string, key: string) {
  const plan = await requireFeature(ctx, subscriberId, 'cards');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new AppError(422, 'invalid_key', 'Fatura inválida.');
  const today = todaySaoPaulo();
  const l = await loadAll(ctx, subscriberId, today);
  const card = l.cards.find((c) => c.id === cardId);
  if (!card) throw notFound();
  const terms = { closingDay: card.closing_day, dueDay: card.due_day };
  const mine = l.charges.filter((c) => c.card_id === cardId);
  const inKey = (k: string) => mine.filter((c) => (c.invoice_key ?? invoiceKeyOf(iso(c.occurred_on), terms)) === k);
  const rows = inKey(key);
  const official = l.invoices.find((i) => i.card_id === cardId && i.invoice_key === key);
  const dates = official ? { closingOn: iso(official.closing_on), dueOn: official.due_on ? iso(official.due_on) : invoiceDates(key, terms).dueOn } : invoiceDates(key, terms);
  const sumCents = rows.reduce((s, c) => s + num(c.cents), 0);
  const out: Record<string, unknown> = {
    key, closingOn: dates.closingOn, dueOn: dates.dueOn,
    // O total é o que o banco informou na fatura em PDF (quando há); a soma das linhas lançadas vem à parte, para a pessoa ver se falta algo.
    totalCents: official ? num(official.total_cents) : sumCents,
    sumCents,
    official: official ? { totalCents: num(official.total_cents), minPaymentCents: official.min_payment_cents === null ? null : num(official.min_payment_cents), previousCents: official.previous_cents === null ? null : num(official.previous_cents), paidCents: official.paid_cents === null ? null : num(official.paid_cents) } : null,
    payments: l.pays.filter((p) => p.card_id === cardId && p.invoice_key === key).map((p) => ({ id: p.id, paidOn: iso(p.paid_on), amountCents: num(p.amount_cents), note: p.note, kind: p.kind })),
    entries: rows.map((c) => ({ id: c.id, date: iso(c.occurred_on), amountCents: num(c.cents), note: c.note, category: c.category, installmentNo: c.installment_no, installmentTotal: c.installment_total })).reverse(),
  };
  if (plan === 'desbravador') {
    const sum = (list: typeof rows) => {
      const m = new Map<string, number>();
      for (const c of list) m.set(c.category, (m.get(c.category) ?? 0) + num(c.cents));
      return m;
    };
    const [y, m] = key.split('-').map(Number) as [number, number];
    const prevKey = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const cur = sum(rows);
    const prev = sum(inKey(prevKey));
    out.previous = { key: prevKey, totalCents: [...prev.values()].reduce((s, v) => s + v, 0) };
    out.byCategory = [...new Set([...cur.keys(), ...prev.keys()])].map((category) => ({ category, cents: cur.get(category) ?? 0, previousCents: prev.get(category) ?? 0 })).sort((a, b) => b.cents - a.cents);
    out.biggest = rows.slice().sort((a, b) => num(b.cents) - num(a.cents)).slice(0, 3).map((c) => ({ note: c.note, amountCents: num(c.cents) }));
  }
  return out;
}

/** Simulação do rotativo para a fatura a pagar (Desbravador). */
export async function rotativoSimulation(ctx: Ctx, subscriberId: string, cardId: string, fixedCents: number) {
  await requireFeature(ctx, subscriberId, 'cards_pro');
  const today = todaySaoPaulo();
  const l = await loadAll(ctx, subscriberId, today);
  const card = l.cards.find((c) => c.id === cardId);
  if (!card) throw notFound();
  const s = summarizeCard({ closingDay: card.closing_day, dueDay: card.due_day, limitCents: num(card.limit_cents) }, chargesOf(l, cardId), paymentsOf(l, cardId), plansOf(l, cardId), today, officialOf(l, cardId));
  const base = s.due?.remainingCents ?? 0;
  return { balanceCents: base, rateBps: card.revolving_rate_bps, options: base > 0 ? revolvingOptions(base, card.revolving_rate_bps, fixedCents) : [] };
}

// ---------------------------------------------------------------------------
// Importar fatura lida do PDF (Desbravador). O arquivo é lido no navegador; aqui chegam só as linhas confirmadas.
// ---------------------------------------------------------------------------
export interface ImportInvoiceInput {
  entries: { date: string; amountCents: number; note: string; installmentNo?: number | null | undefined; installmentTotal?: number | null | undefined; category?: string | undefined }[];
  /** Estornos e créditos da fatura: abatem ESTA fatura. (Versões antigas da tela mandavam os pagamentos aqui também.) */
  credits: { date: string; amountCents: number; note: string }[];
  /** Pagamentos que a fatura mostra no topo: quitam a fatura ANTERIOR, não esta. */
  payments?: { date: string; amountCents: number; note: string }[] | undefined;
  /** O que o banco diz da fatura: com isso cada compra e cada pagamento sabem de qual fatura são. */
  invoice?: {
    key: string; periodStart?: string | null | undefined; closingOn: string; dueOn?: string | null | undefined; totalCents: number;
    minPaymentCents?: number | null | undefined; previousCents?: number | null | undefined; previousKey?: string | null | undefined;
    history?: { key: string; periodStart: string; closingOn: string; totalCents: number; paidCents: number | null }[] | undefined;
  } | undefined;
  /** Dados do cartão a atualizar com o que a fatura informa (só o que vier aqui muda). */
  card?: { name?: string | undefined; limitCents?: number | undefined; closingDay?: number | undefined; dueDay?: number | undefined; last4?: string | null | undefined; availableCents?: number | null | undefined } | undefined;
}

const DAY_MS = 86_400_000;

/**
 * Importa a fatura lida do PDF. O arquivo foi lido no navegador; aqui chegam só as linhas que a pessoa confirmou.
 *  - cada compra fica ligada à fatura certa (`invoice_key`) e compra que já estava solta no extrato é "adotada" em vez de duplicada;
 *  - pagamento da fatura quita a fatura ANTERIOR e, se o extrato do banco já tem essa saída, ela vira "pagamento de fatura" (não conta como gasto);
 *  - o limite e os dias do cartão são atualizados com o que o banco informa.
 */
export async function importInvoice(ctx: Ctx, subscriberId: string, cardId: string, input: ImportInvoiceInput): Promise<{ added: number; duplicates: number; credits: number; adopted: number; transfers: number; updated: string[] }> {
  await requireFeature(ctx, subscriberId, 'cards_pro');
  const payments = input.payments ?? [];
  if (input.entries.length + input.credits.length + payments.length > MAX_IMPORT) throw new AppError(422, 'too_many', `Envie até ${MAX_IMPORT} linhas por vez.`);
  const key = input.invoice?.key ?? null;
  const prevKey = input.invoice?.previousKey ?? null;
  let added = 0;
  let duplicates = 0;
  let credits = 0;
  let adopted = 0;
  let transfers = 0;
  const updated: string[] = [];
  await ctx.db.tx(async (q) => {
    await ownedCard(q, subscriberId, cardId);

    // 1) cadastro do cartão com o que a fatura diz (limite, dias, final, limite disponível informado pelo banco)
    const c = input.card;
    // O limite disponível da fatura é uma foto do dia em que ela fechou: só vale como "agora" se a fatura for recente.
    const closing = input.invoice?.closingOn;
    const fresh = Boolean(closing) && Date.parse(`${todaySaoPaulo()}T00:00:00Z`) - Date.parse(`${closing}T00:00:00Z`) <= 5 * DAY_MS;
    if (c && !fresh) c.availableCents = null;
    if (c) {
      if (c.limitCents !== undefined) updated.push('limite');
      if (c.closingDay !== undefined) updated.push('fechamento');
      if (c.dueDay !== undefined) updated.push('vencimento');
      if (c.last4) updated.push('final');
      await q.query(
        `UPDATE app.credit_cards SET name = coalesce($3, name), limit_cents = coalesce($4, limit_cents), closing_day = coalesce($5, closing_day), due_day = coalesce($6, due_day),
                last4 = coalesce(last4, $7), available_cents = coalesce($8, available_cents), bank_synced_at = CASE WHEN $8::bigint IS NULL THEN bank_synced_at ELSE now() END
          WHERE id = $1 AND subscriber_id = $2`,
        [cardId, subscriberId, c.name?.trim().slice(0, 40) ?? null, c.limitCents ?? null, c.closingDay ?? null, c.dueDay ?? null, c.last4 ?? null, c.availableCents ?? null],
      );
    }

    // 2) a fatura oficial e o histórico que ela traz (mês, total e quanto foi pago)
    const upsertInvoice = (v: { key: string; periodStart?: string | null | undefined; closingOn: string; dueOn?: string | null | undefined; totalCents: number; minPaymentCents?: number | null | undefined; previousCents?: number | null | undefined; paidCents?: number | null | undefined }, source: 'pdf' | 'history') =>
      q.query(
        `INSERT INTO app.card_invoices(subscriber_id, card_id, invoice_key, period_start, closing_on, due_on, total_cents, min_payment_cents, previous_cents, paid_cents, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (card_id, invoice_key) DO UPDATE SET period_start = coalesce(EXCLUDED.period_start, app.card_invoices.period_start), closing_on = EXCLUDED.closing_on,
           due_on = coalesce(EXCLUDED.due_on, app.card_invoices.due_on), total_cents = EXCLUDED.total_cents, min_payment_cents = coalesce(EXCLUDED.min_payment_cents, app.card_invoices.min_payment_cents),
           previous_cents = coalesce(EXCLUDED.previous_cents, app.card_invoices.previous_cents), paid_cents = coalesce(EXCLUDED.paid_cents, app.card_invoices.paid_cents), source = EXCLUDED.source, imported_at = now()
         WHERE app.card_invoices.source = 'history' OR EXCLUDED.source = 'pdf'`,
        [subscriberId, cardId, v.key, v.periodStart ?? null, v.closingOn, v.dueOn ?? null, v.totalCents, v.minPaymentCents ?? null, v.previousCents ?? null, v.paidCents ?? null, source],
      );
    for (const h of input.invoice?.history ?? []) if (h.key !== key) await upsertInvoice({ key: h.key, periodStart: h.periodStart, closingOn: h.closingOn, totalCents: h.totalCents, paidCents: h.paidCents }, 'history');
    if (input.invoice) await upsertInvoice(input.invoice, 'pdf');

    // 3) compras
    const seen = new Map<string, number>();
    for (const e of input.entries) {
      const note = e.note.trim().slice(0, 100) || 'Compra no cartão';
      // parcela "no/total" só vale se fizer sentido (1 a total); do contrário é uma compra comum
      const okParcel = Boolean(e.installmentNo && e.installmentTotal && e.installmentTotal >= 2 && e.installmentNo <= e.installmentTotal);
      const no = okParcel ? (e.installmentNo ?? null) : null;
      const total = okParcel ? (e.installmentTotal ?? null) : null;
      const category = e.category && (await isAllowedCategory(q, subscriberId, e.category)) ? e.category : categorize(note, -e.amountCents);
      let planId: string | null = null;
      if (no && total && total >= 2) {
        // Parcela de uma compra que já temos? Reaproveita o plano para a próxima parcela não entrar em dobro.
        const found = await q.query<{ id: string }>(`SELECT id FROM app.card_installments WHERE card_id = $1 AND subscriber_id = $2 AND lower(note) = lower($3) AND per_cents = $4 AND total_n = $5 LIMIT 1`, [cardId, subscriberId, note, e.amountCents, total]);
        if (found.rows[0]) {
          planId = found.rows[0].id;
          // A fatura é a verdade: parcela de número MAIOR com data ANTERIOR a esta é impossível (o leitor antigo lançava parcelas futuras com data do passado).
          await q.query(`DELETE FROM app.ledger_entries WHERE installment_plan = $1 AND installment_no > $2 AND occurred_on <= $3::date`, [planId, no, e.date]);
          const dupNo =await q.query(`SELECT 1 FROM app.ledger_entries WHERE installment_plan = $1 AND installment_no = $2 LIMIT 1`, [planId, no]);
          if (dupNo.rows.length > 0) {
            // já estava lançada: só garante que sabe de qual fatura é
            if (key) await q.query(`UPDATE app.ledger_entries SET invoice_key = $3 WHERE installment_plan = $1 AND installment_no = $2 AND invoice_key IS NULL`, [planId, no, key]);
            duplicates += 1;
            continue;
          }
          await q.query(`UPDATE app.card_installments SET posted_n = greatest(posted_n, $2) WHERE id = $1`, [planId, no]);
        } else {
          const created = await q.query<{ id: string }>(
            `INSERT INTO app.card_installments(subscriber_id, card_id, note, category, per_cents, total_n, posted_n, first_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [subscriberId, cardId, note, category, e.amountCents, total, no, addMonthsIso(e.date, -(no - 1))],
          );
          planId = created.rows[0]!.id;
        }
      } else {
        // Compras idênticas no mesmo dia são compras diferentes (duas cobranças de 31,10 no mesmo dia): só é repetição o que já estava lançado, até a mesma quantidade.
        const sig = `${e.date}|${e.amountCents}|${note.toLowerCase()}`;
        const nth = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, nth);
        const have = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE subscriber_id = $1 AND card_id = $2 AND occurred_on = $3 AND amount_cents = $4 AND lower(note) = lower($5)`, [subscriberId, cardId, e.date, -e.amountCents, note]);
        if (num(have.rows[0]?.n ?? 0) >= nth) {
          if (key) await q.query(`UPDATE app.ledger_entries SET invoice_key = $6 WHERE subscriber_id = $1 AND card_id = $2 AND occurred_on = $3 AND amount_cents = $4 AND lower(note) = lower($5) AND invoice_key IS NULL`, [subscriberId, cardId, e.date, -e.amountCents, note, key]);
          duplicates += 1;
          continue;
        }
        // Compra que já estava solta no extrato da conta (quando a fatura foi importada como extrato): passa a ser do cartão, sem duplicar.
        const orphan = await q.query<{ id: string }>(
          `SELECT id FROM app.ledger_entries WHERE subscriber_id = $1 AND card_id IS NULL AND transfer_kind IS NULL AND occurred_on = $2 AND amount_cents = $3 AND lower(note) LIKE lower(left($4, 8)) || '%' ORDER BY created_at LIMIT 1`,
          [subscriberId, e.date, -e.amountCents, note],
        );
        if (orphan.rows[0]) {
          await q.query(`UPDATE app.ledger_entries SET card_id = $2, invoice_key = $3, note = $4 WHERE id = $1`, [orphan.rows[0].id, cardId, key, note]);
          adopted += 1;
          continue;
        }
      }
      await q.query(
        `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, installment_plan, invoice_key)
         VALUES ($1,$2,$3,$4,$5,'import',$6,$7,$8,$9,$10)`,
        [subscriberId, e.date, -e.amountCents, category, note, cardId, no, total, planId, key],
      );
      added += 1;
      if (planId) {
        // o plano passa a refletir o que de fato foi lançado: quantas parcelas já saíram e quando começou (as que faltam seguem a partir daí)
        const top = await q.query<{ no: number; d: Date | string }>(`SELECT installment_no AS no, occurred_on AS d FROM app.ledger_entries WHERE installment_plan = $1 ORDER BY installment_no DESC LIMIT 1`, [planId]);
        const t = top.rows[0];
        if (t) await q.query(`UPDATE app.card_installments SET posted_n = $2, first_on = $3 WHERE id = $1`, [planId, t.no, addMonthsIso(new Date(t.d).toISOString().slice(0, 10), -(t.no - 1))]);
      }
    }

    // 4) estornos e créditos desta fatura
    for (const cr of input.credits) {
      const note = cr.note.trim().slice(0, 100);
      const dup = await q.query(`SELECT 1 FROM app.card_payments WHERE subscriber_id = $1 AND card_id = $2 AND paid_on = $3 AND amount_cents = $4 AND note = $5 LIMIT 1`, [subscriberId, cardId, cr.date, cr.amountCents, note]);
      if (dup.rows.length > 0) {
        duplicates += 1;
        continue;
      }
      await q.query(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, note, invoice_key, kind) VALUES ($1,$2,$3,$4,$5,$6,'credit')`, [subscriberId, cardId, cr.date, cr.amountCents, note, key]);
      credits += 1;
    }

    // 5) pagamentos: quitam a fatura anterior; se o extrato do banco já tem essa saída, ela deixa de contar como gasto
    for (const p of payments) {
      const note = p.note.trim().slice(0, 100);
      const near = await q.query<{ id: string }>(
        `SELECT id FROM app.card_payments WHERE subscriber_id = $1 AND card_id = $2 AND kind = 'payment' AND amount_cents = $3 AND paid_on BETWEEN ($4::date - 5) AND ($4::date + 5) ORDER BY abs(paid_on - $4::date), created_at LIMIT 1`,
        [subscriberId, cardId, p.amountCents, p.date],
      );
      let paymentId = near.rows[0]?.id ?? null;
      if (paymentId) {
        await q.query(`UPDATE app.card_payments SET invoice_key = coalesce($2, invoice_key) WHERE id = $1`, [paymentId, prevKey]);
      } else {
        const ins = await q.query<{ id: string }>(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, note, invoice_key, kind) VALUES ($1,$2,$3,$4,$5,$6,'payment') RETURNING id`, [subscriberId, cardId, p.date, p.amountCents, note, prevKey]);
        paymentId = ins.rows[0]!.id;
        credits += 1;
      }
      const bank = await q.query<{ id: string; wallet_id: string | null }>(
        `SELECT id, wallet_id FROM app.ledger_entries WHERE subscriber_id = $1 AND card_id IS NULL AND transfer_kind IS NULL AND amount_cents = $2 AND occurred_on BETWEEN ($3::date - 5) AND ($3::date + 5)
          ORDER BY abs(occurred_on - $3::date), created_at LIMIT 1`,
        [subscriberId, -p.amountCents, p.date],
      );
      if (bank.rows[0]) {
        await bindLedgerToPayment(q, bank.rows[0].id, paymentId);
        transfers += 1;
      }
    }
    await audit(q, `subscriber:${subscriberId}`, 'card_invoice_imported', 'subscriber', subscriberId, { added, credits, adopted, transfers });
  });
  return { added, duplicates, credits, adopted, transfers, updated };
}

/**
 * Extrato do banco: quais saídas são pagamento de fatura de cartão (não é gasto: o gasto já está nas compras do cartão)?
 * Reconhece pelo texto ("pagamento de fatura") e pelo valor: igual a um pagamento já registrado no cartão ou ao total/pago de uma fatura conhecida.
 * Devolve, por linha, o cartão (quando dá para saber) e o pagamento já existente a que ela corresponde.
 */
export async function classifyStatementPayments(q: Queryable, subscriberId: string, entries: { date: string; amountCents: number; note: string }[]): Promise<(StatementPayment | null)[]> {
  const cards = await q.query<{ id: string }>(`SELECT id FROM app.credit_cards WHERE subscriber_id = $1`, [subscriberId]);
  const out: (StatementPayment | null)[] = [];
  const taken = new Set<string>();
  for (const e of entries) {
    if (e.amountCents >= 0) { out.push(null); continue; }
    const amount = -e.amountCents;
    const hint = cardPaymentHint(e.note);
    const pay = await q.query<{ id: string; card_id: string }>(
      `SELECT p.id, p.card_id FROM app.card_payments p WHERE p.subscriber_id = $1 AND p.kind = 'payment' AND p.amount_cents = $2 AND p.paid_on BETWEEN ($3::date - 5) AND ($3::date + 5)
          AND NOT EXISTS (SELECT 1 FROM app.ledger_entries l WHERE l.card_payment_id = p.id) ORDER BY abs(p.paid_on - $3::date) LIMIT 5`,
      [subscriberId, amount, e.date],
    );
    const free = pay.rows.find((r) => !taken.has(r.id));
    if (free) { taken.add(free.id); out.push({ cardId: free.card_id, paymentId: free.id, invoiceKey: null }); continue; }
    const inv = await q.query<{ card_id: string; invoice_key: string }>(
      `SELECT card_id, invoice_key FROM app.card_invoices WHERE subscriber_id = $1 AND (total_cents = $2 OR paid_cents = $2) AND closing_on BETWEEN ($3::date - 50) AND ($3::date + 2) ORDER BY closing_on DESC LIMIT 1`,
      [subscriberId, amount, e.date],
    );
    if (inv.rows[0]) { out.push({ cardId: inv.rows[0].card_id, paymentId: null, invoiceKey: inv.rows[0].invoice_key }); continue; }
    if (hint === 'forte') { out.push({ cardId: cards.rows.length === 1 ? cards.rows[0]!.id : null, paymentId: null, invoiceKey: null }); continue; }
    out.push(null);
  }
  return out;
}

/** Uma saída do extrato que é pagamento de fatura: de qual cartão (se der para saber) e o pagamento já registrado a que corresponde. */
export interface StatementPayment { cardId: string | null; paymentId: string | null; invoiceKey: string | null }

/** Marca uma saída da conta como pagamento de fatura e garante o pagamento correspondente no cartão. */
export async function linkStatementPayment(q: Queryable, subscriberId: string, entry: { id: string; date: string; amountCents: number; walletId: string | null }, match: StatementPayment): Promise<void> {
  let paymentId = match.paymentId;
  if (!paymentId && match.cardId) {
    // sem wallet_id de propósito: a saída do extrato já mexe no saldo da conta; o pagamento do cartão só abate a fatura
    const ins = await q.query<{ id: string }>(
      `INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, note, invoice_key, kind) VALUES ($1,$2,$3,$4,'Pagamento da fatura (extrato)',$5,'payment') RETURNING id`,
      [subscriberId, match.cardId, entry.date, -entry.amountCents, match.invoiceKey],
    );
    paymentId = ins.rows[0]!.id;
  }
  if (paymentId) await bindLedgerToPayment(q, entry.id, paymentId);
  else await q.query(`UPDATE app.ledger_entries SET transfer_kind = 'card_payment' WHERE id = $1 AND subscriber_id = $2`, [entry.id, subscriberId]);
}

/**
 * Liga a saída do extrato ao pagamento do cartão. O saldo da conta passa a vir só do extrato: se o pagamento tinha conta
 * (pagamento manual), a conta passa para o lançamento e sai do pagamento, senão o mesmo dinheiro sairia duas vezes.
 */
async function bindLedgerToPayment(q: Queryable, ledgerId: string, paymentId: string): Promise<void> {
  await q.query(
    `UPDATE app.ledger_entries l SET transfer_kind = 'card_payment', card_payment_id = p.id, wallet_id = coalesce(l.wallet_id, p.wallet_id) FROM app.card_payments p WHERE l.id = $1 AND p.id = $2`,
    [ledgerId, paymentId],
  );
  await q.query(`UPDATE app.card_payments SET wallet_id = NULL WHERE id = $1`, [paymentId]);
}

/** Quanto o plano comporta (para a tela mostrar o que o upgrade traz). */
export const cardLimitsFor = (plan: string) => ({ max: MAX_CARDS[plan] ?? 0, planName: planByCode(plan)?.name ?? plan });
