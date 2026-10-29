// Gráficos e Relatórios do Prumo. Os números saem do mesmo livro-caixa dos lançamentos (sem pagamento de fatura nem resgate, que não são gasto nem receita).
//   Controle: gráficos do mês e dos últimos meses (recurso "charts").
//   Ousado: também o menu Relatórios, com períodos prontos (recurso "reports").
//   Desbravador: Relatórios com filtros por categoria, conta, cartão, tipo e texto (recurso "reports_filters").
import { z } from 'zod';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num } from './services.ts';
import { requireFeature } from './subscriptions.ts';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reportQuerySchema = z.strictObject({
  from: day,
  to: day,
  kind: z.enum(['gasto', 'entrada', 'todos']).optional(),
  category: z.string().trim().min(1).max(30).optional(),
  walletId: z.string().uuid().optional(),
  cardId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(60).optional(),
});
export const chartsQuerySchema = z.strictObject({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), months: z.coerce.number().int().min(1).max(12).default(6) });

type Filters = { kind?: 'gasto' | 'entrada' | 'todos' | undefined; category?: string | undefined; walletId?: string | undefined; cardId?: string | undefined; q?: string | undefined };

const lastDay = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const addMonths = (month: string, n: number): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);

function clause(sub: string, from: string, to: string, f: Filters): { where: string; params: unknown[] } {
  const params: unknown[] = [sub, from, to];
  const where = ['l.subscriber_id = $1', 'l.transfer_kind IS NULL', 'l.occurred_on BETWEEN $2::date AND $3::date'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.category) add('l.category = ?', f.category);
  if (f.walletId) add('l.wallet_id = ?', f.walletId);
  if (f.cardId) add('l.card_id = ?', f.cardId);
  if (f.q) add(`l.note ILIKE ? ESCAPE '\\'`, `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (f.kind === 'gasto') where.push('l.amount_cents < 0');
  if (f.kind === 'entrada') where.push('l.amount_cents > 0');
  return { where: where.join(' AND '), params };
}

const SPEND = `coalesce(sum(-l.amount_cents) FILTER (WHERE l.amount_cents < 0), 0)::text`;
const INCOME = `coalesce(sum(l.amount_cents) FILTER (WHERE l.amount_cents > 0), 0)::text`;

async function aggregate(ctx: Ctx, sub: string, from: string, to: string, f: Filters, opts: { top: boolean; rows: boolean }) {
  const { where, params } = clause(sub, from, to, f);
  const q = <T>(sql: string) => ctx.db.query<T>(sql, params);
  const none = <T>() => Promise.resolve({ rows: [] as T[] });
  const [tot, cat, ser, dly, org, top, rows] = await Promise.all([
    q<{ spend: string; income: string; n: string }>(`SELECT ${SPEND} AS spend, ${INCOME} AS income, count(*)::text AS n FROM app.ledger_entries l WHERE ${where}`),
    q<{ category: string; spend: string; income: string; n: string }>(`SELECT l.category, ${SPEND} AS spend, ${INCOME} AS income, count(*)::text AS n FROM app.ledger_entries l WHERE ${where} GROUP BY l.category ORDER BY sum(-l.amount_cents) FILTER (WHERE l.amount_cents < 0) DESC NULLS LAST`),
    q<{ month: string; spend: string; income: string }>(`SELECT to_char(l.occurred_on, 'YYYY-MM') AS month, ${SPEND} AS spend, ${INCOME} AS income FROM app.ledger_entries l WHERE ${where} GROUP BY 1 ORDER BY 1`),
    q<{ d: string; spend: string; income: string }>(`SELECT to_char(l.occurred_on, 'YYYY-MM-DD') AS d, ${SPEND} AS spend, ${INCOME} AS income FROM app.ledger_entries l WHERE ${where} GROUP BY 1 ORDER BY 1`),
    q<{ kind: string; name: string | null; spend: string; income: string }>(
      `SELECT CASE WHEN c.id IS NOT NULL THEN 'cartao' WHEN w.id IS NOT NULL THEN 'conta' ELSE 'solto' END AS kind, coalesce(c.name, w.name) AS name, ${SPEND} AS spend, ${INCOME} AS income
         FROM app.ledger_entries l LEFT JOIN app.wallets w ON w.id = l.wallet_id LEFT JOIN app.credit_cards c ON c.id = l.card_id WHERE ${where} GROUP BY 1, 2 ORDER BY sum(-l.amount_cents) FILTER (WHERE l.amount_cents < 0) DESC NULLS LAST`),
    opts.top ? q<{ id: string; d: string; note: string; category: string; cents: string }>(`SELECT l.id, to_char(l.occurred_on, 'YYYY-MM-DD') AS d, l.note, l.category, (-l.amount_cents)::text AS cents FROM app.ledger_entries l WHERE ${where} AND l.amount_cents < 0 ORDER BY l.amount_cents ASC LIMIT 10`) : none<{ id: string; d: string; note: string; category: string; cents: string }>(),
    opts.rows ? q<{ d: string; note: string; category: string; cents: string; origin: string | null }>(`SELECT to_char(l.occurred_on, 'YYYY-MM-DD') AS d, l.note, l.category, l.amount_cents::text AS cents, coalesce(c.name, w.name) AS origin FROM app.ledger_entries l LEFT JOIN app.wallets w ON w.id = l.wallet_id LEFT JOIN app.credit_cards c ON c.id = l.card_id WHERE ${where} ORDER BY l.occurred_on DESC, l.created_at DESC LIMIT 3000`) : none<{ d: string; note: string; category: string; cents: string; origin: string | null }>(),
  ]);
  const t = tot.rows[0];
  return {
    totals: { spendCents: num(t?.spend ?? 0), incomeCents: num(t?.income ?? 0), balanceCents: num(t?.income ?? 0) - num(t?.spend ?? 0), count: num(t?.n ?? 0) },
    byCategory: cat.rows.map((r) => ({ category: r.category, spendCents: num(r.spend), incomeCents: num(r.income), count: num(r.n) })),
    series: ser.rows.map((r) => ({ month: r.month, spendCents: num(r.spend), incomeCents: num(r.income) })),
    daily: dly.rows.map((r) => ({ date: r.d, spendCents: num(r.spend), incomeCents: num(r.income) })),
    byOrigin: org.rows.map((r) => ({ kind: r.kind, name: r.name ?? 'Sem conta definida', spendCents: num(r.spend), incomeCents: num(r.income) })),
    top: top.rows.map((r) => ({ id: r.id, date: r.d, note: r.note, category: r.category, cents: num(r.cents) })),
    rows: rows.rows.map((r) => ({ date: r.d, note: r.note, category: r.category, cents: num(r.cents), origin: r.origin })),
  };
}

/** Gráficos das telas: o mês escolhido por categoria, dia e origem, e a série dos últimos meses. */
export async function chartsOverview(ctx: Ctx, sub: string, input: z.infer<typeof chartsQuerySchema>) {
  await requireFeature(ctx, sub, 'charts');
  const from = `${addMonths(input.month, -(input.months - 1))}-01`;
  const [period, month] = await Promise.all([
    aggregate(ctx, sub, from, lastDay(input.month), {}, { top: false, rows: false }),
    aggregate(ctx, sub, `${input.month}-01`, lastDay(input.month), {}, { top: false, rows: false }),
  ]);
  return { month: input.month, months: input.months, series: period.series, totals: month.totals, byCategory: month.byCategory, daily: month.daily, byOrigin: month.byOrigin };
}

/** Relatório de um período. Sem filtros no Ousado; com filtros (categoria, conta, cartão, tipo, texto) no Desbravador. */
export async function report(ctx: Ctx, sub: string, input: z.infer<typeof reportQuerySchema>) {
  await requireFeature(ctx, sub, 'reports');
  const filtered = Boolean(input.category || input.walletId || input.cardId || input.q || (input.kind && input.kind !== 'todos'));
  if (filtered) await requireFeature(ctx, sub, 'reports_filters');
  if (input.to < input.from) throw new AppError(422, 'invalid_range', 'A data final vem antes da inicial.');
  if (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`) > 800 * 86_400_000) throw new AppError(422, 'range_too_long', 'Escolha um período de até 2 anos.');
  const f: Filters = { kind: input.kind, category: input.category, walletId: input.walletId, cardId: input.cardId, q: input.q };
  const data = await aggregate(ctx, sub, input.from, input.to, f, { top: true, rows: true });
  // o período anterior (mesma duração) serve de comparação
  const days = Math.round((Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(`${input.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(`${input.from}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const prev = await aggregate(ctx, sub, prevFrom, prevTo, f, { top: false, rows: false });
  return { from: input.from, to: input.to, filtered, ...data, previous: { from: prevFrom, to: prevTo, totals: prev.totals } };
}
