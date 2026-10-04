// Assinatura: dívidas da conta (saldo, pagamentos, plano de quitação), orçamento por mês e resumo semanal por e-mail.
// Os números vêm do motor (buildPayoffPlan); aqui só persistência, regras de dono e e-mail.
import { AppError, notFound } from './errors.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { buildPayoffPlan, formatBrl, monthOf, CATEGORIES, CATEGORY_LABEL } from './engine.ts';
import type { AccountDebt } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { unsubscribeUrl } from './admin/campaigns.ts';

const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);
const MAX_DEBTS = 30;

interface DebtRow {
  id: string;
  name: string;
  initial_cents: string;
  balance_cents: string;
  monthly_rate_bps: number;
  min_payment_cents: string;
  due_day: number | null;
  paid_off_at: Date | null;
}

const toDebt = (r: DebtRow) => ({
  virtual: false,
  walletId: null as string | null,
  id: r.id,
  name: r.name,
  initialCents: num(r.initial_cents),
  balanceCents: num(r.balance_cents),
  monthlyRateBps: r.monthly_rate_bps,
  minPaymentCents: num(r.min_payment_cents),
  dueDay: r.due_day,
  paidOff: Boolean(r.paid_off_at),
});

export interface DebtInput {
  name: string;
  balanceCents: number;
  monthlyRateBps?: number | undefined;
  minPaymentCents?: number | undefined;
  dueDay?: number | null | undefined;
}

export async function listDebts(ctx: Ctx, subscriberId: string, extraCents = 0) {
  await requireFeature(ctx, subscriberId, 'ledger');
  const r = await ctx.db.query<DebtRow>(`SELECT id, name, initial_cents, balance_cents, monthly_rate_bps, min_payment_cents, due_day, paid_off_at FROM app.account_debts WHERE subscriber_id = $1 ORDER BY (paid_off_at IS NOT NULL), balance_cents DESC, created_at`, [subscriberId]);
  // Cheque especial (LIS) em uso nas contas bancárias entra como dívida "virtual": mesma lista, mesmo plano de quitação.
  // Não se edita nem se paga aqui (o saldo vem da carteira): para quitar, lance uma entrada na conta.
  const lis = await ctx.db.query<{ id: string; name: string; rate: number; balance: string }>(
    `SELECT w.id, w.name, w.overdraft_rate_bps AS rate, (w.opening_balance_cents + coalesce(sum(l.amount_cents), 0))::text AS balance
       FROM app.wallets w LEFT JOIN app.ledger_entries l ON l.wallet_id = w.id WHERE w.subscriber_id = $1 AND w.kind = 'conta' GROUP BY w.id ORDER BY w.created_at`,
    [subscriberId],
  );
  const lisDebts = lis.rows
    .filter((w) => num(w.balance) < 0)
    .map((w) => ({ virtual: true, walletId: w.id, id: `lis-${w.id}`, name: `Cheque especial: ${w.name}`, initialCents: -num(w.balance), balanceCents: -num(w.balance), monthlyRateBps: w.rate, minPaymentCents: 0, dueDay: null as number | null, paidOff: false }));
  const debts = [...r.rows.map(toDebt), ...lisDebts];
  const open = debts.filter((d) => !d.paidOff && d.balanceCents > 0);
  const accountDebts: AccountDebt[] = open.map((d) => ({ id: d.id, name: d.name, balanceCents: d.balanceCents, monthlyRateBps: d.monthlyRateBps, minPaymentCents: d.minPaymentCents }));
  const owed = open.reduce((s, d) => s + d.balanceCents, 0);
  const initial = debts.reduce((s, d) => s + d.initialCents, 0);
  const remainingAll = debts.reduce((s, d) => s + d.balanceCents, 0);
  return {
    debts,
    totals: { owedCents: owed, initialCents: initial, paidCents: Math.max(0, initial - remainingAll), progressPct: initial > 0 ? Math.round(((initial - remainingAll) / initial) * 100) : 0, minPaymentsCents: open.reduce((s, d) => s + d.minPaymentCents, 0) },
    plan: open.length > 0 ? buildPayoffPlan(accountDebts, extraCents) : null,
  };
}

export async function createDebt(ctx: Ctx, subscriberId: string, input: DebtInput): Promise<string> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.account_debts WHERE subscriber_id = $1`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_DEBTS) throw new AppError(422, 'too_many', `Limite de ${MAX_DEBTS} dívidas.`);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.account_debts(subscriber_id, name, initial_cents, balance_cents, monthly_rate_bps, min_payment_cents, due_day) VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
    [subscriberId, input.name.trim().slice(0, 60), input.balanceCents, input.monthlyRateBps ?? 0, input.minPaymentCents ?? 0, input.dueDay ?? null],
  );
  return r.rows[0]!.id;
}

export async function updateDebt(ctx: Ctx, subscriberId: string, id: string, patch: Partial<DebtInput>): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const cur = await ctx.db.query(`SELECT 1 FROM app.account_debts WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (cur.rows.length === 0) throw notFound();
  if (patch.name !== undefined) await ctx.db.query(`UPDATE app.account_debts SET name = $2 WHERE id = $1`, [id, patch.name.trim().slice(0, 60)]);
  if (patch.monthlyRateBps !== undefined) await ctx.db.query(`UPDATE app.account_debts SET monthly_rate_bps = $2 WHERE id = $1`, [id, patch.monthlyRateBps]);
  if (patch.minPaymentCents !== undefined) await ctx.db.query(`UPDATE app.account_debts SET min_payment_cents = $2 WHERE id = $1`, [id, patch.minPaymentCents]);
  if (patch.dueDay !== undefined) await ctx.db.query(`UPDATE app.account_debts SET due_day = $2 WHERE id = $1`, [id, patch.dueDay]);
  if (patch.balanceCents !== undefined) {
    // Correção de saldo (ex.: o banco atualizou com juros). Não vira "pagamento".
    await ctx.db.query(`UPDATE app.account_debts SET balance_cents = $2::bigint, initial_cents = GREATEST(initial_cents, $2::bigint), paid_off_at = CASE WHEN $2::bigint = 0 THEN coalesce(paid_off_at, now()) ELSE NULL END WHERE id = $1`, [id, patch.balanceCents]);
  }
}

export async function deleteDebt(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const r = await ctx.db.query(`DELETE FROM app.account_debts WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

/** Pagamento: abate o saldo (não passa do que falta), guarda o histórico e, se pedido, lança como gasto na categoria "dívidas". */
export async function payDebt(ctx: Ctx, subscriberId: string, id: string, p: { amountCents: number; date?: string | undefined; addToLedger?: boolean | undefined }): Promise<{ balanceCents: number; paidOff: boolean }> {
  await requireFeature(ctx, subscriberId, 'ledger');
  return ctx.db.tx(async (q) => {
    const cur = await q.query<{ name: string; balance_cents: string }>(`SELECT name, balance_cents FROM app.account_debts WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`, [id, subscriberId]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    const balance = num(row.balance_cents);
    if (balance <= 0) throw new AppError(409, 'already_paid', 'Esta dívida já está quitada.');
    const paid = Math.min(p.amountCents, balance);
    const date = p.date ?? todaySaoPaulo();
    const left = balance - paid;
    await q.query(`UPDATE app.account_debts SET balance_cents = $2::bigint, paid_off_at = CASE WHEN $2::bigint = 0 THEN now() ELSE paid_off_at END WHERE id = $1`, [id, left]);
    await q.query(`INSERT INTO app.account_debt_payments(debt_id, subscriber_id, paid_on, amount_cents) VALUES ($1,$2,$3,$4)`, [id, subscriberId, date, paid]);
    if (p.addToLedger) {
      await q.query(`INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source) VALUES ($1,$2,$3,'dividas',$4,'manual')`, [subscriberId, date, -paid, `Pagamento: ${row.name}`.slice(0, 120)]);
    }
    return { balanceCents: left, paidOff: left === 0 };
  });
}

// ---------------------------------------------------------------------------
// Orçamento por mês: o limite do mês vale só naquele mês; sem ele vale o limite padrão (budget_limits).
// ---------------------------------------------------------------------------
export async function monthLimits(ctx: Ctx, subscriberId: string, month: string): Promise<Record<string, number>> {
  const r = await ctx.db.query<{ category: string; limit_cents: string }>(`SELECT category, limit_cents FROM app.budget_months WHERE subscriber_id = $1 AND month = $2`, [subscriberId, month]);
  return Object.fromEntries(r.rows.map((x) => [x.category, num(x.limit_cents)]));
}

export async function setMonthLimit(ctx: Ctx, subscriberId: string, month: string, category: string, limitCents: number | null): Promise<void> {
  await requireFeature(ctx, subscriberId, 'alerts');
  if (!(CATEGORIES as readonly string[]).includes(category) || category === 'renda') throw new AppError(422, 'invalid_category', 'Categoria inválida');
  if (limitCents === null) await ctx.db.query(`DELETE FROM app.budget_months WHERE subscriber_id = $1 AND month = $2 AND category = $3`, [subscriberId, month, category]);
  else await ctx.db.query(`INSERT INTO app.budget_months(subscriber_id, month, category, limit_cents) VALUES ($1,$2,$3,$4) ON CONFLICT (subscriber_id, month, category) DO UPDATE SET limit_cents = EXCLUDED.limit_cents`, [subscriberId, month, category, limitCents]);
}

/** Copia para o mês os limites do mês anterior (os que já existem no mês são mantidos). Devolve quantos foram copiados. */
export async function copyPreviousMonthLimits(ctx: Ctx, subscriberId: string, month: string): Promise<number> {
  await requireFeature(ctx, subscriberId, 'alerts');
  const prev = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const r = await ctx.db.query(
    `INSERT INTO app.budget_months(subscriber_id, month, category, limit_cents)
     SELECT subscriber_id, $2, category, limit_cents FROM app.budget_months WHERE subscriber_id = $1 AND month = $3
     ON CONFLICT (subscriber_id, month, category) DO NOTHING`,
    [subscriberId, month, prev],
  );
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Resumo semanal por e-mail (worker): o que aconteceu nos últimos 7 dias e o que vem aí.
// ---------------------------------------------------------------------------
export async function sendWeeklyDigests(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) return 0;
  const today = todaySaoPaulo();
  const who = await ctx.db.query<{ id: string; email: string }>(
    `SELECT b.id, b.email::text AS email FROM app.subscribers b
       JOIN app.subscriptions s ON s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now()
      WHERE b.deleted_at IS NULL AND b.marketing_opt_out_at IS NULL AND b.notify_digest AND (b.weekly_digest_at IS NULL OR b.weekly_digest_at < now() - interval '7 days')
        AND EXISTS (SELECT 1 FROM app.ledger_entries l WHERE l.subscriber_id = b.id AND l.occurred_on >= ($1::date - 7))
      LIMIT 50`,
    [today],
  );
  let sent = 0;
  for (const b of who.rows) {
    const spent = await ctx.db.query<{ category: string; total: string }>(`SELECT category, (-sum(amount_cents))::text AS total FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on > ($2::date - 7) AND amount_cents < 0 GROUP BY category ORDER BY sum(amount_cents) LIMIT 3`, [b.id, today]);
    const totalSpent = spent.rows.reduce((s, x) => s + num(x.total), 0);
    const due = await ctx.db.query<{ title: string; due_on: Date | string }>(`SELECT title, due_on FROM app.reminders WHERE subscriber_id = $1 AND done_at IS NULL AND due_on BETWEEN $2::date AND ($2::date + 7) ORDER BY due_on LIMIT 5`, [b.id, today]);
    const debts = await listDebts(ctx, b.id).catch(() => null);
    const lines: string[] = [`Nos últimos 7 dias você registrou ${formatBrl(totalSpent)} em gastos.`];
    if (spent.rows.length) lines.push(`Onde mais foi: ${spent.rows.map((x) => `${CATEGORY_LABEL[x.category as keyof typeof CATEGORY_LABEL] ?? x.category} (${formatBrl(num(x.total))})`).join(', ')}.`);
    if (due.rows.length) lines.push(`Vence nesta semana: ${due.rows.map((d) => `${d.title} (${new Date(`${iso(d.due_on)}T12:00:00`).toLocaleDateString('pt-BR')})`).join('; ')}.`);
    if (debts?.plan && debts.plan.focusId) {
      const focus = debts.debts.find((d) => d.id === debts.plan!.focusId);
      if (focus) lines.push(`Foco das dívidas: ${focus.name}, faltam ${formatBrl(focus.balanceCents)}. No ritmo atual, tudo quitado em ${debts.plan[debts.plan.recommended].months} meses.`);
    }
    const body = layout('Seu resumo da semana', lines, { label: 'Abrir minha conta', url: `${ctx.config.publicUrl}/#/conta` }, { unsubscribeUrl: unsubscribeUrl(ctx, b.id) });
    try {
      await ctx.email.send({ to: b.email, subject: 'Seu resumo da semana no Fôlego', ...body, headers: { 'List-Unsubscribe': `<${unsubscribeUrl(ctx, b.id)}>` } });
      await ctx.db.query(`UPDATE app.subscribers SET weekly_digest_at = now() WHERE id = $1`, [b.id]);
      sent += 1;
    } catch {
      opts.log?.({ evento: 'resumo_semanal_falhou' });
    }
  }
  return sent;
}

export { monthOf };
