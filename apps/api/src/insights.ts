// Prumo: detector de cobranças recorrentes e base do simulador "e se...?". Os cálculos vêm do motor (packages/domain).
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { detectRecurring, merchantKey } from './engine.ts';
import type { ScenarioBase } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { listDebts } from './account-debts.ts';

const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

export async function recurringReport(ctx: Ctx, subscriberId: string) {
  await requireFeature(ctx, subscriberId, 'recurring');
  const today = todaySaoPaulo();
  const rows = await ctx.db.query<{ occurred_on: Date; amount_cents: string; note: string }>(
    `SELECT occurred_on, amount_cents, note FROM app.ledger_entries WHERE subscriber_id = $1 AND amount_cents < 0 AND occurred_on > ($2::date - 420) ORDER BY occurred_on`,
    [subscriberId, today],
  );
  const report = detectRecurring(rows.rows.map((r) => ({ date: iso(r.occurred_on), amountCents: num(r.amount_cents), note: r.note })), today);
  const flags = await ctx.db.query<{ merchant_key: string; status: string }>(`SELECT merchant_key, status FROM app.recurring_flags WHERE subscriber_id = $1`, [subscriberId]);
  const flagOf = new Map(flags.rows.map((f) => [f.merchant_key, f.status]));
  const items = report.items.map((i) => ({ ...i, decision: (flagOf.get(i.key) ?? null) as 'keep' | 'cancel' | null }));
  const cancel = items.filter((i) => i.decision === 'cancel');
  return {
    items,
    monthlyTotalCents: report.monthlyTotalCents,
    yearlyTotalCents: report.yearlyTotalCents,
    alerts: { priceIncreases: items.filter((i) => i.priceChange).length, duplicates: items.filter((i) => i.duplicate).length },
    savings: { monthlyCents: cancel.reduce((s, i) => s + i.monthlyCents, 0), yearlyCents: cancel.reduce((s, i) => s + i.yearlyCents, 0), count: cancel.length },
    hasData: rows.rows.length > 0,
  };
}

export async function setRecurringDecision(ctx: Ctx, subscriberId: string, key: string, status: 'keep' | 'cancel' | null): Promise<void> {
  await requireFeature(ctx, subscriberId, 'recurring');
  const clean = merchantKey(key) || key.toUpperCase().slice(0, 40);
  if (clean.length < 2 || clean.length > 60) throw new AppError(422, 'invalid_key', 'Cobrança inválida.');
  if (status === null) await ctx.db.query(`DELETE FROM app.recurring_flags WHERE subscriber_id = $1 AND merchant_key = $2`, [subscriberId, key]);
  else await ctx.db.query(`INSERT INTO app.recurring_flags(subscriber_id, merchant_key, status) VALUES ($1,$2,$3) ON CONFLICT (subscriber_id, merchant_key) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`, [subscriberId, key.slice(0, 60), status]);
}

const ESSENTIAL = ['moradia', 'mercado', 'transporte', 'saude', 'contas', 'educacao'];

/** Ponto de partida do simulador: média dos últimos 3 meses (ou do que houver) + parcelas das dívidas + reserva. */
export async function scenarioBase(ctx: Ctx, subscriberId: string): Promise<{ base: ScenarioBase; months: number }> {
  await requireFeature(ctx, subscriberId, 'scenarios');
  const today = todaySaoPaulo();
  const sums = await ctx.db.query<{ months: string; income: string; essential: string; flexible: string }>(
    `SELECT count(DISTINCT to_char(occurred_on, 'YYYY-MM'))::text AS months,
            coalesce(sum(amount_cents) FILTER (WHERE amount_cents > 0), 0)::text AS income,
            coalesce(-sum(amount_cents) FILTER (WHERE amount_cents < 0 AND category = ANY($3::text[])), 0)::text AS essential,
            coalesce(-sum(amount_cents) FILTER (WHERE amount_cents < 0 AND category <> 'dividas' AND NOT (category = ANY($3::text[]))), 0)::text AS flexible
       FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on > ($2::date - 92)`,
    [subscriberId, today, ESSENTIAL],
  );
  const s = sums.rows[0];
  const months = Math.max(1, Math.min(3, num(s?.months ?? 1)));
  const debts = await listDebts(ctx, subscriberId);
  const saved = await ctx.db.query<{ saved: string; poup: string }>(
    `SELECT coalesce((SELECT sum(g.saved_cents + coalesce((SELECT sum(c.amount_cents) FROM app.goal_contributions c WHERE c.goal_id = g.id), 0)) FROM app.goals g WHERE g.subscriber_id = $1), 0)::text AS saved,
            coalesce((SELECT sum(l.amount_cents) FROM app.ledger_entries l JOIN app.wallets w ON w.id = l.wallet_id WHERE l.subscriber_id = $1 AND w.kind = 'poupanca'), 0)::text AS poup`,
    [subscriberId],
  );
  return {
    months: num(s?.months ?? 0),
    base: {
      incomeCents: Math.round(num(s?.income ?? 0) / months),
      essentialCents: Math.round(num(s?.essential ?? 0) / months),
      flexibleCents: Math.round(num(s?.flexible ?? 0) / months),
      debtPaymentsCents: debts.totals.minPaymentsCents,
      reserveCents: num(saved.rows[0]?.saved ?? 0) + Math.max(0, num(saved.rows[0]?.poup ?? 0)),
    },
  };
}
