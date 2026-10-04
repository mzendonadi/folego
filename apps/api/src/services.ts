import { GUIDED_CODES, GUIDED_PRODUCT, buildGuided, guidedKindOfCode } from './guided.ts';
import type { GuidedKind } from './guided.ts';
import { onSubscriptionPaid } from './referrals.ts';
import { handleBillingEvent, registerRenewal } from './billing.ts';
import type { Config } from './config.ts';
import type { Db, Queryable } from './db.ts';
import type { PaymentGateway } from './gateway.ts';
import { layout } from './email.ts';
import { activateSubscription } from './subscriptions.ts';
import { leadState, leadDocumentId } from './leads.ts';
import type { LeadState } from './leads.ts';
import type { EmailSender } from './email.ts';
import type { CreateCaseInput, IncomeInterviewInput } from './schemas.ts';
import { diagnose, buildPreview, buildCalendar, buildStrategies, buildIncomeFacts, analyzeCollectionText, buildTranslatorPreview } from './engine.ts';
import type { DebtInput, Diagnosis, Preview, CalendarItem, Profile, Strategies, EmploymentType, TranslatorAnalysis, TranslatorPreview } from './engine.ts';
import { encryptText, hmac, newToken, sha256 } from './crypto.ts';
import { AppError, notFound } from './errors.ts';

export interface Ctx {
  db: Db;
  config: Config;
  gateway: PaymentGateway;
  /** Ausente = e-mail desligado. */
  email?: EmailSender;
  /** Ausente = contas conectadas (Open Finance) desligadas. */
  openFinance?: import('./openfinance.ts').OpenFinanceProvider;
}

export const TERMS_VERSION = 'minuta-2026-09-26';
const PIX_TTL_MS = 30 * 60 * 1000;

export const num = (v: unknown): number => Number(v);

/** Data de hoje no fuso de São Paulo. O relógio é do servidor: o cliente nunca define "hoje". */
export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export async function audit(q: Queryable, actor: string, action: string, entity: string, entityId: string, data: Record<string, unknown> = {}) {
  await q.query(`INSERT INTO app.audit_log(actor, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5::jsonb)`, [actor, action, entity, entityId, JSON.stringify(data)]);
}

// ---------------------------------------------------------------------------
// Sessão anônima
// ---------------------------------------------------------------------------
export async function resolveSession(ctx: Ctx, token: string | undefined, ipHash: Buffer | null): Promise<{ sessionId: string; newToken: string | null }> {
  if (token) {
    const found = await ctx.db.query<{ id: string }>(`SELECT id FROM app.sessions WHERE token_hash = $1 AND expires_at > now()`, [sha256(token)]);
    const row = found.rows[0];
    if (row) {
      await ctx.db.query(`UPDATE app.sessions SET last_seen_at = now() WHERE id = $1`, [row.id]);
      return { sessionId: row.id, newToken: null };
    }
  }
  const fresh = newToken();
  const created = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.sessions(token_hash, ip_hash, expires_at) VALUES ($1, $2, now() + interval '30 days') RETURNING id`,
    [sha256(fresh), ipHash],
  );
  const row = created.rows[0];
  if (!row) throw new Error('falha ao criar sessão');
  return { sessionId: row.id, newToken: fresh };
}

/** Só procura; nunca cria. Usado nas leituras, para não gerar sessões à toa. */
export async function findSession(ctx: Ctx, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const found = await ctx.db.query<{ id: string }>(`SELECT id FROM app.sessions WHERE token_hash = $1 AND expires_at > now()`, [sha256(token)]);
  return found.rows[0]?.id ?? null;
}

/** Quem pode abrir o caso: a sessão que o criou OU uma que abriu o link de acesso (vários aparelhos ao mesmo tempo). */
export const caseOf = (c: string, p: string) => `(${c}.session_id = ${p} OR EXISTS (SELECT 1 FROM app.case_access ca WHERE ca.case_id = ${c}.id AND ca.session_id = ${p}))`;
/** O mesmo para um pedido (o pedido é do caso). */
export const orderOf = (o: string, p: string) => `(${o}.session_id = ${p} OR EXISTS (SELECT 1 FROM app.case_access ca WHERE ca.case_id = ${o}.case_id AND ca.session_id = ${p}))`;

export async function ownedCase(q: Queryable, sessionId: string, caseId: string): Promise<void> {
  const r = await q.query(`SELECT 1 FROM app.cases c WHERE c.id = $1 AND ${caseOf('c', '$2')} AND c.status <> 'purged'`, [caseId, sessionId]);
  if (r.rows.length === 0) throw notFound();
}

// ---------------------------------------------------------------------------
// Caso e preview
// ---------------------------------------------------------------------------
async function termsDocumentId(q: Queryable): Promise<string> {
  await q.query(
    `INSERT INTO app.legal_documents(kind, version, content_sha256) VALUES ('terms', $1, $2) ON CONFLICT (kind, version) DO NOTHING`,
    [TERMS_VERSION, sha256(TERMS_VERSION)],
  );
  const r = await q.query<{ id: string }>(`SELECT id FROM app.legal_documents WHERE kind = 'terms' AND version = $1`, [TERMS_VERSION]);
  const row = r.rows[0];
  if (!row) throw new Error('documento legal não encontrado');
  return row.id;
}

export async function createCase(ctx: Ctx, args: { sessionId: string; ipHash: Buffer | null; input: CreateCaseInput; userAgent: string | null }): Promise<{ caseId: string; preview: Preview }> {
  const { input } = args;
  const debts: DebtInput[] = input.debts.map((d, i) => ({ id: `d${i + 1}`, ...d }));
  const { employmentNote, ...engineProfile } = input.profile; // a observação é só descritiva: não entra no cálculo
  const engineInput = { asOf: todaySaoPaulo(), profile: engineProfile, debts };
  const diagnosis = diagnose(engineInput);
  const preview = buildPreview(diagnosis, debts);

  const caseId = await ctx.db.tx(async (q) => {
    const created = await q.query<{ id: string }>(
      `INSERT INTO app.cases(session_id, status, employment_type, net_income_cents, fixed_expenses_cents, age_band, uf, inputs, purge_after, debt_total_cents, debt_count, has_overdue, debt_kinds)
       VALUES ($1, 'previewed', $2, $3, $4, $5, $6, $7::jsonb, now() + interval '7 days', $8, $9, $10, $11) RETURNING id`,
      [args.sessionId, input.profile.employmentType, input.profile.netIncomeCents, input.profile.fixedExpensesCents, input.profile.ageBand, input.profile.uf, JSON.stringify({ asOf: engineInput.asOf, debts, ...(employmentNote && input.profile.employmentType === 'other' ? { employmentNote } : {}) }), debts.reduce((s, x) => s + x.balanceCents, 0), debts.length, debts.some((x) => x.daysOverdue > 0), [...new Set(debts.map((x) => x.kind))]],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('falha ao criar caso');
    for (const d of debts) {
      await q.query(
        `INSERT INTO app.debts(case_id, creditor_name, kind, balance_cents, monthly_payment_cents, remaining_installments, monthly_rate_bps, days_overdue, first_default_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, d.creditorName, d.kind, d.balanceCents, d.monthlyPaymentCents ?? null, d.remainingInstallments ?? null, d.monthlyRateBps ?? null, d.daysOverdue, d.firstDefaultOn ?? null],
      );
    }
    await q.query(`INSERT INTO app.diagnoses(case_id, engine_version, preview) VALUES ($1, $2, $3::jsonb)`, [id, diagnosis.engineVersion, JSON.stringify(preview)]);
    // Conteúdo completo fica no servidor, em tabela separada, e só sai com direito de acesso (entitlement).
    await q.query(`INSERT INTO app.deliverables(case_id, product_code, status, content) VALUES ($1, 'recovery_map', 'pending', $2::jsonb)`, [id, JSON.stringify(diagnosis)]);
    const docId = await termsDocumentId(q);
    await q.query(
      `INSERT INTO app.consents(case_id, legal_document_id, purpose, action, ip_hash, user_agent) VALUES ($1, $2, 'terms_of_service', 'grant', $3, $4)`,
      [id, docId, args.ipHash, args.userAgent ? args.userAgent.slice(0, 300) : null],
    );
    await audit(q, `session:${args.sessionId}`, 'case_created', 'case', id, { debts: debts.length });
    return id;
  });

  return { caseId, preview };
}

export async function getPreview(ctx: Ctx, sessionId: string, caseId: string): Promise<Preview> {
  const r = await ctx.db.query<{ preview: Preview }>(
    `SELECT d.preview FROM app.diagnoses d JOIN app.cases c ON c.id = d.case_id WHERE c.id = $1 AND ${caseOf('c', '$2')} AND c.status <> 'purged'`,
    [caseId, sessionId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  return row.preview;
}

// ---------------------------------------------------------------------------
// Pedido e Pix
// ---------------------------------------------------------------------------
export interface OrderView {
  orderId: string;
  totalCents: number;
  items: string[];
  expiresAt: number;
  pixCode: string;
  status: string;
}

export async function orderView(q: Queryable, orderId: string): Promise<OrderView> {
  const o = await q.query<{ total_cents: string; status: string; pix_copy_paste: string; pix_expires_at: Date | string }>(
    `SELECT o.total_cents, o.status, p.pix_copy_paste, p.pix_expires_at FROM app.orders o JOIN app.payments p ON p.order_id = o.id WHERE o.id = $1 ORDER BY p.created_at DESC LIMIT 1`,
    [orderId],
  );
  const row = o.rows[0];
  if (!row) throw notFound();
  const items = await q.query<{ product_code: string }>(`SELECT product_code FROM app.order_items WHERE order_id = $1 ORDER BY product_code`, [orderId]);
  return {
    orderId,
    totalCents: num(row.total_cents),
    items: items.rows.map((i) => i.product_code),
    expiresAt: new Date(row.pix_expires_at).getTime(),
    pixCode: row.pix_copy_paste,
    status: row.status,
  };
}

export const OFFERABLE = ['recovery_map', 'defense_letters', 'calendar_30d', 'extra_income_plan', 'collection_translator', ...GUIDED_CODES] as const;
/** Preço fechado do Kit Completo (Mapa + Cartas + Calendário comprados juntos). O desconto é calculado aqui, nunca no navegador. */
export const BUNDLE_PRICE_CENTS = 5990;

export async function createOrder(ctx: Ctx, args: { sessionId: string; caseId: string; products: string[]; idempotencyKey: string }): Promise<OrderView> {
  await ownedCase(ctx.db, args.sessionId, args.caseId);

  const existing = await ctx.db.query<{ id: string }>(`SELECT id FROM app.orders WHERE session_id = $1 AND idempotency_key = $2`, [args.sessionId, args.idempotencyKey]);
  if (existing.rows[0]) return orderView(ctx.db, existing.rows[0].id);

  const codes = [...new Set(args.products)];
  if (codes.length === 0 || codes.some((c) => !(OFFERABLE as readonly string[]).includes(c))) throw new AppError(422, 'invalid_products', 'Produto inválido');
  const kindRow = await ctx.db.query<{ kind: string | null }>(`SELECT inputs->>'kind' AS kind FROM app.cases WHERE id = $1`, [args.caseId]);
  // Atendimentos próprios (tradutor e guias): o caso só vende o produto dele; os outros casos não vendem esses produtos.
  const caseKind = kindRow.rows[0]?.kind ?? null;
  const standaloneCode = caseKind === 'translator' ? 'collection_translator' : caseKind?.startsWith('guided:') ? (GUIDED_PRODUCT[caseKind.slice(7) as GuidedKind] ?? null) : null;
  const isTranslator = standaloneCode !== null;
  const isStandaloneCode = (c: string) => c === 'collection_translator' || GUIDED_CODES.includes(c);
  if (standaloneCode !== null ? !(codes.length === 1 && codes[0] === standaloneCode) : codes.some(isStandaloneCode)) throw new AppError(422, 'invalid_products', 'Este produto não se aplica a este atendimento');
  const ownedRows = await ctx.db.query<{ product_code: string }>(`SELECT product_code FROM app.entitlements WHERE case_id = $1 AND expires_at > now()`, [args.caseId]);
  const owned = new Set(ownedRows.rows.map((r) => r.product_code));
  if (codes.includes('recovery_map') && owned.has('recovery_map')) throw new AppError(409, 'already_paid', 'O Mapa deste diagnóstico já foi pago');
  if (!isTranslator && !codes.includes('recovery_map') && !owned.has('recovery_map')) throw new AppError(422, 'map_required', 'Os complementos são vendidos depois do Mapa');
  if (codes.some((c) => owned.has(c))) throw new AppError(409, 'already_owned', 'Você já tem este item');

  if (codes.includes('defense_letters')) {
    // Calculado dos dados do próprio caso (não do preview gravado, que em casos antigos não tem o campo novo).
    const c = await ctx.db.query<{ inputs: { debts?: DebtInput[] }; diagnosis: Diagnosis | null }>(
      `SELECT c.inputs, (SELECT d.content FROM app.deliverables d WHERE d.case_id = c.id AND d.product_code = 'recovery_map') AS diagnosis FROM app.cases c WHERE c.id = $1`,
      [args.caseId],
    );
    const debts = c.rows[0]?.inputs.debts ?? [];
    const held = new Set(c.rows[0]?.diagnosis?.heldAsideIds ?? []);
    const eligible = debts.filter((d) => d.daysOverdue > 0 || held.has(d.id)).length;
    if (eligible === 0) throw new AppError(422, 'not_applicable', 'As cartas só são oferecidas quando há dívida em atraso ou possivelmente prescrita');
  }

  if (ctx.config.salesPaused) throw new AppError(503, 'sales_paused', 'As vendas estão pausadas por um instante. Tente novamente em alguns minutos.');
  const marks = codes.map((_, i) => `$${i + 1}`).join(',');
  const products = await ctx.db.query<{ code: string; price_cents: string }>(`SELECT code, price_cents FROM app.products WHERE active AND code IN (${marks})`, codes);
  if (products.rows.length !== codes.length) throw new AppError(422, 'product_unavailable', 'Este item não está disponível no momento.');
  const prices = new Map(products.rows.map((p) => [p.code, num(p.price_cents)]));
  const isBundle = ['recovery_map', 'defense_letters', 'calendar_30d'].every((c) => codes.includes(c));
  if (isBundle) {
    const sum = prices.get('recovery_map')! + prices.get('defense_letters')! + prices.get('calendar_30d')!;
    const discount = Math.max(0, sum - ctx.config.bundlePriceCents);
    prices.set('calendar_30d', Math.max(0, prices.get('calendar_30d')! - discount)); // o desconto fica no item mais barato do combo
  }
  const totalCents = [...prices.values()].reduce((s, v) => s + v, 0);

  const expiresAt = new Date(Date.now() + PIX_TTL_MS);
  const orderId = await ctx.db.tx(async (q) => {
    const created = await q.query<{ id: string }>(
      `INSERT INTO app.orders(case_id, session_id, status, total_cents, idempotency_key) VALUES ($1,$2,'pending',$3,$4) ON CONFLICT (session_id, idempotency_key) DO NOTHING RETURNING id`,
      [args.caseId, args.sessionId, totalCents, args.idempotencyKey],
    );
    const id = created.rows[0]?.id;
    if (!id) {
      const again = await q.query<{ id: string }>(`SELECT id FROM app.orders WHERE session_id = $1 AND idempotency_key = $2`, [args.sessionId, args.idempotencyKey]);
      const found = again.rows[0]?.id;
      if (!found) throw new Error('falha ao criar pedido');
      return found;
    }
    for (const [code, price] of prices) {
      await q.query(`INSERT INTO app.order_items(order_id, product_code, unit_price_cents) VALUES ($1,$2,$3)`, [id, code, price]);
    }
    const charge = await ctx.gateway.createPix({ orderId: id, amountCents: totalCents, expiresAt });
    await q.query(
      `INSERT INTO app.payments(order_id, provider, provider_payment_id, method, amount_cents, status, pix_copy_paste, pix_expires_at) VALUES ($1,$2,$3,'pix',$4,'pending',$5,$6)`,
      [id, ctx.gateway.name, charge.providerPaymentId, totalCents, charge.pixCopyPaste, charge.expiresAt.toISOString()],
    );
    await audit(q, `session:${args.sessionId}`, 'order_created', 'order', id, { totalCents, items: codes });
    return id;
  });
  return orderView(ctx.db, orderId);
}

export async function getOrder(ctx: Ctx, sessionId: string, orderId: string): Promise<{ status: string; totalCents: number }> {
  const r = await ctx.db.query<{ status: string; total_cents: string; pix_expires_at: Date | string }>(
    `SELECT o.status, o.total_cents, p.pix_expires_at FROM app.orders o JOIN app.payments p ON p.order_id = o.id WHERE o.id = $1 AND ${orderOf('o', '$2')} ORDER BY p.created_at DESC LIMIT 1`,
    [orderId, sessionId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  let status = row.status;
  if (status === 'pending' && new Date(row.pix_expires_at).getTime() < Date.now()) {
    await ctx.db.query(`UPDATE app.orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [orderId]);
    await ctx.db.query(`UPDATE app.payments SET status = 'expired' WHERE order_id = $1 AND status = 'pending'`, [orderId]);
    status = 'expired';
  }
  return { status, totalCents: num(row.total_cents) };
}

// ---------------------------------------------------------------------------
// Webhook do gateway → liberação (idempotente)
// ---------------------------------------------------------------------------
export type WebhookOutcome = 'invalid_signature' | 'duplicate' | 'ignored' | 'confirmed' | 'already_confirmed';

export async function handleWebhook(ctx: Ctx, headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookOutcome> {
  const parsed = ctx.gateway.parseWebhook(headers, body);
  if (parsed.kind === 'invalid') return 'invalid_signature';
  if (parsed.kind === 'ignore') return 'ignored';
  if (parsed.kind === 'billing') return handleBillingEvent(ctx, parsed.event);
  const event = parsed.event;

  const inserted = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.payment_events(provider, provider_event_id, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`,
    [ctx.gateway.name, event.providerEventId, JSON.stringify(body ?? {})],
  );
  let eventId = inserted.rows[0]?.id;
  if (!eventId) {
    // Já vimos este evento. Só é duplicata se ele foi RESOLVIDO; se a tentativa anterior falhou no meio
    // (ex.: o provedor estava fora do ar), a retentativa do provedor precisa ser processada de novo.
    const seen = await ctx.db.query<{ id: string; processed_at: Date | string | null }>(
      `SELECT id, processed_at FROM app.payment_events WHERE provider = $1 AND provider_event_id = $2`,
      [ctx.gateway.name, event.providerEventId],
    );
    const row = seen.rows[0];
    if (!row || row.processed_at) return 'duplicate';
    eventId = row.id;
  }

  // Não confiamos no corpo do webhook: perguntamos ao provedor e conferimos o VALOR pago.
  const known = await ctx.db.query<{ amount_cents: string }>(`SELECT amount_cents FROM app.payments WHERE provider = $1 AND provider_payment_id = $2`, [ctx.gateway.name, event.providerPaymentId]);
  let expected: { amount_cents: string } | undefined = known.rows[0];
  if (!expected && event.providerSubscriptionId) {
    // Mensalidade nova de uma assinatura no cartão: o provedor avisa e nós registramos a cobrança.
    const value = await registerRenewal(ctx, event);
    if (value) expected = { amount_cents: String(value) };
  }
  let outcome: WebhookOutcome = 'ignored';
  if (expected) {
    const status = await ctx.gateway.getPaymentStatus(event.providerPaymentId, num(expected.amount_cents));
    if (status === 'confirmed') outcome = await confirmPayment(ctx, event.providerPaymentId);
  }
  // Resolvido = confirmamos o pagamento, ou ele não é nosso. Se ainda consta pendente no provedor, deixamos em aberto.
  if (outcome !== 'ignored' || !expected) {
    await ctx.db.query(`UPDATE app.payment_events SET processed_at = now() WHERE id = $1`, [eventId]);
  }
  return outcome;
}

async function confirmPayment(ctx: Ctx, providerPaymentId: string): Promise<WebhookOutcome> {
  return ctx.db.tx(async (q) => {
    const p = await q.query<{ id: string; status: string; order_id: string; case_id: string | null; subscriber_id: string | null }>(
      `SELECT p.id, p.status, p.order_id, o.case_id, o.subscriber_id FROM app.payments p JOIN app.orders o ON o.id = p.order_id WHERE p.provider = $1 AND p.provider_payment_id = $2 FOR UPDATE OF p`,
      [ctx.gateway.name, providerPaymentId],
    );
    const pay = p.rows[0];
    if (!pay) return 'ignored';
    if (pay.status === 'confirmed') return 'already_confirmed';

    await q.query(`UPDATE app.payments SET status = 'confirmed', confirmed_at = now() WHERE id = $1`, [pay.id]);
    await q.query(`UPDATE app.orders SET status = 'paid', paid_at = now() WHERE id = $1`, [pay.order_id]);

    if (pay.subscriber_id) {
      // Pedido de assinatura: não tem caso, entregáveis nem entitlements. Ativa o período no próprio app.subscriptions.
      await activateSubscription(q, pay.subscriber_id, pay.order_id);
      const paidRow = await q.query<{ amount_cents: string }>(`SELECT amount_cents FROM app.payments WHERE id = $1`, [pay.id]);
      await onSubscriptionPaid(ctx, q, pay.subscriber_id, { id: pay.id, amountCents: num(paidRow.rows[0]?.amount_cents ?? 0) });
      await audit(q, 'system', 'payment_confirmed', 'order', pay.order_id, { provider: ctx.gateway.name, kind: 'subscription' });
      return 'confirmed';
    }

    await q.query(
      `INSERT INTO app.entitlements(case_id, product_code, order_id, expires_at)
       SELECT $1, oi.product_code, oi.order_id, now() + make_interval(days => pr.access_days)
       FROM app.order_items oi JOIN app.products pr ON pr.code = oi.product_code WHERE oi.order_id = $2
       ON CONFLICT (case_id, product_code) DO NOTHING`,
      [pay.case_id, pay.order_id],
    );
    await q.query(`UPDATE app.deliverables SET status = 'ready', generated_at = now() WHERE case_id = $1 AND (product_code IN ('recovery_map', 'collection_translator') OR product_code LIKE 'guide\\_%')`, [pay.case_id]);
    // Os roteiros de negociação fazem parte do Mapa (D-017): entram na fila do worker assim que o pagamento do Mapa é confirmado.
    await q.query(
      `INSERT INTO app.deliverables(case_id, product_code, status) SELECT $1, 'negotiation_scripts', 'pending' WHERE EXISTS (SELECT 1 FROM app.order_items WHERE order_id = $2 AND product_code = 'recovery_map') ON CONFLICT (case_id, product_code) DO NOTHING`,
      [pay.case_id, pay.order_id],
    );
    await q.query(
      `INSERT INTO app.deliverables(case_id, product_code, status)
       SELECT $1, oi.product_code, 'pending' FROM app.order_items oi WHERE oi.order_id = $2 AND oi.product_code = 'defense_letters'
       ON CONFLICT (case_id, product_code) DO NOTHING`,
      [pay.case_id, pay.order_id],
    );
    await q.query(`UPDATE app.cases SET status = 'paid', purge_after = now() + interval '30 days' WHERE id = $1`, [pay.case_id]);
    await audit(q, 'system', 'payment_confirmed', 'order', pay.order_id, { provider: ctx.gateway.name });
    return 'confirmed';
  });
}

// ---------------------------------------------------------------------------
// Entrega (conteúdo pago)
// ---------------------------------------------------------------------------
export interface Delivery {
  generated: Record<string, { status: string; source: string | null; content: unknown; progress?: Record<string, boolean> }>;
  input: { asOf: string; profile: Record<string, unknown>; debts: DebtInput[] };
  diagnosis: Diagnosis;
  items: string[];
  /** Complementos calculados no servidor SÓ para quem tem o direito ativo. */
  extras: { calendar?: CalendarItem[] };
  /** Estratégias do Mapa (comparação, plano mês a mês, marcos, roteiro). Calculadas na hora, a partir dos dados do caso. */
  strategies: Strategies | null;
  /** Até quando o Mapa está liberado (ms). */
  accessUntil: number;
  /** Quantas dívidas comportam cartas (em atraso ou possivelmente prescritas): decide se o Kit é oferecido. */
  lettersEligible: number;
  /** Propostas de parceiros (só se ligado neste servidor). */
  leads: LeadState;
}

export async function getDelivery(ctx: Ctx, sessionId: string, orderId: string): Promise<Delivery> {
  const o = await ctx.db.query<{ status: string; case_id: string }>(`SELECT status, case_id FROM app.orders o WHERE o.id = $1 AND ${orderOf('o', '$2')}`, [orderId, sessionId]);
  const order = o.rows[0];
  if (!order) throw notFound();
  if (order.status !== 'paid') throw new AppError(402, 'payment_required', 'Pagamento ainda não confirmado');

  const ent = await ctx.db.query<{ expires_at: Date | string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'recovery_map' AND expires_at > now()`, [order.case_id]);
  if (ent.rows.length === 0) throw new AppError(403, 'access_expired', 'O acesso a este Mapa expirou');

  const content = await ctx.db.query<{ content: Diagnosis }>(`SELECT content FROM app.deliverables WHERE case_id = $1 AND product_code = 'recovery_map' AND status = 'ready'`, [order.case_id]);
  const diagnosis = content.rows[0]?.content;
  if (!diagnosis) throw new AppError(409, 'not_ready', 'O Mapa ainda está sendo preparado');

  const c = await ctx.db.query<{ inputs: { asOf: string; debts: DebtInput[] }; employment_type: string; net_income_cents: string; fixed_expenses_cents: string; age_band: string; uf: string }>(
    `SELECT inputs, employment_type, net_income_cents, fixed_expenses_cents, age_band, uf FROM app.cases WHERE id = $1`,
    [order.case_id],
  );
  const cr = c.rows[0];
  if (!cr) throw notFound();
  // Itens = tudo o que este diagnóstico tem direito de ver (o Mapa e os complementos comprados depois).
  const items = await ctx.db.query<{ product_code: string }>(`SELECT product_code FROM app.entitlements WHERE case_id = $1 AND expires_at > now() ORDER BY product_code`, [order.case_id]);
  const has = new Set(items.rows.map((i) => i.product_code));
  const extras: Delivery['extras'] = {};
  // Recalculadas a cada leitura (função pura do motor): casos antigos também recebem, sem migrar nada.
  let strategies: Strategies | null = null;
  try {
    strategies = buildStrategies(
      { asOf: cr.inputs.asOf, profile: { netIncomeCents: num(cr.net_income_cents), fixedExpensesCents: num(cr.fixed_expenses_cents), employmentType: cr.employment_type as EmploymentType, ageBand: cr.age_band, uf: cr.uf }, debts: cr.inputs.debts },
      undefined,
      diagnosis,
    );
  } catch {
    strategies = null; // o Mapa nunca deixa de abrir por causa das estratégias
  }
  if (has.has('calendar_30d')) extras.calendar = buildCalendar(diagnosis, cr.inputs.debts, strategies ?? undefined);

  // Acesso vale por 30 dias contados do último acesso (documento oficial, §6.4).
  await ctx.db.query(`UPDATE app.cases SET status = 'delivered', purge_after = GREATEST(purge_after, now() + interval '30 days') WHERE id = $1`, [order.case_id]);

  // Entregáveis gerados em segundo plano (roteiros, cartas e o plano de renda extra): o front-end consulta
  // até ficarem prontos. O plano de renda extra só entra na fila quando a entrevista é enviada (ver
  // submitIncomeInterview) — sem entrevista ainda, mostramos 'needs_interview' mesmo sem linha na tabela.
  const extra = await ctx.db.query<{ product_code: string; status: string; content: unknown; generation_meta: { source?: string; progress?: Record<string, boolean> } | null }>(
    `SELECT product_code, status, content, generation_meta FROM app.deliverables WHERE case_id = $1 AND product_code IN ('negotiation_scripts', 'defense_letters', 'extra_income_plan')`,
    [order.case_id],
  );
  const generated: Record<string, { status: string; source: string | null; content: unknown; progress?: Record<string, boolean> }> = {};
  const KEY: Record<string, string> = { negotiation_scripts: 'scripts', defense_letters: 'letters', extra_income_plan: 'income' };
  for (const e of extra.rows) {
    generated[KEY[e.product_code] ?? e.product_code] = {
      status: e.status,
      source: e.generation_meta?.source ?? null,
      content: e.status === 'ready' ? e.content : null,
      ...(e.product_code === 'extra_income_plan' ? { progress: e.generation_meta?.progress ?? {} } : {}),
    };
  }
  if (has.has('extra_income_plan') && !generated.income) generated.income = { status: 'needs_interview', source: null, content: null };

  return {
    generated,
    input: {
      asOf: cr.inputs.asOf,
      profile: { netIncomeCents: num(cr.net_income_cents), fixedExpensesCents: num(cr.fixed_expenses_cents), employmentType: cr.employment_type, ageBand: cr.age_band, uf: cr.uf },
      debts: cr.inputs.debts,
    },
    diagnosis,
    items: items.rows.map((i) => i.product_code),
    extras,
    strategies,
    accessUntil: new Date(ent.rows[0]!.expires_at).getTime(),
    lettersEligible: cr.inputs.debts.filter((d) => d.daysOverdue > 0 || diagnosis.heldAsideIds.includes(d.id)).length,
    leads: await leadState(ctx, order.case_id, diagnosis, cr.inputs.debts),
  };
}

// ---------------------------------------------------------------------------
// Renda extra: entrevista pós-compra (dispara a geração) e progresso das semanas.
// O contato (nome/telefone/e-mail) é capturado sempre, criptografado — é o que permite reabrir o link de
// acesso e, mais adiante, mandar lembretes. A autorização para repassar a parceiros de capacitação
// (SEBRAE, escolas técnicas etc., NENHUM ainda cadastrado) é um consentimento SEPARADO e opcional: reaproveita
// a mesma infraestrutura de leads (app.consents, categoria 'empreendedorismo') que já entrega a parceiros
// reais quando eles existirem — nenhum código de entrega novo será necessário nesse dia.
// ---------------------------------------------------------------------------
export async function submitIncomeInterview(ctx: Ctx, sessionId: string, caseId: string, args: { input: IncomeInterviewInput; ipHash: Buffer | null; userAgent: string | null }): Promise<void> {
  await ownedCase(ctx.db, sessionId, caseId);
  const ent = await ctx.db.query(`SELECT 1 FROM app.entitlements WHERE case_id = $1 AND product_code = 'extra_income_plan' AND expires_at > now()`, [caseId]);
  if (ent.rows.length === 0) throw new AppError(403, 'no_access', 'Disponível só depois de comprar o Criador de Renda Extra');

  const { input } = args;
  await ctx.db.tx(async (q) => {
    await q.query(
      `INSERT INTO app.income_interviews(case_id, skills, hours_band, capital_cents, has_vehicle, mode, prior_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (case_id) DO UPDATE SET skills = EXCLUDED.skills, hours_band = EXCLUDED.hours_band, capital_cents = EXCLUDED.capital_cents,
         has_vehicle = EXCLUDED.has_vehicle, mode = EXCLUDED.mode, prior_attempts = EXCLUDED.prior_attempts`,
      [caseId, input.skills, input.hoursBand, input.capitalCents, input.hasVehicle, input.mode, input.priorAttempts ?? ''],
    );
    const secret = ctx.config.secret;
    await q.query(
      `INSERT INTO app.lead_contacts(case_id, full_name_enc, phone_enc, email_enc, phone_hmac) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (case_id) DO UPDATE SET full_name_enc = EXCLUDED.full_name_enc, phone_enc = EXCLUDED.phone_enc, email_enc = EXCLUDED.email_enc, phone_hmac = EXCLUDED.phone_hmac`,
      [caseId, encryptText(secret, input.name.trim()), encryptText(secret, input.phone.trim()), input.email ? encryptText(secret, input.email.trim().toLowerCase()) : null, hmac(secret, `phone:${input.phone.trim()}`)],
    );
    if (input.wantsPartnerContact) {
      const docId = await leadDocumentId(ctx, q as Ctx['db']);
      await q.query(
        `INSERT INTO app.consents(case_id, legal_document_id, purpose, action, scope, ip_hash, user_agent) VALUES ($1,$2,'lead_sharing','grant',$3::jsonb,$4,$5)`,
        [caseId, docId, JSON.stringify({ categories: ['empreendedorismo'] }), args.ipHash, args.userAgent ? args.userAgent.slice(0, 300) : null],
      );
    }
    // (Re)inicia a geração: uma nova entrevista sempre refaz o plano do zero.
    await q.query(
      `INSERT INTO app.deliverables(case_id, product_code, status, content, generation_meta) VALUES ($1,'extra_income_plan','pending',NULL,'{}'::jsonb)
       ON CONFLICT (case_id, product_code) DO UPDATE SET status = 'pending', content = NULL, generation_meta = '{}'::jsonb, updated_at = now()`,
      [caseId],
    );
    await audit(q, `session:${sessionId}`, 'income_interview_submitted', 'case', caseId, { wantsPartnerContact: input.wantsPartnerContact });
  });
}

export async function toggleIncomeTask(ctx: Ctx, sessionId: string, caseId: string, taskKey: string, done: boolean): Promise<void> {
  await ownedCase(ctx.db, sessionId, caseId);
  if (!/^w[1-4]t\d{1,2}$/.test(taskKey)) throw new AppError(422, 'invalid_key', 'Chave de tarefa inválida');
  const r = await ctx.db.query(
    `UPDATE app.deliverables SET generation_meta = jsonb_set(coalesce(generation_meta, '{}'::jsonb), '{progress}', coalesce(generation_meta->'progress', '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean))
      WHERE case_id = $1 AND product_code = 'extra_income_plan' AND status = 'ready'`,
    [caseId, taskKey, done],
  );
  if (r.rowCount === 0) throw notFound();
}

// ---------------------------------------------------------------------------
// Apagar
// ---------------------------------------------------------------------------
export async function deleteCase(ctx: Ctx, sessionId: string, caseId: string): Promise<void> {
  await ctx.db.tx(async (q) => {
    await ownedCase(q, sessionId, caseId);
    for (const table of ['debts', 'deliverables', 'diagnoses', 'lead_contacts', 'lead_profiles', 'access_tokens', 'entitlements', 'case_access']) {
      await q.query(`DELETE FROM app.${table} WHERE case_id = $1`, [caseId]);
    }
    await q.query(`UPDATE app.cases SET status = 'purged', inputs = '{}'::jsonb, purged_at = now() WHERE id = $1`, [caseId]);
    await audit(q, `session:${sessionId}`, 'case_deleted_by_user', 'case', caseId);
  });
}

/** Expurgo por prazo (função SQL do schema). Chamado por um agendador. */
export async function purgeExpired(ctx: Ctx, limit = 500): Promise<number> {
  const r = await ctx.db.query<{ n: number }>(`SELECT app.purge_expired_cases($1) AS n`, [limit]);
  return num(r.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Voltar ao Mapa sem cadastro nem senha
//  - Mesmo navegador: o cookie de sessão acha o pedido pago (GET /api/me).
//  - Outro aparelho ou cookie apagado: LINK DE ACESSO (token aleatório de 256 bits; só o hash fica no banco).
// O caso é a "conta". Abrir o link dá acesso ao aparelho de quem abriu SEM tirar o dos outros (até 5 aparelhos).
// ---------------------------------------------------------------------------
export type AccessKind = 'map' | 'translator' | 'guided';
export interface AccessInfo {
  caseId: string;
  orderId: string;
  kind: AccessKind;
  expiresAt: number;
}
const BASE_PRODUCT: Record<AccessKind, string> = { map: 'recovery_map', translator: 'collection_translator', guided: 'guide\\_%' };

interface AccessRow {
  order_id: string;
  case_id: string;
  expires_at: Date | string;
}
const toAccess = (kind: AccessKind, row: AccessRow): AccessInfo => ({ caseId: row.case_id, orderId: row.order_id, kind, expiresAt: new Date(row.expires_at).getTime() });

/** O pedido pago mais recente (do tipo pedido) que a sessão tem e que ainda vale. */
export async function meAccess(ctx: Ctx, sessionId: string, kind: AccessKind = 'map'): Promise<AccessInfo | null> {
  const base = BASE_PRODUCT[kind];
  const r = await ctx.db.query<AccessRow>(
    `SELECT o.id AS order_id, o.case_id, e.expires_at
       FROM app.orders o
       JOIN app.cases c ON c.id = o.case_id AND c.status <> 'purged'
       JOIN app.entitlements e ON e.case_id = o.case_id AND e.product_code LIKE $2 AND e.expires_at > now()
       JOIN app.order_items oi ON oi.order_id = o.id AND oi.product_code LIKE $2
      WHERE ${orderOf('o', '$1')} AND o.status = 'paid'
      ORDER BY o.paid_at DESC LIMIT 1`,
    [sessionId, base],
  );
  const row = r.rows[0];
  return row ? toAccess(kind, row) : null;
}

/** Acesso de um caso específico (usado ao abrir o link de acesso). */
async function accessForCase(ctx: Ctx, caseId: string): Promise<AccessInfo | null> {
  for (const kind of ['map', 'translator', 'guided'] as const) {
    const r = await ctx.db.query<AccessRow>(
      `SELECT o.id AS order_id, o.case_id, e.expires_at
         FROM app.orders o
         JOIN app.entitlements e ON e.case_id = o.case_id AND e.product_code LIKE $2 AND e.expires_at > now()
         JOIN app.order_items oi ON oi.order_id = o.id AND oi.product_code LIKE $2
        WHERE o.case_id = $1 AND o.status = 'paid'
        ORDER BY o.paid_at DESC LIMIT 1`,
      [caseId, BASE_PRODUCT[kind]],
    );
    if (r.rows[0]) return toAccess(kind, r.rows[0]);
  }
  return null;
}

export async function createAccessLink(ctx: Ctx, sessionId: string, orderId: string): Promise<{ token: string; expiresAt: number }> {
  const o = await ctx.db.query<{ case_id: string }>(`SELECT case_id FROM app.orders o WHERE o.id = $1 AND ${orderOf('o', '$2')} AND o.status = 'paid'`, [orderId, sessionId]);
  const caseId = o.rows[0]?.case_id;
  const access = caseId ? await accessForCase(ctx, caseId) : null;
  if (!caseId || !access) throw notFound();
  const token = newToken();
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.access_tokens SET revoked_at = now() WHERE case_id = $1 AND revoked_at IS NULL`, [caseId]); // o link novo invalida o anterior
    await q.query(`INSERT INTO app.access_tokens(case_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [caseId, sha256(token), new Date(access.expiresAt).toISOString()]);
    await audit(q, `session:${sessionId}`, 'access_link_created', 'case', caseId);
  });
  return { token, expiresAt: access.expiresAt };
}

export async function redeemAccess(ctx: Ctx, sessionId: string, token: string): Promise<AccessInfo> {
  const t = await ctx.db.query<{ id: string; case_id: string }>(
    `SELECT t.id, t.case_id FROM app.access_tokens t JOIN app.cases c ON c.id = t.case_id AND c.status <> 'purged'
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`,
    [sha256(token)],
  );
  const row = t.rows[0];
  if (!row) throw new AppError(404, 'invalid_link', 'Este link não vale mais. Ele pode ter expirado ou ter sido trocado por um mais novo.');
  await ctx.db.tx(async (q) => {
    // Vários aparelhos: quem abre o link GANHA acesso; o aparelho que já tinha continua com o dele.
    // No máximo 5 aparelhos por caso (o acesso mais antigo sai quando passa disso).
    await q.query(`INSERT INTO app.case_access(case_id, session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [row.case_id, sessionId]);
    await q.query(`DELETE FROM app.case_access WHERE case_id = $1 AND session_id IN (SELECT session_id FROM app.case_access WHERE case_id = $1 ORDER BY created_at DESC OFFSET 5)`, [row.case_id]);
    await q.query(`UPDATE app.access_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
    await audit(q, `session:${sessionId}`, 'access_link_redeemed', 'case', row.case_id);
  });
  const access = await accessForCase(ctx, row.case_id);
  if (!access) throw new AppError(404, 'invalid_link', 'Este link não vale mais.');
  return access;
}

// ---------------------------------------------------------------------------
// Tradutor de cobrança (produto avulso, caso próprio). O texto colado NÃO é guardado: só o resultado.
// ---------------------------------------------------------------------------
export async function createTranslation(ctx: Ctx, args: { sessionId: string; ipHash: Buffer | null; text: string; userAgent: string | null }): Promise<{ caseId: string; preview: TranslatorPreview }> {
  const analysis = analyzeCollectionText(args.text);
  const preview = buildTranslatorPreview(analysis);
  const caseId = await ctx.db.tx(async (q) => {
    const created = await q.query<{ id: string }>(
      `INSERT INTO app.cases(session_id, status, inputs, purge_after, product_kind) VALUES ($1, 'previewed', $2::jsonb, now() + interval '7 days', 'translator') RETURNING id`,
      [args.sessionId, JSON.stringify({ kind: 'translator' })],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('falha ao criar caso');
    await q.query(`INSERT INTO app.diagnoses(case_id, engine_version, preview) VALUES ($1, 'translator-1', $2::jsonb)`, [id, JSON.stringify(preview)]);
    await q.query(`INSERT INTO app.deliverables(case_id, product_code, status, content) VALUES ($1, 'collection_translator', 'pending', $2::jsonb)`, [id, JSON.stringify(analysis)]);
    const docId = await termsDocumentId(q);
    await q.query(`INSERT INTO app.consents(case_id, legal_document_id, purpose, action, ip_hash, user_agent) VALUES ($1, $2, 'terms_of_service', 'grant', $3, $4)`, [id, docId, args.ipHash, args.userAgent ? args.userAgent.slice(0, 300) : null]);
    await audit(q, `session:${args.sessionId}`, 'translation_created', 'case', id, { risk: analysis.risk });
    return id;
  });
  return { caseId, preview };
}

// ---------------------------------------------------------------------------
// Guias pagos sob medida (comparador de financiamento, contas de casa, dinheiro esquecido, currículo por vaga).
// Mesmo desenho do tradutor: o que a pessoa digitou NÃO é guardado, só o resultado (prévia grátis e conteúdo completo).
// ---------------------------------------------------------------------------
export async function createGuided(ctx: Ctx, args: { sessionId: string; ipHash: Buffer | null; kind: GuidedKind; input: unknown; userAgent: string | null }): Promise<{ caseId: string; preview: unknown }> {
  const { full, preview } = buildGuided(args.kind, args.input);
  const code = GUIDED_PRODUCT[args.kind];
  const caseId = await ctx.db.tx(async (q) => {
    const created = await q.query<{ id: string }>(
      `INSERT INTO app.cases(session_id, status, inputs, purge_after, product_kind) VALUES ($1, 'previewed', $2::jsonb, now() + interval '7 days', 'guided') RETURNING id`,
      [args.sessionId, JSON.stringify({ kind: `guided:${args.kind}` })],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error('falha ao criar caso');
    await q.query(`INSERT INTO app.diagnoses(case_id, engine_version, preview) VALUES ($1, $2, $3::jsonb)`, [id, `guided-${args.kind}-1`, JSON.stringify(preview)]);
    await q.query(`INSERT INTO app.deliverables(case_id, product_code, status, content) VALUES ($1, $2, 'pending', $3::jsonb)`, [id, code, JSON.stringify(full)]);
    const docId = await termsDocumentId(q);
    await q.query(`INSERT INTO app.consents(case_id, legal_document_id, purpose, action, ip_hash, user_agent) VALUES ($1, $2, 'terms_of_service', 'grant', $3, $4)`, [id, docId, args.ipHash, args.userAgent ? args.userAgent.slice(0, 300) : null]);
    await audit(q, `session:${args.sessionId}`, 'guided_created', 'case', id, { kind: args.kind });
    return id;
  });
  return { caseId, preview };
}

export async function getGuided(ctx: Ctx, sessionId: string, orderId: string): Promise<{ kind: GuidedKind; content: unknown; accessUntil: number }> {
  const o = await ctx.db.query<{ status: string; case_id: string }>(`SELECT status, case_id FROM app.orders o WHERE o.id = $1 AND ${orderOf('o', '$2')}`, [orderId, sessionId]);
  const order = o.rows[0];
  if (!order) throw notFound();
  if (order.status !== 'paid') throw new AppError(402, 'payment_required', 'Pagamento ainda não confirmado');
  const d = await ctx.db.query<{ product_code: string; content: unknown; expires_at: Date | string | null }>(
    `SELECT d.product_code, d.content, e.expires_at FROM app.deliverables d
       LEFT JOIN app.entitlements e ON e.case_id = d.case_id AND e.product_code = d.product_code AND e.expires_at > now()
      WHERE d.case_id = $1 AND d.product_code LIKE 'guide\\_%' AND d.status = 'ready'`,
    [order.case_id],
  );
  const row = d.rows[0];
  const kind = row ? guidedKindOfCode(row.product_code) : null;
  if (!row || !kind) throw new AppError(409, 'not_ready', 'O guia ainda está sendo preparado');
  if (!row.expires_at) throw new AppError(403, 'access_expired', 'O acesso a este guia expirou');
  return { kind, content: row.content, accessUntil: new Date(row.expires_at).getTime() };
}

/** Todos os guias que a sessão comprou e ainda valem (para "voltar ao que comprei"). */
export async function listGuidedAccess(ctx: Ctx, sessionId: string): Promise<{ kind: GuidedKind; orderId: string; caseId: string; expiresAt: number }[]> {
  const r = await ctx.db.query<{ order_id: string; case_id: string; expires_at: Date | string; product_code: string }>(
    `SELECT o.id AS order_id, o.case_id, e.expires_at, e.product_code
       FROM app.orders o
       JOIN app.cases c ON c.id = o.case_id AND c.status <> 'purged'
       JOIN app.entitlements e ON e.case_id = o.case_id AND e.product_code LIKE 'guide\\_%' AND e.expires_at > now()
      WHERE ${orderOf('o', '$1')} AND o.status = 'paid'
      ORDER BY o.paid_at DESC LIMIT 20`,
    [sessionId],
  );
  return r.rows.flatMap((x) => {
    const kind = guidedKindOfCode(x.product_code);
    return kind ? [{ kind, orderId: x.order_id, caseId: x.case_id, expiresAt: new Date(x.expires_at).getTime() }] : [];
  });
}

export async function getTranslation(ctx: Ctx, sessionId: string, orderId: string): Promise<{ analysis: TranslatorAnalysis; accessUntil: number }> {
  const o = await ctx.db.query<{ status: string; case_id: string }>(`SELECT status, case_id FROM app.orders o WHERE o.id = $1 AND ${orderOf('o', '$2')}`, [orderId, sessionId]);
  const order = o.rows[0];
  if (!order) throw notFound();
  if (order.status !== 'paid') throw new AppError(402, 'payment_required', 'Pagamento ainda não confirmado');
  const ent = await ctx.db.query<{ expires_at: Date | string }>(`SELECT expires_at FROM app.entitlements WHERE case_id = $1 AND product_code = 'collection_translator' AND expires_at > now()`, [order.case_id]);
  if (ent.rows.length === 0) throw new AppError(403, 'access_expired', 'O acesso a esta tradução expirou');
  const d = await ctx.db.query<{ content: TranslatorAnalysis }>(`SELECT content FROM app.deliverables WHERE case_id = $1 AND product_code = 'collection_translator' AND status = 'ready'`, [order.case_id]);
  const analysis = d.rows[0]?.content;
  if (!analysis) throw new AppError(409, 'not_ready', 'A tradução ainda está sendo preparada');
  return { analysis, accessUntil: new Date(ent.rows[0]!.expires_at).getTime() };
}

// ---------------------------------------------------------------------------
// Link de acesso por e-mail (opcional: só se houver provedor). O e-mail é usado e descartado.
// ---------------------------------------------------------------------------
export async function emailAccessLink(ctx: Ctx, sessionId: string, orderId: string, email: string): Promise<{ sent: true }> {
  if (!ctx.email) throw new AppError(503, 'email_unavailable', 'O envio por e-mail ainda não está disponível. Copie o link e guarde em um lugar seguro.');
  const sent = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.audit_log WHERE action = 'access_link_emailed' AND actor = $1 AND occurred_at > now() - interval '1 day'`, [`session:${sessionId}`]);
  if (num(sent.rows[0]?.n ?? 0) >= 3) throw new AppError(429, 'too_many_emails', 'Você já pediu o link por e-mail algumas vezes hoje. Tente de novo amanhã ou copie o link na tela.');
  const { token, expiresAt } = await createAccessLink(ctx, sessionId, orderId);
  const url = `${ctx.config.publicUrl}/#/acesso/${token}`;
  const until = new Date(expiresAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const body = layout(
    'Seu link de acesso ao Fôlego',
    [`Use o botão abaixo para abrir o que você comprou, em qualquer aparelho, até ${until}.`, 'Quem tiver este link abre o seu conteúdo: não compartilhe. Se gerar outro link, este deixa de funcionar.'],
    { label: 'Abrir meu conteúdo', url },
  );
  try {
    await ctx.email.send({ to: email, subject: 'Seu link de acesso ao Fôlego', ...body });
  } catch {
    throw new AppError(502, 'email_failed', 'Não consegui enviar o e-mail agora. Copie o link na tela.');
  }
  await audit(ctx.db, `session:${sessionId}`, 'access_link_emailed', 'order', orderId); // sem o endereço
  return { sent: true };
}
