// Indicações.
// - Produtos pagos no Pix (pagamento único): o comprador indica um amigo por e-mail. SÓ gera lead: sem desconto nem bônus.
// - Prumo (assinatura mensal): cada indicação que vira assinante dá ao assinante um crédito de desconto (padrão 10%) na
//   PRÓXIMA fatura. Os créditos se acumulam: 10 indicações que assinam = 10 faturas seguidas com desconto.
import { randomBytes } from 'node:crypto';
import { AppError, notFound } from './errors.ts';
import { brandLayout } from './email.ts';
import { hmac, safeEqual } from './crypto.ts';
import type { Ctx } from './services.ts';
import { audit, num } from './services.ts';
import type { Queryable } from './db.ts';
import { planByCode } from './engine.ts';
import { requireFeature } from './subscriptions.ts';
import { createHash } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SESSION_LIMIT = 5; // convites por comprador de Pix
const SUBSCRIBER_LIMIT = 30; // convites por assinante
const FRIEND_COOLDOWN_DAYS = 30; // o mesmo amigo não recebe de novo dentro deste prazo

const emailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Valor com desconto (centavos), arredondado para baixo. */
export const discounted = (priceCents: number, percent: number) => Math.floor((priceCents * (100 - percent)) / 100);

// ---------------------------------------------------------------------------
// Descadastro de convites (link no e-mail do amigo): token assinado por e-mail
// ---------------------------------------------------------------------------
export const optOutToken = (ctx: Ctx, email: string) => {
  const e = Buffer.from(email.trim().toLowerCase()).toString('base64url');
  return `r.${e}.${hmac(ctx.config.secret, `refopt:${e}`).toString('base64url').slice(0, 32)}`;
};
export const optOutUrl = (ctx: Ctx, email: string) => `${ctx.config.publicUrl}/descadastrar#${optOutToken(ctx, email)}`;

export async function referralOptOut(ctx: Ctx, token: string): Promise<boolean> {
  const [tag, e, sig] = token.split('.');
  if (tag !== 'r' || !e || !sig) return false;
  if (!safeEqual(sig, hmac(ctx.config.secret, `refopt:${e}`).toString('base64url').slice(0, 32))) throw new AppError(400, 'invalid_link', 'Este link de cancelamento não é válido.');
  const email = Buffer.from(e, 'base64url').toString('utf8');
  await ctx.db.query(`INSERT INTO app.referral_optout(email_hash) VALUES ($1) ON CONFLICT DO NOTHING`, [emailHash(email)]);
  return true;
}

// ---------------------------------------------------------------------------
// Código de indicação
// ---------------------------------------------------------------------------
export async function ensureReferralCode(ctx: Ctx, subscriberId: string): Promise<string> {
  const cur = await ctx.db.query<{ referral_code: string | null }>(`SELECT referral_code FROM app.subscribers WHERE id = $1`, [subscriberId]);
  if (cur.rows[0]?.referral_code) return cur.rows[0].referral_code;
  for (let i = 0; i < 6; i += 1) {
    const bytes = randomBytes(8);
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    const r = await ctx.db.query(`UPDATE app.subscribers SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL AND NOT EXISTS (SELECT 1 FROM app.subscribers WHERE referral_code = $2)`, [subscriberId, code]);
    if (r.rowCount > 0) return code;
    const again = await ctx.db.query<{ referral_code: string | null }>(`SELECT referral_code FROM app.subscribers WHERE id = $1`, [subscriberId]);
    if (again.rows[0]?.referral_code) return again.rows[0].referral_code;
  }
  throw new AppError(500, 'code_failed', 'Não consegui gerar o seu código agora.');
}

const firstName = (name: string | null | undefined, email = '') => {
  const raw = (name ?? email.split('@')[0] ?? '').trim().split(/[\s._-]+/)[0] ?? '';
  const clean = raw.replace(/[^\p{L}]/gu, '').slice(0, 24);
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : '';
};

async function suppressed(ctx: Ctx, friendEmail: string): Promise<boolean> {
  const o = await ctx.db.query(`SELECT 1 FROM app.referral_optout WHERE email_hash = $1`, [emailHash(friendEmail)]);
  if (o.rows.length > 0) return true;
  const recent = await ctx.db.query(`SELECT 1 FROM app.referrals WHERE friend_email = $1 AND created_at > now() - make_interval(days => ${FRIEND_COOLDOWN_DAYS})`, [friendEmail]);
  return recent.rows.length > 0;
}

// ---------------------------------------------------------------------------
// E-mails
// ---------------------------------------------------------------------------
async function sendLeadMail(ctx: Ctx, to: string, who: string): Promise<void> {
  if (!ctx.email) return;
  const name = who || 'Um amigo';
  const mail = brandLayout({
    preheader: `${name} indicou o Fôlego para você.`,
    kicker: 'Uma indicação de amigo',
    title: `${name} lembrou de você`,
    paragraphs: [
      `Oi! Passando para contar uma coisa boa: **${name} está curtindo o Fôlego** e achou que você ia gostar também.`,
      'O Fôlego é um jeito calmo de olhar para o dinheiro. Você informa suas dívidas e seus números, e em poucos minutos vê um diagnóstico claro, com a ordem certa para pagar e um plano para respirar melhor. **Sem cadastro, sem CPF, sem senha do banco.**',
    ],
    highlight: {
      title: 'Como funciona',
      items: ['O diagnóstico inicial é **grátis** e leva cerca de 3 minutos', 'Você só paga, no Pix e uma vez só, **se gostar** do resultado completo', 'Seus dados ficam só pelo tempo necessário e você pode apagar quando quiser'],
    },
    button: { label: 'Fazer meu diagnóstico grátis', url: `${ctx.config.publicUrl}/?ind=amigo` },
    closing: [`Você recebeu este e-mail porque ${name} informou o seu endereço. Se não quiser receber mais nada assim, é só usar o link abaixo: respeitamos na hora.`, 'Com carinho,\n**Equipe Fôlego**'],
    optOut: { label: 'Não quero receber indicações do Fôlego', url: optOutUrl(ctx, to) },
  });
  await ctx.email.send({ to, subject: `${name} indicou o Fôlego para você`, ...mail, headers: { 'List-Unsubscribe': `<${optOutUrl(ctx, to)}>` } });
}

async function sendSubscriberMail(ctx: Ctx, to: string, who: string, code: string): Promise<void> {
  if (!ctx.email) return;
  const name = who || 'Um amigo';
  const link = `${ctx.config.publicUrl}/conta?ind=${code}`;
  const mail = brandLayout({
    preheader: `${name} está usando o Prumo e indicou para você.`,
    kicker: 'Uma indicação de amigo',
    title: `${name} indicou o Prumo para você`,
    paragraphs: [
      `Oi! **${name} está usando o Prumo**, o app de finanças do Fôlego, e está gostando tanto que lembrou de você.`,
      'O Prumo reúne em um só lugar o controle de gastos, as dívidas com plano de quitação, metas, lembretes de contas e um coach que mostra, todo dia, o próximo passo. Você acompanha o dinheiro com calma e vê o progresso mês a mês.',
    ],
    highlight: {
      title: 'O que você encontra no Prumo',
      items: ['**Nota de saúde financeira** e jornadas de transformação', 'Dívidas com **plano de quitação** (avalanche ou bola de neve)', 'Orçamento por mês, metas e lembretes por e-mail', 'Cenário econômico (Selic, inflação, CDI) explicado em português claro'],
    },
    button: { label: `Conhecer o Prumo`, url: link },
    closing: ['A cobrança é mensal no cartão e você cancela quando quiser, sem fidelidade.', `Você recebeu este e-mail porque ${name} informou o seu endereço.`, 'Com carinho,\n**Equipe Fôlego**'],
    optOut: { label: 'Não quero receber indicações do Fôlego', url: optOutUrl(ctx, to) },
  });
  await ctx.email.send({ to, subject: `${name} indicou o Prumo, o app de finanças do Fôlego, para você`, ...mail, headers: { 'List-Unsubscribe': `<${optOutUrl(ctx, to)}>` } });
}

// ---------------------------------------------------------------------------
// Indicar: comprador de produto Pix (lead) e assinante (com bônus)
// ---------------------------------------------------------------------------
export async function inviteLead(ctx: Ctx, args: { sessionId: string; friendEmail: string; yourName: string }): Promise<void> {
  if (!ctx.config.referralEnabled) throw notFound();
  const paid = await ctx.db.query(`SELECT 1 FROM app.orders WHERE session_id = $1 AND status = 'paid' LIMIT 1`, [args.sessionId]);
  if (paid.rows.length === 0) throw new AppError(403, 'not_a_customer', 'A indicação fica disponível depois que você usa um produto do Fôlego.');
  const friend = args.friendEmail.trim().toLowerCase();
  const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.referrals WHERE referrer_session_id = $1`, [args.sessionId]);
  if (num(used.rows[0]?.n ?? 0) >= SESSION_LIMIT) throw new AppError(429, 'referral_limit', `Você já indicou ${SESSION_LIMIT} amigos. Obrigado por espalhar o Fôlego!`);
  const name = firstName(args.yourName);
  if (!name) throw new AppError(422, 'name_required', 'Diga o seu primeiro nome para o seu amigo saber quem indicou.');
  if (await suppressed(ctx, friend)) return; // silencioso: não revelamos quem pediu para não receber
  await ctx.db.query(`INSERT INTO app.referrals(kind, referrer_session_id, referrer_name, friend_email) VALUES ('lead',$1,$2,$3)`, [args.sessionId, name, friend]);
  await sendLeadMail(ctx, friend, name);
}

export async function inviteBySubscriber(ctx: Ctx, subscriberId: string, friendEmail: string): Promise<void> {
  if (!ctx.config.referralEnabled) throw notFound();
  await requireFeature(ctx, subscriberId, 'ledger');
  const friend = friendEmail.trim().toLowerCase();
  const me = await ctx.db.query<{ email: string; display_name: string | null }>(`SELECT email::text AS email, display_name FROM app.subscribers WHERE id = $1`, [subscriberId]);
  if (me.rows[0]?.email.toLowerCase() === friend) throw new AppError(422, 'self_invite', 'Indique outra pessoa: este é o seu próprio e-mail.');
  const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.referrals WHERE referrer_subscriber_id = $1`, [subscriberId]);
  if (num(used.rows[0]?.n ?? 0) >= SUBSCRIBER_LIMIT) throw new AppError(429, 'referral_limit', `Você chegou ao limite de ${SUBSCRIBER_LIMIT} convites por e-mail. Compartilhe o seu link!`);
  // Quem já é assinante ativo não rende indicação.
  const already = await ctx.db.query(`SELECT 1 FROM app.subscribers b JOIN app.billing_profiles p ON p.subscriber_id = b.id AND p.status IN ('active','past_due') WHERE lower(b.email::text) = $1`, [friend]);
  if (already.rows.length > 0) throw new AppError(409, 'already_subscriber', 'Esta pessoa já usa o Prumo. Que tal indicar outra?');
  if (await suppressed(ctx, friend)) return;
  const code = await ensureReferralCode(ctx, subscriberId);
  await ctx.db.query(`INSERT INTO app.referrals(kind, referrer_subscriber_id, referrer_name, friend_email) VALUES ('subscriber',$1,$2,$3)`, [subscriberId, firstName(me.rows[0]?.display_name, me.rows[0]?.email), friend]);
  await sendSubscriberMail(ctx, friend, firstName(me.rows[0]?.display_name, me.rows[0]?.email), code);
}

// ---------------------------------------------------------------------------
// Atribuição no checkout e conversão no primeiro pagamento
// ---------------------------------------------------------------------------
/** No início do checkout: descobre quem indicou (pelo código do link ou pelo e-mail convidado) e grava no perfil de cobrança. */
export async function attribute(ctx: Ctx, subscriberId: string, code: string | undefined): Promise<void> {
  if (!ctx.config.referralEnabled) return;
  const me = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [subscriberId]);
  const done = await ctx.db.query(`SELECT 1 FROM app.billing_profiles WHERE subscriber_id = $1 AND (referral_credited_at IS NOT NULL OR last_charge_at IS NOT NULL)`, [subscriberId]);
  if (done.rows.length > 0) return; // só a primeira assinatura conta
  let referrer: string | null = null;
  let referralId: string | null = null;
  if (code && /^[a-z0-9]{8}$/.test(code)) {
    const r = await ctx.db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE referral_code = $1 AND deleted_at IS NULL`, [code]);
    referrer = r.rows[0]?.id ?? null;
  }
  const email = me.rows[0]?.email.toLowerCase() ?? '';
  const invited = await ctx.db.query<{ id: string; referrer_subscriber_id: string }>(
    `SELECT id, referrer_subscriber_id FROM app.referrals WHERE kind = 'subscriber' AND lower(friend_email::text) = $1 AND status = 'sent' AND referrer_subscriber_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  if (!referrer && invited.rows[0]) referrer = invited.rows[0].referrer_subscriber_id;
  if (referrer && invited.rows[0]?.referrer_subscriber_id === referrer) referralId = invited.rows[0].id;
  if (!referrer || referrer === subscriberId) return;
  // Mesmo e-mail em outra conta do indicador não vale (autoindicação).
  const same = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [referrer]);
  if (same.rows[0]?.email.toLowerCase() === email) return;
  await ctx.db.query(`UPDATE app.billing_profiles SET referred_by = $2, referral_id = $3 WHERE subscriber_id = $1`, [subscriberId, referrer, referralId]);
}

/** Dentro da transação do pagamento confirmado: consome um crédito (se a fatura veio com desconto) e premia quem indicou. */
export async function onSubscriptionPaid(ctx: Ctx, q: Queryable, subscriberId: string, payment: { id: string; amountCents: number }): Promise<void> {
  // 1) fatura com desconto: gasta o crédito mais antigo
  const prof = await q.query<{ plan: string; referred_by: string | null; referral_id: string | null; referral_credited_at: Date | null; last_charge_at: Date | null; contract_cents: string | null }>(`SELECT plan, referred_by, referral_id, referral_credited_at, last_charge_at, contract_cents FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  const p = prof.rows[0];
  if (!p) return;
  const plan = planByCode(p.plan);
  const price = plan ? await q.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1`, [plan.productCode]) : { rows: [] as { price_cents: string }[] };
  const list = num(p.contract_cents ?? price.rows[0]?.price_cents ?? 0); // valor contratado: mudar o preço do plano não mexe em quem já assina
  const pct = ctx.config.referralDiscountPct;
  // A fatura veio com desconto se o valor cobrado é o do crédito mais antigo: gasta esse crédito (e só um por fatura).
  const next = await q.query<{ id: string; percent: number }>(`SELECT id, percent FROM app.referral_credits WHERE subscriber_id = $1 AND status = 'available' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [subscriberId]);
  if (next.rows[0] && list > 0 && payment.amountCents <= discounted(list, next.rows[0].percent) + 1) {
    await q.query(`UPDATE app.referral_credits SET status = 'applied', applied_at = now(), applied_payment_id = $2 WHERE id = $1`, [next.rows[0].id, payment.id]);
    await audit(q, 'system', 'referral_credit_applied', 'subscriber', subscriberId, { credit: next.rows[0].id, percent: next.rows[0].percent, chargedCents: payment.amountCents, listCents: list });
  }
  // 2) primeira mensalidade de quem veio por indicação: o indicador ganha um crédito
  if (ctx.config.referralEnabled && pct > 0 && p.referred_by && !p.referral_credited_at) {
    const credit = await q.query<{ id: string }>(`INSERT INTO app.referral_credits(subscriber_id, referral_id, percent, source) VALUES ($1,$2,$3,'indicacao') RETURNING id`, [p.referred_by, p.referral_id, pct]);
    await q.query(`UPDATE app.billing_profiles SET referral_credited_at = now() WHERE subscriber_id = $1`, [subscriberId]);
    if (p.referral_id) await q.query(`UPDATE app.referrals SET status = 'converted', converted_subscriber_id = $2, converted_at = now() WHERE id = $1`, [p.referral_id, subscriberId]);
    else await q.query(`INSERT INTO app.referrals(kind, referrer_subscriber_id, friend_email, status, converted_subscriber_id, converted_at) SELECT 'subscriber', $1, email, 'converted', $2, now() FROM app.subscribers WHERE id = $2`, [p.referred_by, subscriberId]);
    await audit(q, 'system', 'referral_credit_granted', 'subscriber', p.referred_by, { credit: credit.rows[0]!.id, from: subscriberId, percent: pct });
  }
}

// ---------------------------------------------------------------------------
// Visão do assinante
// ---------------------------------------------------------------------------
const mask = (email: string) => {
  const [u = '', d = ''] = email.split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, Math.min(6, u.length - 2)))}@${d}`;
};

export async function overview(ctx: Ctx, subscriberId: string) {
  await requireFeature(ctx, subscriberId, 'ledger');
  const code = await ensureReferralCode(ctx, subscriberId);
  const counts = await ctx.db.query<{ sent: string; converted: string }>(`SELECT count(*)::text AS sent, count(*) FILTER (WHERE status = 'converted')::text AS converted FROM app.referrals WHERE referrer_subscriber_id = $1`, [subscriberId]);
  const cr = await ctx.db.query<{ available: string; applied: string }>(`SELECT count(*) FILTER (WHERE status = 'available')::text AS available, count(*) FILTER (WHERE status = 'applied')::text AS applied FROM app.referral_credits WHERE subscriber_id = $1`, [subscriberId]);
  const recent = await ctx.db.query<{ friend_email: string; status: string; created_at: Date; converted_at: Date | null }>(`SELECT friend_email::text AS friend_email, status, created_at, converted_at FROM app.referrals WHERE referrer_subscriber_id = $1 ORDER BY created_at DESC LIMIT 20`, [subscriberId]);
  const prof = await ctx.db.query<{ plan: string; status: string; contract_cents: string | null }>(`SELECT plan, status, contract_cents FROM app.billing_profiles WHERE subscriber_id = $1`, [subscriberId]);
  const plan = prof.rows[0] ? planByCode(prof.rows[0].plan) : null;
  const price = plan ? await ctx.db.query<{ price_cents: string }>(`SELECT price_cents FROM app.products WHERE code = $1`, [plan.productCode]) : { rows: [] as { price_cents: string }[] };
  const list = num(prof.rows[0]?.contract_cents ?? price.rows[0]?.price_cents ?? 0);
  const available = num(cr.rows[0]?.available ?? 0);
  const firstPct = await ctx.db.query<{ percent: number }>(`SELECT percent FROM app.referral_credits WHERE subscriber_id = $1 AND status = 'available' ORDER BY created_at LIMIT 1`, [subscriberId]);
  const pct = firstPct.rows[0]?.percent ?? ctx.config.referralDiscountPct;
  return {
    enabled: ctx.config.referralEnabled,
    percent: pct,
    code,
    link: `${ctx.config.publicUrl}/conta?ind=${code}`,
    invited: num(counts.rows[0]?.sent ?? 0),
    converted: num(counts.rows[0]?.converted ?? 0),
    credits: { available, applied: num(cr.rows[0]?.applied ?? 0) },
    next: available > 0 && list > 0 ? { percent: pct, valueCents: discounted(list, pct), listCents: list, months: available } : null,
    recent: recent.rows.map((r) => ({ friend: mask(r.friend_email), status: r.status, at: new Date(r.created_at).toISOString(), convertedAt: r.converted_at ? new Date(r.converted_at).toISOString() : null })),
  };
}

// ---------------------------------------------------------------------------
// Worker: avisa quem ganhou desconto e ajusta o valor da próxima fatura no provedor
// ---------------------------------------------------------------------------
export async function notifyCredits(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) return 0;
  const due = await ctx.db.query<{ id: string; subscriber_id: string; email: string; display_name: string | null; percent: number; avail: string }>(
    `SELECT c.id, c.subscriber_id, b.email::text AS email, b.display_name, c.percent,
            (SELECT count(*) FROM app.referral_credits x WHERE x.subscriber_id = c.subscriber_id AND x.status = 'available')::text AS avail
       FROM app.referral_credits c JOIN app.subscribers b ON b.id = c.subscriber_id AND b.deleted_at IS NULL
      WHERE c.status = 'available' AND c.source = 'indicacao' AND c.note IS NULL ORDER BY c.created_at LIMIT 20`,
  );
  let sent = 0;
  for (const c of due.rows) {
    const name = firstName(c.display_name, c.email);
    const mail = brandLayout({
      preheader: `Uma indicação sua virou assinatura: ${c.percent}% de desconto na sua próxima fatura.`,
      kicker: 'Obrigado por indicar',
      title: name ? `${name}, uma indicação sua assinou o Prumo` : 'Uma indicação sua assinou o Prumo',
      paragraphs: [`Boa notícia! Um amigo que você indicou acabou de assinar. Como agradecimento, a sua **próxima fatura vem com ${c.percent}% de desconto**.`, `Você já acumula **${c.avail} ${Number(c.avail) === 1 ? 'mês' : 'meses'} de desconto**: cada indicação que assina vale um mês, um depois do outro. Não precisa fazer nada, o desconto entra sozinho na cobrança.`],
      button: { label: 'Ver minhas indicações', url: `${ctx.config.publicUrl}/conta/indicar` },
      closing: ['Continue indicando: quem você traz ganha um jeito mais calmo de cuidar do dinheiro, e você ganha desconto.', 'Com carinho,\n**Equipe Fôlego**'],
    });
    try {
      await ctx.email.send({ to: c.email, subject: `Sua indicação assinou o Prumo: ${c.percent}% de desconto na próxima fatura`, ...mail });
      await ctx.db.query(`UPDATE app.referral_credits SET note = 'avisado' WHERE id = $1`, [c.id]);
      sent += 1;
    } catch {
      opts.log?.({ evento: 'credito_indicacao_aviso_falhou' });
    }
  }
  return sent;
}

/** Mantém o valor da assinatura no provedor igual ao que deve ser cobrado na próxima fatura (com ou sem desconto). */
export async function syncPrices(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled) return 0;
  const rows = await ctx.db.query<{ subscriber_id: string; provider_subscription_id: string; plan: string; price_cents: string; next_pct: number | null; synced: string | null }>(
    `SELECT b.subscriber_id, b.provider_subscription_id, b.plan, coalesce(b.contract_cents, pr.price_cents) AS price_cents,
            (SELECT c.percent FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available' ORDER BY c.created_at LIMIT 1) AS next_pct,
            b.synced_value_cents::text AS synced
       FROM app.billing_profiles b
       JOIN app.products pr ON pr.code = 'sub_' || b.plan
      WHERE b.status IN ('active','past_due') AND b.provider_subscription_id IS NOT NULL LIMIT 200`,
  );
  let changed = 0;
  for (const r of rows.rows) {
    const list = num(r.price_cents);
    const want = r.next_pct ? discounted(list, r.next_pct) : list; // valor contratado, com o desconto do próximo crédito se houver
    const have = r.synced === null ? list : num(r.synced);
    if (want === have) continue;
    try {
      await ctx.gateway.updateCardSubscriptionValue(r.provider_subscription_id, want);
      await ctx.db.query(`UPDATE app.billing_profiles SET synced_value_cents = $2 WHERE subscriber_id = $1`, [r.subscriber_id, want]);
      changed += 1;
    } catch {
      opts.log?.({ evento: 'sincronizar_valor_assinatura_falhou' });
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Backoffice
// ---------------------------------------------------------------------------
export async function adminOverview(ctx: Ctx) {
  const k = await ctx.db.query<{ leads: string; subs: string; converted: string; avail: string; applied: string; manual: string }>(
    `SELECT (SELECT count(*) FROM app.referrals WHERE kind = 'lead')::text AS leads,
            (SELECT count(*) FROM app.referrals WHERE kind = 'subscriber')::text AS subs,
            (SELECT count(*) FROM app.referrals WHERE status = 'converted')::text AS converted,
            (SELECT count(*) FROM app.referral_credits WHERE status = 'available')::text AS avail,
            (SELECT count(*) FROM app.referral_credits WHERE status = 'applied')::text AS applied,
            (SELECT count(*) FROM app.referral_credits WHERE source = 'manual' AND status <> 'revoked')::text AS manual`,
  );
  const top = await ctx.db.query<{ subscriber_id: string; email: string; sent: string; converted: string; avail: string; applied: string }>(
    `SELECT b.id AS subscriber_id, b.email::text AS email,
            (SELECT count(*) FROM app.referrals r WHERE r.referrer_subscriber_id = b.id)::text AS sent,
            (SELECT count(*) FROM app.referrals r WHERE r.referrer_subscriber_id = b.id AND r.status = 'converted')::text AS converted,
            (SELECT count(*) FROM app.referral_credits c WHERE c.subscriber_id = b.id AND c.status = 'available')::text AS avail,
            (SELECT count(*) FROM app.referral_credits c WHERE c.subscriber_id = b.id AND c.status = 'applied')::text AS applied
       FROM app.subscribers b WHERE b.deleted_at IS NULL AND (EXISTS (SELECT 1 FROM app.referrals r WHERE r.referrer_subscriber_id = b.id) OR EXISTS (SELECT 1 FROM app.referral_credits c WHERE c.subscriber_id = b.id))
      ORDER BY (SELECT count(*) FROM app.referrals r WHERE r.referrer_subscriber_id = b.id AND r.status = 'converted') DESC, 3 DESC LIMIT 30`,
  );
  const recent = await ctx.db.query<{ kind: string; referrer: string | null; referrer_name: string | null; friend_email: string; status: string; created_at: Date; converted_at: Date | null }>(
    `SELECT r.kind, b.email::text AS referrer, r.referrer_name, r.friend_email::text AS friend_email, r.status, r.created_at, r.converted_at FROM app.referrals r LEFT JOIN app.subscribers b ON b.id = r.referrer_subscriber_id ORDER BY r.created_at DESC LIMIT 40`,
  );
  const kv = k.rows[0];
  const subs = num(kv?.subs ?? 0);
  const converted = num(kv?.converted ?? 0);
  return {
    enabled: ctx.config.referralEnabled,
    percent: ctx.config.referralDiscountPct,
    kpis: { leadInvites: num(kv?.leads ?? 0), subscriberInvites: subs, converted, conversionPct: subs > 0 ? Math.round((converted / subs) * 100) : 0, creditsAvailable: num(kv?.avail ?? 0), creditsApplied: num(kv?.applied ?? 0), manualCredits: num(kv?.manual ?? 0) },
    top: top.rows.map((t) => ({ subscriberId: t.subscriber_id, email: t.email, sent: num(t.sent), converted: num(t.converted), available: num(t.avail), applied: num(t.applied) })),
    reconcile: await reconcile(ctx),
    recent: recent.rows.map((r) => ({ kind: r.kind, referrer: r.referrer ?? r.referrer_name ?? '—', friend: mask(r.friend_email), status: r.status, at: new Date(r.created_at).toISOString(), convertedAt: r.converted_at ? new Date(r.converted_at).toISOString() : null })),
  };
}

/** Ajuste manual de créditos (cortesia ou correção), sempre com motivo e na auditoria. */
export async function adjustCredits(ctx: Ctx, adminId: string, subscriberId: string, delta: number, reason: string): Promise<{ available: number }> {
  const exists = await ctx.db.query(`SELECT 1 FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL`, [subscriberId]);
  if (exists.rows.length === 0) throw notFound();
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 12) throw new AppError(422, 'invalid_delta', 'Ajuste entre -12 e +12 créditos.');
  if (reason.trim().length < 3) throw new AppError(422, 'reason_required', 'Explique o motivo do ajuste.');
  await ctx.db.tx(async (q) => {
    if (delta > 0) {
      for (let i = 0; i < delta; i += 1) await q.query(`INSERT INTO app.referral_credits(subscriber_id, percent, source, note) VALUES ($1,$2,'manual',$3)`, [subscriberId, ctx.config.referralDiscountPct, reason.trim().slice(0, 200)]);
    } else {
      await q.query(`UPDATE app.referral_credits SET status = 'revoked', note = $3 WHERE id IN (SELECT id FROM app.referral_credits WHERE subscriber_id = $1 AND status = 'available' ORDER BY created_at DESC LIMIT $2)`, [subscriberId, -delta, reason.trim().slice(0, 200)]);
    }
    await audit(q, `admin:${adminId}`, 'referral_credits_adjusted', 'subscriber', subscriberId, { delta, reason: reason.trim().slice(0, 200) });
  });
  const left = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.referral_credits WHERE subscriber_id = $1 AND status = 'available'`, [subscriberId]);
  return { available: num(left.rows[0]?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// Controle por cliente e conferência geral (backoffice)
// ---------------------------------------------------------------------------
/** Tudo sobre indicações e descontos de UM assinante, para o dono ter certeza do que foi dado, aplicado e cobrado. */
export async function subscriberReferralView(ctx: Ctx, subscriberId: string) {
  const code = await ctx.db.query<{ referral_code: string | null }>(`SELECT referral_code FROM app.subscribers WHERE id = $1`, [subscriberId]);
  const by = await ctx.db.query<{ email: string | null; credited_at: Date | null }>(
    `SELECT r.email::text AS email, p.referral_credited_at AS credited_at FROM app.billing_profiles p LEFT JOIN app.subscribers r ON r.id = p.referred_by WHERE p.subscriber_id = $1 AND p.referred_by IS NOT NULL`,
    [subscriberId],
  );
  const counts = await ctx.db.query<{ sent: string; converted: string }>(`SELECT count(*)::text AS sent, count(*) FILTER (WHERE status = 'converted')::text AS converted FROM app.referrals WHERE referrer_subscriber_id = $1`, [subscriberId]);
  const credits = await ctx.db.query<{ id: string; status: string; percent: number; source: string; note: string | null; created_at: Date; applied_at: Date | null; amount: string | null; friend: string | null }>(
    `SELECT c.id, c.status, c.percent, c.source, c.note, c.created_at, c.applied_at, p.amount_cents AS amount, f.email::text AS friend
       FROM app.referral_credits c
       LEFT JOIN app.payments p ON p.id = c.applied_payment_id
       LEFT JOIN app.referrals r ON r.id = c.referral_id
       LEFT JOIN app.subscribers f ON f.id = r.converted_subscriber_id
      WHERE c.subscriber_id = $1 ORDER BY c.created_at DESC LIMIT 60`,
    [subscriberId],
  );
  const bp = await ctx.db.query<{ plan: string; status: string; provider_subscription_id: string | null; synced: string | null; last_charge_at: Date | null; terms_accepted_at: Date; terms_version: string; price: string | null; avail: string; next_pct: number | null }>(
    `SELECT b.plan, b.status, b.provider_subscription_id, b.synced_value_cents::text AS synced, b.last_charge_at, b.terms_accepted_at, b.terms_version, coalesce(b.contract_cents, pr.price_cents)::text AS price,
            (SELECT c.percent FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available' ORDER BY c.created_at LIMIT 1) AS next_pct,
            (SELECT count(*) FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available')::text AS avail
       FROM app.billing_profiles b LEFT JOIN app.products pr ON pr.code = 'sub_' || b.plan WHERE b.subscriber_id = $1`,
    [subscriberId],
  );
  const b = bp.rows[0];
  const list = num(b?.price ?? 0);
  const wanted = b && list > 0 ? (b.next_pct ? discounted(list, b.next_pct) : list) : null;
  const synced = b ? (b.synced === null ? list : num(b.synced)) : null;
  return {
    code: code.rows[0]?.referral_code ?? null,
    referredBy: by.rows[0]?.email ?? null,
    creditedForReferrer: Boolean(by.rows[0]?.credited_at),
    invited: num(counts.rows[0]?.sent ?? 0),
    converted: num(counts.rows[0]?.converted ?? 0),
    credits: credits.rows.map((c) => ({ id: c.id, status: c.status, percent: c.percent, source: c.source, note: c.note === 'avisado' ? null : c.note, createdAt: new Date(c.created_at).toISOString(), appliedAt: c.applied_at ? new Date(c.applied_at).toISOString() : null, appliedAmountCents: c.amount === null ? null : num(c.amount), friend: c.friend ? mask(c.friend) : null })),
    billing: b ? { plan: b.plan, status: b.status, lastChargeAt: b.last_charge_at ? new Date(b.last_charge_at).toISOString() : null, termsAcceptedAt: new Date(b.terms_accepted_at).toISOString(), termsVersion: b.terms_version, providerSubscriptionId: b.provider_subscription_id, listCents: list, wantedCents: wanted, syncedCents: synced, inSync: wanted === synced, creditsAvailable: num(b.avail) } : null,
  };
}

/** Conferência: quem tem desconto a receber, qual valor deve ser cobrado e qual valor está de fato no provedor. */
export async function reconcile(ctx: Ctx) {
  const r = await ctx.db.query<{ subscriber_id: string; email: string; plan: string; status: string; price: string | null; avail: string; next_pct: number | null; synced: string | null; period_end: Date | null }>(
    `SELECT b.subscriber_id, s.email::text AS email, b.plan, b.status, coalesce(b.contract_cents, pr.price_cents)::text AS price, b.synced_value_cents::text AS synced, sub.current_period_end AS period_end,
            (SELECT c.percent FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available' ORDER BY c.created_at LIMIT 1) AS next_pct,
            (SELECT count(*) FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available')::text AS avail
       FROM app.billing_profiles b
       JOIN app.subscribers s ON s.id = b.subscriber_id AND s.deleted_at IS NULL
       LEFT JOIN app.subscriptions sub ON sub.subscriber_id = b.subscriber_id
       LEFT JOIN app.products pr ON pr.code = 'sub_' || b.plan
      WHERE b.status IN ('active','past_due') AND (EXISTS (SELECT 1 FROM app.referral_credits c WHERE c.subscriber_id = b.subscriber_id AND c.status = 'available') OR (b.synced_value_cents IS NOT NULL AND b.synced_value_cents <> coalesce(b.contract_cents, pr.price_cents)))
      ORDER BY 6 DESC LIMIT 100`,
  );
  return r.rows.map((x) => {
    const list = num(x.price ?? 0);
    const credits = num(x.avail);
    const wanted = x.next_pct ? discounted(list, x.next_pct) : list;
    const synced = x.synced === null ? list : num(x.synced);
    return { subscriberId: x.subscriber_id, email: x.email, plan: x.plan, status: x.status, listCents: list, credits, wantedCents: wanted, syncedCents: synced, inSync: wanted === synced, nextChargeOn: x.period_end ? new Date(x.period_end).toISOString() : null };
  });
}
