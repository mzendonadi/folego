// Assinatura (Controle, Ousado, Desbravador). Conta por e-mail SEM senha: código de 6 dígitos válido por 10 minutos.
// Pagamento é Pix mensal (sem cartão, sem débito automático): a assinatura vale por 30 dias por pagamento, o cancelamento
// é um clique (só deixa de renovar) e nunca há cobrança sem a pessoa pagar. Os avulsos continuam sem cadastro.
import { randomInt } from 'node:crypto';
import { PLANS, buildAlerts, categorize, coachInsights, monthOf, planByCode, planHas, simulateInvestment, summarizeMonth, CATEGORIES } from './engine.ts';
import type { Feature, Goal, LedgerEntry, PlanCode } from './engine.ts';
import { hmac, safeEqual } from './crypto.ts';
import { layout } from './email.ts';
import { AppError, notFound } from './errors.ts';
import type { Ctx, OrderView } from './services.ts';
import { audit, num, orderView, todaySaoPaulo, wipeCase } from './services.ts';
import type { Queryable } from './db.ts';
import { ownedWalletId, walletOverdraftAlerts } from './account-extras.ts';
import { monthLimits } from './account-debts.ts';
import { createCustomCategory, customCategories, deleteCustomCategory, isAllowedCategory } from './categories.ts';
import { markMissionDone } from './coach-program.ts';
import { materializeInstallments } from './cards.ts';
import { billingView, CARD_GRACE_DAYS } from './billing.ts';
import { isDemoSubscriber } from './demo.ts';
import type { BillingView } from './billing.ts';

const CODE_TTL_MIN = 10;
const PIX_TTL_MS = 30 * 60 * 1000;
const PERIOD_DAYS = 30;
const MAX_ENTRIES_PER_CALL = 500;

export function assertEnabled(ctx: Ctx): void {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) throw notFound();
}

// ---------------------------------------------------------------------------
// Login por código
// ---------------------------------------------------------------------------
const codeHash = (ctx: Ctx, email: string, code: string) => hmac(ctx.config.secret, `login:${email}:${code}`);

export async function requestLoginCode(ctx: Ctx, email: string): Promise<{ sent: true; devCode?: string }> {
  assertEnabled(ctx);
  const recent = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.login_codes WHERE email = $1 AND attempts < 5 AND created_at > now() - interval '10 minutes'`, [email]);
  if (num(recent.rows[0]?.n ?? 0) >= 3) throw new AppError(429, 'too_many_codes', 'Você já pediu alguns códigos. Espere 10 minutos ou use o último que chegou.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(`INSERT INTO app.login_codes(email, code_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => ${CODE_TTL_MIN}))`, [email, codeHash(ctx, email, code)]);
  const body = layout('Seu código de acesso ao Fôlego', [`Use este código para entrar: ${code}`, `Ele vale por ${CODE_TTL_MIN} minutos. Se não foi você, ignore este e-mail.`]);
  try {
    await ctx.email!.send({ to: email, subject: `Seu código do Fôlego: ${code}`, ...body });
  } catch {
    throw new AppError(502, 'email_failed', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
  }
  return ctx.config.exposeDevCodes ? { sent: true, devCode: code } : { sent: true };
}

export async function verifyLoginCode(ctx: Ctx, sessionId: string, email: string, code: string): Promise<{ subscriberId: string }> {
  assertEnabled(ctx);
  const r = await ctx.db.query<{ id: string; code_hash: Buffer; attempts: number }>(
    `SELECT id, code_hash, attempts FROM app.login_codes WHERE email = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  if (!row) throw new AppError(401, 'invalid_code', 'Código inválido ou vencido. Peça um novo.');
  if (row.attempts >= 5) throw new AppError(429, 'too_many_attempts', 'Muitas tentativas. Peça um novo código.');
  await ctx.db.query(`UPDATE app.login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  // bytea pode voltar como Uint8Array simples (PGlite) em vez de Buffer: normaliza antes de comparar.
  if (!safeEqual(codeHash(ctx, email, code).toString('hex'), Buffer.from(row.code_hash).toString('hex'))) throw new AppError(401, 'invalid_code', 'Código incorreto.');
  return ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.login_codes SET used_at = now() WHERE id = $1`, [row.id]);
    const sub = await q.query<{ id: string }>(
      `INSERT INTO app.subscribers(email, last_login_at) VALUES ($1, now()) ON CONFLICT (email) DO UPDATE SET last_login_at = now() RETURNING id`,
      [email],
    );
    const id = sub.rows[0]!.id;
    await q.query(`UPDATE app.sessions SET subscriber_id = $2 WHERE id = $1`, [sessionId, id]);
    await audit(q, `session:${sessionId}`, 'subscriber_login', 'subscriber', id);
    return { subscriberId: id };
  });
}

export async function logout(ctx: Ctx, sessionId: string): Promise<void> {
  await ctx.db.query(`UPDATE app.sessions SET subscriber_id = NULL WHERE id = $1`, [sessionId]);
}

export async function subscriberOf(ctx: Ctx, sessionId: string): Promise<string | null> {
  const r = await ctx.db.query<{ subscriber_id: string | null }>(`SELECT subscriber_id FROM app.sessions WHERE id = $1`, [sessionId]);
  return r.rows[0]?.subscriber_id ?? null;
}

// ---------------------------------------------------------------------------
// Conta, assinatura e pagamento
// ---------------------------------------------------------------------------
export interface AccountView {
  email: string;
  subscription: { plan: PlanCode; active: boolean; periodEnd: number; cancelAtPeriodEnd: boolean } | null;
  /** Assinatura mensal no cartão (mensal, renova em…, cancelada, acesso até…). Nulo para quem ainda não assinou desse jeito. */
  billing: BillingView | null;
  profile: { displayName: string | null; notifyDigest: boolean; notifyReminders: boolean; marketing: boolean };
  /** Conta de teste ligada pelo dono: nada é cobrado (o Prumo mostra um aviso). */
  demo: boolean;
}

export async function accountView(ctx: Ctx, subscriberId: string): Promise<AccountView> {
  const s = await ctx.db.query<{ email: string; display_name: string | null; notify_digest: boolean; notify_reminders: boolean; opted_out: boolean }>(`SELECT email, display_name, notify_digest, notify_reminders, (marketing_opt_out_at IS NOT NULL) AS opted_out FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL`, [subscriberId]);
  if (!s.rows[0]) throw notFound();
  const sub = await ctx.db.query<{ plan: PlanCode; status: string; current_period_end: Date | string; cancel_at_period_end: boolean }>(
    `SELECT plan, status, current_period_end, cancel_at_period_end FROM app.subscriptions WHERE subscriber_id = $1`,
    [subscriberId],
  );
  const row = sub.rows[0];
  const end = row ? new Date(row.current_period_end).getTime() : 0;
  const billing = await billingView(ctx, subscriberId);
  // Cartão em dia tem uns dias de tolerância depois do vencimento: a renovação chega por webhook.
  const grace = billing && billing.status !== 'canceled' ? CARD_GRACE_DAYS * 86_400_000 : 0;
  const p = s.rows[0];
  return {
    email: p.email,
    subscription: row ? { plan: row.plan, active: row.status === 'active' && end + grace > Date.now(), periodEnd: end, cancelAtPeriodEnd: row.cancel_at_period_end } : null,
    billing,
    profile: { displayName: p.display_name, notifyDigest: p.notify_digest, notifyReminders: p.notify_reminders, marketing: !p.opted_out },
    demo: await isDemoSubscriber(ctx, subscriberId),
  };
}

export async function createSubscriptionOrder(ctx: Ctx, args: { sessionId: string; subscriberId: string; plan: string; idempotencyKey: string }): Promise<OrderView> {
  assertEnabled(ctx);
  const plan = planByCode(args.plan);
  if (!plan) throw new AppError(422, 'invalid_plan', 'Plano inválido');
  const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM app.orders WHERE session_id = $1 AND idempotency_key = $2`, [args.sessionId, args.idempotencyKey]);
  if (existing.rows[0]) return orderView(ctx.db, existing.rows[0].id);
  if (ctx.config.salesPaused) throw new AppError(503, 'sales_paused', 'As vendas estão pausadas por um instante. Tente novamente em alguns minutos.');
  const price = await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1 AND active AND kind = 'subscription'`, [plan.productCode]);
  if (!price.rows[0]) throw new AppError(422, 'product_unavailable', 'Este plano não está disponível no momento.');
  const totalCents = num(price.rows[0].price_cents);
  const expiresAt = new Date(Date.now() + PIX_TTL_MS);

  const orderId = await ctx.db.tx(async (q) => {
    const created = await q.query<{ id: string }>(
      `INSERT INTO app.orders(case_id, subscriber_id, session_id, status, total_cents, idempotency_key) VALUES (NULL,$1,$2,'pending',$3,$4) ON CONFLICT (session_id, idempotency_key) DO NOTHING RETURNING id`,
      [args.subscriberId, args.sessionId, totalCents, args.idempotencyKey],
    );
    const id = created.rows[0]?.id;
    if (!id) {
      const again = await q.query<{ id: string }>(`SELECT id FROM app.orders WHERE session_id = $1 AND idempotency_key = $2`, [args.sessionId, args.idempotencyKey]);
      return again.rows[0]!.id;
    }
    await q.query(`INSERT INTO app.order_items(order_id, product_code, unit_price_cents) VALUES ($1,$2,$3)`, [id, plan.productCode, totalCents]);
    const charge = await ctx.gateway.createPix({ orderId: id, amountCents: totalCents, expiresAt });
    await q.query(
      `INSERT INTO app.payments(order_id, provider, provider_payment_id, method, amount_cents, status, pix_copy_paste, pix_expires_at) VALUES ($1,$2,$3,'pix',$4,'pending',$5,$6)`,
      [id, ctx.gateway.name, charge.providerPaymentId, totalCents, charge.pixCopyPaste, charge.expiresAt.toISOString()],
    );
    await audit(q, `subscriber:${args.subscriberId}`, 'subscription_order_created', 'order', id, { plan: plan.code });
    return id;
  });
  return orderView(ctx.db, orderId);
}

/** Desbravador: o Mapa que veio com o plano acompanha o período da assinatura (a cada renovação o prazo se estende). */
export async function extendPlanMaps(q: Queryable, subscriberId: string): Promise<void> {
  const plan = `EXISTS (SELECT 1 FROM app.entitlements e JOIN app.payments p ON p.order_id = e.order_id AND p.provider = 'plan' WHERE e.case_id = c.id AND e.product_code = 'recovery_map')`;
  await q.query(
    `UPDATE app.entitlements e SET expires_at = s.current_period_end
       FROM app.subscriptions s, app.cases c, app.payments p
      WHERE s.subscriber_id = $1 AND s.plan = 'desbravador' AND e.product_code = 'recovery_map' AND e.expires_at < s.current_period_end
        AND c.id = e.case_id AND c.owner_subscriber_id = $1 AND c.status <> 'purged'
        AND p.order_id = e.order_id AND p.provider = 'plan'`,
    [subscriberId],
  );
  await q.query(
    `UPDATE app.cases c SET purge_after = greatest(c.purge_after, s.current_period_end + interval '1 day')
       FROM app.subscriptions s
      WHERE s.subscriber_id = $1 AND s.plan = 'desbravador' AND c.owner_subscriber_id = $1 AND c.status <> 'purged' AND ${plan}`,
    [subscriberId],
  );
}

/** Chamada por confirmPayment (dentro da transação) quando o pedido pago é de assinatura. */
export async function activateSubscription(q: Queryable, subscriberId: string, orderId: string): Promise<void> {
  await activateSubscriptionPeriod(q, subscriberId, orderId);
  await extendPlanMaps(q, subscriberId);
}

async function activateSubscriptionPeriod(q: Queryable, subscriberId: string, orderId: string): Promise<void> {
  const item = await q.query<{ product_code: string }>(`SELECT product_code FROM app.order_items WHERE order_id = $1`, [orderId]);
  const plan = PLANS.find((p) => p.productCode === item.rows[0]?.product_code);
  if (!plan) return;
  // Dias por pagamento vêm do catálogo (o dono pode mudar em Produtos e preços); 30 se o produto não tiver valor.
  const d = await q.query<{ access_days: number }>(`SELECT access_days FROM app.products WHERE code = $1`, [plan.productCode]);
  const period = Math.max(1, Math.min(365, d.rows[0]?.access_days ?? PERIOD_DAYS));
  const card = await q.query<{ status: string }>(`SELECT status FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  if (card.rows[0]) {
    // Assinatura mensal no cartão: cada mensalidade paga vale um mês de calendário.
    await q.query(
      `INSERT INTO app.subscriptions(subscriber_id, plan, status, current_period_end)
       VALUES ($1, $2, 'active', now() + interval '1 month')
       ON CONFLICT (subscriber_id) DO UPDATE
         SET plan = EXCLUDED.plan, status = 'active', reminded_at = NULL, canceled_at = NULL, cancel_at_period_end = false,
             current_period_end = GREATEST(app.subscriptions.current_period_end, now()) + interval '1 month'`,
      [subscriberId, plan.code],
    );
    await q.query(`UPDATE app.billing_profiles SET status = CASE WHEN status = 'canceled' THEN status ELSE 'active' END, last_charge_at = now(), past_due_since = NULL WHERE subscriber_id = $1`, [subscriberId]);
    await audit(q, 'system', 'subscription_paid', 'subscriber', subscriberId, { plan: plan.code, billing: 'card' });
    return;
  }
  await q.query(
    `INSERT INTO app.subscriptions(subscriber_id, plan, status, current_period_end)
     VALUES ($1, $2, 'active', now() + make_interval(days => $3))
     ON CONFLICT (subscriber_id) DO UPDATE
       SET plan = EXCLUDED.plan, status = 'active', cancel_at_period_end = false, reminded_at = NULL,
           current_period_end = GREATEST(app.subscriptions.current_period_end, now()) + make_interval(days => $3)`,
    [subscriberId, plan.code, period],
  );
  await audit(q, 'system', 'subscription_paid', 'subscriber', subscriberId, { plan: plan.code });
}

export async function setCancel(ctx: Ctx, subscriberId: string, cancel: boolean): Promise<void> {
  const r = await ctx.db.query(`UPDATE app.subscriptions SET cancel_at_period_end = $2 WHERE subscriber_id = $1`, [subscriberId, cancel]);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `subscriber:${subscriberId}`, cancel ? 'subscription_cancel' : 'subscription_resume', 'subscriber', subscriberId);
}

/** Apaga a conta: dados de uso somem; o registro fica anonimizado só para não quebrar pedidos pagos (obrigação fiscal). */
export async function deleteAccount(ctx: Ctx, sessionId: string, subscriberId: string): Promise<void> {
  await ctx.db.tx(async (q) => {
    const maps = await q.query<{ id: string }>(`SELECT id FROM app.cases WHERE owner_subscriber_id = $1 AND status <> 'purged'`, [subscriberId]);
    for (const m of maps.rows) await wipeCase(q, m.id); // o Mapa de quem apaga a conta vai junto
    await q.query(`DELETE FROM app.ledger_entries WHERE subscriber_id = $1`, [subscriberId]);
    await q.query(`DELETE FROM app.budget_limits WHERE subscriber_id = $1`, [subscriberId]);
    await q.query(`DELETE FROM app.goals WHERE subscriber_id = $1`, [subscriberId]);
    await q.query(`DELETE FROM app.subscriptions WHERE subscriber_id = $1`, [subscriberId]);
    const old = await q.query<{ email: string }>(`SELECT email FROM app.subscribers WHERE id = $1`, [subscriberId]);
    if (old.rows[0]) await q.query(`DELETE FROM app.login_codes WHERE email = $1`, [old.rows[0].email]);
    await q.query(`UPDATE app.sessions SET subscriber_id = NULL WHERE subscriber_id = $1`, [subscriberId]);
    await q.query(`UPDATE app.subscribers SET email = 'excluido-' || id::text || '@invalid.local', deleted_at = now() WHERE id = $1`, [subscriberId]);
    await audit(q, `session:${sessionId}`, 'subscriber_deleted', 'subscriber', subscriberId);
  });
}

/** Exige assinatura ativa com o recurso pedido. */
export async function requireFeature(ctx: Ctx, subscriberId: string, feature: Feature): Promise<PlanCode> {
  const a = await accountView(ctx, subscriberId);
  if (!a.subscription?.active) throw new AppError(402, 'subscription_required', 'Assine um plano para usar esta parte.');
  if (!planHas(a.subscription.plan, feature)) throw new AppError(403, 'plan_upgrade', 'Este recurso é de um plano acima do seu.');
  return a.subscription.plan;
}

// ---------------------------------------------------------------------------
// Lançamentos, limites, metas, treinador e simulador
// ---------------------------------------------------------------------------
export interface NewEntry {
  date: string;
  amountCents: number;
  note: string;
  category?: string | undefined;
  source?: 'manual' | 'import' | undefined;
  walletId?: string | null | undefined;
}

export async function addEntries(ctx: Ctx, subscriberId: string, entries: NewEntry[]): Promise<{ added: number; duplicates: number }> {
  await requireFeature(ctx, subscriberId, 'ledger');
  if (entries.length > MAX_ENTRIES_PER_CALL) throw new AppError(422, 'too_many', `Envie até ${MAX_ENTRIES_PER_CALL} lançamentos por vez.`);
  if (entries.some((e) => e.source === 'import')) await requireFeature(ctx, subscriberId, 'import');
  let added = 0;
  let duplicates = 0;
  await ctx.db.tx(async (q) => {
    for (const e of entries) {
      const category = e.category && (await isAllowedCategory(q, subscriberId, e.category)) ? e.category : categorize(e.note, e.amountCents);
      if (e.source === 'import') {
        const dup = await q.query(`SELECT 1 FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on = $2 AND amount_cents = $3 AND note = $4 LIMIT 1`, [subscriberId, e.date, e.amountCents, e.note]);
        if (dup.rows.length > 0) {
          duplicates += 1;
          continue;
        }
      }
      const walletId = e.walletId ? await ownedWalletId({ ...ctx, db: q as never }, subscriberId, e.walletId) : null;
      await q.query(`INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, wallet_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [subscriberId, e.date, e.amountCents, category, e.note.slice(0, 120), e.source ?? 'manual', walletId]);
      added += 1;
    }
  });
  return { added, duplicates };
}

export async function deleteEntry(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  const r = await ctx.db.query(`DELETE FROM app.ledger_entries WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

export async function setEntryCategory(ctx: Ctx, subscriberId: string, id: string, category: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'ledger');
  if (!(await isAllowedCategory(ctx.db, subscriberId, category))) throw new AppError(422, 'invalid_category', 'Categoria inválida');
  const r = await ctx.db.query(`UPDATE app.ledger_entries SET category = $3 WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId, category]);
  if (r.rowCount === 0) throw notFound();
}

async function loadLedger(ctx: Ctx, subscriberId: string, fromDate: string): Promise<LedgerEntry[]> {
  const r = await ctx.db.query<{ id: string; occurred_on: Date | string; amount_cents: string; category: string; note: string }>(
    `SELECT id, occurred_on, amount_cents, category, note FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on >= $2 ORDER BY occurred_on DESC, created_at DESC LIMIT 5000`,
    [subscriberId, fromDate],
  );
  return r.rows.map((x) => ({ id: x.id, date: new Date(x.occurred_on).toISOString().slice(0, 10), amountCents: num(x.amount_cents), category: x.category, note: x.note }));
}

async function loadLimits(ctx: Ctx, subscriberId: string): Promise<Record<string, number>> {
  const r = await ctx.db.query<{ category: string; limit_cents: string }>(`SELECT category, limit_cents FROM app.budget_limits WHERE subscriber_id = $1`, [subscriberId]);
  return Object.fromEntries(r.rows.map((x) => [x.category, num(x.limit_cents)]));
}

const isoDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export async function loadGoals(ctx: Ctx, subscriberId: string): Promise<Goal[]> {
  // total guardado = valor inicial + soma dos aportes (calculado aqui, nunca digitado no navegador)
  const r = await ctx.db.query<{ id: string; name: string; target_cents: string; saved_cents: string; total_cents: string; due_on: Date | string | null; completed_at: Date | string | null }>(
    `SELECT g.id, g.name, g.target_cents, g.saved_cents, g.due_on, g.completed_at,
            g.saved_cents + coalesce((SELECT sum(c.amount_cents) FROM app.goal_contributions c WHERE c.goal_id = g.id), 0) AS total_cents
       FROM app.goals g WHERE g.subscriber_id = $1 ORDER BY g.created_at`,
    [subscriberId],
  );
  const recent = await ctx.db.query<{ id: string; goal_id: string; occurred_on: Date | string; amount_cents: string; note: string }>(
    `SELECT id, goal_id, occurred_on, amount_cents, note FROM (
       SELECT c.*, row_number() OVER (PARTITION BY c.goal_id ORDER BY c.occurred_on DESC, c.created_at DESC) AS rn
         FROM app.goal_contributions c WHERE c.subscriber_id = $1) x
      WHERE rn <= 5 ORDER BY occurred_on DESC`,
    [subscriberId],
  );
  return r.rows.map((g) => ({
    id: g.id,
    name: g.name,
    targetCents: num(g.target_cents),
    savedCents: num(g.total_cents),
    dueOn: g.due_on ? isoDay(g.due_on) : null,
    completedAt: g.completed_at ? new Date(g.completed_at).toISOString() : null,
    contributions: recent.rows.filter((c) => c.goal_id === g.id).map((c) => ({ id: c.id, date: isoDay(c.occurred_on), amountCents: num(c.amount_cents), note: c.note })),
  }));
}

/** Recalcula se a meta está concluída (total ≥ alvo). Guarda o dia em que concluiu; se o total cair, volta a "em andamento". */
async function syncGoalCompletion(q: Queryable, goalId: string): Promise<void> {
  await q.query(
    `UPDATE app.goals g SET completed_at = CASE
        WHEN g.saved_cents + coalesce((SELECT sum(c.amount_cents) FROM app.goal_contributions c WHERE c.goal_id = g.id), 0) >= g.target_cents
        THEN coalesce(g.completed_at, now()) ELSE NULL END
      WHERE g.id = $1`,
    [goalId],
  );
}

const MAX_CONTRIBUTIONS_PER_GOAL = 2000;

export async function addContribution(ctx: Ctx, subscriberId: string, goalId: string, c: { amountCents: number; date?: string | undefined; note?: string | undefined }): Promise<void> {
  await requireFeature(ctx, subscriberId, 'goals');
  await ctx.db.tx(async (q) => {
    const own = await q.query(`SELECT 1 FROM app.goals WHERE id = $1 AND subscriber_id = $2 FOR UPDATE`, [goalId, subscriberId]);
    if (own.rows.length === 0) throw notFound();
    const n = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.goal_contributions WHERE goal_id = $1`, [goalId]);
    if (num(n.rows[0]?.n ?? 0) >= MAX_CONTRIBUTIONS_PER_GOAL) throw new AppError(422, 'too_many', 'Essa meta já tem aportes demais. Crie uma nova meta.');
    await q.query(`INSERT INTO app.goal_contributions(goal_id, subscriber_id, amount_cents, occurred_on, note) VALUES ($1,$2,$3,$4,$5)`, [goalId, subscriberId, c.amountCents, c.date ?? todaySaoPaulo(), (c.note ?? '').slice(0, 120)]);
    await syncGoalCompletion(q, goalId);
  });
}

export async function deleteContribution(ctx: Ctx, subscriberId: string, goalId: string, contributionId: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'goals');
  await ctx.db.tx(async (q) => {
    const r = await q.query(`DELETE FROM app.goal_contributions WHERE id = $1 AND goal_id = $2 AND subscriber_id = $3`, [contributionId, goalId, subscriberId]);
    if (r.rowCount === 0) throw notFound();
    await syncGoalCompletion(q, goalId);
  });
}

export async function monthView(ctx: Ctx, subscriberId: string, month: string) {
  const plan = await requireFeature(ctx, subscriberId, 'ledger');
  if (planHas(plan, 'cards')) await materializeInstallments(ctx, subscriberId); // parcelas do cartão entram no mês certo
  const today = todaySaoPaulo();
  const from = `${monthOf(new Date(Date.parse(`${month}-01T00:00:00Z`) - 62 * 86_400_000).toISOString().slice(0, 10))}-01`; // 2 meses antes, para comparar
  const entries = await loadLedger(ctx, subscriberId, from);
  const limits = { ...(await loadLimits(ctx, subscriberId)), ...(await monthLimits(ctx, subscriberId, month)) };
  const goals = planHas(plan, 'goals') ? await loadGoals(ctx, subscriberId) : [];
  const inMonth = entries.filter((e) => monthOf(e.date) === month);
  type Meta = { id: string; wallet_id: string | null; card_id: string | null; card_name: string | null; installment_no: number | null; installment_total: number | null };
  const metas = inMonth.length
    ? await ctx.db.query<Meta>(
      `SELECT l.id, l.wallet_id, l.card_id, c.name AS card_name, l.installment_no, l.installment_total FROM app.ledger_entries l LEFT JOIN app.credit_cards c ON c.id = l.card_id WHERE l.subscriber_id = $1 AND l.id = ANY($2::uuid[])`,
      [subscriberId, inMonth.map((e) => e.id)],
    )
    : { rows: [] as Meta[] };
  const metaOf = new Map(metas.rows.map((m) => [m.id, m]));
  return {
    month,
    entries: inMonth.map((e) => {
      const m = metaOf.get(e.id as string);
      return { ...e, walletId: m?.wallet_id ?? null, cardId: m?.card_id ?? null, cardName: m?.card_name ?? null, installmentNo: m?.installment_no ?? null, installmentTotal: m?.installment_total ?? null };
    }),
    summary: summarizeMonth(entries, limits, month),
    limits,
    customCategories: await customCategories(ctx.db, subscriberId),
    goals,
    alerts: [...(await walletOverdraftAlerts(ctx, subscriberId)), ...buildAlerts(entries, limits, goals, monthOf(today) === month ? today : `${month}-28`)],
  };
}

/** Categorias próprias da pessoa (as do sistema são fixas e já vêm no site). */
export async function listCategories(ctx: Ctx, subscriberId: string): Promise<{ custom: string[] }> {
  await requireFeature(ctx, subscriberId, 'ledger');
  return { custom: await customCategories(ctx.db, subscriberId) };
}

export async function addCategory(ctx: Ctx, subscriberId: string, name: string): Promise<{ name: string }> {
  await requireFeature(ctx, subscriberId, 'ledger');
  return { name: await createCustomCategory(ctx.db, subscriberId, name) };
}

export async function removeCategory(ctx: Ctx, subscriberId: string, name: string): Promise<{ moved: number }> {
  await requireFeature(ctx, subscriberId, 'ledger');
  return { moved: await deleteCustomCategory(ctx.db, subscriberId, name) };
}

export async function setLimit(ctx: Ctx, subscriberId: string, category: string, limitCents: number | null): Promise<void> {
  await requireFeature(ctx, subscriberId, 'alerts');
  if (category === 'renda' || !(await isAllowedCategory(ctx.db, subscriberId, category))) throw new AppError(422, 'invalid_category', 'Categoria inválida');
  if (limitCents === null) await ctx.db.query(`DELETE FROM app.budget_limits WHERE subscriber_id = $1 AND category = $2`, [subscriberId, category]);
  else await ctx.db.query(`INSERT INTO app.budget_limits(subscriber_id, category, limit_cents) VALUES ($1,$2,$3) ON CONFLICT (subscriber_id, category) DO UPDATE SET limit_cents = EXCLUDED.limit_cents`, [subscriberId, category, limitCents]);
}

export async function saveGoal(ctx: Ctx, subscriberId: string, goal: { id?: string | undefined; name: string; targetCents: number; savedCents: number; dueOn?: string | null | undefined }): Promise<void> {
  await requireFeature(ctx, subscriberId, 'goals');
  if (goal.id) {
    const id = goal.id;
    await ctx.db.tx(async (q) => {
      const r = await q.query(`UPDATE app.goals SET name = $3, target_cents = $4, saved_cents = $5, due_on = $6 WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId, goal.name, goal.targetCents, goal.savedCents, goal.dueOn ?? null]);
      if (r.rowCount === 0) throw notFound();
      await syncGoalCompletion(q, id);
    });
    return;
  }
  const count = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.goals WHERE subscriber_id = $1`, [subscriberId]);
  if (num(count.rows[0]?.n ?? 0) >= 20) throw new AppError(422, 'too_many', 'Limite de 20 metas.');
  await ctx.db.tx(async (q) => {
    const ins = await q.query<{ id: string }>(`INSERT INTO app.goals(subscriber_id, name, target_cents, saved_cents, due_on) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [subscriberId, goal.name, goal.targetCents, goal.savedCents, goal.dueOn ?? null]);
    await syncGoalCompletion(q, ins.rows[0]!.id);
  });
}

export async function deleteGoal(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  await requireFeature(ctx, subscriberId, 'goals');
  const r = await ctx.db.query(`DELETE FROM app.goals WHERE id = $1 AND subscriber_id = $2`, [id, subscriberId]);
  if (r.rowCount === 0) throw notFound();
}

/** Treinador por regras. No Controle sai só o essencial (3 dicas); Ousado e Desbravador veem tudo. */
export async function coach(ctx: Ctx, subscriberId: string) {
  const a = await accountView(ctx, subscriberId);
  if (!a.subscription?.active) throw new AppError(402, 'subscription_required', 'Assine um plano para usar esta parte.');
  const plan = a.subscription.plan;
  if (!planHas(plan, 'coach') && !planHas(plan, 'coach_limited')) throw new AppError(403, 'plan_upgrade', 'Este recurso é de um plano acima do seu.');
  const today = todaySaoPaulo();
  const from = `${monthOf(new Date(Date.parse(`${today}T00:00:00Z`) - 200 * 86_400_000).toISOString().slice(0, 10))}-01`;
  // Cheque especial (LIS) em uso vem primeiro: é o que mais custa.
  const lis = (await walletOverdraftAlerts(ctx, subscriberId)).map((a, i) => ({ id: `lis-${i}`, title: a.title, detail: a.detail }));
  const insights = [...lis, ...coachInsights(await loadLedger(ctx, subscriberId, from), await loadLimits(ctx, subscriberId), today)];
  const full = planHas(plan, 'coach');
  return { insights: full ? insights : insights.slice(0, 3), limited: !full && insights.length > 3 };
}

export interface SimulateArgs {
  initialCents: number;
  monthlyCents: number;
  months: number;
  scenarios: { name: string; annualPct: number }[];
  inflationAnnualPct: number;
}

export async function simulate(ctx: Ctx, subscriberId: string, args: SimulateArgs) {
  await requireFeature(ctx, subscriberId, 'simulator');
  await markMissionDone(ctx, subscriberId, 'i4').catch(() => undefined); // missão do treinador é um extra: nunca derruba a simulação
  return {
    results: simulateInvestment(args),
    notice: 'Simulação educativa com as taxas que você informou. Não é recomendação de investimento nem previsão de resultado. Rendimentos passados e hipóteses não garantem o futuro.',
  };
}

// ---------------------------------------------------------------------------
// Manutenção (worker): expira o que venceu e avisa 3 dias antes de acabar
// ---------------------------------------------------------------------------
let lastMaintenance = 0;

export async function maintenance(ctx: Ctx, opts: { force?: boolean; log?: (e: Record<string, unknown>) => void } = {}): Promise<{ expired: number; reminded: number }> {
  if (!ctx.config.subscriptionsEnabled) return { expired: 0, reminded: 0 };
  if (!opts.force && Date.now() - lastMaintenance < 30 * 60 * 1000) return { expired: 0, reminded: 0 };
  lastMaintenance = Date.now();
  const expired = await ctx.db.query(
    `UPDATE app.subscriptions s SET status = 'expired'
      WHERE s.status = 'active'
        AND s.current_period_end < now() - CASE WHEN EXISTS (SELECT 1 FROM app.billing_profiles b WHERE b.subscriber_id = s.subscriber_id AND b.status IN ('active','past_due')) THEN make_interval(days => ${CARD_GRACE_DAYS}) ELSE interval '0' END`,
  );
  let reminded = 0;
  if (ctx.email) {
    const due = await ctx.db.query<{ id: string; email: string; plan: string; end: Date | string }>(
      `SELECT s.id, b.email, s.plan, s.current_period_end AS end
         FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL
        WHERE s.status = 'active' AND NOT s.cancel_at_period_end AND s.reminded_at IS NULL AND NOT EXISTS (SELECT 1 FROM app.billing_profiles bp WHERE bp.subscriber_id = s.subscriber_id) AND s.current_period_end < now() + make_interval(days => $1)`,
      [ctx.config.reminderDaysBefore],
    );
    for (const s of due.rows) {
      const name = planByCode(s.plan)?.name ?? s.plan;
      const body = layout(`Seu plano ${name} vence em breve`, [`Seu acesso vai até ${new Date(s.end).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Para continuar, é só gerar um novo Pix na sua conta. Nada é cobrado sozinho.`, 'Se não quiser continuar, não precisa fazer nada.'], { label: 'Abrir minha conta', url: `${ctx.config.publicUrl}/conta` });
      try {
        await ctx.email.send({ to: s.email, subject: `Seu plano ${name} vence em breve`, ...body });
        await ctx.db.query(`UPDATE app.subscriptions SET reminded_at = now() WHERE id = $1`, [s.id]);
        reminded += 1;
      } catch {
        opts.log?.({ evento: 'lembrete_falhou' });
      }
    }
  }
  return { expired: expired.rowCount, reminded };
}
