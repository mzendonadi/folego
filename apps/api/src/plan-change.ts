// Troca de plano no meio do mês (upgrade e downgrade) com pró-rata por dia (D-114).
//  - Pró-rata só serve para calcular a diferença entre os dois planos pelos dias que FALTAM no período já pago:
//      diferença = (preço novo - preço atual) x dias que faltam / dias do período.
//  - Upgrade: o plano novo vale assim que a diferença é paga (página segura do provedor, sem guardar cartão). Nas faturas seguintes
//    a cobrança passa para o preço cheio do plano novo, no mesmo dia do mês de sempre.
//  - Downgrade: o plano novo vale na hora e a diferença vira crédito único na PRÓXIMA fatura; depois, preço cheio do plano novo.
//  - Upgrade com diferença menor que o mínimo de cobrança do provedor (R$ 5,00): liberado na hora, sem cobrança extra.
//  - Só para assinatura mensal no cartão, em dia. Cancelada, em atraso ou sem cartão: não troca (a tela explica o que fazer).
import { AppError } from './errors.ts';
import { planByCode } from './engine.ts';
import { syncPrices } from './referrals.ts';
import type { Ctx } from './services.ts';
import { audit, num } from './services.ts';
import { extendPlanMaps } from './subscriptions.ts';
import type { Queryable } from './db.ts';

export const MIN_CHARGE_CENTS = 500;

export interface PlanQuote {
  kind: 'upgrade' | 'downgrade';
  fromPlan: string;
  toPlan: string;
  fromPriceCents: number;
  toPriceCents: number;
  daysLeft: number;
  periodDays: number;
  /** Diferença proporcional (cobrada no upgrade, creditada no downgrade). */
  prorataCents: number;
  /** O que a pessoa paga agora (0 no downgrade e no upgrade pequeno demais para cobrar). */
  chargeNowCents: number;
  /** Crédito que abate a próxima fatura (só downgrade). */
  creditCents: number;
  waived: boolean;
  /** Próxima cobrança: data (ms) e valor, já com o crédito. */
  nextChargeOn: number;
  nextChargeCents: number;
}

interface State {
  status: string;
  plan: string;
  customerId: string | null;
  fromPriceCents: number;
  existingCreditCents: number;
  periodEnd: number;
  periodDays: number;
  leftDays: number;
  active: boolean;
}

async function loadState(db: Queryable, subscriberId: string): Promise<State> {
  const r = await db.query<{ status: string; plan: string; customer: string | null; from_price: string | null; credit: number; period_end: Date | string; active: boolean; period_days: string; left_days: string }>(
    `SELECT b.status, b.plan, b.provider_customer_id AS customer, coalesce(b.contract_cents, pr.price_cents) AS from_price, b.plan_credit_cents AS credit,
            s.current_period_end AS period_end, (s.status = 'active' AND s.current_period_end > now()) AS active,
            extract(epoch FROM (s.current_period_end - (s.current_period_end - interval '1 month'))) / 86400 AS period_days,
            extract(epoch FROM (s.current_period_end - now())) / 86400 AS left_days
       FROM app.billing_profiles b
       JOIN app.subscriptions s ON s.subscriber_id = b.subscriber_id
       LEFT JOIN app.products pr ON pr.code = 'sub_' || b.plan
      WHERE b.subscriber_id = $1`,
    [subscriberId],
  );
  const row = r.rows[0];
  if (!row) throw new AppError(409, 'plan_change_unavailable', 'A troca de plano vale para a assinatura mensal no cartão. Assine primeiro um plano.');
  return {
    status: row.status,
    plan: row.plan,
    customerId: row.customer,
    fromPriceCents: num(row.from_price ?? 0),
    existingCreditCents: row.credit ?? 0,
    periodEnd: new Date(row.period_end).getTime(),
    periodDays: Math.max(1, Math.round(Number(row.period_days))),
    leftDays: Number(row.left_days),
    active: row.active,
  };
}

function assertCanChange(s: State): void {
  if (s.status === 'canceled') throw new AppError(409, 'plan_change_canceled', 'Sua assinatura está cancelada. Para mudar de plano, assine o plano novo depois do fim do mês já pago.');
  if (s.status === 'past_due') throw new AppError(409, 'plan_change_past_due', 'O cartão foi recusado na última cobrança. Regularize o pagamento antes de trocar de plano.');
  if (s.status !== 'active' || !s.active) throw new AppError(409, 'plan_change_unavailable', 'A troca de plano vale para a assinatura mensal no cartão em dia.');
}

/** Cálculo puro do pró-rata (testável sem banco). */
export function prorate(diffCents: number, daysLeft: number, periodDays: number): number {
  if (periodDays <= 0 || daysLeft <= 0 || diffCents <= 0) return 0;
  return Math.round((diffCents * Math.min(daysLeft, periodDays)) / periodDays);
}

export async function quotePlanChange(ctx: Ctx, subscriberId: string, toPlanCode: string): Promise<PlanQuote> {
  const s = await loadState(ctx.db, subscriberId);
  assertCanChange(s);
  const to = planByCode(toPlanCode);
  if (!to) throw new AppError(422, 'invalid_plan', 'Plano inválido.');
  if (to.code === s.plan) throw new AppError(422, 'same_plan', 'Você já está neste plano.');
  const price = await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1 AND active AND kind = 'subscription'`, [to.productCode]);
  if (!price.rows[0]) throw new AppError(422, 'product_unavailable', 'Este plano não está disponível no momento.');
  const toPrice = num(price.rows[0].price_cents);
  if (toPrice === s.fromPriceCents) throw new AppError(422, 'same_price', 'Os dois planos têm o mesmo valor.');
  const daysLeft = Math.max(0, Math.min(s.periodDays, Math.ceil(s.leftDays)));
  const base = { fromPlan: s.plan, toPlan: to.code, fromPriceCents: s.fromPriceCents, toPriceCents: toPrice, daysLeft, periodDays: s.periodDays, nextChargeOn: s.periodEnd };
  if (toPrice > s.fromPriceCents) {
    const prorataCents = prorate(toPrice - s.fromPriceCents, daysLeft, s.periodDays);
    const waived = prorataCents < MIN_CHARGE_CENTS;
    return { ...base, kind: 'upgrade', prorataCents, chargeNowCents: waived ? 0 : prorataCents, creditCents: 0, waived, nextChargeCents: Math.max(MIN_CHARGE_CENTS, toPrice - s.existingCreditCents) };
  }
  const prorataCents = prorate(s.fromPriceCents - toPrice, daysLeft, s.periodDays);
  // A próxima fatura nunca fica abaixo do mínimo do provedor: o crédito que não couber se perde (diferença pequena demais para importar).
  const creditCents = Math.max(0, Math.min(prorataCents, toPrice - MIN_CHARGE_CENTS - s.existingCreditCents));
  return { ...base, kind: 'downgrade', prorataCents, chargeNowCents: 0, creditCents, waived: false, nextChargeCents: Math.max(MIN_CHARGE_CENTS, toPrice - s.existingCreditCents - creditCents) };
}

/** Passa o plano (e o preço contratado) para o novo valor. Dentro da transação. O período e o dia da cobrança não mudam. */
async function applyPlan(q: Queryable, subscriberId: string, toPlan: string, toPriceCents: number, creditCents: number): Promise<void> {
  await q.query(`UPDATE app.subscriptions SET plan = $2 WHERE subscriber_id = $1`, [subscriberId, toPlan]);
  await q.query(`UPDATE app.billing_profiles SET plan = $2, contract_cents = $3, plan_credit_cents = plan_credit_cents + $4 WHERE subscriber_id = $1`, [subscriberId, toPlan, toPriceCents, creditCents]);
  await extendPlanMaps(q, subscriberId); // quem chega ao Desbravador leva o Mapa incluso junto com o período
}

export interface PlanChangeResult {
  status: 'applied' | 'payment_required';
  quote: PlanQuote;
  orderId?: string;
  checkoutUrl?: string;
}

export async function startPlanChange(ctx: Ctx, args: { subscriberId: string; toPlan: string; acceptTerms: boolean }): Promise<PlanChangeResult> {
  if (!ctx.config.subscriptionsEnabled) throw new AppError(404, 'not_found', 'Não encontrado.');
  if (!args.acceptTerms) throw new AppError(422, 'terms_required', 'Para trocar de plano, confirme que entendeu a cobrança proporcional.');
  const quote = await quotePlanChange(ctx, args.subscriberId, args.toPlan);
  if (quote.kind === 'upgrade' && ctx.config.salesPaused) throw new AppError(503, 'sales_paused', 'As vendas estão pausadas por um instante. Tente novamente em alguns minutos.');
  const s = await loadState(ctx.db, args.subscriberId);

  // Uma troca por vez: a que ficou esperando pagamento é cancelada (e a cobrança avulsa, se ainda não foi paga).
  const old = await ctx.db.query<{ id: string; provider_payment_id: string | null }>(`SELECT id, provider_payment_id FROM app.plan_changes WHERE subscriber_id = $1 AND status = 'pending'`, [args.subscriberId]);
  for (const o of old.rows) {
    if (o.provider_payment_id) await ctx.gateway.cancelCharge(o.provider_payment_id).catch(() => undefined);
    await ctx.db.query(`UPDATE app.plan_changes SET status = 'canceled' WHERE id = $1`, [o.id]);
  }

  const row = [args.subscriberId, quote.fromPlan, quote.toPlan, quote.kind, quote.fromPriceCents, quote.toPriceCents, quote.prorataCents, quote.daysLeft, quote.periodDays, quote.waived] as const;
  const insert = `INSERT INTO app.plan_changes(subscriber_id, from_plan, to_plan, kind, from_price_cents, to_price_cents, prorata_cents, days_left, period_days, waived, status, applied_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'applied', now())`;

  if (quote.chargeNowCents === 0) {
    // Downgrade, ou upgrade pequeno demais para cobrar: vale na hora.
    await ctx.db.tx(async (q) => {
      await q.query(insert, [...row]);
      await applyPlan(q, args.subscriberId, quote.toPlan, quote.toPriceCents, quote.creditCents);
      await audit(q, `subscriber:${args.subscriberId}`, 'plan_changed', 'subscriber', args.subscriberId, { kind: quote.kind, from: quote.fromPlan, to: quote.toPlan, prorataCents: quote.prorataCents, creditCents: quote.creditCents, waived: quote.waived });
    });
    await syncPrices(ctx).catch(() => 0); // o valor da próxima fatura no provedor (o worker também faz, se isto falhar)
    return { status: 'applied', quote };
  }

  // Upgrade com cobrança: pedido + cobrança avulsa na página segura do provedor. O plano muda quando o pagamento é confirmado.
  if (!s.customerId) throw new AppError(409, 'plan_change_unavailable', 'Não encontrei o seu cadastro de cobrança. Fale com o suporte.');
  const orderId = await ctx.db.tx(async (q) => {
    const o = await q.query<{ id: string }>(`INSERT INTO app.orders(case_id, subscriber_id, session_id, status, total_cents, idempotency_key) VALUES (NULL,$1,NULL,'pending',$2,$3) RETURNING id`, [args.subscriberId, quote.chargeNowCents, `planchange-${args.subscriberId}-${Date.now()}`]);
    const plan = planByCode(quote.toPlan)!;
    await q.query(`INSERT INTO app.order_items(order_id, product_code, unit_price_cents) VALUES ($1,$2,$3)`, [o.rows[0]!.id, plan.productCode, quote.chargeNowCents]);
    return o.rows[0]!.id;
  });
  let charge;
  try {
    const dueOn = new Date().toISOString().slice(0, 10);
    charge = await ctx.gateway.createOneOffCardCharge({ customerId: s.customerId, orderId, valueCents: quote.chargeNowCents, dueOn, description: `Prumo: diferença proporcional da troca para o plano ${planByCode(quote.toPlan)!.name} (${quote.daysLeft} dias)` });
  } catch (e) {
    await ctx.db.query(`UPDATE app.orders SET status = 'canceled' WHERE id = $1`, [orderId]);
    throw e;
  }
  await ctx.db.tx(async (q) => {
    await q.query(`INSERT INTO app.payments(order_id, provider, provider_payment_id, method, amount_cents, status) VALUES ($1,$2,$3,'card',$4,'pending')`, [orderId, ctx.gateway.name, charge.providerPaymentId, quote.chargeNowCents]);
    await q.query(`INSERT INTO app.plan_changes(subscriber_id, from_plan, to_plan, kind, from_price_cents, to_price_cents, prorata_cents, days_left, period_days, waived, status, order_id, provider_payment_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12)`, [...row, orderId, charge.providerPaymentId]);
    await audit(q, `subscriber:${args.subscriberId}`, 'plan_change_started', 'subscriber', args.subscriberId, { from: quote.fromPlan, to: quote.toPlan, chargeCents: quote.chargeNowCents, orderId });
  });
  return { status: 'payment_required', quote, orderId, checkoutUrl: charge.checkoutUrl };
}

/**
 * Pagamento confirmado de um pedido: se for de troca de plano, aplica o plano novo (e NÃO estende o período da assinatura).
 * Devolve null quando o pedido não é de troca de plano (segue o fluxo normal).
 */
export async function settlePlanChangePayment(q: Queryable, orderId: string): Promise<'applied' | 'stale' | null> {
  const r = await q.query<{ id: string; subscriber_id: string; to_plan: string; to_price_cents: number; status: string }>(
    `SELECT id, subscriber_id, to_plan, to_price_cents, status FROM app.plan_changes WHERE order_id = $1 FOR UPDATE`,
    [orderId],
  );
  const pc = r.rows[0];
  if (!pc) return null;
  if (pc.status !== 'pending') {
    // Foi paga depois de a troca ser cancelada (a pessoa abriu outra, por exemplo): fica registrado para devolver o valor.
    await audit(q, 'system', 'plan_change_paid_but_not_pending', 'subscriber', pc.subscriber_id, { planChange: pc.id, orderId });
    return 'stale';
  }
  await applyPlan(q, pc.subscriber_id, pc.to_plan, pc.to_price_cents, 0);
  await q.query(`UPDATE app.plan_changes SET status = 'applied', applied_at = now() WHERE id = $1`, [pc.id]);
  await audit(q, 'system', 'plan_changed', 'subscriber', pc.subscriber_id, { kind: 'upgrade', to: pc.to_plan, orderId });
  return 'applied';
}
