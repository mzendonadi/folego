// WhatsApp do Fôlego pela Bird (número próprio da empresa). Hoje serve ao convite de indicação do Prumo.
// - Só mensagens por MODELO aprovado (a Meta exige para quem inicia a conversa).
// - Fila no banco: o envio é feito pelo worker, só em horário comercial, com chave de idempotência (retentativa não duplica).
// - Telefone nunca em texto puro: criptografado, e achado só pelo HMAC (phone_key).
// - Quem responde SAIR (ou parecido) nunca mais recebe nada.
// - O webhook da Bird segue o padrão Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { decryptText, encryptText } from './crypto.ts';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { inQuietHours, isOptOut, loadAccount, phoneKey, waPhone } from './whatsapp.ts';
import { HOUSE_PARTNER_ID, applyBirdStatus, ensureHouseAccount, ingestBirdInbound } from './wa-bird.ts';

const MAX_ATTEMPTS = 5;
const COMPANY = 'fl'; // "locatário" da chave de telefone: o próprio Fôlego (os parceiros usam o id deles em whatsapp.ts)
const QUIET_START = 20; // não envia entre 20h e 8h (Brasília): a mensagem espera na fila
const QUIET_END = 8;

export interface BirdSend {
  /** Telefone com + (E.164), ex.: +5541999990000. */
  to: string;
  template: string;
  language: string;
  /** Variáveis nomeadas do modelo (nome_do_assinante, nome_da_indicacao, codigo). */
  params: Record<string, string>;
  /** Mesma chave = mesma mensagem: se a resposta se perder e o envio for repetido, a Bird não duplica. */
  idempotencyKey: string;
  /** Devolvido pela Bird nos avisos de status: é como achamos o registro. */
  ref: string;
  purpose: string;
}

export class BirdError extends Error {
  readonly status: number;
  /** true = vale tentar de novo mais tarde (instabilidade, limite). false = erro definitivo (número inválido, modelo reprovado, chave errada). */
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export interface BirdTransport {
  readonly name: string;
  send(m: BirdSend): Promise<{ messageId: string }>;
}

export interface BirdConfig { apiKey: string; from: string; baseUrl: string; classic?: boolean; workspaceId?: string; channelId?: string; inviteProjectId?: string; inviteVersion?: string }

export class HttpBird implements BirdTransport {
  readonly name = 'bird';
  private readonly cfg: BirdConfig;
  private readonly fetchFn: typeof fetch;
  constructor(cfg: BirdConfig, fetchFn: typeof fetch = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }
  async send(m: BirdSend): Promise<{ messageId: string }> {
    let res: Response;
    try {
      // Plataforma clássica (app.bird.com): modelo pelo projeto e versão publicada, destinatário em `receiver`, chave "AccessKey".
      const classic = this.cfg.classic === true;
      res = await this.fetchFn(classic ? `${this.cfg.baseUrl}/workspaces/${this.cfg.workspaceId}/channels/${this.cfg.channelId}/messages` : `${this.cfg.baseUrl}/v1/whatsapp/messages`, {
        method: 'POST',
        headers: { authorization: classic ? `AccessKey ${this.cfg.apiKey}` : `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json', 'idempotency-key': m.idempotencyKey },
        body: JSON.stringify(classic
          ? {
              receiver: { contacts: [{ identifierValue: m.to, identifierKey: 'phonenumber' }] },
              template: { projectId: this.cfg.inviteProjectId, version: this.cfg.inviteVersion, locale: m.language, parameters: Object.entries(m.params).map(([key, value]) => ({ type: 'string', key, value })) },
              reference: m.ref,
            }
          : {
              from: this.cfg.from,
              to: m.to,
              template: { slug: m.template, language: m.language, components: [{ type: 'body', parameters: Object.entries(m.params).map(([name, text]) => ({ type: 'text', name, text })) }] },
              tags: [{ name: 'purpose', value: m.purpose }],
              metadata: { ref: m.ref },
            }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BirdError('A Bird não respondeu.', 0, true);
    }
    if (res.status === 202 || res.status === 200 || res.status === 201) {
      const j = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
      const id = j.id ?? j.message_id;
      if (!id) throw new BirdError('A Bird aceitou, mas não devolveu o identificador da mensagem.', res.status, false);
      return { messageId: String(id) };
    }
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    // 422 = pedido inválido (número, parâmetros, modelo); 401/403 = chave ou permissão; 429 e 5xx = tentar depois.
    const retryable = res.status === 429 || res.status >= 500;
    throw new BirdError(`Bird ${res.status}${detail ? `: ${detail}` : ''}`, res.status, retryable);
  }
}

/** Transporte de teste: guarda o que "enviou" e pode simular falhas. */
export class FakeBird implements BirdTransport {
  readonly name = 'fake';
  sent: BirdSend[] = [];
  failNext: BirdError | null = null;
  async send(m: BirdSend): Promise<{ messageId: string }> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.sent.push(m);
    return { messageId: `fake-${this.sent.length}` };
  }
}

/** O transporte em uso: o injetado (testes) ou a Bird real, se as chaves estiverem configuradas. null = WhatsApp do Fôlego desligado. */
export function birdOf(ctx: Ctx): BirdTransport | null {
  if (ctx.bird) return ctx.bird;
  const c = ctx.config.bird;
  return c ? new HttpBird({ apiKey: c.apiKey, from: c.from, baseUrl: c.baseUrl, classic: c.classic, workspaceId: c.workspaceId, channelId: c.channelId, inviteProjectId: c.inviteProjectId, inviteVersion: c.inviteVersion }) : null;
}

export const birdTemplate = (ctx: Ctx): { slug: string; language: string } => ({ slug: ctx.config.bird?.template ?? 'indicacao_prumo', language: ctx.config.bird?.language ?? 'pt-BR' });

// ---------------------------------------------------------------------------
// Contatos e fila
// ---------------------------------------------------------------------------
export const contactKey = (ctx: Ctx, e164digits: string): string => phoneKey(ctx.config.secret, COMPANY, e164digits);

export async function ensureContact(ctx: Ctx, e164digits: string): Promise<{ key: string; optedOut: boolean }> {
  const key = contactKey(ctx, e164digits);
  await ctx.db.query(`INSERT INTO app.msg_contacts(phone_key, phone_enc) VALUES ($1,$2) ON CONFLICT (phone_key) DO NOTHING`, [key, encryptText(ctx.config.secret, e164digits)]);
  const r = await ctx.db.query<{ opted_out: boolean }>(`SELECT opted_out FROM app.msg_contacts WHERE phone_key = $1`, [key]);
  return { key, optedOut: r.rows[0]?.opted_out === true };
}

const brHour = (d: Date): number => Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(d)) % 24;

/** Próximo instante em que pode enviar (agora, se fora do horário de silêncio). */
export function nextSendTime(now = new Date()): Date {
  let t = new Date(now);
  for (let i = 0; i < 96 && inQuietHours(brHour(t), QUIET_START, QUIET_END); i += 1) t = new Date(t.getTime() + 15 * 60_000);
  return t;
}

export interface QueueInvite { subscriberId: string; referralId: string; e164digits: string; subscriberName: string; friendName: string; code: string }

/** Põe o convite na fila. Quem pediu para não receber (SAIR) não entra: devolve null. */
export async function queueInvite(ctx: Ctx, a: QueueInvite): Promise<string | null> {
  const c = await ensureContact(ctx, a.e164digits);
  if (c.optedOut) return null;
  const tpl = birdTemplate(ctx);
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.msg_log(direction, purpose, phone_key, subscriber_id, referral_id, template_slug, params_enc, status, send_after) VALUES ('out','indicacao_prumo',$1,$2,$3,$4,$5,'fila',$6) RETURNING id`,
    [c.key, a.subscriberId, a.referralId, tpl.slug, encryptText(ctx.config.secret, JSON.stringify({ nome_do_assinante: a.subscriberName, nome_da_indicacao: a.friendName, codigo: a.code })), nextSendTime()],
  );
  return r.rows[0]!.id;
}

const backoffMinutes = (attempts: number): number => Math.min(240, 5 * 2 ** Math.max(0, attempts - 1));

/** Worker: envia o que está na fila. Devolve quantas mensagens foram aceitas pela Bird. */
export async function processBirdQueue(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void; now?: Date } = {}): Promise<number> {
  const bird = birdOf(ctx);
  if (!bird) return 0;
  // Envio interrompido no meio (processo caiu): volta para a fila. A chave de idempotência impede duplicar.
  await ctx.db.query(`UPDATE app.msg_log SET status = 'fila' WHERE status = 'enviando' AND updated_at < now() - interval '10 minutes'`);
  const due = await ctx.db.query<{ id: string; phone_key: string; template_slug: string; params_enc: Buffer | null; attempts: number; purpose: string }>(
    `UPDATE app.msg_log SET status = 'enviando', attempts = attempts + 1
      WHERE id IN (SELECT id FROM app.msg_log WHERE status = 'fila' AND direction = 'out' AND send_after <= now() ORDER BY send_after LIMIT 10 FOR UPDATE SKIP LOCKED)
      RETURNING id, phone_key, template_slug, params_enc, attempts, purpose`,
  );
  let ok = 0;
  const lang = birdTemplate(ctx).language;
  for (const m of due.rows) {
    const contact = await ctx.db.query<{ phone_enc: Buffer; opted_out: boolean }>(`SELECT phone_enc, opted_out FROM app.msg_contacts WHERE phone_key = $1`, [m.phone_key]);
    const c = contact.rows[0];
    if (!c || c.opted_out) {
      await ctx.db.query(`UPDATE app.msg_log SET status = 'cancelada', error = 'pediu para não receber' WHERE id = $1`, [m.id]);
      continue;
    }
    // Se virou horário de silêncio entre o agendamento e agora, devolve para a fila.
    if (inQuietHours(brHour(opts.now ?? new Date()), QUIET_START, QUIET_END)) {
      await ctx.db.query(`UPDATE app.msg_log SET status = 'fila', attempts = attempts - 1, send_after = $2 WHERE id = $1`, [m.id, nextSendTime(opts.now)]);
      continue;
    }
    try {
      const params = m.params_enc ? (JSON.parse(decryptText(ctx.config.secret, m.params_enc)) as Record<string, string>) : {};
      const out = await bird.send({ to: `+${decryptText(ctx.config.secret, c.phone_enc)}`, template: m.template_slug, language: lang, params, idempotencyKey: m.id, ref: m.id, purpose: m.purpose });
      await ctx.db.query(`UPDATE app.msg_log SET status = 'aceita', provider_message_id = $2, error = NULL WHERE id = $1`, [m.id, out.messageId]);
      ok += 1;
    } catch (e) {
      const err = e instanceof BirdError ? e : new BirdError('Falha ao enviar.', 0, true);
      const final = !err.retryable || m.attempts >= MAX_ATTEMPTS;
      await ctx.db.query(`UPDATE app.msg_log SET status = $2, error = $3, send_after = now() + make_interval(mins => $4) WHERE id = $1`, [m.id, final ? 'falhou' : 'fila', err.message.slice(0, 200), backoffMinutes(m.attempts)]);
      opts.log?.({ evento: 'bird_envio_falhou', status: err.status, definitivo: final });
    }
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Webhook da Bird (Standard Webhooks)
// ---------------------------------------------------------------------------
/** Confere a assinatura: HMAC-SHA256 de "id.timestamp.corpo" com o segredo (whsec_ + base64). Aceita até 5 minutos de diferença. */
export function verifyBirdSignature(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, rawBody: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const got = Buffer.from(sig, 'base64');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Webhook da Bird clássica (app.bird.com): cabeçalhos messagebird-signature / messagebird-request-timestamp
// ---------------------------------------------------------------------------
/** HMAC-SHA256 de "timestamp \n URL \n SHA-256(corpo) (binário)" com a chave de assinatura (texto puro); a assinatura vem em base64. Aceita até 10 min de diferença. */
export function verifyBirdClassicSignature(signingKey: string, headers: { signature?: string; timestamp?: string }, url: string, rawBody: string, now = Date.now()): boolean {
  const { signature, timestamp } = headers;
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 600) return false;
  const got = Buffer.from(signature, 'base64');
  const bodyHash = createHash('sha256').update(rawBody).digest();
  const expected = createHmac('sha256', signingKey).update(Buffer.concat([Buffer.from(`${timestamp}\n${url}\n`), bodyHash])).digest();
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Alternativa à assinatura: o mesmo segredo, passado como ?k= no endereço do webhook (HTTPS). Comparação em tempo constante. */
export function verifyBirdToken(secret: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length < 16) return false;
  const a = createHash('sha256').update(secret).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

const CLASSIC_STATUS: Record<string, string> = { accepted: 'whatsapp.accepted', sent: 'whatsapp.sent', delivered: 'whatsapp.delivered', read: 'whatsapp.read', sending_failed: 'whatsapp.failed', delivery_failed: 'whatsapp.failed' };

/**
 * Converte o aviso da Bird clássica ({service, event, payload}) no formato que o resto do código já entende:
 * resposta recebida = whatsapp.received; andamento de envio = whatsapp.<situação>, com o nosso id em metadata.ref (é o `reference` que mandamos).
 * Mídia recebida ainda não é baixada nesta versão: vira um aviso no texto.
 */
export function classicToEvent(body: unknown): unknown {
  const b = obj(body);
  const event = str(b.event) ?? '';
  const p = obj(b.payload);
  if (event === 'whatsapp.inbound') {
    const contact = obj(obj(p.sender).contact);
    const msg = obj(p.body);
    const kind = str(msg.type) ?? 'text';
    const text = kind === 'text' ? (str(obj(msg.text).text) ?? '') : `[${kind === 'image' ? 'imagem' : kind === 'file' ? 'arquivo' : kind} recebido(a): veja na Bird]`;
    return { type: 'whatsapp.received', data: { id: str(p.id), from: { phone_number: str(contact.identifierValue) }, text: { body: text } } };
  }
  if (event === 'whatsapp.outbound') {
    const type = CLASSIC_STATUS[str(p.status) ?? ''];
    if (!type) return { type: 'ignorado', data: {} }; // processing, scheduled, skipped…: nada a atualizar
    return { type, data: { id: str(p.id), metadata: { ref: str(p.reference) }, reason: str(p.reason) } };
  }
  return { type: 'ignorado', data: {} };
}

const RANK: Record<string, number> = { fila: 0, enviando: 1, aceita: 2, enviada: 3, entregue: 4, lida: 5 };
const STATUS_OF: Record<string, string> = { 'whatsapp.accepted': 'aceita', 'whatsapp.sent': 'enviada', 'whatsapp.delivered': 'entregue', 'whatsapp.read': 'lida', 'whatsapp.failed': 'falhou', 'whatsapp.rejected': 'falhou' };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** O texto da mensagem recebida (o formato exato vem da Bird; tentamos os lugares prováveis). */
function inboundText(data: Obj): string {
  const body = obj(data.body);
  const content = obj(data.content);
  const msg = obj(data.message);
  const cand = [str(data.body), str(data.text), str(obj(body.text).text), str(body.text), str(content.text), str(obj(content.text).text), str(msg.text), str(obj(msg.body).text)];
  return cand.find((c) => c !== null) ?? '';
}

export async function handleBirdEvent(ctx: Ctx, event: unknown, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<{ handled: boolean }> {
  const ev = obj(event);
  const type = str(ev.type) ?? '';
  const data = obj(ev.data);
  if (type === 'whatsapp.received') {
    // Caixa de entrada do WhatsApp do Fôlego (backoffice): a mensagem vira conversa; falha aqui não impede o tratamento de SAIR abaixo.
    await ingestBirdInbound(ctx, data, opts).catch((e) => opts.log?.({ evento: 'bird_entrada_falhou', erro: e instanceof Error ? e.message.slice(0, 100) : 'erro' }));
    const from = obj(data.from);
    const digits = waPhone(str(from.phone_number) ?? '');
    if (!digits) return { handled: false }; // sem telefone (só identificador do WhatsApp): não há como cruzar com a nossa lista
    if (isOptOut(inboundText(data))) {
      const c = await ensureContact(ctx, digits);
      await ctx.db.query(`UPDATE app.msg_contacts SET opted_out = true, opted_out_at = coalesce(opted_out_at, now()) WHERE phone_key = $1`, [c.key]);
      await ctx.db.query(`UPDATE app.msg_log SET status = 'cancelada', error = 'pediu para não receber' WHERE phone_key = $1 AND status = 'fila'`, [c.key]);
      await ctx.db.query(`INSERT INTO app.msg_log(direction, purpose, phone_key, status) VALUES ('in','resposta_sair',$1,'recebida')`, [c.key]);
      opts.log?.({ evento: 'bird_contato_saiu' });
      return { handled: true };
    }
    const key = contactKey(ctx, digits);
    const known = await ctx.db.query(`SELECT 1 FROM app.msg_contacts WHERE phone_key = $1`, [key]);
    if (known.rows.length > 0) await ctx.db.query(`INSERT INTO app.msg_log(direction, purpose, phone_key, status) VALUES ('in','resposta',$1,'recebida')`, [key]);
    return { handled: known.rows.length > 0 };
  }
  const next = STATUS_OF[type];
  if (!next) return { handled: false }; // eventos que não usamos (reações, grupos…) não são erro
  const meta = obj(data.metadata);
  const ref = str(meta.ref);
  const provider = [str(data.id), str(data.message_id), str(data.whatsapp_id)].filter((x): x is string => x !== null);
  const row = await ctx.db.query<{ id: string; status: string }>(
    `SELECT id, status FROM app.msg_log WHERE direction = 'out' AND (id::text = $1 OR provider_message_id = ANY($2::text[])) LIMIT 1`,
    [ref ?? '', provider],
  );
  const m = row.rows[0];
  if (!m) return { handled: await applyBirdStatus(ctx, type, data, str(obj(data.error).message) ?? str(data.error) ?? str(data.reason) ?? str(data.failure_reason) ?? type) }; // não é convite: pode ser mensagem da caixa de entrada
  if (next === 'falhou') {
    if ((RANK[m.status] ?? 0) >= RANK.entregue!) return { handled: true }; // já entregue: um "falhou" atrasado não desfaz
    const why = str(obj(data.error).message) ?? str(data.error) ?? str(data.reason) ?? str(data.failure_reason) ?? type;
    await ctx.db.query(`UPDATE app.msg_log SET status = 'falhou', error = $2 WHERE id = $1`, [m.id, why.slice(0, 200)]);
    opts.log?.({ evento: 'bird_mensagem_falhou', tipo: type });
    return { handled: true };
  }
  if ((RANK[next] ?? 0) > (RANK[m.status] ?? 0) || m.status === 'falhou') {
    await ctx.db.query(`UPDATE app.msg_log SET status = $2, error = NULL WHERE id = $1`, [m.id, next]);
  }
  return { handled: true };
}

/**
 * Traz para a caixa de entrada as respostas que a Bird recebeu mas o webhook não entregou (recusado por assinatura/código, servidor fora do ar).
 * Lê as mensagens do canal na API clássica da Bird (GET /workspaces/{ws}/channels/{canal}/messages, com limit, pageToken e startAt), fica com as
 * recebidas e passa cada uma pelo mesmo caminho do webhook (inclui o SAIR). Não duplica (a mensagem é identificada pelo id da Bird) e mantém a hora original.
 */
export async function backfillBirdInbound(ctx: Ctx, days = 14, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<{ lidas: number; recebidasNaBird: number; novas: number }> {
  const c = ctx.config.bird;
  if (!c || !c.classic) throw new AppError(409, 'wa_backfill', 'A busca das respostas atrasadas só existe na Bird clássica (a que está em uso).');
  const acc = (await loadAccount(ctx, HOUSE_PARTNER_ID)) ?? (await ensureHouseAccount(ctx));
  if (!acc) throw birdOff();
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 30) * 86_400_000).toISOString();
  const count = async () => Number((await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE partner_id = $1 AND direction = 'in'`, [HOUSE_PARTNER_ID])).rows[0]?.n ?? 0);
  const before = await count();

  const incoming: Obj[] = [];
  let lidas = 0;
  let pageToken = '';
  for (let page = 0; page < 60; page += 1) {
    const q = new URLSearchParams({ limit: '100', startAt: since, ...(pageToken ? { pageToken } : {}) });
    const res = await fetch(`${c.baseUrl}/workspaces/${c.workspaceId}/channels/${c.channelId}/messages?${q}`, { headers: { authorization: `AccessKey ${c.apiKey}` }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new AppError(502, 'wa_backfill_bird', `A Bird recusou a consulta (erro ${res.status}).`);
    const j = obj(await res.json().catch(() => ({})));
    const results = Array.isArray(j.results) ? (j.results as unknown[]) : [];
    for (const m of results) {
      lidas += 1;
      if (obj(m).direction === 'incoming') incoming.push(obj(m));
    }
    pageToken = str(j.nextPageToken) ?? '';
    if (!pageToken || results.length === 0) break;
  }

  // Do mais antigo ao mais novo, para as conversas nascerem na ordem certa.
  incoming.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  const waIds: string[] = [];
  for (const m of incoming) {
    const ev = classicToEvent({ event: 'whatsapp.inbound', payload: m }) as { type: string; data: Obj };
    const id = str(ev.data.id);
    await handleBirdEvent(ctx, ev, opts);
    const at = str(m.createdAt);
    if (id && at && !Number.isNaN(Date.parse(at))) {
      // A mensagem entra "agora"; devolve a hora em que o cliente realmente escreveu (só se acabou de ser criada por esta busca).
      await ctx.db.query(`UPDATE app.wa_messages SET created_at = $3 WHERE partner_id = $1 AND wa_id = $2 AND created_at > now() - interval '2 minutes'`, [HOUSE_PARTNER_ID, id, at]);
      waIds.push(id);
    }
  }
  if (waIds.length) {
    // A janela de 24 h e a ordem da lista seguem o que o cliente fez de fato, não a hora desta busca.
    await ctx.db.query(
      `UPDATE app.wa_threads t SET last_inbound_at = (SELECT max(m.created_at) FROM app.wa_messages m WHERE m.thread_id = t.id AND m.direction = 'in'),
                                  last_message_at = (SELECT max(m.created_at) FROM app.wa_messages m WHERE m.thread_id = t.id)
        WHERE t.partner_id = $1 AND t.id IN (SELECT thread_id FROM app.wa_messages WHERE partner_id = $1 AND wa_id = ANY($2::text[]))`,
      [HOUSE_PARTNER_ID, waIds],
    );
  }
  return { lidas, recebidasNaBird: incoming.length, novas: (await count()) - before };
}

/** Resumo para o backoffice: como estão os envios dos últimos 30 dias. */
export async function birdStats(ctx: Ctx): Promise<{ enabled: boolean; queued: number; accepted: number; delivered: number; read: number; failed: number; optedOut: number }> {
  const s = await ctx.db.query<{ queued: string; accepted: string; delivered: string; read: string; failed: string }>(
    `SELECT count(*) FILTER (WHERE status IN ('fila','enviando'))::text AS queued,
            count(*) FILTER (WHERE status IN ('aceita','enviada'))::text AS accepted,
            count(*) FILTER (WHERE status = 'entregue')::text AS delivered,
            count(*) FILTER (WHERE status = 'lida')::text AS read,
            count(*) FILTER (WHERE status = 'falhou')::text AS failed
       FROM app.msg_log WHERE direction = 'out' AND created_at > now() - interval '30 days'`,
  );
  const o = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.msg_contacts WHERE opted_out`);
  const v = s.rows[0];
  return { enabled: birdOf(ctx) !== null, queued: Number(v?.queued ?? 0), accepted: Number(v?.accepted ?? 0), delivered: Number(v?.delivered ?? 0), read: Number(v?.read ?? 0), failed: Number(v?.failed ?? 0), optedOut: Number(o.rows[0]?.n ?? 0) };
}

/** Erro padrão quando o WhatsApp do Fôlego não está ligado. */
export const birdOff = (): AppError => new AppError(503, 'whatsapp_unavailable', 'O envio pelo WhatsApp do Fôlego ainda não está ativo. Você pode compartilhar o link pelo seu próprio WhatsApp.');
