// Meta Conversions API (servidor para servidor). Sem pixel no navegador (D-022).
// Os dados da pessoa (e-mail/celular em hash SHA-256, IP e navegador) seguem para a Meta, conforme informado nos termos.
// O PageView anônimo fica desligado até META_CAPI_PAGEVIEW=1.
// Falhas nunca derrubam o pedido: tudo aqui é "dispare e esqueça" e só registra no log do servidor.
import { createHash } from 'node:crypto';
import { decryptText } from './crypto.ts';
import type { Ctx } from './services.ts';

type EventName = 'PageView' | 'Lead' | 'InitiateCheckout' | 'Purchase';

export interface CapiInput {
  name: EventName;
  eventId: string;
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  ip?: string | undefined;
  userAgent?: string | undefined;
  url?: string | undefined;
  fbc?: string | undefined;
  fbp?: string | undefined;
  valueCents?: number | undefined;
  contentName?: string | undefined;
  orderId?: string | undefined;
}

let fetchImpl: typeof fetch = (...a) => fetch(...a);
/** Só para testes. */
export function setCapiFetch(f: typeof fetch): void {
  fetchImpl = f;
}

const sha = (v: string): string => createHash('sha256').update(v.trim().toLowerCase()).digest('hex');
/** Celular no formato que a Meta pede: só dígitos, com o código do país (55). */
export const normalizePhone = (p: string): string => {
  const d = p.replace(/\D/g, '');
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
};

export function buildPayload(input: CapiInput, testCode: string | null): Record<string, unknown> {
  const user: Record<string, unknown> = {};
  if (input.email) user.em = [sha(input.email)];
  if (input.phone) user.ph = [sha(normalizePhone(input.phone))];
  if (input.externalId) user.external_id = [sha(input.externalId)];
  if (input.ip) user.client_ip_address = input.ip;
  if (input.userAgent) user.client_user_agent = input.userAgent;
  if (input.fbc) user.fbc = input.fbc;
  if (input.fbp) user.fbp = input.fbp;
  const custom: Record<string, unknown> = {};
  if (input.valueCents !== undefined) {
    custom.currency = 'BRL';
    custom.value = input.valueCents / 100;
  }
  if (input.contentName) custom.content_name = input.contentName;
  if (input.orderId) custom.order_id = input.orderId;
  return {
    data: [
      {
        event_name: input.name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        ...(input.url ? { event_source_url: input.url } : {}),
        user_data: user,
        ...(Object.keys(custom).length ? { custom_data: custom } : {}),
      },
    ],
    ...(testCode ? { test_event_code: testCode } : {}),
  };
}

export async function sendCapi(ctx: Ctx, input: CapiInput): Promise<void> {
  const c = ctx.config;
  if (!c.metaCapiToken) return;
  try {
    const res = await fetchImpl(`https://graph.facebook.com/v21.0/${c.metaPixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.metaCapiToken}` },
      body: JSON.stringify(buildPayload(input, c.metaTestEventCode)),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) console.error(JSON.stringify({ level: 40, msg: 'meta_capi_erro', evento: input.name, status: res.status }));
  } catch {
    console.error(JSON.stringify({ level: 40, msg: 'meta_capi_falha', evento: input.name }));
  }
}

const dec = (ctx: Ctx, b: Buffer | null): string | null => (b ? decryptText(ctx.config.secret, Buffer.from(b)) : null);

/** Pix: a pessoa informou e-mail e celular e gerou o código. Dispara Lead e InitiateCheckout (só com o aceite de publicidade). */
export async function pixIntent(ctx: Ctx, a: { caseId: string; orderId: string; totalCents: number; ip?: string | undefined; userAgent?: string | undefined }): Promise<void> {
  if (!ctx.config.metaCapiToken) return;
  const r = await ctx.db.query<{ e: Buffer | null; p: Buffer | null; ads: boolean; fbc: string | null }>(`SELECT contact_email_enc AS e, contact_phone_enc AS p, ads_consent AS ads, contact_fbc AS fbc FROM app.cases WHERE id = $1`, [a.caseId]);
  const row = r.rows[0];
  if (!row) return;
  const base = { email: dec(ctx, row.e), phone: dec(ctx, row.p), externalId: a.caseId, ip: a.ip, userAgent: a.userAgent, fbc: row.fbc ?? undefined, url: `${ctx.config.publicUrl}/pagamento` };
  await sendCapi(ctx, { ...base, name: 'Lead', eventId: `lead-${a.caseId}` });
  await sendCapi(ctx, { ...base, name: 'InitiateCheckout', eventId: `ic-${a.orderId}`, valueCents: a.totalCents, orderId: a.orderId });
}

/** Pagamento confirmado (Pix ou cartão): Purchase com o valor e os dados em hash, se houve aceite de publicidade. */
export async function purchase(ctx: Ctx, providerPaymentId: string): Promise<void> {
  if (!ctx.config.metaCapiToken) return;
  const r = await ctx.db.query<{ id: string; order_id: string; amount: string; provider: string; ce: Buffer | null; cp: Buffer | null; cads: boolean | null; case_id: string | null; sid: string | null; semail: string | null; sp: Buffer | null; sads: boolean | null; cip: string | null; cua: string | null; cfbc: string | null; sip: string | null; sua: string | null; sfbc: string | null }>(
    `SELECT p.id, p.order_id, p.amount_cents AS amount, p.provider, c.contact_email_enc AS ce, c.contact_phone_enc AS cp, c.ads_consent AS cads, o.case_id, o.subscriber_id AS sid,
            s.email::text AS semail, s.phone_enc AS sp, s.ads_consent AS sads,
            c.contact_ip AS cip, c.contact_ua AS cua, c.contact_fbc AS cfbc, s.contact_ip AS sip, s.contact_ua AS sua, s.contact_fbc AS sfbc
       FROM app.payments p JOIN app.orders o ON o.id = p.order_id
       LEFT JOIN app.cases c ON c.id = o.case_id LEFT JOIN app.subscribers s ON s.id = o.subscriber_id
      WHERE p.provider_payment_id = $1 LIMIT 1`,
    [providerPaymentId],
  );
  const row = r.rows[0];
  if (!row || row.provider === 'demo') return;
  const isSub = Boolean(row.sid);
  await sendCapi(ctx, {
    name: 'Purchase',
    eventId: `purchase-${row.id}`,
    email: isSub ? row.semail : dec(ctx, row.ce),
    phone: isSub ? dec(ctx, row.sp) : dec(ctx, row.cp),
    externalId: row.case_id ?? row.sid,
    // Evento de site exige IP e navegador: usamos os do momento em que a pessoa informou o contato.
    ip: (isSub ? row.sip : row.cip) ?? undefined,
    userAgent: (isSub ? row.sua : row.cua) ?? undefined,
    fbc: (isSub ? row.sfbc : row.cfbc) ?? undefined,
    valueCents: Number(row.amount),
    orderId: row.order_id,
    contentName: isSub ? 'Prumo' : 'Mapa da Virada',
    url: `${ctx.config.publicUrl}/`,
  });
}
