// Dados da conta: (1) exportação da própria pessoa (planilha e PDF, enquanto tem acesso);
// (2) pacote COMPLETO de um ex-assinante para o backoffice (.zip, tudo o que o sistema guarda dele);
// (3) exclusão definitiva dos dados (manual no backoffice, ou automática depois da janela de retenção).
import { AppError, notFound } from './errors.ts';
import { audit, wipeCase } from './services.ts';
import type { Ctx } from './services.ts';
import { num } from './services.ts';
import { CATEGORY_LABEL, planByCode } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { revokeAllForSubscriber } from './openfinance.ts';
import { buildXlsx } from './xlsx.ts';
import type { Sheet } from './xlsx.ts';
import { createZip } from './zip.ts';
import type { ZipEntry } from './zip.ts';

const day = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);
const cat = (c: string) => CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c;

export interface AccountReport {
  generatedAt: string;
  email: string;
  plan: string;
  sheets: Sheet[];
  summary: { label: string; value: string }[];
}

/** Tudo o que a pessoa lançou, em tabelas. Serve de base para a planilha (.xlsx) e para o PDF (gerado no navegador). */
export async function accountReport(ctx: Ctx, subscriberId: string): Promise<AccountReport> {
  const plan = await requireFeature(ctx, subscriberId, 'ledger');
  const q = ctx.db;
  const [who, entries, debts, pays, goals, contribs, reminders, wallets, limits, monthLimits, cardRows] = await Promise.all([
    q.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [subscriberId]),
    q.query<{ occurred_on: Date; note: string; category: string; amount_cents: string; wallet: string | null }>(`SELECT l.occurred_on, l.note, l.category, l.amount_cents, w.name AS wallet FROM app.ledger_entries l LEFT JOIN app.wallets w ON w.id = l.wallet_id WHERE l.subscriber_id = $1 ORDER BY l.occurred_on, l.created_at`, [subscriberId]),
    q.query<{ name: string; initial_cents: string; balance_cents: string; monthly_rate_bps: number; min_payment_cents: string; paid_off_at: Date | null }>(`SELECT name, initial_cents, balance_cents, monthly_rate_bps, min_payment_cents, paid_off_at FROM app.account_debts WHERE subscriber_id = $1 ORDER BY created_at`, [subscriberId]),
    q.query<{ paid_on: Date; name: string; amount_cents: string }>(`SELECT p.paid_on, d.name, p.amount_cents FROM app.account_debt_payments p JOIN app.account_debts d ON d.id = p.debt_id WHERE p.subscriber_id = $1 ORDER BY p.paid_on`, [subscriberId]),
    q.query<{ name: string; target_cents: string; total: string; due_on: Date | null; completed_at: Date | null }>(`SELECT g.name, g.target_cents, g.saved_cents + coalesce((SELECT sum(c.amount_cents) FROM app.goal_contributions c WHERE c.goal_id = g.id), 0) AS total, g.due_on, g.completed_at FROM app.goals g WHERE g.subscriber_id = $1 ORDER BY g.created_at`, [subscriberId]),
    q.query<{ occurred_on: Date; name: string; amount_cents: string; note: string }>(`SELECT c.occurred_on, g.name, c.amount_cents, c.note FROM app.goal_contributions c JOIN app.goals g ON g.id = c.goal_id WHERE c.subscriber_id = $1 ORDER BY c.occurred_on`, [subscriberId]),
    q.query<{ title: string; due_on: Date; amount_cents: string | null; repeat_monthly: boolean; done_at: Date | null }>(`SELECT title, due_on, amount_cents, repeat_monthly, done_at FROM app.reminders WHERE subscriber_id = $1 ORDER BY due_on`, [subscriberId]),
    q.query<{ name: string; kind: string; opening: string; limit_c: string; rate: number; balance: string }>(`SELECT w.name, w.kind, w.opening_balance_cents::text AS opening, w.overdraft_limit_cents::text AS limit_c, w.overdraft_rate_bps AS rate, (w.opening_balance_cents + coalesce(sum(l.amount_cents), 0) - coalesce((SELECT sum(cp.amount_cents) FROM app.card_payments cp WHERE cp.wallet_id = w.id), 0))::text AS balance FROM app.wallets w LEFT JOIN app.ledger_entries l ON l.wallet_id = w.id WHERE w.subscriber_id = $1 GROUP BY w.id ORDER BY w.created_at`, [subscriberId]),
    q.query<{ category: string; limit_cents: string }>(`SELECT category, limit_cents FROM app.budget_limits WHERE subscriber_id = $1 ORDER BY category`, [subscriberId]),
    q.query<{ month: string; category: string; limit_cents: string }>(`SELECT month, category, limit_cents FROM app.budget_months WHERE subscriber_id = $1 ORDER BY month, category`, [subscriberId]),
    q.query<{ name: string; brand: string; limit_cents: string; closing_day: number; due_day: number }>(`SELECT name, brand, limit_cents, closing_day, due_day FROM app.credit_cards WHERE subscriber_id = $1 ORDER BY created_at`, [subscriberId]),
  ]);
  const income = entries.rows.filter((e) => num(e.amount_cents) > 0).reduce((s, e) => s + num(e.amount_cents), 0);
  const spent = entries.rows.filter((e) => num(e.amount_cents) < 0).reduce((s, e) => s - num(e.amount_cents), 0);
  const owed = debts.rows.reduce((s, d) => s + num(d.balance_cents), 0);
  const sheets: Sheet[] = [
    { name: 'Lançamentos', headers: ['Data', 'Descrição', 'Categoria', 'Carteira', 'Valor'], rows: entries.rows.map((e) => [day(e.occurred_on), e.note, cat(e.category), e.wallet ?? '', num(e.amount_cents)]), moneyCols: [4] },
    { name: 'Dívidas', headers: ['Dívida', 'Valor inicial', 'Falta pagar', 'Juros ao mês (%)', 'Parcela mínima', 'Situação'], rows: debts.rows.map((d) => [d.name, num(d.initial_cents), num(d.balance_cents), d.monthly_rate_bps / 100, num(d.min_payment_cents), d.paid_off_at ? 'Quitada' : 'Em aberto']), moneyCols: [1, 2, 4] },
    { name: 'Pagamentos de dívidas', headers: ['Data', 'Dívida', 'Valor pago'], rows: pays.rows.map((p) => [day(p.paid_on), p.name, num(p.amount_cents)]), moneyCols: [2] },
    { name: 'Metas', headers: ['Meta', 'Alvo', 'Guardado', 'Prazo', 'Situação'], rows: goals.rows.map((g) => [g.name, num(g.target_cents), num(g.total), g.due_on ? day(g.due_on) : '', g.completed_at ? 'Concluída' : 'Em andamento']), moneyCols: [1, 2] },
    { name: 'Aportes em metas', headers: ['Data', 'Meta', 'Valor', 'Observação'], rows: contribs.rows.map((c) => [day(c.occurred_on), c.name, num(c.amount_cents), c.note]), moneyCols: [2] },
    { name: 'Lembretes', headers: ['Conta ou prazo', 'Vence em', 'Valor', 'Todo mês', 'Situação'], rows: reminders.rows.map((r) => [r.title, day(r.due_on), r.amount_cents === null ? null : num(r.amount_cents), r.repeat_monthly ? 'Sim' : 'Não', r.done_at ? 'Pago' : 'Pendente']), moneyCols: [2] },
    { name: 'Carteiras', headers: ['Carteira', 'Tipo', 'Saldo', 'Saldo de partida', 'Limite do cheque especial', 'Taxa do cheque especial (% ao mês)'], rows: wallets.rows.map((w) => [w.name, w.kind, num(w.balance), num(w.opening), num(w.limit_c), w.rate / 100]), moneyCols: [2, 3, 4] },
    { name: 'Cartões', headers: ['Cartão', 'Bandeira', 'Limite', 'Fecha no dia', 'Vence no dia'], rows: cardRows.rows.map((k) => [k.name, k.brand, num(k.limit_cents), k.closing_day, k.due_day]), moneyCols: [2] },
    { name: 'Limites', headers: ['Mês', 'Categoria', 'Limite'], rows: [...limits.rows.map((l) => ['Todos os meses', cat(l.category), num(l.limit_cents)] as (string | number)[]), ...monthLimits.rows.map((l) => [l.month, cat(l.category), num(l.limit_cents)] as (string | number)[])], moneyCols: [2] },
  ];
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return {
    generatedAt: new Date().toISOString(),
    email: who.rows[0]?.email ?? '',
    plan: planByCode(plan)?.name ?? plan,
    sheets,
    summary: [
      { label: 'Lançamentos', value: String(entries.rows.length) },
      { label: 'Entradas registradas', value: brl(income) },
      { label: 'Gastos registrados', value: brl(spent) },
      { label: 'Dívidas em aberto', value: brl(owed) },
      { label: 'Metas', value: String(goals.rows.length) },
    ],
  };
}

export async function accountXlsx(ctx: Ctx, subscriberId: string): Promise<Buffer> {
  const r = await accountReport(ctx, subscriberId);
  const resumo: Sheet = { name: 'Resumo', headers: ['Item', 'Valor'], rows: [['Conta', r.email], ['Plano', r.plan], ['Gerado em', new Date(r.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })], ...r.summary.map((s) => [s.label, s.value] as (string | number)[])] };
  await audit(ctx.db, `subscriber:${subscriberId}`, 'account_export_xlsx', 'subscriber', subscriberId);
  return buildXlsx([resumo, ...r.sheets]);
}

// ---------------------------------------------------------------------------
// Backoffice: ex-assinantes (cancelados)
// ---------------------------------------------------------------------------
export interface CanceledRow {
  subscriberId: string;
  email: string;
  plan: string;
  canceledAt: string;
  accessUntil: string | null;
  accessEnded: boolean;
  purgeOn: string | null;
  exportedAt: string | null;
  dataRows: number;
}

/** Tabelas do schema app que têm a coluna subscriber_id (descobertas no banco: nada fica de fora quando o sistema cresce). */
async function subscriberTables(ctx: Ctx): Promise<string[]> {
  const r = await ctx.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'app' AND column_name = 'subscriber_id' ORDER BY table_name`);
  return r.rows.map((x) => x.table_name).filter((t) => /^[a-z_]+$/.test(t));
}

const NEVER_EXPORT = new Set(['sessions']); // contêm segredos de sessão
const KEEP_ON_PURGE = new Set(['orders']); // registro financeiro, sem dados pessoais depois da anonimização

export async function listCanceled(ctx: Ctx): Promise<{ rows: CanceledRow[]; purgeDays: number }> {
  const r = await ctx.db.query<{ subscriber_id: string; email: string; plan: string; canceled_at: Date; period_end: Date | null; exported_at: Date | null }>(
    `SELECT b.subscriber_id, s.email::text AS email, b.plan, b.canceled_at, sub.current_period_end AS period_end, b.data_exported_at AS exported_at
       FROM app.billing_profiles b
       JOIN app.subscribers s ON s.id = b.subscriber_id AND s.deleted_at IS NULL
       LEFT JOIN app.subscriptions sub ON sub.subscriber_id = b.subscriber_id
      WHERE b.status = 'canceled' AND b.canceled_at IS NOT NULL
      ORDER BY b.canceled_at DESC LIMIT 500`,
  );
  const purgeDays = ctx.config.canceledPurgeDays;
  const out: CanceledRow[] = [];
  for (const x of r.rows) {
    const rows = await countRows(ctx, x.subscriber_id);
    const end = x.period_end ? new Date(x.period_end) : null;
    out.push({
      subscriberId: x.subscriber_id,
      email: x.email,
      plan: planByCode(x.plan)?.name ?? x.plan,
      canceledAt: new Date(x.canceled_at).toISOString(),
      accessUntil: end ? end.toISOString() : null,
      accessEnded: end ? end.getTime() < Date.now() : true,
      purgeOn: end ? new Date(end.getTime() + purgeDays * 86_400_000).toISOString() : null,
      exportedAt: x.exported_at ? new Date(x.exported_at).toISOString() : null,
      dataRows: rows,
    });
  }
  return { rows: out, purgeDays };
}

async function countRows(ctx: Ctx, subscriberId: string): Promise<number> {
  let total = 0;
  for (const t of await subscriberTables(ctx)) {
    if (NEVER_EXPORT.has(t)) continue;
    const c = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.${t} WHERE subscriber_id = $1`, [subscriberId]);
    total += num(c.rows[0]?.n ?? 0);
  }
  return total;
}

async function canceledProfile(ctx: Ctx, subscriberId: string) {
  const r = await ctx.db.query<{ status: string; data_exported_at: Date | null }>(`SELECT status, data_exported_at FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  const p = r.rows[0];
  if (!p || p.status !== 'canceled') throw new AppError(409, 'not_canceled', 'Só dados de assinantes cancelados podem ser baixados ou excluídos aqui.');
  return p;
}

/** .zip com TUDO que o sistema guarda deste ex-assinante: uma tabela por arquivo .json, mais o histórico de auditoria. */
export async function buildSubscriberPackage(ctx: Ctx, subscriberId: string, actorId: string, actorEmail: string): Promise<{ zip: Buffer; filename: string }> {
  await canceledProfile(ctx, subscriberId);
  const sub = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL`, [subscriberId]);
  if (!sub.rows[0]) throw notFound();
  const entries: ZipEntry[] = [];
  const counts: Record<string, number> = {};
  const add = (name: string, rows: unknown[]) => {
    counts[name] = rows.length;
    entries.push({ name: `${name}.json`, data: JSON.stringify(rows, null, 2) });
  };
  const one = async (name: string, sql: string, params: unknown[]) => add(name, (await ctx.db.query(sql, params)).rows);
  await one('subscribers', `SELECT * FROM app.subscribers WHERE id = $1`, [subscriberId]);
  for (const t of await subscriberTables(ctx)) {
    if (NEVER_EXPORT.has(t)) continue;
    await one(t, `SELECT * FROM app.${t} WHERE subscriber_id = $1 ORDER BY 1`, [subscriberId]);
  }
  await one('order_items', `SELECT oi.* FROM app.order_items oi JOIN app.orders o ON o.id = oi.order_id WHERE o.subscriber_id = $1`, [subscriberId]);
  await one('payments', `SELECT p.* FROM app.payments p JOIN app.orders o ON o.id = p.order_id WHERE o.subscriber_id = $1 ORDER BY p.created_at`, [subscriberId]);
  await one('referrals', `SELECT * FROM app.referrals WHERE referrer_subscriber_id = $1 OR converted_subscriber_id = $1 ORDER BY created_at`, [subscriberId]);
  await one('household_members', `SELECT * FROM app.household_members WHERE owner_id = $1 OR member_id = $1`, [subscriberId]);
  await one('audit_log', `SELECT * FROM app.audit_log WHERE entity_id = $1 OR actor = $2 ORDER BY 1`, [subscriberId, `subscriber:${subscriberId}`]).catch(() => undefined);
  const readme = [
    'Pacote de dados de ex-assinante (Fôlego / Prumo)',
    `Conta: ${sub.rows[0].email}`,
    `Gerado em: ${new Date().toISOString()} por ${actorEmail}`,
    '',
    'Cada arquivo .json é uma tabela do sistema com TODAS as linhas ligadas a esta conta.',
    'Não inclui segredos de sessão. Guarde este pacote com segurança e apague-o quando a obrigação de guarda terminar.',
    '',
    'Linhas por arquivo:',
    ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`),
  ].join('\n');
  entries.unshift({ name: 'LEIA-ME.txt', data: readme });
  await ctx.db.query(`UPDATE app.billing_profiles SET data_exported_at = now(), data_exported_by = $2 WHERE subscriber_id = $1`, [subscriberId, actorId]);
  await audit(ctx.db, `admin:${actorId}`, 'subscriber_data_exported', 'subscriber', subscriberId, { email: sub.rows[0].email, tables: Object.keys(counts).length });
  const safe = sub.rows[0].email.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return { zip: createZip(entries), filename: `dados-${safe}-${new Date().toISOString().slice(0, 10)}.zip` };
}

/** Apaga TUDO o que é dado da pessoa. Pedidos e pagamentos ficam sem dado pessoal (e-mail anonimizado) por obrigação fiscal. */
export async function purgeSubscriber(ctx: Ctx, subscriberId: string, actor: string): Promise<{ deletedRows: number }> {
  const tables = (await subscriberTables(ctx)).filter((t) => !KEEP_ON_PURGE.has(t));
  const prof = await ctx.db.query<{ provider_subscription_id: string | null; status: string }>(`SELECT provider_subscription_id, status FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  if (prof.rows[0]?.provider_subscription_id && prof.rows[0].status !== 'canceled') await ctx.gateway.cancelCardSubscription(prof.rows[0].provider_subscription_id);
  await revokeAllForSubscriber(ctx, subscriberId); // corta o acesso aos bancos no agregador antes de apagar os dados
  return ctx.db.tx(async (q) => {
    const old = await q.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [subscriberId]);
    let deleted = 0;
    const maps = await q.query<{ id: string }>(`SELECT id FROM app.cases WHERE owner_subscriber_id = $1 AND status <> 'purged'`, [subscriberId]);
    for (const m of maps.rows) await wipeCase(q, m.id); // o Mapa que veio com a assinatura também é dado da pessoa
    await q.query(`UPDATE app.sessions SET subscriber_id = NULL WHERE subscriber_id = $1`, [subscriberId]);
    await q.query(`DELETE FROM app.household_members WHERE owner_id = $1 OR member_id = $1`, [subscriberId]);
    // E-mails de amigos que esta pessoa indicou são dados de terceiros: somem junto.
    await q.query(`DELETE FROM app.referrals WHERE referrer_subscriber_id = $1`, [subscriberId]);
    for (const t of tables) {
      if (NEVER_EXPORT.has(t) || t === 'sessions') continue;
      const r = await q.query(`DELETE FROM app.${t} WHERE subscriber_id = $1`, [subscriberId]);
      deleted += r.rowCount;
    }
    if (old.rows[0]) await q.query(`DELETE FROM app.login_codes WHERE email = $1`, [old.rows[0].email]);
    await q.query(`UPDATE app.subscribers SET email = 'excluido-' || id::text || '@invalid.local', display_name = NULL, deleted_at = now() WHERE id = $1`, [subscriberId]);
    await audit(q, actor, 'subscriber_data_purged', 'subscriber', subscriberId, { rows: deleted });
    return { deletedRows: deleted };
  });
}

/** Exclusão pedida no backoffice: só depois de o pacote ter sido baixado e com o e-mail digitado para confirmar. */
export async function adminPurge(ctx: Ctx, subscriberId: string, actorId: string, confirmEmail: string): Promise<{ deletedRows: number }> {
  const p = await canceledProfile(ctx, subscriberId);
  if (!p.data_exported_at) throw new AppError(409, 'export_first', 'Baixe o pacote de dados antes de excluir.');
  const sub = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL`, [subscriberId]);
  if (!sub.rows[0]) throw notFound();
  if (sub.rows[0].email.toLowerCase() !== confirmEmail.trim().toLowerCase()) throw new AppError(422, 'confirm_mismatch', 'O e-mail digitado não confere com o do ex-assinante.');
  return purgeSubscriber(ctx, subscriberId, `admin:${actorId}`);
}

/** Worker: elimina sozinho os dados de quem cancelou quando o acesso acabou e a janela de retenção venceu. */
export async function purgeCanceledExpired(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  const due = await ctx.db.query<{ subscriber_id: string }>(
    `SELECT b.subscriber_id FROM app.billing_profiles b
       JOIN app.subscribers s ON s.id = b.subscriber_id AND s.deleted_at IS NULL
       JOIN app.subscriptions sub ON sub.subscriber_id = b.subscriber_id
      WHERE b.status = 'canceled' AND sub.current_period_end + make_interval(days => $1) < now() LIMIT 20`,
    [ctx.config.canceledPurgeDays],
  );
  let n = 0;
  for (const d of due.rows) {
    try {
      await purgeSubscriber(ctx, d.subscriber_id, 'system');
      n += 1;
    } catch {
      opts.log?.({ evento: 'purga_automatica_falhou' });
    }
  }
  return n;
}
