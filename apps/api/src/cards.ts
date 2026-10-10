// Cartões de crédito do Prumo. Ousado: cadastro, limite, fatura, vencimento, parcelas e pagamento da fatura.
// Desbravador: tudo isso mais importar a fatura em PDF, comparação entre faturas e estratégias.
// A compra no cartão é um lançamento normal (conta como gasto no mês da compra); pagar a fatura NÃO é gasto novo (fica em card_payments).
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import { addMonthsIso, cardStrategies, categorize, dueInstallments, installmentCommitments, invoiceDates, invoiceKeyOf, limitLevel, planByCode, revolvingOptions, summarizeCard } from './engine.ts';
import type { CardCharge, CardPayment, CardStrategy, CardSummary, InstallmentPlan } from './engine.ts';
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
  const [cards, charges, pays, plans] = await Promise.all([
    ctx.db.query<CardRow>(`SELECT id, name, brand, last4, limit_cents, closing_day, due_day, revolving_rate_bps, connection_id, available_cents::text AS available_cents, bank_synced_at FROM app.credit_cards WHERE subscriber_id = $1 ORDER BY created_at`, [subscriberId]),
    ctx.db.query<{ id: string; card_id: string; occurred_on: Date | string; cents: string; category: string; note: string; installment_no: number | null; installment_total: number | null }>(
      `SELECT id, card_id, occurred_on, (-amount_cents)::text AS cents, category, note, installment_no, installment_total FROM app.ledger_entries
        WHERE subscriber_id = $1 AND card_id IS NOT NULL AND amount_cents < 0 AND occurred_on >= $2 ORDER BY occurred_on, created_at`,
      [subscriberId, since],
    ),
    ctx.db.query<{ id: string; card_id: string; paid_on: Date | string; amount_cents: string; wallet_id: string | null; note: string }>(
      `SELECT id, card_id, paid_on, amount_cents, wallet_id, note FROM app.card_payments WHERE subscriber_id = $1 AND paid_on >= $2 ORDER BY paid_on`,
      [subscriberId, since],
    ),
    ctx.db.query<{ id: string; card_id: string; note: string; per_cents: string; total_n: number; posted_n: number; first_on: Date | string }>(
      `SELECT id, card_id, note, per_cents, total_n, posted_n, first_on FROM app.card_installments WHERE subscriber_id = $1 ORDER BY created_at`,
      [subscriberId],
    ),
  ]);
  return { cards: cards.rows, charges: charges.rows, pays: pays.rows, plans: plans.rows };
}

type Loaded = Awaited<ReturnType<typeof loadAll>>;

function chargesOf(l: Loaded, cardId: string): CardCharge[] {
  return l.charges.filter((c) => c.card_id === cardId).map((c) => ({ date: iso(c.occurred_on), amountCents: num(c.cents), category: c.category, note: c.note, installmentNo: c.installment_no, installmentTotal: c.installment_total }));
}
const paymentsOf = (l: Loaded, cardId: string): CardPayment[] => l.pays.filter((p) => p.card_id === cardId).map((p) => ({ date: iso(p.paid_on), amountCents: num(p.amount_cents) }));
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
    let summary: CardSummary = summarizeCard({ ...terms, limitCents: num(c.limit_cents) }, chargesOf(l, c.id), paymentsOf(l, c.id), plansOf(l, c.id), today);
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
      payments: l.pays.filter((p) => p.card_id === c.id).slice(-5).reverse().map((p) => ({ id: p.id, paidOn: iso(p.paid_on), amountCents: num(p.amount_cents), note: p.note })),
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
  const inKey = (k: string) => mine.filter((c) => invoiceKeyOf(iso(c.occurred_on), terms) === k);
  const rows = inKey(key);
  const dates = invoiceDates(key, terms);
  const out: Record<string, unknown> = {
    key, closingOn: dates.closingOn, dueOn: dates.dueOn,
    totalCents: rows.reduce((s, c) => s + num(c.cents), 0),
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
  const s = summarizeCard({ closingDay: card.closing_day, dueDay: card.due_day, limitCents: num(card.limit_cents) }, chargesOf(l, cardId), paymentsOf(l, cardId), plansOf(l, cardId), today);
  const base = s.due?.remainingCents ?? 0;
  return { balanceCents: base, rateBps: card.revolving_rate_bps, options: base > 0 ? revolvingOptions(base, card.revolving_rate_bps, fixedCents) : [] };
}

// ---------------------------------------------------------------------------
// Importar fatura lida do PDF (Desbravador). O arquivo é lido no navegador; aqui chegam só as linhas confirmadas.
// ---------------------------------------------------------------------------
export interface ImportInvoiceInput {
  entries: { date: string; amountCents: number; note: string; installmentNo?: number | null | undefined; installmentTotal?: number | null | undefined; category?: string | undefined }[];
  credits: { date: string; amountCents: number; note: string }[];
}

export async function importInvoice(ctx: Ctx, subscriberId: string, cardId: string, input: ImportInvoiceInput): Promise<{ added: number; duplicates: number; credits: number }> {
  await requireFeature(ctx, subscriberId, 'cards_pro');
  if (input.entries.length + input.credits.length > MAX_IMPORT) throw new AppError(422, 'too_many', `Envie até ${MAX_IMPORT} linhas por vez.`);
  let added = 0;
  let duplicates = 0;
  let credits = 0;
  await ctx.db.tx(async (q) => {
    await ownedCard(q, subscriberId, cardId);
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
          const dupNo = await q.query(`SELECT 1 FROM app.ledger_entries WHERE installment_plan = $1 AND installment_no = $2 LIMIT 1`, [planId, no]);
          if (dupNo.rows.length > 0) {
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
        const dup = await q.query(`SELECT 1 FROM app.ledger_entries WHERE subscriber_id = $1 AND card_id = $2 AND occurred_on = $3 AND amount_cents = $4 AND note = $5 LIMIT 1`, [subscriberId, cardId, e.date, -e.amountCents, note]);
        if (dup.rows.length > 0) {
          duplicates += 1;
          continue;
        }
      }
      await q.query(
        `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, installment_plan)
         VALUES ($1,$2,$3,$4,$5,'import',$6,$7,$8,$9)`,
        [subscriberId, e.date, -e.amountCents, category, note, cardId, no, total, planId],
      );
      added += 1;
    }
    for (const c of input.credits) {
      const note = c.note.trim().slice(0, 100);
      const dup = await q.query(`SELECT 1 FROM app.card_payments WHERE subscriber_id = $1 AND card_id = $2 AND paid_on = $3 AND amount_cents = $4 AND note = $5 LIMIT 1`, [subscriberId, cardId, c.date, c.amountCents, note]);
      if (dup.rows.length > 0) {
        duplicates += 1;
        continue;
      }
      await q.query(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, note) VALUES ($1,$2,$3,$4,$5)`, [subscriberId, cardId, c.date, c.amountCents, note]);
      credits += 1;
    }
    await audit(q, `subscriber:${subscriberId}`, 'card_invoice_imported', 'subscriber', subscriberId, { added, credits });
  });
  return { added, duplicates, credits };
}

/** Quanto o plano comporta (para a tela mostrar o que o upgrade traz). */
export const cardLimitsFor = (plan: string) => ({ max: MAX_CARDS[plan] ?? 0, planName: planByCode(plan)?.name ?? plan });
