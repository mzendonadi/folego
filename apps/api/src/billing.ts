// Prumo: assinatura mensal recorrente no cartão de crédito (Asaas).
// - A pessoa aceita os termos, é levada à página segura do provedor, digita o cartão lá e o provedor cobra todo mês.
// - Cada mensalidade confirmada estende o acesso em 1 mês (calendário). Cancelar para a cobrança NA HORA, não devolve o
//   mês corrente e mantém o acesso (e o download dos dados) até o fim do mês já pago. Depois o acesso encerra e os dados
//   são apagados (pelo backoffice, após o download de segurança, ou automaticamente depois da janela de retenção).
import { attribute } from './referrals.ts';
import { assertNotOwner } from './subscriptions.ts';
import { AppError, notFound } from './errors.ts';
import { encryptText } from './crypto.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';
import { audit, num } from './services.ts';
import type { Queryable } from './db.ts';
import { planByCode, formatBrl } from './engine.ts';
import type { BillingEvent, GatewayEvent, StopResult } from './gateway.ts';

export const TERMS_VERSION = '2026-10-03';
export const CARD_GRACE_DAYS = 2; // tolerância para a renovação chegar por webhook antes de o acesso fechar

const addDaysIso = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);

export interface CheckoutView {
  orderId: string;
  checkoutUrl: string;
  totalCents: number;
  plan: string;
  status: 'pending';
  /** A pessoa volta sozinha ao Prumo depois de pagar (a tela pode seguir na mesma aba). */
  returnsToSite: boolean;
}

/** Começa a assinatura mensal: registra o aceite dos termos, cria a assinatura no provedor e devolve a página do cartão. */
export async function startCardCheckout(ctx: Ctx, args: { subscriberId: string; plan: string; acceptTerms: boolean; referralCode?: string | undefined; cpf?: string | undefined; name?: string | undefined; phone?: string | undefined; adsConsent?: boolean | undefined; fbc?: string | undefined; ip?: string | undefined; userAgent?: string | undefined }): Promise<CheckoutView> {
  if (!ctx.config.subscriptionsEnabled) throw notFound();
  if (ctx.gateway.name === 'asaas' && !args.cpf) throw new AppError(422, 'cpf_required', 'Para assinar no cartão, informe o seu CPF.');
  if (ctx.gateway.name === 'asaas' && !args.name) throw new AppError(422, 'name_required', 'Para assinar no cartão, informe o seu nome completo.');
  if (!args.acceptTerms) throw new AppError(422, 'terms_required', 'Para assinar, aceite os termos e a cobrança mensal no cartão.');
  const plan = planByCode(args.plan);
  if (!plan) throw new AppError(422, 'invalid_plan', 'Plano inválido');
  if (ctx.config.salesPaused) throw new AppError(503, 'sales_paused', 'As vendas estão pausadas por um instante. Tente novamente em alguns minutos.');
  const price = await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1 AND active AND kind = 'subscription'`, [plan.productCode]);
  if (!price.rows[0]) throw new AppError(422, 'product_unavailable', 'Este plano não está disponível no momento.');
  const valueCents = num(price.rows[0].price_cents);

  const cur = await ctx.db.query<{ status: string; provider_subscription_id: string | null }>(`SELECT status, provider_subscription_id FROM app.billing_profiles WHERE subscriber_id = $1`, [args.subscriberId]);
  const sub = await ctx.db.query<{ active: boolean }>(`SELECT (status = 'active' AND current_period_end > now()) AS active FROM app.subscriptions WHERE subscriber_id = $1`, [args.subscriberId]);
  if (cur.rows[0] && ['active', 'past_due'].includes(cur.rows[0].status)) throw new AppError(409, 'already_subscribed', 'Você já tem uma assinatura mensal ativa. Para trocar de plano, cancele e assine o novo depois do fim do mês pago.');
  if (sub.rows[0]?.active && cur.rows[0]?.status === 'canceled') throw new AppError(409, 'still_in_period', 'Seu plano está cancelado, mas o acesso continua até o fim do mês já pago. Depois dessa data você pode assinar de novo.');

  // Dados cadastrais guardados já na intenção de assinar (mesmo que a pessoa desista antes de pagar): CPF e celular criptografados.
  if (args.cpf || args.name || args.phone) {
    await ctx.db.query(
      `UPDATE app.subscribers SET display_name = coalesce($2, display_name), cpf_enc = coalesce($3, cpf_enc), cpf_last4 = coalesce($4, cpf_last4), phone_enc = coalesce($5, phone_enc), ads_consent = coalesce($6, ads_consent), contact_ip = coalesce($7, contact_ip), contact_ua = coalesce($8, contact_ua), contact_fbc = coalesce($9, contact_fbc), profile_updated_at = now() WHERE id = $1`,
      [args.subscriberId, args.name ?? null, args.cpf ? encryptText(ctx.config.secret, args.cpf) : null, args.cpf ? args.cpf.slice(-4) : null, args.phone ? encryptText(ctx.config.secret, args.phone) : null, args.adsConsent ?? true, args.ip ?? null, (args.userAgent ?? '').slice(0, 400) || null, args.fbc ?? null],
    );
  }
  const who = await ctx.db.query<{ email: string; display_name: string | null }>(`SELECT email::text AS email, display_name FROM app.subscribers WHERE id = $1`, [args.subscriberId]);
  const email = who.rows[0]?.email ?? '';

  const orderId = await ctx.db.tx(async (q) => {
    const o = await q.query<{ id: string }>(`INSERT INTO app.orders(case_id, subscriber_id, session_id, status, total_cents, idempotency_key) VALUES (NULL,$1,NULL,'pending',$2,$3) RETURNING id`, [args.subscriberId, valueCents, `card-${args.subscriberId}-${Date.now()}`]);
    const id = o.rows[0]!.id;
    await q.query(`INSERT INTO app.order_items(order_id, product_code, unit_price_cents) VALUES ($1,$2,$3)`, [id, plan.productCode, valueCents]);
    return id;
  });
  // Checkout anterior que ficou pendente (a pessoa abandonou e voltou): a assinatura antiga seguiria gerando cobrança no provedor. Encerra antes de criar a nova.
  if (cur.rows[0]?.provider_subscription_id) await stopAndAlert(ctx, args.subscriberId, cur.rows[0].provider_subscription_id, 'cancelamento').catch(() => undefined);
  let card;
  try {
    card = await ctx.gateway.createCardSubscription({
      orderId,
      subscriberId: args.subscriberId,
      email,
      name: who.rows[0]?.display_name ?? email.split('@')[0] ?? 'Assinante',
      planName: plan.name,
      valueCents,
      firstDueOn: addDaysIso(new Date(), 0),
      cpf: args.cpf,
      successUrl: `${ctx.config.publicUrl}/conta/plano`,
    });
  } catch (e) {
    await ctx.db.query(`UPDATE app.orders SET status = 'canceled' WHERE id = $1`, [orderId]);
    throw e;
  }
  await ctx.db.tx(async (q) => {
    await q.query(`INSERT INTO app.payments(order_id, provider, provider_payment_id, method, amount_cents, status) VALUES ($1,$2,$3,'card',$4,'pending')`, [orderId, ctx.gateway.name, card.providerPaymentId, valueCents]);
    await q.query(
      `INSERT INTO app.billing_profiles(subscriber_id, provider, provider_customer_id, provider_subscription_id, plan, status, terms_accepted_at, terms_version)
       VALUES ($1,$2,$3,$4,$5,'pending', now(), $6)
       ON CONFLICT (subscriber_id) DO UPDATE SET provider = EXCLUDED.provider, provider_customer_id = EXCLUDED.provider_customer_id, provider_subscription_id = EXCLUDED.provider_subscription_id,
         plan = EXCLUDED.plan, status = 'pending', terms_accepted_at = now(), terms_version = EXCLUDED.terms_version, canceled_at = NULL, past_due_since = NULL, data_exported_at = NULL`,
      [args.subscriberId, ctx.gateway.name, card.providerCustomerId, card.providerSubscriptionId, plan.code, TERMS_VERSION],
    );
    await q.query(`UPDATE app.billing_profiles SET synced_value_cents = $2, contract_cents = $2 WHERE subscriber_id = $1`, [args.subscriberId, valueCents]);
    await audit(q, `subscriber:${args.subscriberId}`, 'subscription_checkout_started', 'subscriber', args.subscriberId, { plan: plan.code, termsVersion: TERMS_VERSION, orderId });
  });
  await attribute(ctx, args.subscriberId, args.referralCode);
  return { orderId, checkoutUrl: card.checkoutUrl, totalCents: valueCents, plan: plan.code, status: 'pending', returnsToSite: Boolean(card.returnsToSite) };
}

/** Webhook de cobrança de uma assinatura que ainda não conhecemos como pagamento: registra a mensalidade (renovação). */
export async function registerRenewal(ctx: Ctx, event: GatewayEvent): Promise<number | null> {
  if (!event.providerSubscriptionId) return null;
  const bp = await ctx.db.query<{ subscriber_id: string; plan: string }>(`SELECT subscriber_id, plan FROM app.billing_profiles WHERE provider = $1 AND provider_subscription_id = $2`, [ctx.gateway.name, event.providerSubscriptionId]);
  const profile = bp.rows[0];
  if (!profile) return null;
  const plan = planByCode(profile.plan);
  if (!plan) return null;
  const price = await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1`, [plan.productCode]);
  const valueCents = event.valueCents && event.valueCents > 0 ? event.valueCents : num(price.rows[0]?.price_cents ?? 0);
  if (valueCents <= 0) return null;
  await ctx.db.tx(async (q) => {
    const exists = await q.query(`SELECT 1 FROM app.payments WHERE provider = $1 AND provider_payment_id = $2`, [ctx.gateway.name, event.providerPaymentId]);
    if (exists.rows.length > 0) return;
    const o = await q.query<{ id: string }>(`INSERT INTO app.orders(case_id, subscriber_id, session_id, status, total_cents, idempotency_key) VALUES (NULL,$1,NULL,'pending',$2,$3) RETURNING id`, [profile.subscriber_id, valueCents, `renewal-${event.providerPaymentId}`]);
    // O item guarda o preço de tabela e o pedido o valor cobrado: a diferença é o desconto (indicação) e fica visível em Pedidos.
    const contract = await q.query<{ contract_cents: string | null }>(`SELECT contract_cents FROM app.billing_profiles WHERE subscriber_id = $1`, [profile.subscriber_id]);
    const listCents = num(contract.rows[0]?.contract_cents ?? price.rows[0]?.price_cents ?? valueCents);
    await q.query(`INSERT INTO app.order_items(order_id, product_code, unit_price_cents) VALUES ($1,$2,$3)`, [o.rows[0]!.id, plan.productCode, Math.max(listCents, valueCents)]);
    await q.query(`INSERT INTO app.payments(order_id, provider, provider_payment_id, method, amount_cents, status) VALUES ($1,$2,$3,'card',$4,'pending')`, [o.rows[0]!.id, ctx.gateway.name, event.providerPaymentId, valueCents]);
  });
  return valueCents;
}

/** Chamado na transação do pagamento confirmado: a mensalidade está paga, a assinatura fica em dia. */
export async function markChargePaid(q: Queryable, subscriberId: string): Promise<void> {
  await q.query(`UPDATE app.billing_profiles SET status = CASE WHEN status = 'canceled' THEN status ELSE 'active' END, last_charge_at = now(), past_due_since = NULL WHERE subscriber_id = $1`, [subscriberId]);
}

export async function hasCardProfile(ctx: Ctx, subscriberId: string): Promise<boolean> {
  const r = await ctx.db.query(`SELECT 1 FROM app.billing_profiles WHERE subscriber_id = $1 AND status <> 'pending'`, [subscriberId]);
  return r.rows.length > 0;
}

/** Cartão recusado ou assinatura encerrada no provedor. */
export async function handleBillingEvent(ctx: Ctx, event: BillingEvent): Promise<'confirmed' | 'ignored'> {
  const bp = await ctx.db.query<{ subscriber_id: string; status: string; email: string }>(
    `SELECT b.subscriber_id, b.status, s.email::text AS email FROM app.billing_profiles b JOIN app.subscribers s ON s.id = b.subscriber_id WHERE b.provider = $1 AND b.provider_subscription_id = $2`,
    [ctx.gateway.name, event.providerSubscriptionId],
  );
  const p = bp.rows[0];
  if (!p) return 'ignored';
  const seen = await ctx.db.query<{ id: string }>(`INSERT INTO app.payment_events(provider, provider_event_id, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`, [ctx.gateway.name, event.providerEventId, JSON.stringify(event)]);
  if (!seen.rows[0]) return 'ignored';
  // Cobrança nova de uma assinatura que a pessoa já cancelou: nunca pode ser cobrada. Apaga na hora e avisa.
  if (event.type === 'charge_created') {
    if (p.status !== 'canceled') return 'ignored';
    if (event.providerPaymentId) await ctx.gateway.cancelCharge(event.providerPaymentId);
    await audit(ctx.db, 'system', 'charge_after_cancel_blocked', 'subscriber', p.subscriber_id, { paymentId: event.providerPaymentId ?? null });
    await alertOwners(ctx, 'Cobrança de assinatura cancelada foi barrada', [`O Asaas gerou uma cobrança nova para um cliente que já tinha cancelado (${p.subscriber_id.slice(0, 8)}). Ela foi apagada na hora. Vale conferir se a assinatura foi encerrada no Asaas.`]);
    return 'confirmed';
  }
  if (event.type === 'charge_refused') {
    if (p.status === 'canceled') return 'ignored';
    await ctx.db.query(`UPDATE app.billing_profiles SET status = 'past_due', past_due_since = coalesce(past_due_since, now()) WHERE subscriber_id = $1`, [p.subscriber_id]);
    await audit(ctx.db, 'system', 'subscription_charge_refused', 'subscriber', p.subscriber_id);
    if (ctx.email) {
      const body = layout('Não conseguimos cobrar o seu cartão', ['A mensalidade do Prumo não passou no cartão. Seu acesso continua até o fim do período já pago.', 'Para não perder o acesso, atualize o cartão pela cobrança que enviamos ao seu e-mail ou fale com a gente. Se você não quiser continuar, é só cancelar na sua conta.'], { label: 'Abrir o Prumo', url: `${ctx.config.publicUrl}/conta/plano` });
      await ctx.email.send({ to: p.email, subject: 'Prumo: não conseguimos cobrar o seu cartão', ...body }).catch(() => undefined);
    }
    return 'confirmed';
  }
  // Assinatura encerrada no provedor: sem novas cobranças. O acesso vai até o fim do período já pago.
  if (p.status !== 'canceled') await markCanceled(ctx, p.subscriber_id, 'provider');
  return 'confirmed';
}

// ---------------------------------------------------------------------------------------------------------------------
// Cancelamento que vale de verdade. Regra do produto: depois do pedido de cancelamento NENHUMA cobrança pode sair.
//  1) cancelar = o provedor confirma (cobranças em aberto apagadas e assinatura encerrada); "não enxergo" NÃO é "cancelada";
//  2) cobrança nova de assinatura cancelada (webhook) é apagada na hora;
//  3) varredura periódica reconfere todas as canceladas;
//  4) qualquer coisa que não dê para confirmar vira alerta por e-mail aos administradores.
// ---------------------------------------------------------------------------------------------------------------------
async function alertOwners(ctx: Ctx, subject: string, lines: string[]): Promise<void> {
  if (!ctx.email) return;
  const body = layout(subject, lines);
  for (const to of ctx.config.adminEmails ?? []) await ctx.email.send({ to, subject, ...body }).catch(() => undefined);
}

async function alertUnverified(ctx: Ctx, subscriberId: string, providerSubscriptionId: string, when: 'cancelamento' | 'varredura'): Promise<void> {
  await ctx.db.query(`UPDATE app.billing_profiles SET cancel_verified = false, cancel_alerted_at = now() WHERE subscriber_id = $1`, [subscriberId]);
  await audit(ctx.db, 'system', 'cancel_unverified', 'subscriber', subscriberId, { provider: ctx.gateway.name, when });
  await alertOwners(ctx, 'URGENTE: cancelamento não confirmado no Asaas', [
    `Um cancelamento (cliente ${subscriberId.slice(0, 8)}) NÃO foi confirmado no Asaas: a assinatura ${providerSubscriptionId} não é visível para a chave de API atual (provavelmente foi criada em outra conta do Asaas, como a PF antiga).`,
    'Isso significa que o Asaas pode continuar cobrando. Entre na conta do Asaas onde ela foi criada, cancele a assinatura e apague as cobranças pendentes dela.',
    'O Prumo já tirou o acesso renovável e vai reconferir sozinho; este aviso se repete no máximo a cada 7 dias.',
  ]);
}

/** Cancela no provedor e confere. Devolve o resultado; "não visível" já dispara o alerta. */
async function stopAndAlert(ctx: Ctx, subscriberId: string, providerSubscriptionId: string, when: 'cancelamento' | 'varredura'): Promise<StopResult> {
  const out = await ctx.gateway.stopCardSubscription(providerSubscriptionId);
  if (out.result === 'not_visible') await alertUnverified(ctx, subscriberId, providerSubscriptionId, when);
  return out;
}

/**
 * Varredura: reconfere as assinaturas canceladas (últimos 120 dias). Apaga cobrança em aberto que tenha aparecido, encerra assinatura que
 * ainda esteja ativa e refaz o alerta (a cada 7 dias, até 45 dias depois do cancelamento) quando o provedor não enxerga a assinatura.
 */
let lastReconcile = 0;
export async function reconcileCanceled(ctx: Ctx, opts: { force?: boolean; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled) return 0;
  if (!opts.force && Date.now() - lastReconcile < 30 * 60_000) return 0;
  lastReconcile = Date.now();
  const r = await ctx.db.query<{ subscriber_id: string; sub: string; verified: boolean | null; alerted: Date | null; canceled_at: Date | null }>(
    `SELECT subscriber_id, provider_subscription_id AS sub, cancel_verified AS verified, cancel_alerted_at AS alerted, canceled_at
       FROM app.billing_profiles WHERE status = 'canceled' AND provider = $1 AND provider_subscription_id IS NOT NULL AND canceled_at > now() - interval '120 days' LIMIT 100`,
    [ctx.gateway.name],
  );
  let fixed = 0;
  for (const row of r.rows) {
    try {
      const out = await ctx.gateway.stopCardSubscription(row.sub);
      if (out.result === 'not_visible') {
        const recentlyAlerted = row.alerted !== null && Date.now() - new Date(row.alerted).getTime() < 7 * 86_400_000;
        const tooOld = row.canceled_at !== null && Date.now() - new Date(row.canceled_at).getTime() > 45 * 86_400_000;
        if (!recentlyAlerted && !tooOld) await alertUnverified(ctx, row.subscriber_id, row.sub, 'varredura');
        continue;
      }
      if (row.verified !== true) await ctx.db.query(`UPDATE app.billing_profiles SET cancel_verified = true WHERE subscriber_id = $1`, [row.subscriber_id]);
      if (out.result === 'stopped' || out.chargesRemoved > 0) {
        fixed += 1;
        await audit(ctx.db, 'system', 'charge_after_cancel_removed', 'subscriber', row.subscriber_id, { assinatura: out.result, cobrancasRemovidas: out.chargesRemoved });
        await alertOwners(ctx, 'Cobrança de assinatura cancelada foi barrada', [`Encontramos ${out.result === 'stopped' ? 'a assinatura ainda ativa e ' : ''}${out.chargesRemoved} cobrança(s) em aberto de um cliente que já tinha cancelado (${row.subscriber_id.slice(0, 8)}). Já foram apagadas no Asaas.`]);
      }
    } catch (e) {
      opts.log?.({ evento: 'varredura_cancelados_falhou', erro: e instanceof Error ? e.message.slice(0, 120) : 'erro' });
    }
  }
  return fixed;
}

async function markCanceled(ctx: Ctx, subscriberId: string, by: 'subscriber' | 'provider', verified: boolean | null = null): Promise<void> {
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.billing_profiles SET status = 'canceled', canceled_at = now(), cancel_verified = coalesce($2, cancel_verified) WHERE subscriber_id = $1`, [subscriberId, verified]);
    await q.query(`UPDATE app.subscriptions SET cancel_at_period_end = true, canceled_at = coalesce(canceled_at, now()) WHERE subscriber_id = $1`, [subscriberId]);
    await audit(q, by === 'subscriber' ? `subscriber:${subscriberId}` : 'system', 'subscription_canceled', 'subscriber', subscriberId, { by });
  });
}

/** Cancelamento pedido pela pessoa: para a cobrança agora; o acesso e os downloads seguem até o fim do mês pago. */
export async function cancelCardSubscription(ctx: Ctx, subscriberId: string): Promise<{ accessUntil: number }> {
  await assertNotOwner(ctx, subscriberId);
  const bp = await ctx.db.query<{ status: string; provider_subscription_id: string | null }>(`SELECT status, provider_subscription_id FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  const p = bp.rows[0];
  if (!p || p.status === 'pending') {
    // Nada cobrado ainda (checkout abandonado): encerra a assinatura criada no provedor (senão ela segue gerando cobrança) e limpa.
    if (p?.provider_subscription_id) await stopAndAlert(ctx, subscriberId, p.provider_subscription_id, 'cancelamento');
    await ctx.db.query(`DELETE FROM app.billing_profiles WHERE subscriber_id = $1 AND status = 'pending'`, [subscriberId]);
    throw new AppError(409, 'nothing_to_cancel', 'Não há assinatura ativa para cancelar.');
  }
  let verified = true;
  if (p.status !== 'canceled' && p.provider_subscription_id) verified = (await stopAndAlert(ctx, subscriberId, p.provider_subscription_id, 'cancelamento')).result !== 'not_visible';
  if (p.status !== 'canceled') await markCanceled(ctx, subscriberId, 'subscriber', verified);
  const sub = await ctx.db.query<{ current_period_end: Date | string }>(`SELECT current_period_end FROM app.subscriptions WHERE subscriber_id = $1`, [subscriberId]);
  return { accessUntil: new Date(sub.rows[0]?.current_period_end ?? Date.now()).getTime() };
}

export interface BillingView {
  mode: 'card' | 'pix';
  status: 'active' | 'past_due' | 'canceled';
  priceCents: number | null;
  renewsOn: number | null;
  canceledAt: number | null;
  accessUntil: number | null;
}

/** Como a assinatura é cobrada e o que mostrar no cabeçalho (mensal, renova em…, cancelado, acesso até…). */
export async function billingView(ctx: Ctx, subscriberId: string): Promise<BillingView | null> {
  const r = await ctx.db.query<{ status: string; canceled_at: Date | null; period_end: Date | string | null; plan: string }>(
    `SELECT b.status, b.canceled_at, s.current_period_end AS period_end, b.plan FROM app.billing_profiles b LEFT JOIN app.subscriptions s ON s.subscriber_id = b.subscriber_id WHERE b.subscriber_id = $1`,
    [subscriberId],
  );
  const b = r.rows[0];
  if (!b || b.status === 'pending') return null;
  const plan = planByCode(b.plan);
  const price = plan ? await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1`, [plan.productCode]) : { rows: [] as { price_cents: string }[] };
  const end = b.period_end ? new Date(b.period_end).getTime() : null;
  return {
    mode: 'card',
    status: b.status as BillingView['status'],
    priceCents: price.rows[0] ? num(price.rows[0].price_cents) : null,
    renewsOn: b.status === 'canceled' ? null : end,
    canceledAt: b.canceled_at ? new Date(b.canceled_at).getTime() : null,
    accessUntil: end,
  };
}

/** Texto padrão do aviso de cancelamento (mesmo nas telas, no e-mail e nos termos). */
export const CANCEL_NOTICE = (accessUntil: string, purgeDays: number) =>
  `Cobrança interrompida. Você continua com acesso ao Prumo e pode baixar todos os seus dados até ${accessUntil}. Não devolvemos o valor do mês em andamento. Depois dessa data seus dados são apagados automaticamente (mantemos uma cópia de segurança por até ${purgeDays} dias, só para o caso de você pedir ajuda, e então eliminamos tudo).`;

export function cancelEmail(ctx: Ctx, to: string, accessUntil: string): Promise<void> {
  if (!ctx.email) return Promise.resolve();
  const body = layout('Sua assinatura do Prumo foi cancelada', [
    `Paramos a cobrança agora. Você continua com acesso ao Prumo até ${accessUntil} e pode baixar todos os seus dados (planilha e PDF) pela aba Plano até essa data.`,
    'Não devolvemos o valor do mês em andamento. Depois da data de encerramento, seus dados são apagados automaticamente.',
    'Mudou de ideia? Depois do fim do mês pago é só assinar de novo.',
  ], { label: 'Baixar meus dados', url: `${ctx.config.publicUrl}/conta/plano` });
  return ctx.email.send({ to, subject: 'Prumo: assinatura cancelada e como baixar seus dados', ...body }).catch(() => undefined);
}

export const formatBrl0 = formatBrl;
