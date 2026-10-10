// WhatsApp do portal do parceiro, pela API oficial da Meta (Cloud API): sem mensalidade e sem intermediário. Cada parceiro conecta o PRÓPRIO número.
// Regras que protegem o número e o negócio (ban e LGPD):
//  - texto livre só dentro de 24 h depois da última mensagem do contato (janela de atendimento, sem custo); fora dela, só modelo aprovado pela Meta;
//  - disparo ativo (modelo) só para quem deu permissão: contato do Fôlego (autorizou falar com parceiro), base própria marcada "sim" ou quem escreveu primeiro;
//  - "SAIR", "PARAR" e parecidos encerram os envios na hora; teto diário e horário de silêncio por parceiro;
//  - o agente de IA é só uma interface (SalesAgent): desligado por padrão, com limite por hora e passagem para humano.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptText, encryptText, hmac } from './crypto.ts';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';

export const WINDOW_MS = 24 * 3_600_000;
const MAX_ATTEMPTS = 5;
const GRAPH = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------------------------------------------------
/** Telefone brasileiro no formato do WhatsApp (55 + DDD + número, só dígitos) ou null. */
export function waPhone(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (!/^[1-9]{2}9?\d{8}$/.test(d)) return null;
  return `55${d}`;
}

/** Chave estável do telefone: o WhatsApp antigo omite o 9 depois do DDD; as duas formas viram a mesma chave. */
export function phoneKey(secret: string, partnerId: string, e164: string): string {
  const canonical = e164.length === 13 && e164[4] === '9' ? e164.slice(0, 4) + e164.slice(5) : e164;
  return hmac(secret, `wa:${partnerId}:${canonical}`).toString('hex');
}

// ---------------------------------------------------------------------------------------------------------------------
// Transporte (Meta). Em testes entra um falso por Ctx.whatsapp.
// ---------------------------------------------------------------------------------------------------------------------
export interface WaCredentials { phoneNumberId: string; token: string }
export interface WaTemplateCall { name: string; language: string; params: string[] }

export class WaError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly permanent: boolean;
  constructor(message: string, status: number, code: number | null) {
    super(message);
    this.status = status;
    this.code = code;
    // 4xx (menos limite de uso) e token inválido não melhoram tentando de novo; 5xx, rede e 429 sim.
    this.permanent = status >= 400 && status < 500 && status !== 429 && code !== 130429;
  }
}

export interface WaTransport {
  sendText(cred: WaCredentials, to: string, text: string): Promise<{ id: string }>;
  sendTemplate(cred: WaCredentials, to: string, tpl: WaTemplateCall): Promise<{ id: string }>;
  profile(cred: WaCredentials): Promise<{ displayPhone: string | null; verifiedName: string | null }>;
}

export class CloudTransport implements WaTransport {
  private readonly fetchFn: typeof fetch;
  constructor(fetchFn: typeof fetch = fetch) {
    this.fetchFn = fetchFn;
  }

  private async call(cred: WaCredentials, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${GRAPH}/${path}`, {
        method: init.method,
        headers: { authorization: `Bearer ${cred.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new WaError(`Sem resposta da Meta: ${e instanceof Error ? e.message.slice(0, 80) : 'rede'}`, 0, null);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } } & Record<string, unknown>;
    if (!res.ok) throw new WaError(json.error?.error_data?.details ?? json.error?.message ?? `Erro ${res.status} da Meta`, res.status, json.error?.code ?? null);
    return json;
  }

  async sendText(cred: WaCredentials, to: string, text: string): Promise<{ id: string }> {
    const j = await this.call(cred, `${cred.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } } });
    return { id: String((j.messages as { id?: string }[] | undefined)?.[0]?.id ?? '') };
  }

  async sendTemplate(cred: WaCredentials, to: string, tpl: WaTemplateCall): Promise<{ id: string }> {
    const components = tpl.params.length ? [{ type: 'body', parameters: tpl.params.map((p) => ({ type: 'text', text: p })) }] : [];
    const j = await this.call(cred, `${cred.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: 'template', template: { name: tpl.name, language: { code: tpl.language }, components } } });
    return { id: String((j.messages as { id?: string }[] | undefined)?.[0]?.id ?? '') };
  }

  async profile(cred: WaCredentials): Promise<{ displayPhone: string | null; verifiedName: string | null }> {
    const j = await this.call(cred, `${cred.phoneNumberId}?fields=display_phone_number,verified_name`, { method: 'GET' });
    return { displayPhone: (j.display_phone_number as string | undefined) ?? null, verifiedName: (j.verified_name as string | undefined) ?? null };
  }
}

/** Só desenvolvimento (WHATSAPP_FAKE=1, nunca em produção): não chama a Meta, só imprime o que seria enviado. */
export class ConsoleTransport implements WaTransport {
  private n = 0;
  async sendText(_c: WaCredentials, to: string, text: string): Promise<{ id: string }> {
    console.log(`[whatsapp de mentira] texto para ${to}: ${text}`);
    return { id: `wamid.local.${(this.n += 1)}` };
  }
  async sendTemplate(_c: WaCredentials, to: string, tpl: WaTemplateCall): Promise<{ id: string }> {
    console.log(`[whatsapp de mentira] modelo ${tpl.name} para ${to}: ${tpl.params.join(' | ')}`);
    return { id: `wamid.local.${(this.n += 1)}` };
  }
  async profile(): Promise<{ displayPhone: string | null; verifiedName: string | null }> {
    return { displayPhone: '+55 11 90000-0000', verifiedName: 'Número de teste (local)' };
  }
}

export const transportOf = (ctx: Ctx): WaTransport => ctx.whatsapp ?? new CloudTransport();

// ---------------------------------------------------------------------------------------------------------------------
// Agente de IA (gancho). Nada é chamado se não houver agente registrado em Ctx.salesAgent E o parceiro ligar.
// ---------------------------------------------------------------------------------------------------------------------
export interface AgentConfig {
  enabled: boolean;
  /** Quem o agente é e como fala (instrução de sistema do modelo). */
  persona: string;
  /** Regras de negócio: o que pode e o que nunca pode prometer. */
  rules: string;
  /** Se o cliente escrever uma destas palavras, a conversa vai para uma pessoa. */
  handoffKeywords: string[];
  maxRepliesPerHour: number;
  /** Primeira mensagem de IA de cada conversa começa com este aviso. */
  disclosure: string;
}

export const DEFAULT_AGENT: AgentConfig = {
  enabled: false,
  persona: 'Você é um(a) especialista em crédito consignado e renegociação de dívidas. Fale em português simples, com empatia e sem pressão.',
  rules: 'Nunca prometa taxa, aprovação ou prazo. Não peça senha, código ou dados de cartão. Peça só o que precisa para simular (margem, vínculo, valor desejado). Passe para uma pessoa quando houver dúvida jurídica, reclamação ou pedido de cancelamento.',
  handoffKeywords: ['atendente', 'humano', 'pessoa', 'reclamação', 'reclamacao', 'procon', 'advogado'],
  maxRepliesPerHour: 6,
  disclosure: 'Sou o assistente virtual. Se preferir falar com uma pessoa, é só pedir.',
};

export interface AgentInput {
  partnerId: string;
  threadId: string;
  config: AgentConfig;
  contact: { name: string | null; origin: 'folego' | 'base' | 'inbound' };
  /** Mais antigas primeiro. role 'user' = o contato; 'assistant' = o parceiro (pessoa ou IA). */
  history: { role: 'user' | 'assistant'; text: string }[];
}
export interface AgentReply { text: string | null; handoff: boolean; reason?: string }
export interface SalesAgent {
  readonly name: string;
  reply(input: AgentInput): Promise<AgentReply>;
}

export const agentConfigOf = (raw: unknown): AgentConfig => ({ ...DEFAULT_AGENT, ...(raw && typeof raw === 'object' ? (raw as Partial<AgentConfig>) : {}) });

// ---------------------------------------------------------------------------------------------------------------------
// Conta
// ---------------------------------------------------------------------------------------------------------------------
export interface WaAccount {
  partnerId: string;
  phoneNumberId: string;
  token: string;
  appSecret: string;
  verifyToken: string;
  status: 'ativa' | 'pausada';
  dailyCap: number;
  quietStart: number;
  quietEnd: number;
  agent: AgentConfig;
  displayPhone: string | null;
  wabaId: string | null;
}

interface AccountRow { partner_id: string; phone_number_id: string; token_enc: Buffer; app_secret_enc: Buffer; verify_token: string; status: 'ativa' | 'pausada'; daily_cap: number; quiet_start: number; quiet_end: number; agent: unknown; display_phone: string | null; waba_id: string | null }
const ACCOUNT_COLS = 'partner_id, phone_number_id, token_enc, app_secret_enc, verify_token, status, daily_cap, quiet_start, quiet_end, agent, display_phone, waba_id';

function accountOf(ctx: Ctx, r: AccountRow): WaAccount {
  return {
    partnerId: r.partner_id, phoneNumberId: r.phone_number_id, token: decryptText(ctx.config.secret, r.token_enc), appSecret: decryptText(ctx.config.secret, r.app_secret_enc), verifyToken: r.verify_token,
    status: r.status, dailyCap: r.daily_cap, quietStart: r.quiet_start, quietEnd: r.quiet_end, agent: agentConfigOf(r.agent), displayPhone: r.display_phone, wabaId: r.waba_id,
  };
}

export async function loadAccount(ctx: Ctx, partnerId: string): Promise<WaAccount | null> {
  const r = await ctx.db.query<AccountRow>(`SELECT ${ACCOUNT_COLS} FROM app.wa_accounts WHERE partner_id = $1`, [partnerId]);
  return r.rows[0] ? accountOf(ctx, r.rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Regras de envio
// ---------------------------------------------------------------------------------------------------------------------
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const OPT_OUT = /^(sair|parar|pare|stop|cancelar|descadastrar|remover|nao quero( mais)?|nao me envie|nao envie)\b/;
export const isOptOut = (text: string): boolean => OPT_OUT.test(norm(text));

/** Hora de Brasília (0 a 23). */
const brHour = (now = new Date()): number => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(now)) % 24;

export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export const windowOpen = (lastInboundAt: Date | string | null, now = Date.now()): boolean => lastInboundAt !== null && now - new Date(lastInboundAt).getTime() < WINDOW_MS;
export const windowEndsAt = (lastInboundAt: Date | string | null): number | null => (lastInboundAt ? new Date(lastInboundAt).getTime() + WINDOW_MS : null);

/** {{1}}, {{2}}... trocados pelas variáveis. */
export const renderTemplate = (body: string, vars: string[]): string => body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => vars[Number(n) - 1] ?? '');
export const templateSlots = (body: string): number => Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

export interface ThreadRow {
  id: string; partner_id: string; contact_id: string | null; delivery_id: string | null; phone_enc: Buffer; display_name: string | null; state: string; mode: string;
  last_inbound_at: Date | string | null; last_message_at: Date | string | null; unread_n: number; opted_out: boolean; ai_replies_hour: number; ai_hour_start: Date | string | null;
}
export const THREAD_COLS = 'id, partner_id, contact_id, delivery_id, phone_enc, display_name, state, mode, last_inbound_at, last_message_at, unread_n, opted_out, ai_replies_hour, ai_hour_start';

/** A pessoa pode receber modelo/disparo? Contato do Fôlego (autorizou), base própria marcada "sim", ou quem já escreveu. */
export async function mayReceiveTemplates(ctx: Ctx, t: ThreadRow): Promise<boolean> {
  if (t.opted_out) return false;
  if (t.last_inbound_at) return true;
  if (t.delivery_id) return true;
  if (t.contact_id) {
    const c = await ctx.db.query<{ wa_optin: string }>(`SELECT wa_optin FROM app.partner_contacts WHERE id = $1 AND partner_id = $2`, [t.contact_id, t.partner_id]);
    return c.rows[0]?.wa_optin === 'sim';
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conversas e fila
// ---------------------------------------------------------------------------------------------------------------------
/** Acha (ou cria) a conversa do telefone e liga ao contato da base ou ao contato do Fôlego, se houver. */
export async function ensureThread(ctx: Ctx, partnerId: string, e164: string, hint: { name?: string | null; contactId?: string | null; deliveryId?: string | null } = {}): Promise<ThreadRow> {
  const secret = ctx.config.secret;
  const key = phoneKey(secret, partnerId, e164);
  const found = await ctx.db.query<ThreadRow>(`SELECT ${THREAD_COLS} FROM app.wa_threads WHERE partner_id = $1 AND phone_hmac = $2`, [partnerId, key]);
  let contactId = hint.contactId ?? null;
  let deliveryId = hint.deliveryId ?? null;
  let name = hint.name ?? null;
  if (!found.rows[0] || (!found.rows[0].contact_id && !found.rows[0].delivery_id)) {
    if (!contactId) {
      const c = await ctx.db.query<{ id: string; name: string }>(`SELECT id, name FROM app.partner_contacts WHERE partner_id = $1 AND phone_keys @> ARRAY[$2]::text[] LIMIT 1`, [partnerId, key]);
      if (c.rows[0]) {
        contactId = c.rows[0].id;
        name = name ?? c.rows[0].name;
      }
    }
    if (!contactId && !deliveryId) {
      const national = e164.slice(2);
      const variants = new Set([national, national.length === 10 ? `${national.slice(0, 2)}9${national.slice(2)}` : national.length === 11 ? `${national.slice(0, 2)}${national.slice(3)}` : national]);
      const keys = [...variants].map((n) => hmac(secret, `phone:${n}`).toString('hex'));
      const d = await ctx.db.query<{ id: string }>(
        `SELECT d.id FROM app.lead_deliveries d JOIN app.lead_contacts lc ON lc.case_id = d.case_id WHERE d.partner_id = $1 AND d.status IN ('delivered','contacted','converted') AND encode(lc.phone_hmac, 'hex') = ANY($2::text[]) LIMIT 1`,
        [partnerId, keys],
      );
      if (d.rows[0]) deliveryId = d.rows[0].id;
    }
  }
  if (found.rows[0]) {
    const t = found.rows[0];
    if ((contactId && !t.contact_id) || (deliveryId && !t.delivery_id) || (name && !t.display_name)) {
      await ctx.db.query(`UPDATE app.wa_threads SET contact_id = coalesce(contact_id, $2), delivery_id = coalesce(delivery_id, $3), display_name = coalesce(display_name, $4) WHERE id = $1`, [t.id, contactId, deliveryId, name]);
      return { ...t, contact_id: t.contact_id ?? contactId, delivery_id: t.delivery_id ?? deliveryId, display_name: t.display_name ?? name };
    }
    return t;
  }
  const ins = await ctx.db.query<ThreadRow>(
    `INSERT INTO app.wa_threads(partner_id, contact_id, delivery_id, phone_hmac, phone_enc, display_name) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (partner_id, phone_hmac) DO UPDATE SET display_name = coalesce(app.wa_threads.display_name, EXCLUDED.display_name) RETURNING ${THREAD_COLS}`,
    [partnerId, contactId, deliveryId, key, encryptText(secret, e164), name],
  );
  return ins.rows[0]!;
}

export interface QueueArgs {
  partnerId: string;
  threadId: string;
  author: 'humano' | 'ia' | 'sistema';
  kind: 'text' | 'template';
  text: string;
  templateId?: string | undefined;
  vars?: string[] | undefined;
  broadcastId?: string | undefined;
}

export async function queueMessage(ctx: Ctx, a: QueueArgs): Promise<string> {
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.wa_messages(partner_id, thread_id, direction, author, kind, body_enc, template_id, vars_enc, broadcast_id, status) VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,'fila') RETURNING id`,
    [a.partnerId, a.threadId, a.author, a.kind, encryptText(ctx.config.secret, a.text), a.templateId ?? null, a.vars ? encryptText(ctx.config.secret, JSON.stringify(a.vars)) : null, a.broadcastId ?? null],
  );
  await ctx.db.query(`UPDATE app.wa_threads SET last_message_at = now() WHERE id = $1`, [a.threadId]);
  return r.rows[0]!.id;
}

interface QueuedRow { id: string; thread_id: string; kind: 'text' | 'template'; body_enc: Buffer; vars_enc: Buffer | null; template_id: string | null; attempts: number }

/** Worker: manda o que está na fila, respeitando teto diário e horário de silêncio dos disparos (resposta em atendimento sai sempre). */
export async function processWhatsAppQueue(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  const partners = await ctx.db.query<{ partner_id: string }>(`SELECT DISTINCT partner_id FROM app.wa_messages WHERE status = 'fila' AND direction = 'out' AND attempts < ${MAX_ATTEMPTS}`);
  let sent = 0;
  for (const { partner_id } of partners.rows) {
    const acc = await loadAccount(ctx, partner_id);
    if (!acc || acc.status !== 'ativa') continue;
    const dayStart = `${todaySaoPaulo()}T00:00:00-03:00`;
    const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND kind = 'template' AND sent_at >= $2::timestamptz`, [partner_id, dayStart]);
    const quiet = inQuietHours(brHour(), acc.quietStart, acc.quietEnd);
    const budget = quiet ? 0 : Math.max(0, acc.dailyCap - num(used.rows[0]?.n ?? 0));
    for (const [kind, limit] of [['text', 30], ['template', Math.min(30, budget)]] as const) {
      if (limit <= 0) continue;
      const claimed = await ctx.db.query<QueuedRow>(
        `UPDATE app.wa_messages SET attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => (attempts + 1) * 2)
          WHERE id IN (SELECT id FROM app.wa_messages WHERE partner_id = $1 AND status = 'fila' AND direction = 'out' AND kind = $2 AND attempts < ${MAX_ATTEMPTS} AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED)
        RETURNING id, thread_id, kind, body_enc, vars_enc, template_id, attempts`,
        [partner_id, kind, limit],
      );
      for (const m of claimed.rows) if (await sendOne(ctx, acc, m, opts)) sent += 1;
    }
  }
  return sent;
}

async function sendOne(ctx: Ctx, acc: WaAccount, m: QueuedRow, opts: { log?: (e: Record<string, unknown>) => void }): Promise<boolean> {
  const fail = async (error: string) => {
    await ctx.db.query(`UPDATE app.wa_messages SET status = 'falhou', error = $2 WHERE id = $1`, [m.id, error.slice(0, 300)]);
    opts.log?.({ evento: 'whatsapp_falhou', mensagem: m.id, motivo: error.slice(0, 100) });
    return false;
  };
  const t = await ctx.db.query<ThreadRow>(`SELECT ${THREAD_COLS} FROM app.wa_threads WHERE id = $1`, [m.thread_id]);
  const thread = t.rows[0];
  if (!thread) return fail('Conversa apagada.');
  if (thread.opted_out && m.kind === 'template') return fail('O contato pediu para não receber mensagens.');
  if (m.kind === 'text' && !windowOpen(thread.last_inbound_at)) return fail('A janela de 24 h fechou. Envie um modelo aprovado.'); // pode ter fechado enquanto esperava na fila
  const to = decryptText(ctx.config.secret, thread.phone_enc);
  const cred = { phoneNumberId: acc.phoneNumberId, token: acc.token };
  try {
    let id: string;
    if (m.kind === 'template') {
      const tpl = m.template_id ? await ctx.db.query<{ name: string; language: string; status: string }>(`SELECT name, language, status FROM app.wa_templates WHERE id = $1`, [m.template_id]) : { rows: [] };
      if (!tpl.rows[0] || tpl.rows[0].status !== 'aprovado') return fail('Modelo não aprovado.');
      const vars = m.vars_enc ? (JSON.parse(decryptText(ctx.config.secret, m.vars_enc)) as string[]) : [];
      id = (await transportOf(ctx).sendTemplate(cred, to, { name: tpl.rows[0].name, language: tpl.rows[0].language, params: vars })).id;
    } else {
      id = (await transportOf(ctx).sendText(cred, to, decryptText(ctx.config.secret, m.body_enc))).id;
    }
    await ctx.db.query(`UPDATE app.wa_messages SET status = 'enviada', wa_id = nullif($2, ''), sent_at = now(), error = NULL WHERE id = $1`, [m.id, id]);
    return true;
  } catch (e) {
    const err = e instanceof WaError ? e : new WaError(e instanceof Error ? e.message : 'erro', 0, null);
    if (err.permanent || m.attempts >= MAX_ATTEMPTS) return fail(err.message);
    opts.log?.({ evento: 'whatsapp_tentara_de_novo', mensagem: m.id, motivo: err.message.slice(0, 100) });
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Webhook da Meta
// ---------------------------------------------------------------------------------------------------------------------
/** Confere X-Hub-Signature-256 (HMAC-SHA256 do corpo cru com o segredo do app). */
export function validSignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header ?? '');
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(m[1]!, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

interface InboundMessage { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }
interface StatusUpdate { id: string; status: string; errors?: { code?: number; title?: string; message?: string }[] }
export interface WebhookBody { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string } }[]; messages?: InboundMessage[]; statuses?: StatusUpdate[] } }[] }[] }

const textOf = (m: InboundMessage): string => {
  if (m.type === 'text') return m.text?.body ?? '';
  if (m.type === 'button') return m.button?.text ?? '';
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
  const names: Record<string, string> = { image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contacts: 'contato' };
  return `[${names[m.type] ?? m.type} recebido(a): abra no WhatsApp para ver]`;
};

const STATUS_RANK: Record<string, number> = { fila: 0, enviada: 1, entregue: 2, lida: 3 };
const STATUS_MAP: Record<string, 'enviada' | 'entregue' | 'lida' | 'falhou'> = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou' };

export async function handleWebhook(ctx: Ctx, acc: WaAccount, body: WebhookBody, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<{ messages: number; statuses: number }> {
  let messages = 0;
  let statuses = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value;
      if (!v || v.metadata?.phone_number_id !== acc.phoneNumberId) continue;
      for (const s of v.statuses ?? []) {
        const mapped = STATUS_MAP[s.status];
        if (!mapped) continue;
        const cur = await ctx.db.query<{ id: string; status: string }>(`SELECT id, status FROM app.wa_messages WHERE partner_id = $1 AND wa_id = $2`, [acc.partnerId, s.id]);
        const row = cur.rows[0];
        if (!row) continue;
        // o status só avança (enviada → entregue → lida); "falhou" vale sempre
        if (mapped !== 'falhou' && (STATUS_RANK[mapped] ?? 0) <= (STATUS_RANK[row.status] ?? 0)) continue;
        await ctx.db.query(`UPDATE app.wa_messages SET status = $2, error = $3 WHERE id = $1`, [row.id, mapped, mapped === 'falhou' ? (s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? 'Falha informada pela Meta').slice(0, 300) : null]);
        statuses += 1;
      }
      for (const m of v.messages ?? []) {
        const e164 = waPhone(m.from);
        if (!e164 || !m.id) continue;
        const text = textOf(m).slice(0, 4000);
        const thread = await ensureThread(ctx, acc.partnerId, e164, { name: v.contacts?.[0]?.profile?.name ?? null });
        const ins = await ctx.db.query(
          `INSERT INTO app.wa_messages(partner_id, thread_id, direction, author, kind, body_enc, wa_id, status) VALUES ($1,$2,'in','contato','text',$3,$4,'recebida') ON CONFLICT DO NOTHING`,
          [acc.partnerId, thread.id, encryptText(ctx.config.secret, text), m.id],
        );
        if ((ins.rowCount ?? 0) === 0) continue; // a Meta reenvia o mesmo evento: já tratado
        messages += 1;
        await ctx.db.query(`UPDATE app.wa_threads SET last_inbound_at = now(), last_message_at = now(), unread_n = unread_n + 1, state = 'aberta' WHERE id = $1`, [thread.id]);
        // quem escreveu primeiro permitiu a conversa
        if (thread.contact_id) await ctx.db.query(`UPDATE app.partner_contacts SET wa_optin = 'sim' WHERE id = $1 AND wa_optin = 'desconhecido'`, [thread.contact_id]);
        if (isOptOut(text)) {
          await ctx.db.query(`UPDATE app.wa_threads SET opted_out = true, mode = 'humano', last_inbound_at = now() WHERE id = $1`, [thread.id]);
          if (thread.contact_id) await ctx.db.query(`UPDATE app.partner_contacts SET wa_optin = 'nao' WHERE id = $1`, [thread.contact_id]);
          await queueMessage(ctx, { partnerId: acc.partnerId, threadId: thread.id, author: 'sistema', kind: 'text', text: 'Tudo certo: você não receberá mais mensagens por aqui.' });
          await audit(ctx.db, `partner:${acc.partnerId}`, 'wa_opt_out', 'wa_thread', thread.id);
          continue;
        }
        await maybeAgentReply(ctx, acc, { ...thread, last_inbound_at: new Date().toISOString() }, text, opts);
      }
    }
  }
  return { messages, statuses };
}

// ---------------------------------------------------------------------------------------------------------------------
// Agente de IA: guardas ao redor da interface
// ---------------------------------------------------------------------------------------------------------------------
async function maybeAgentReply(ctx: Ctx, acc: WaAccount, thread: ThreadRow, inbound: string, opts: { log?: (e: Record<string, unknown>) => void }): Promise<void> {
  const cfg = acc.agent;
  if (!ctx.salesAgent || !cfg.enabled || thread.mode !== 'ia' || thread.opted_out) return;
  const lowered = norm(inbound);
  if (cfg.handoffKeywords.some((k) => lowered.includes(norm(k)))) {
    await ctx.db.query(`UPDATE app.wa_threads SET mode = 'humano' WHERE id = $1`, [thread.id]);
    return;
  }
  const hourStart = thread.ai_hour_start && Date.now() - new Date(thread.ai_hour_start).getTime() < 3_600_000 ? new Date(thread.ai_hour_start) : null;
  const used = hourStart ? thread.ai_replies_hour : 0;
  if (used >= cfg.maxRepliesPerHour) {
    await ctx.db.query(`UPDATE app.wa_threads SET mode = 'humano' WHERE id = $1`, [thread.id]); // muita troca seguida: uma pessoa assume
    return;
  }
  try {
    const hist = await ctx.db.query<{ direction: string; body_enc: Buffer }>(`SELECT direction, body_enc FROM app.wa_messages WHERE thread_id = $1 AND status <> 'falhou' ORDER BY created_at DESC LIMIT 12`, [thread.id]);
    const history = hist.rows.reverse().map((r) => ({ role: r.direction === 'in' ? ('user' as const) : ('assistant' as const), text: decryptText(ctx.config.secret, r.body_enc) }));
    const out = await ctx.salesAgent.reply({
      partnerId: acc.partnerId, threadId: thread.id, config: cfg, history,
      contact: { name: thread.display_name, origin: thread.delivery_id ? 'folego' : thread.contact_id ? 'base' : 'inbound' },
    });
    if (out.handoff) await ctx.db.query(`UPDATE app.wa_threads SET mode = 'humano' WHERE id = $1`, [thread.id]);
    const text = out.text?.trim().slice(0, 1000);
    if (!text) return;
    const before = await ctx.db.query(`SELECT 1 FROM app.wa_messages WHERE thread_id = $1 AND author = 'ia' LIMIT 1`, [thread.id]);
    await queueMessage(ctx, { partnerId: acc.partnerId, threadId: thread.id, author: 'ia', kind: 'text', text: before.rows.length === 0 && cfg.disclosure ? `${cfg.disclosure}\n\n${text}` : text });
    await ctx.db.query(`UPDATE app.wa_threads SET ai_replies_hour = $2, ai_hour_start = coalesce($3, now()) WHERE id = $1`, [thread.id, used + 1, hourStart]);
  } catch (e) {
    // o agente nunca derruba o atendimento: se falhar, a conversa fica com uma pessoa
    opts.log?.({ evento: 'agente_falhou', conversa: thread.id, erro: e instanceof Error ? e.message.slice(0, 100) : 'erro' });
    await ctx.db.query(`UPDATE app.wa_threads SET mode = 'humano' WHERE id = $1`, [thread.id]);
  }
}

export const notConnected = (): AppError => new AppError(409, 'wa_not_connected', 'Conecte o seu número de WhatsApp primeiro.');
