// Mapa da Virada para quem assina o Prumo. O servidor decide preço e prazo (o navegador só mostra):
//  - Ousado: preço especial no Pix e prazo próprio (padrão R$ 12,99 por 90 dias; ambos mudam no backoffice).
//  - Desbravador: usa o Mapa sem pagar, enquanto a assinatura valer. O acesso acompanha o período e se estende a cada renovação.
//  - Controle (ou sem assinatura ativa): nada muda, vale o preço e o prazo de sempre.
import { effectiveAccountId } from './household.ts';
import type { Ctx } from './services.ts';
import { num } from './services.ts';
import { accountView, subscriberOf } from './subscriptions.ts';

const DAY = 86_400_000;
const MAX_DEVICES = 5;

export interface SubscriberMapTerms {
  /** Quem está logado nesta sessão. */
  subscriberId: string;
  /** Contas cujo Mapa vale para a pessoa (a dela e a do titular, se ela usa uma conta compartilhada). */
  accountIds: string[];
  plan: 'ousado' | 'desbravador';
  mode: 'paid' | 'free';
  priceCents: number;
  days: number;
  periodEnd: number;
}

/** Condições do Mapa para a pessoa logada nesta sessão. Nulo = preço e prazo normais. */
export async function subscriberMapTerms(ctx: Ctx, sessionId: string): Promise<SubscriberMapTerms | null> {
  if (!ctx.config.subscriptionsEnabled) return null;
  const self = await subscriberOf(ctx, sessionId);
  if (!self) return null;
  try {
    const owner = await effectiveAccountId(ctx, self);
    const sub = (await accountView(ctx, owner)).subscription;
    if (!sub?.active) return null;
    const accountIds = [...new Set([self, owner])];
    if (sub.plan === 'ousado') return { subscriberId: self, accountIds, plan: 'ousado', mode: 'paid', priceCents: ctx.config.subscriberMapPriceCents, days: ctx.config.subscriberMapDays, periodEnd: sub.periodEnd };
    if (sub.plan === 'desbravador') return { subscriberId: self, accountIds, plan: 'desbravador', mode: 'free', priceCents: 0, days: Math.min(1100, Math.max(1, Math.ceil((sub.periodEnd - Date.now()) / DAY))), periodEnd: sub.periodEnd };
    return null;
  } catch {
    return null; // conta apagada ou sem assinatura: segue com as condições normais
  }
}

export interface ActiveMap {
  orderId: string;
  caseId: string;
  until: number;
  redoCount: number;
}

/** O Mapa que a pessoa tem agora (pago e dentro do prazo), em qualquer aparelho. */
export async function activeMap(ctx: Ctx, accountIds: string[]): Promise<ActiveMap | null> {
  const r = await ctx.db.query<{ order_id: string; case_id: string; expires_at: Date | string; redo_count: number }>(
    `SELECT o.id AS order_id, o.case_id, e.expires_at, e.redo_count
       FROM app.cases c
       JOIN app.entitlements e ON e.case_id = c.id AND e.product_code = 'recovery_map' AND e.expires_at > now()
       JOIN app.orders o ON o.id = e.order_id AND o.status = 'paid'
      WHERE c.owner_subscriber_id = ANY($1::uuid[]) AND c.status <> 'purged'
      ORDER BY e.expires_at DESC LIMIT 1`,
    [accountIds],
  );
  const row = r.rows[0];
  return row ? { orderId: row.order_id, caseId: row.case_id, until: new Date(row.expires_at).getTime(), redoCount: row.redo_count } : null;
}

export interface MapOffer {
  eligible: boolean;
  plan?: 'ousado' | 'desbravador';
  mode?: 'paid' | 'free';
  priceCents?: number;
  regularCents?: number;
  discountCents?: number;
  days?: number;
  email?: string;
  active?: ActiveMap | null;
}

/** O que a tela Dívidas mostra: oferta (Ousado), uso incluído (Desbravador) ou o Mapa que já está ativo. Controle não recebe nada. */
export async function mapOffer(ctx: Ctx, sessionId: string): Promise<MapOffer> {
  const terms = await subscriberMapTerms(ctx, sessionId);
  if (!terms) return { eligible: false };
  const regular = await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = 'recovery_map'`);
  const regularCents = num(regular.rows[0]?.price_cents ?? 0);
  const active = await activeMap(ctx, terms.accountIds);
  if (active) {
    // Este aparelho passa a abrir o Mapa também (a pessoa pode ter comprado em outro).
    await ctx.db.query(`INSERT INTO app.case_access(case_id, session_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [active.caseId, sessionId]);
    await ctx.db.query(`DELETE FROM app.case_access WHERE case_id = $1 AND session_id IN (SELECT session_id FROM app.case_access WHERE case_id = $1 ORDER BY created_at DESC OFFSET ${MAX_DEVICES})`, [active.caseId]);
  }
  const email = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [terms.subscriberId]);
  return {
    eligible: true,
    plan: terms.plan,
    mode: terms.mode,
    priceCents: terms.priceCents,
    regularCents,
    discountCents: Math.max(0, regularCents - terms.priceCents),
    days: terms.days,
    email: email.rows[0]?.email ?? '',
    active,
  };
}
