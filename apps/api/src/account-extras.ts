// Assinatura: carteiras e lembretes. Mesmo princípio do resto da conta: tudo é do assinante (isolado por subscriber_id)
// e cada recurso respeita o plano (requireFeature).
import { AppError, notFound } from './errors.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { addMonthsIso, formatBrl, overdraftStatus, overdraftAlerts } from './engine.ts';
import type { AlertItem } from './engine.ts';
import { requireFeature } from './subscriptions.ts';

const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Carteiras
// ---------------------------------------------------------------------------
export const WALLET_KINDS = ['dinheiro', 'conta', 'cartao', 'poupanca', 'outra'] as const;
const MAX_WALLETS = 10;

export async function listWallets(ctx: Ctx, subscriberId: string) {
  await requireFeature(ctx, subscriberId, 'ledger');
  const r = await ctx.db.query<{ id: string; name: string; kind: string; opening: string; limit_c: string; rate: number; balance: string; entries: string }>(
    `SELECT w.id, w.name, w.kind, w.opening_balance_cents::text AS opening, w.overdraft_limit_cents::text AS limit_c, w.overdraft_rate_bps AS rate,
            (w.opening_balance_cents + coalesce(sum(l.amount_cents), 0) - coalesce((SELECT sum(cp.amount_cents) FROM app.card_payments cp WHERE cp.wallet_id = w.id), 0))::text AS balance, count(l.id)::text AS entries
       FROM app.wallets w LEFT JOIN app.ledger_entries l ON l.wallet_id = w.id WHERE w.subscriber_id = $1 GROUP BY w.id ORDER BY w.created_at`,
    [subscriberId],
  );
  const loose = await ctx.db.query<{ balance: string; entries: string }>(`SELECT coalesce(sum(amount_cents), 0)::text AS balance, count(*)::text AS entries FROM app.ledger_entries WHERE subscriber_id = $1 AND wallet_id IS NULL`, [subscriberId]);
  return {
    wallets: r.rows.map((w) => ({
      id: w.id, name: w.name, kind: w.kind, balanceCents: num(w.balance), entries: num(w.entries),
      openingBalanceCents: num(w.opening), overdraftLimitCents: num(w.limit_c), overdraftRateBps: w.rate,
      // cheque especial (LIS): só em conta bancária
      overdraft: w.kind === 'conta' ? overdraftStatus({ balanceCents: num(w.balance), limitCents: num(w.limit_c), rateBps: w.rate }) : null,
    })),
    unassigned: { balanceCents: num(loose.rows[0]?.balance ?? 0), entries: num(loose.rows[0]?.entries ?? 0) },
  };
}

export interface WalletInput {
  name: string;
  kind: string;
  openingBalanceCents?: number | undefined;
  overdraftLimitCents?: number | undefined;
  overdraftRateBps?: number | undefined;
}

/** Alertas de cheque especial (LIS) de todas as contas bancárias do assinante, para a visão do mês. */
export async function walletOverdraftAlerts(ctx: Ctx, subscriberId: string): Promise<AlertItem[]> {
  const r = await ctx.db.query<{ name: string; limit_c: string; rate: number; balance: string }>(
    `SELECT w.name, w.overdraft_limit_cents::text AS limit_c, w.overdraft_rate_bps AS rate,
            (w.opening_balance_cents + coalesce(sum(l.amount_cents), 0) - coalesce((SELECT sum(cp.amount_cents) FROM app.card_payments cp WHERE cp.wallet_id = w.id), 0))::text AS balance
       FROM app.wallets w LEFT JOIN app.ledger_entries l ON l.wallet_id = w.id WHERE w.subscriber_id = $1 AND w.kind = 'conta' GROUP BY w.id`,
    [subscriberId],
  );
  return overdraftAlerts(r.rows.map((w) => ({ name: w.name, balanceCents: num(w.balance), limitCents: num(w.limit_c), rateBps: w.rate })));
}

export async function createWallet(ctx: Ctx, subscriberId: string, input: WalletInput): Promise<string> {
  await requireFeature(ctx, subscriberId, 'ledger');
  if (!(WALLET_KINDS as readonly string[]).includes(input.kind)) throw new AppError(422, 'invalid_kind', 'Tipo de carteira inválido.');
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wallets WHERE subscriber_id = $1`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_WALLETS) throw new AppError(422, 'too_many', `Limite de ${MAX_WALLETS} carteiras.`);
  const isAccount = input.kind === 'conta';
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.wallets(subscriber_id, name, kind, opening_balance_cents, overdraft_limit_cents, overdraft_rate_bps) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [subscriberId, input.name.trim().slice(0, 40), input.kind, input.openingBalanceCents ?? 0, isAccount ? (input.overdraftLimitCents ?? 0) : 0, isAccount ? (input.overdraftRateBps ?? 800) : 800],
  );
  return r.rows[0]!.id;
}

/** Ajusta nome, saldo de partida e cheque especial (LIS). O limite e a taxa só valem para conta bancária. */
export async function updateWallet(ctx: Ctx, subscriberId: string, id: string, patch: Partial<Omit<WalletInput, 'kind'>>): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const cur = await ctx.db.query<{ kind: string }>(`SELECT kind FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (!cur.rows[0]) throw notFound();
  if (cur.rows[0].kind !== 'conta' && (patch.overdraftLimitCents !== undefined || patch.overdraftRateBps !== undefined)) throw new AppError(422, 'not_account', 'Cheque especial só vale para conta bancária.');
  await ctx.db.query(
    `UPDATE app.wallets SET name = coalesce($3, name), opening_balance_cents = coalesce($4, opening_balance_cents),
            overdraft_limit_cents = coalesce($5, overdraft_limit_cents), overdraft_rate_bps = coalesce($6, overdraft_rate_bps)
      WHERE id = $1 AND subscriber_id = $2`,
    [id, subscriberId, patch.name?.trim().slice(0, 40) ?? null, patch.openingBalanceCents ?? null, patch.overdraftLimitCents ?? null, patch.overdraftRateBps ?? null],
  );
}

export async function deleteWallet(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const r = await ctx.db.query(`DELETE FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

/** Muda a carteira de um lançamento (null = sem carteira). Só carteira e lançamento do próprio assinante. */
export async function setEntryWallet(ctx: Ctx, subscriberId: string, entryId: string, walletId: string | null): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  if (walletId) {
    const own = await ctx.db.query(`SELECT 1 FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [walletId, subscriberId]);
    if (own.rows.length === 0) throw notFound();
  }
  const r = await ctx.db.query(`UPDATE app.ledger_entries SET wallet_id = $3 WHERE id = $1 AND subscriber_id = $2`, [entryId, subscriberId, walletId]);
  if (r.rowCount === 0) throw notFound();
}

/** Garante que a carteira informada num lançamento novo é do assinante (devolve null se não vier nenhuma). */
export async function ownedWalletId(ctx: Ctx, subscriberId: string, walletId: string | null | undefined): Promise<string | null> {
  if (!walletId) return null;
  const own = await ctx.db.query(`SELECT 1 FROM app.wallets WHERE id = $1 AND subscriber_id = $2`, [walletId, subscriberId]);
  if (own.rows.length === 0) throw notFound();
  return walletId;
}

// ---------------------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------------------
const MAX_REMINDERS = 100;

export interface ReminderInput {
  title: string;
  dueOn: string;
  amountCents?: number | null | undefined;
  repeatMonthly?: boolean | undefined;
  emailDaysBefore?: number | undefined;
}

export async function listReminders(ctx: Ctx, subscriberId: string) {
  await requireFeature(ctx, subscriberId, 'alerts');
  const today = todaySaoPaulo();
  const r = await ctx.db.query<{ id: string; title: string; due_on: Date | string; amount_cents: string | null; repeat_monthly: boolean; email_days_before: number; done_at: Date | null }>(
    `SELECT id, title, due_on, amount_cents, repeat_monthly, email_days_before, done_at FROM app.reminders WHERE subscriber_id = $1 ORDER BY (done_at IS NOT NULL), due_on, created_at LIMIT 200`,
    [subscriberId],
  );
  return r.rows.map((x) => {
    const dueOn = iso(x.due_on);
    const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    return { id: x.id, title: x.title, dueOn, daysLeft: days, amountCents: x.amount_cents === null ? null : num(x.amount_cents), repeatMonthly: x.repeat_monthly, emailDaysBefore: x.email_days_before, done: Boolean(x.done_at), overdue: !x.done_at && days < 0 };
  });
}

export async function createReminder(ctx: Ctx, subscriberId: string, input: ReminderInput): Promise<string> {
  await requireFeature(ctx, subscriberId, 'alerts');
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.reminders WHERE subscriber_id = $1`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_REMINDERS) throw new AppError(422, 'too_many', `Limite de ${MAX_REMINDERS} lembretes.`);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.reminders(subscriber_id, title, due_on, amount_cents, repeat_monthly, email_days_before) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [subscriberId, input.title.trim().slice(0, 80), input.dueOn, input.amountCents ?? null, input.repeatMonthly ?? false, input.emailDaysBefore ?? 1],
  );
  return r.rows[0]!.id;
}

export async function updateReminder(ctx: Ctx, subscriberId: string, id: string, patch: { done?: boolean | undefined; title?: string | undefined; dueOn?: string | undefined; amountCents?: number | null | undefined; emailDaysBefore?: number | undefined }): Promise<void> {
  await requireFeature(ctx, subscriberId, 'alerts');
  await ctx.db.tx(async (q) => {
    const cur = await q.query<{ due_on: Date | string; title: string; amount_cents: string | null; repeat_monthly: boolean; email_days_before: number; done_at: Date | null }>(`SELECT due_on, title, amount_cents, repeat_monthly, email_days_before, done_at FROM app.reminders WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`, [id, subscriberId]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (patch.done === true && !row.done_at) {
      await q.query(`UPDATE app.reminders SET done_at = now() WHERE id = $1`, [id]);
      // Conta que se repete todo mês: ao dar baixa, já nasce a do mês seguinte.
      if (row.repeat_monthly) {
        await q.query(`INSERT INTO app.reminders(subscriber_id, title, due_on, amount_cents, repeat_monthly, email_days_before) VALUES ($1,$2,$3,$4,true,$5)`, [subscriberId, row.title, addMonthsIso(iso(row.due_on), 1), row.amount_cents, row.email_days_before]);
      }
    } else if (patch.done === false) {
      await q.query(`UPDATE app.reminders SET done_at = NULL WHERE id = $1`, [id]);
    }
    if (patch.title !== undefined) await q.query(`UPDATE app.reminders SET title = $2 WHERE id = $1`, [id, patch.title.trim().slice(0, 80)]);
    if (patch.dueOn !== undefined) await q.query(`UPDATE app.reminders SET due_on = $2, notified_for = NULL WHERE id = $1`, [id, patch.dueOn]);
    if (patch.amountCents !== undefined) await q.query(`UPDATE app.reminders SET amount_cents = $2 WHERE id = $1`, [id, patch.amountCents]);
    if (patch.emailDaysBefore !== undefined) await q.query(`UPDATE app.reminders SET email_days_before = $2 WHERE id = $1`, [id, patch.emailDaysBefore]);
  });
}

export async function deleteReminder(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'alerts');
  const r = await ctx.db.query(`DELETE FROM app.reminders WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

/** Worker: manda o e-mail dos lembretes que chegaram na antecedência combinada (uma vez por vencimento) para assinantes ativos. */
export async function sendDueReminders(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) return 0;
  const today = todaySaoPaulo();
  const due = await ctx.db.query<{ id: string; title: string; due_on: Date | string; amount_cents: string | null; email: string }>(
    `SELECT r.id, r.title, r.due_on, r.amount_cents, b.email::text AS email
       FROM app.reminders r
       JOIN app.subscribers b ON b.id = r.subscriber_id AND b.deleted_at IS NULL AND b.notify_reminders
       JOIN app.subscriptions s ON s.subscriber_id = r.subscriber_id AND s.status = 'active' AND s.current_period_end > now()
      WHERE r.done_at IS NULL AND r.due_on <= ($1::date + r.email_days_before) AND r.due_on >= ($1::date - 3)
        AND (r.notified_for IS NULL OR r.notified_for <> r.due_on)
      LIMIT 100`,
    [today],
  );
  let sent = 0;
  for (const r of due.rows) {
    const dueOn = iso(r.due_on);
    const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const when = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : days < 0 ? `venceu há ${-days} dia(s)` : `em ${days} dias`;
    const body = layout(`Lembrete: ${r.title}`, [`${r.title} vence ${when} (${new Date(`${dueOn}T12:00:00`).toLocaleDateString('pt-BR')}).${r.amount_cents ? ` Valor: ${formatBrl(num(r.amount_cents))}.` : ''}`, 'Quando pagar, marque como feito na aba Lembretes da sua conta.'], { label: 'Abrir meus lembretes', url: `${ctx.config.publicUrl}/conta/lembretes` });
    try {
      await ctx.email.send({ to: r.email, subject: `Lembrete: ${r.title} vence ${when}`, ...body });
      await ctx.db.query(`UPDATE app.reminders SET notified_for = due_on WHERE id = $1`, [r.id]);
      sent += 1;
    } catch {
      opts.log?.({ evento: 'lembrete_conta_falhou' });
    }
  }
  return sent;
}

