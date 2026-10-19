// WhatsApp do portal do parceiro, pela API oficial da Meta (Cloud API): sem mensalidade e sem intermediário. Cada parceiro conecta o PRÓPRIO número.
// Regras que protegem o número e o negócio (ban e LGPD):
//  - texto livre só dentro de 24 h depois da última mensagem do contato (janela de atendimento, sem custo); fora dela, só modelo aprovado pela Meta;
//  - disparo ativo (modelo) só para quem deu permissão: contato do Fôlego (autorizou falar com parceiro), base própria marcada "sim" ou quem escreveu primeiro;
//  - "SAIR", "PARAR" e parecidos encerram os envios na hora; teto diário e horário de silêncio por parceiro;
//  - o agente de IA é só uma interface (SalesAgent): desligado por padrão, com limite por hora e passagem para humano.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decryptText, encryptText, hmac } from './crypto.ts';
import { BirdWaTransport } from './wa-bird.ts';
import { loadMedia, previewOf, signedMediaUrl, storeMedia } from './wa-media.ts';
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
/** `ref`: id interno da mensagem; a Bird o devolve nos avisos de status (metadata.ref) e é assim que achamos a mensagem. */
export interface WaCredentials { phoneNumberId: string; token: string; provider?: 'meta' | 'bird'; appId?: string | null; ref?: string }
export interface WaTemplateCall { name: string; language: string; params: string[]; paramNames?: string[] | null; birdProjectId?: string | null; birdVersion?: string | null }
export interface MediaSend { kind: 'image' | 'audio' | 'document' | 'video'; mime: string; filename: string | null; caption: string; bytes: Buffer; publicUrl: string; voice: boolean }
export interface BusinessProfile { about: string; description: string; email: string; websites: string[]; address: string; vertical: string; photoUrl: string | null }

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
  /** Foto, áudio, documento ou vídeo. A Meta recebe o arquivo (upload); a Bird busca em `publicUrl`. */
  sendMedia?(cred: WaCredentials, to: string, m: MediaSend): Promise<{ id: string }>;
  /** Baixa uma mídia recebida (por id na Meta; por endereço na Bird). */
  downloadMedia?(cred: WaCredentials, ref: { id?: string; url?: string }): Promise<{ bytes: Buffer; mime: string }>;
  getBusinessProfile?(cred: WaCredentials): Promise<BusinessProfile>;
  updateBusinessProfile?(cred: WaCredentials, p: Partial<Omit<BusinessProfile, 'photoUrl'>>): Promise<void>;
  setBusinessPhoto?(cred: WaCredentials, bytes: Buffer, mime: string): Promise<void>;
}

/** Chama o método opcional do transporte ou explica que este número não tem o recurso. */
export function need<T>(fn: T | undefined, what: string): T {
  if (!fn) throw new WaError(`Este número não permite ${what}.`, 422, null);
  return fn;
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

  private async form(cred: WaCredentials, path: string, body: FormData): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${GRAPH}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${cred.token}` }, body, signal: AbortSignal.timeout(60_000) });
    } catch (e) {
      throw new WaError(`Sem resposta da Meta: ${e instanceof Error ? e.message.slice(0, 80) : 'rede'}`, 0, null);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } } } & Record<string, unknown>;
    if (!res.ok) throw new WaError(json.error?.error_data?.details ?? json.error?.message ?? `Erro ${res.status} da Meta`, res.status, json.error?.code ?? null);
    return json;
  }

  async sendMedia(cred: WaCredentials, to: string, m: MediaSend): Promise<{ id: string }> {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', m.mime);
    fd.append('file', new Blob([new Uint8Array(m.bytes)], { type: m.mime }), m.filename ?? 'arquivo');
    const up = await this.form(cred, `${cred.phoneNumberId}/media`, fd);
    const mediaId = String(up.id ?? '');
    if (!mediaId) throw new WaError('A Meta não devolveu o identificador do arquivo enviado.', 502, null);
    const content = m.kind === 'audio' ? { id: mediaId } : m.kind === 'document' ? { id: mediaId, caption: m.caption || undefined, filename: m.filename ?? undefined } : { id: mediaId, caption: m.caption || undefined };
    const j = await this.call(cred, `${cred.phoneNumberId}/messages`, { method: 'POST', body: { messaging_product: 'whatsapp', to, type: m.kind, [m.kind]: content } });
    return { id: String((j.messages as { id?: string }[] | undefined)?.[0]?.id ?? '') };
  }

  async downloadMedia(cred: WaCredentials, ref: { id?: string; url?: string }): Promise<{ bytes: Buffer; mime: string }> {
    if (!ref.id) throw new WaError('Mídia sem identificador.', 422, null);
    const meta = await this.call(cred, ref.id, { method: 'GET' });
    const url = String(meta.url ?? '');
    if (!url.startsWith('https://')) throw new WaError('A Meta não devolveu o endereço do arquivo.', 502, null);
    const res = await this.fetchFn(url, { headers: { authorization: `Bearer ${cred.token}` }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new WaError(`Não consegui baixar o arquivo (erro ${res.status}).`, res.status, null);
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, mime: String(meta.mime_type ?? res.headers.get('content-type') ?? 'application/octet-stream') };
  }

  async getBusinessProfile(cred: WaCredentials): Promise<BusinessProfile> {
    const j = await this.call(cred, `${cred.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, { method: 'GET' });
    const p = ((j.data as Record<string, unknown>[] | undefined)?.[0] ?? {}) as Record<string, unknown>;
    return { about: String(p.about ?? ''), description: String(p.description ?? ''), email: String(p.email ?? ''), websites: Array.isArray(p.websites) ? (p.websites as string[]) : [], address: String(p.address ?? ''), vertical: String(p.vertical ?? ''), photoUrl: (p.profile_picture_url as string | undefined) ?? null };
  }

  async updateBusinessProfile(cred: WaCredentials, p: Partial<Omit<BusinessProfile, 'photoUrl'>>): Promise<void> {
    await this.call(cred, `${cred.phoneNumberId}/whatsapp_business_profile`, { method: 'POST', body: { messaging_product: 'whatsapp', ...p } });
  }

  /** Foto do perfil da empresa: upload retomável da Meta (precisa do ID do app) e depois troca do perfil. */
  async setBusinessPhoto(cred: WaCredentials, bytes: Buffer, mime: string): Promise<void> {
    if (!cred.appId) throw new WaError('Para trocar a foto do perfil, informe o ID do app da Meta em Conexão.', 422, null);
    const s = await this.call(cred, `${cred.appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(mime)}&file_name=perfil`, { method: 'POST' });
    const uploadId = String(s.id ?? '');
    if (!uploadId) throw new WaError('A Meta não abriu o envio da foto.', 502, null);
    const up = await this.fetchFn(`${GRAPH}/${uploadId}`, { method: 'POST', headers: { authorization: `OAuth ${cred.token}`, file_offset: '0' }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(60_000) });
    const handle = ((await up.json().catch(() => ({}))) as { h?: string }).h;
    if (!up.ok || !handle) throw new WaError('A Meta recusou a foto do perfil.', up.status || 502, null);
    await this.call(cred, `${cred.phoneNumberId}/whatsapp_business_profile`, { method: 'POST', body: { messaging_product: 'whatsapp', profile_picture_handle: handle } });
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
  async sendMedia(_c: WaCredentials, to: string, m: MediaSend): Promise<{ id: string }> {
    console.log(`[whatsapp de mentira] ${m.kind} (${m.mime}, ${m.bytes.length} bytes) para ${to}${m.caption ? `: ${m.caption}` : ''}`);
    return { id: `wamid.local.${(this.n += 1)}` };
  }
  async downloadMedia(): Promise<{ bytes: Buffer; mime: string }> {
    // 1 pixel PNG: serve para ver o fluxo de mídia recebida em desenvolvimento
    return { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), mime: 'image/png' };
  }
  async getBusinessProfile(): Promise<BusinessProfile> {
    return { about: 'Perfil de teste', description: 'Descrição de teste', email: 'teste@exemplo.com', websites: [], address: '', vertical: 'FINANCE', photoUrl: null };
  }
  async updateBusinessProfile(): Promise<void> {
    console.log('[whatsapp de mentira] perfil da empresa atualizado');
  }
  async setBusinessPhoto(): Promise<void> {
    console.log('[whatsapp de mentira] foto do perfil atualizada');
  }
}

/** O transporte da conta: Meta (padrão), Bird (número do próprio Fôlego), ou o falso injetado nos testes. */
export const transportOf = (ctx: Ctx, provider: 'meta' | 'bird' = 'meta'): WaTransport => ctx.whatsapp ?? (provider === 'bird' ? new BirdWaTransport(ctx.config.bird) : new CloudTransport());

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
  provider: 'meta' | 'bird';
  appId: string | null;
}

interface AccountRow { partner_id: string; phone_number_id: string; token_enc: Buffer | null; app_secret_enc: Buffer | null; verify_token: string; status: 'ativa' | 'pausada'; daily_cap: number; quiet_start: number; quiet_end: number; agent: unknown; display_phone: string | null; waba_id: string | null; provider: 'meta' | 'bird'; app_id: string | null }
const ACCOUNT_COLS = 'partner_id, phone_number_id, token_enc, app_secret_enc, verify_token, status, daily_cap, quiet_start, quiet_end, agent, display_phone, waba_id, provider, app_id';

function accountOf(ctx: Ctx, r: AccountRow): WaAccount {
  return {
    partnerId: r.partner_id, phoneNumberId: r.phone_number_id, token: r.token_enc ? decryptText(ctx.config.secret, r.token_enc) : '', appSecret: r.app_secret_enc ? decryptText(ctx.config.secret, r.app_secret_enc) : '', verifyToken: r.verify_token,
    status: r.status, dailyCap: r.daily_cap, quietStart: r.quiet_start, quietEnd: r.quiet_end, agent: agentConfigOf(r.agent), displayPhone: r.display_phone, wabaId: r.waba_id, provider: r.provider, appId: r.app_id,
  };
}

/** Credenciais para o transporte: na Bird o "ID do número" é o próprio número (+55...) usado em `from`. */
export const credOf = (acc: WaAccount): WaCredentials => ({ phoneNumberId: acc.provider === 'bird' ? `+${acc.phoneNumberId}` : acc.phoneNumberId, token: acc.token, provider: acc.provider, appId: acc.appId });

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
  optin?: boolean; avatar_media_id?: string | null; notes_enc?: Buffer | null;
}
export const THREAD_COLS = 'id, partner_id, contact_id, delivery_id, phone_enc, display_name, state, mode, last_inbound_at, last_message_at, unread_n, opted_out, ai_replies_hour, ai_hour_start, optin, avatar_media_id, notes_enc';

/** A pessoa pode receber modelo/disparo? Contato do Fôlego (autorizou), base própria marcada "sim", ou quem já escreveu. */
export async function mayReceiveTemplates(ctx: Ctx, t: ThreadRow): Promise<boolean> {
  if (t.opted_out) return false;
  if (t.last_inbound_at) return true;
  if (t.delivery_id) return true;
  if (t.optin) return true; // número adicionado à mão: quem atende declarou que a pessoa autorizou
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
  kind: 'text' | 'template' | 'image' | 'audio' | 'document' | 'video';
  text: string;
  templateId?: string | undefined;
  vars?: string[] | undefined;
  broadcastId?: string | undefined;
  /** Arquivo já guardado em wa_media (kind image/audio/document/video); `text` é a legenda. */
  mediaId?: string | undefined;
  voice?: boolean | undefined;
  forwarded?: boolean | undefined;
  sentBy?: string | undefined;
}

export async function queueMessage(ctx: Ctx, a: QueueArgs): Promise<string> {
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.wa_messages(partner_id, thread_id, direction, author, kind, body_enc, template_id, vars_enc, broadcast_id, media_id, voice, forwarded, sent_by, status) VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'fila') RETURNING id`,
    [a.partnerId, a.threadId, a.author, a.kind, encryptText(ctx.config.secret, a.text), a.templateId ?? null, a.vars ? encryptText(ctx.config.secret, JSON.stringify(a.vars)) : null, a.broadcastId ?? null, a.mediaId ?? null, a.voice === true, a.forwarded === true, a.sentBy ?? null],
  );
  await ctx.db.query(`UPDATE app.wa_threads SET last_message_at = now() WHERE id = $1`, [a.threadId]);
  return r.rows[0]!.id;
}

/** A recusa vem de o modelo ainda não estar aprovado/publicado na Meta (Meta 132001/132015/132016; Bird 4xx falando de modelo). */
export function awaitsApproval(err: WaError): boolean {
  if (err.code !== null && [132001, 132015, 132016].includes(err.code)) return true;
  return [400, 404, 422].includes(err.status) && /templ|modelo|approv|aprov|pending|not found|inexist/i.test(err.message);
}

interface QueuedRow { id: string; thread_id: string; kind: QueueArgs['kind']; body_enc: Buffer; vars_enc: Buffer | null; template_id: string | null; attempts: number; media_id: string | null; voice: boolean }
const FREE_KINDS = ['text', 'image', 'audio', 'document', 'video'];

/** Worker: manda o que está na fila, respeitando teto diário e horário de silêncio dos disparos (resposta em atendimento sai sempre). */
export async function processWhatsAppQueue(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  const partners = await ctx.db.query<{ partner_id: string }>(`SELECT DISTINCT partner_id FROM app.wa_messages WHERE status = 'fila' AND direction = 'out' AND attempts < ${MAX_ATTEMPTS}`);
  let sent = 0;
  for (const { partner_id } of partners.rows) {
    const acc = await loadAccount(ctx, partner_id);
    if (!acc || acc.status !== 'ativa') continue;
    const dayStart = `${todaySaoPaulo()}T00:00:00-03:00`;
    const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND kind = 'template' AND sent_at >= $2::timestamptz`, [partner_id, dayStart]);
    // "Liberar fila": enquanto quiet_override_until estiver no futuro, o horário de silêncio não vale (decisão do dono, com prazo).
    const open = await ctx.db.query<{ on: boolean }>(`SELECT coalesce(quiet_override_until > now(), false) AS "on" FROM app.wa_accounts WHERE partner_id = $1`, [partner_id]);
    const quiet = !open.rows[0]?.on && inQuietHours(brHour(), acc.quietStart, acc.quietEnd);
    const budget = quiet ? 0 : Math.max(0, acc.dailyCap - num(used.rows[0]?.n ?? 0));
    for (const [kinds, limit] of [[FREE_KINDS, 30], [['template'], Math.min(30, budget)]] as const) {
      if (limit <= 0) continue;
      const claimed = await ctx.db.query<QueuedRow>(
        `UPDATE app.wa_messages SET attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => (attempts + 1) * 2)
          WHERE id IN (SELECT id FROM app.wa_messages WHERE partner_id = $1 AND status = 'fila' AND direction = 'out' AND kind = ANY($2::text[]) AND attempts < ${MAX_ATTEMPTS} AND (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at LIMIT $3 FOR UPDATE SKIP LOCKED)
        RETURNING id, thread_id, kind, body_enc, vars_enc, template_id, attempts, media_id, voice`,
        [partner_id, kinds, limit],
      );
      for (const m of claimed.rows) {
        // Um erro inesperado numa mensagem não pode travar a fila nem deixá-la "na fila" para sempre: vira "não enviada" com o motivo.
        try {
          if (await sendOne(ctx, acc, m, opts)) sent += 1;
        } catch (e) {
          const why = e instanceof Error ? e.message : 'erro';
          opts.log?.({ evento: 'whatsapp_erro_inesperado', mensagem: m.id, motivo: why.slice(0, 120) });
          if (m.attempts >= MAX_ATTEMPTS) await ctx.db.query(`UPDATE app.wa_messages SET status = 'falhou', error = $2 WHERE id = $1`, [m.id, `Erro interno: ${why}`.slice(0, 300)]);
          else await ctx.db.query(`UPDATE app.wa_messages SET error = $2 WHERE id = $1`, [m.id, `Tentativa ${m.attempts} de ${MAX_ATTEMPTS}: erro interno: ${why}`.slice(0, 300)]);
        }
      }
    }
  }
  // Quem esgotou as tentativas sem resposta definitiva (ex.: erro interno) não fica esperando para sempre.
  await ctx.db.query(`UPDATE app.wa_messages SET status = 'falhou', error = coalesce(error, 'Muitas tentativas sem sucesso.') WHERE status = 'fila' AND direction = 'out' AND attempts >= ${MAX_ATTEMPTS}`);
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
  if (m.kind !== 'template' && !windowOpen(thread.last_inbound_at)) return fail('A janela de 24 h fechou. Envie um modelo aprovado.'); // pode ter fechado enquanto esperava na fila
  const to = decryptText(ctx.config.secret, thread.phone_enc);
  const cred = { ...credOf(acc), ref: m.id };
  const transport = transportOf(ctx, acc.provider);
  try {
    let id: string;
    if (m.kind === 'template') {
      const tpl = m.template_id ? await ctx.db.query<{ name: string; language: string; status: string; param_names: string[] | null; bird_project_id: string | null; bird_version: string | null }>(`SELECT name, language, status, param_names, bird_project_id, bird_version FROM app.wa_templates WHERE id = $1`, [m.template_id]) : { rows: [] };
      if (!tpl.rows[0] || tpl.rows[0].status !== 'aprovado') return fail('Modelo não aprovado.');
      const vars = m.vars_enc ? (JSON.parse(decryptText(ctx.config.secret, m.vars_enc)) as string[]) : [];
      id = (await transport.sendTemplate(cred, to, { name: tpl.rows[0].name, language: tpl.rows[0].language, params: vars, paramNames: tpl.rows[0].param_names, birdProjectId: tpl.rows[0].bird_project_id, birdVersion: tpl.rows[0].bird_version })).id;
    } else if (m.kind === 'text') {
      id = (await transport.sendText(cred, to, decryptText(ctx.config.secret, m.body_enc))).id;
    } else {
      if (!m.media_id) return fail('Arquivo não encontrado.');
      const file = await loadMedia(ctx, m.media_id, acc.partnerId).catch(() => null);
      if (!file) return fail('O arquivo foi apagado.');
      id = (await need(transport.sendMedia?.bind(transport), 'enviar arquivos')(cred, to, {
        kind: m.kind, mime: file.mime, filename: file.filename, caption: decryptText(ctx.config.secret, m.body_enc), bytes: file.bytes, publicUrl: signedMediaUrl(ctx, file.id), voice: m.voice,
      })).id;
    }
    await ctx.db.query(`UPDATE app.wa_messages SET status = 'enviada', wa_id = nullif($2, ''), sent_at = now(), error = NULL WHERE id = $1`, [m.id, id]);
    return true;
  } catch (e) {
    const err = e instanceof WaError ? e : new WaError(e instanceof Error ? e.message : 'erro', 0, null);
    // Modelo ainda sem aprovação na Meta: a mensagem espera na fila (até 24 h) e tenta de novo a cada 15 min, sem gastar tentativas.
    // Ao marcar o modelo como Aprovado no backoffice, ela é liberada na hora (setTemplateStatus).
    if (m.kind === 'template' && awaitsApproval(err)) {
      const held = await ctx.db.query(
        `UPDATE app.wa_messages SET status = 'fila', attempts = 0, next_attempt_at = now() + interval '15 minutes', error = $2
          WHERE id = $1 AND created_at > now() - interval '24 hours' RETURNING id`,
        [m.id, `Aguardando o modelo ser aceito: ${err.message}`.slice(0, 300)], // o motivo real da recusa fica à vista (nada de erro escondido)
      );
      if (held.rows.length) { opts.log?.({ evento: 'whatsapp_aguarda_aprovacao', mensagem: m.id, motivo: err.message.slice(0, 100) }); return false; }
      return fail(`${err.message} (o modelo não foi aprovado em 24 h)`);
    }
    // Chave/credencial recusada (401/403): não adianta insistir a cada minuto, mas também não deve descartar a mensagem.
    // Ela espera (até 24 h, com o motivo à vista) e sai sozinha quando a chave for corrigida e o servidor atualizado.
    if (err.status === 401 || err.status === 403) {
      const held = await ctx.db.query(
        `UPDATE app.wa_messages SET status = 'fila', attempts = 0, next_attempt_at = now() + interval '15 minutes', error = $2
          WHERE id = $1 AND created_at > now() - interval '24 hours' RETURNING id`,
        [m.id, `Aguardando corrigir a chave de acesso: ${err.message}`.slice(0, 300)],
      );
      if (held.rows.length) { opts.log?.({ evento: 'whatsapp_aguarda_chave', mensagem: m.id }); return false; }
      return fail(err.message);
    }
    if (err.permanent || m.attempts >= MAX_ATTEMPTS) return fail(err.message);
    await ctx.db.query(`UPDATE app.wa_messages SET error = $2 WHERE id = $1`, [m.id, `Tentativa ${m.attempts} de ${MAX_ATTEMPTS}: ${err.message}`.slice(0, 300)]);
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

interface MetaMedia { id?: string; mime_type?: string; caption?: string; filename?: string; voice?: boolean }
interface InboundMessage { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }; image?: MetaMedia; audio?: MetaMedia; video?: MetaMedia; document?: MetaMedia; sticker?: MetaMedia }
interface StatusUpdate { id: string; status: string; errors?: { code?: number; title?: string; message?: string }[] }
export interface WebhookBody { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; contacts?: { profile?: { name?: string } }[]; messages?: InboundMessage[]; statuses?: StatusUpdate[] } }[] }[] }

const textOf = (m: InboundMessage): string => {
  if (m.type === 'text') return m.text?.body ?? '';
  if (m.type === 'button') return m.button?.text ?? '';
  if (m.type === 'interactive') return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
  const names: Record<string, string> = { image: 'imagem', audio: 'áudio', video: 'vídeo', document: 'documento', sticker: 'figurinha', location: 'localização', contacts: 'contato' };
  return `[${names[m.type] ?? m.type} recebido(a): este tipo não aparece aqui, abra no WhatsApp para ver]`;
};

export interface InboundIn {
  waId: string;
  e164: string;
  name: string | null;
  kind: 'text' | 'image' | 'audio' | 'document' | 'video' | 'sticker';
  text: string;
  voice?: boolean;
  media?: { mime: string; filename: string | null; fetch: () => Promise<{ bytes: Buffer; mime: string }> };
}

/** Uma mensagem que chegou (Meta ou Bird): acha a conversa, guarda o arquivo, trata SAIR e chama o agente. Devolve false se já tinha sido tratada. */
export async function ingestInbound(ctx: Ctx, acc: WaAccount, m: InboundIn, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<boolean> {
  const dup = await ctx.db.query(`SELECT 1 FROM app.wa_messages WHERE partner_id = $1 AND wa_id = $2`, [acc.partnerId, m.waId]);
  if (dup.rows.length > 0) return false;
  const thread = await ensureThread(ctx, acc.partnerId, m.e164, { name: m.name });
  let text = m.text.slice(0, 4000);
  let mediaId: string | null = null;
  if (m.media) {
    try {
      const f = await m.media.fetch();
      mediaId = (await storeMedia(ctx, acc.partnerId, { mime: f.mime || m.media.mime, filename: m.media.filename, bytes: f.bytes, origin: 'in', hint: m.kind })).id;
    } catch (e) {
      opts.log?.({ evento: 'whatsapp_midia_falhou', motivo: e instanceof Error ? e.message.slice(0, 100) : 'erro' });
      text = text || '[Arquivo recebido, mas não consegui baixá-lo. Abra no WhatsApp para ver.]';
    }
  }
  const ins = await ctx.db.query(
    `INSERT INTO app.wa_messages(partner_id, thread_id, direction, author, kind, body_enc, wa_id, status, media_id, voice) VALUES ($1,$2,'in','contato',$3,$4,$5,'recebida',$6,$7) ON CONFLICT DO NOTHING`,
    [acc.partnerId, thread.id, m.kind, encryptText(ctx.config.secret, text), m.waId, mediaId, m.voice === true],
  );
  if ((ins.rowCount ?? 0) === 0) return false;
  await ctx.db.query(`UPDATE app.wa_threads SET last_inbound_at = now(), last_message_at = now(), unread_n = unread_n + 1, state = 'aberta' WHERE id = $1`, [thread.id]);
  // quem escreveu primeiro permitiu a conversa
  if (thread.contact_id) await ctx.db.query(`UPDATE app.partner_contacts SET wa_optin = 'sim' WHERE id = $1 AND wa_optin = 'desconhecido'`, [thread.contact_id]);
  if (m.kind === 'text' && isOptOut(text)) {
    await ctx.db.query(`UPDATE app.wa_threads SET opted_out = true, mode = 'humano', last_inbound_at = now() WHERE id = $1`, [thread.id]);
    if (thread.contact_id) await ctx.db.query(`UPDATE app.partner_contacts SET wa_optin = 'nao' WHERE id = $1`, [thread.contact_id]);
    await queueMessage(ctx, { partnerId: acc.partnerId, threadId: thread.id, author: 'sistema', kind: 'text', text: 'Tudo certo: você não receberá mais mensagens por aqui.' });
    await audit(ctx.db, `partner:${acc.partnerId}`, 'wa_opt_out', 'wa_thread', thread.id);
    return true;
  }
  await maybeAgentReply(ctx, acc, { ...thread, last_inbound_at: new Date().toISOString() }, previewOf(m.kind, text), opts);
  return true;
}

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
        const base = { waId: m.id, e164, name: v.contacts?.[0]?.profile?.name ?? null };
        const found = (['image', 'audio', 'video', 'document', 'sticker'] as const).map((k) => [k, m[k]] as const).find(([, x]) => x?.id);
        let isNew: boolean;
        if (found) {
          const [kind, x] = found;
          isNew = await ingestInbound(ctx, acc, {
            ...base, kind, text: x!.caption ?? '', voice: x!.voice === true,
            media: { mime: x!.mime_type ?? 'application/octet-stream', filename: x!.filename ?? null, fetch: () => need(transportOf(ctx, acc.provider).downloadMedia?.bind(transportOf(ctx, acc.provider)), 'baixar arquivos')(credOf(acc), { id: x!.id as string }) },
          }, opts);
        } else {
          isNew = await ingestInbound(ctx, acc, { ...base, kind: 'text', text: textOf(m) }, opts); // a Meta reenvia o mesmo evento: o segundo é ignorado
        }
        if (isNew) messages += 1;
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
