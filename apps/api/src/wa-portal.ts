// WhatsApp no portal do parceiro: conexão do número, conversas, modelos, disparos e agente de IA (gancho).
// Tudo isolado por parceiro. As regras de envio (janela de 24 h, permissão, teto, silêncio) ficam em whatsapp.ts.
import { z } from 'zod';
import { decryptText, encryptText, newToken, safeEqual } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import {
  DEFAULT_AGENT, WaError, agentConfigOf, credOf, ensureThread, loadAccount, mayReceiveTemplates, need, processWhatsAppQueue, queueMessage, renderTemplate, templateSlots, transportOf, waPhone, windowEndsAt, windowOpen, notConnected,
} from './whatsapp.ts';
import type { ThreadRow, WaAccount } from './whatsapp.ts';
import { THREAD_COLS } from './whatsapp.ts';
import { classifyOutgoing, loadMedia, previewOf, storeMedia } from './wa-media.ts';

const iso = (d: unknown): string => new Date(d as string).toISOString();
const PAGE = 30;
/** Primeiro nome com a primeira letra maiúscula ("MARIA SOUZA" vira "Maria"): a planilha costuma vir em caixa-alta. */
const firstName = (full: string): string => {
  const f = full.trim().split(/\s+/)[0] ?? '';
  return f.charAt(0).toUpperCase() + f.slice(1).toLowerCase();
};

// ---------------------------------------------------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------------------------------------------------
export const accountSchema = z.strictObject({
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, 'O ID do número tem só dígitos.').optional(),
  wabaId: z.string().trim().regex(/^\d{5,25}$/).nullable().optional(),
  displayPhone: z.string().trim().max(40).nullable().optional(),
  token: z.string().trim().min(20).max(1000).optional(),
  appSecret: z.string().trim().min(16).max(200).optional(),
  appId: z.string().trim().regex(/^\d{5,25}$/, 'O ID do app tem só dígitos.').nullable().optional(),
  dailyCap: z.number().int().min(1).max(5000).optional(),
  quietStart: z.number().int().min(0).max(23).optional(),
  quietEnd: z.number().int().min(0).max(23).optional(),
  status: z.enum(['ativa', 'pausada']).optional(),
});

export async function accountView(ctx: Ctx, partnerId: string) {
  const a = await loadAccount(ctx, partnerId);
  const base = `${ctx.config.publicUrl}/webhooks/whatsapp/${partnerId}`;
  if (!a) return { connected: false, webhookUrl: base, agentAvailable: Boolean(ctx.salesAgent), defaultAgent: DEFAULT_AGENT };
  const day = `${todaySaoPaulo()}T00:00:00-03:00`;
  const used = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND kind = 'template' AND sent_at >= $2::timestamptz`, [partnerId, day]);
  return {
    connected: true, provider: a.provider, appId: a.appId, phoneNumberId: a.phoneNumberId, wabaId: a.wabaId, displayPhone: a.displayPhone, status: a.status, dailyCap: a.dailyCap, quietStart: a.quietStart, quietEnd: a.quietEnd,
    usedToday: num(used.rows[0]?.n ?? 0), webhookUrl: base, verifyToken: a.verifyToken, agent: a.agent, agentAvailable: Boolean(ctx.salesAgent), tokenSet: true, appSecretSet: true,
  };
}

export async function saveAccount(ctx: Ctx, partnerId: string, input: z.infer<typeof accountSchema>) {
  const cur = await ctx.db.query<{ partner_id: string }>(`SELECT partner_id FROM app.wa_accounts WHERE partner_id = $1`, [partnerId]);
  const secret = ctx.config.secret;
  try {
    if (!cur.rows[0]) {
      if (!input.phoneNumberId || !input.token || !input.appSecret) throw new AppError(422, 'missing', 'Informe o ID do número, o token e o segredo do app da Meta.');
      await ctx.db.query(
        `INSERT INTO app.wa_accounts(partner_id, phone_number_id, waba_id, display_phone, token_enc, app_secret_enc, verify_token, daily_cap, quiet_start, quiet_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [partnerId, input.phoneNumberId, input.wabaId ?? null, input.displayPhone ?? null, encryptText(secret, input.token), encryptText(secret, input.appSecret), newToken().slice(0, 24), input.dailyCap ?? 200, input.quietStart ?? 20, input.quietEnd ?? 8],
      );
    } else {
      const sets: string[] = [];
      const params: unknown[] = [partnerId];
      const add = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      if (input.phoneNumberId) add('phone_number_id', input.phoneNumberId);
      if (input.wabaId !== undefined) add('waba_id', input.wabaId);
      if (input.appId !== undefined) add('app_id', input.appId);
      if (input.displayPhone !== undefined) add('display_phone', input.displayPhone);
      if (input.token) add('token_enc', encryptText(secret, input.token));
      if (input.appSecret) add('app_secret_enc', encryptText(secret, input.appSecret));
      if (input.dailyCap !== undefined) add('daily_cap', input.dailyCap);
      if (input.quietStart !== undefined) add('quiet_start', input.quietStart);
      if (input.quietEnd !== undefined) add('quiet_end', input.quietEnd);
      if (input.status) add('status', input.status);
      if (sets.length) await ctx.db.query(`UPDATE app.wa_accounts SET ${sets.join(', ')} WHERE partner_id = $1`, params);
    }
  } catch (e) {
    if (e instanceof Error && /wa_accounts_phone_number_idx|duplicate key/i.test(e.message)) throw new AppError(409, 'duplicate', 'Este número já está conectado a outro parceiro.');
    throw e;
  }
  await audit(ctx.db, `partner:${partnerId}`, 'wa_account_saved', 'partner', partnerId, { fields: Object.keys(input).filter((k) => k !== 'token' && k !== 'appSecret') });
  return accountView(ctx, partnerId);
}

/** Pergunta à Meta quem é o número (confere ID e token sem mandar mensagem nenhuma). */
export async function testAccount(ctx: Ctx, partnerId: string) {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  try {
    const p = await transportOf(ctx, a.provider).profile(credOf(a));
    if (p.displayPhone) await ctx.db.query(`UPDATE app.wa_accounts SET display_phone = $2 WHERE partner_id = $1`, [partnerId, p.displayPhone]);
    return { ok: true, displayPhone: p.displayPhone, verifiedName: p.verifiedName };
  } catch (e) {
    throw new AppError(422, 'wa_test_failed', `A Meta recusou a conexão: ${e instanceof Error ? e.message : 'erro'}. Confira o ID do número e o token.`);
  }
}

export const agentSchema = z.strictObject({
  enabled: z.boolean().optional(),
  persona: z.string().trim().min(10).max(2000).optional(),
  rules: z.string().trim().min(10).max(3000).optional(),
  handoffKeywords: z.array(z.string().trim().min(2).max(40)).max(30).optional(),
  maxRepliesPerHour: z.number().int().min(1).max(30).optional(),
  disclosure: z.string().trim().max(300).optional(),
});

export async function saveAgent(ctx: Ctx, partnerId: string, input: z.infer<typeof agentSchema>) {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  if (input.enabled && !ctx.salesAgent) throw new AppError(409, 'agent_unavailable', 'O agente de IA ainda não está instalado neste servidor. A configuração fica salva para quando ele entrar.');
  const merged = { ...a.agent, ...input };
  await ctx.db.query(`UPDATE app.wa_accounts SET agent = $2::jsonb WHERE partner_id = $1`, [partnerId, JSON.stringify(merged)]);
  await audit(ctx.db, `partner:${partnerId}`, 'wa_agent_saved', 'partner', partnerId, { enabled: merged.enabled });
  return { agent: agentConfigOf(merged) };
}

async function requireActive(ctx: Ctx, partnerId: string): Promise<WaAccount> {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  if (a.status !== 'ativa') throw new AppError(409, 'wa_paused', 'O WhatsApp está pausado. Reative em Conexão.');
  return a;
}

// ---------------------------------------------------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------------------------------------------------
export const templateSchema = z.strictObject({
  name: z.string().trim().regex(/^[a-z0-9_-]{3,60}$/, 'Use letras minúsculas, números, _ e - (3 a 60).'),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('pt_BR'),
  category: z.enum(['MARKETING', 'UTILITY']),
  body: z.string().trim().min(5).max(1024),
  /** Só para modelos com variáveis nomeadas (Bird): o nome de cada {{n}}, na ordem. */
  paramNames: z.array(z.string().trim().regex(/^[a-z0-9_]{2,40}$/)).max(10).optional(),
});
export const templatePatchSchema = z.strictObject({ status: z.enum(['rascunho', 'em_analise', 'aprovado', 'rejeitado']) });

export async function listTemplates(ctx: Ctx, partnerId: string) {
  const r = await ctx.db.query<{ id: string; name: string; language: string; category: string; body: string; status: string; created_at: Date; param_names: string[] | null }>(`SELECT id, name, language, category, body, status, created_at, param_names FROM app.wa_templates WHERE partner_id = $1 ORDER BY created_at DESC`, [partnerId]);
  return { templates: r.rows.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, body: t.body, status: t.status, slots: templateSlots(t.body), paramNames: t.param_names, createdAt: iso(t.created_at) })) };
}

export async function createTemplate(ctx: Ctx, partnerId: string, input: z.infer<typeof templateSchema>) {
  try {
    const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.wa_templates(partner_id, name, language, category, body, param_names) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [partnerId, input.name, input.language, input.category, input.body, input.paramNames ?? null]);
    return { id: r.rows[0]!.id };
  } catch (e) {
    if (e instanceof Error && /duplicate key/i.test(e.message)) throw new AppError(409, 'duplicate', 'Já existe um modelo com este nome.');
    throw e;
  }
}

export async function setTemplateStatus(ctx: Ctx, partnerId: string, id: string, status: z.infer<typeof templatePatchSchema>['status']) {
  const r = await ctx.db.query(`UPDATE app.wa_templates SET status = $3 WHERE id = $1 AND partner_id = $2`, [id, partnerId, status]);
  if (!r.rowCount) throw notFound();
  return { ok: true };
}

export async function deleteTemplate(ctx: Ctx, partnerId: string, id: string) {
  try {
    const r = await ctx.db.query(`DELETE FROM app.wa_templates WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
    if (!r.rowCount) throw notFound();
  } catch (e) {
    if (e instanceof Error && /foreign key|violates/i.test(e.message)) throw new AppError(409, 'in_use', 'Este modelo já foi usado em mensagens. Marque como rejeitado para parar de usar.');
    throw e;
  }
  return { ok: true };
}

async function approvedTemplate(ctx: Ctx, partnerId: string, id: string) {
  const r = await ctx.db.query<{ id: string; name: string; body: string; status: string }>(`SELECT id, name, body, status FROM app.wa_templates WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
  const t = r.rows[0];
  if (!t) throw notFound();
  if (t.status !== 'aprovado') throw new AppError(409, 'template_not_approved', 'Este modelo ainda não foi aprovado pela Meta. Depois da aprovação, marque como "aprovado" em Modelos.');
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------------------------------------------------
const maskPhone = (e164: string): string => `(${e164.slice(2, 4)}) •••••-${e164.slice(-4)}`;

export async function listThreads(ctx: Ctx, partnerId: string, o: { filtro?: string | undefined; q?: string | undefined; page?: number | undefined }) {
  const params: unknown[] = [partnerId];
  const where = ['t.partner_id = $1'];
  if (o.filtro === 'nao_lidas') where.push('t.unread_n > 0');
  else if (o.filtro === 'abertas') where.push(`t.state = 'aberta'`);
  else if (o.filtro === 'fechadas') where.push(`t.state = 'fechada'`);
  const q = (o.q ?? '').trim().toLowerCase().replace(/[%_\\]/g, '');
  if (q) {
    params.push(`%${q}%`);
    where.push(`lower(coalesce(t.display_name, c.name, '')) LIKE $${params.length}`);
  }
  const page = Math.max(0, Math.floor(o.page ?? 0));
  const rows = await ctx.db.query<ThreadRow & { cname: string | null; preview: Buffer | null; pdir: string | null; pkind: string | null }>(
    `SELECT t.id, t.partner_id, t.contact_id, t.delivery_id, t.phone_enc, t.display_name, t.state, t.mode, t.last_inbound_at, t.last_message_at, t.unread_n, t.opted_out, t.ai_replies_hour, t.ai_hour_start, t.avatar_media_id, c.name AS cname,
            (SELECT m.body_enc FROM app.wa_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
            (SELECT m.direction FROM app.wa_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS pdir,
            (SELECT m.kind FROM app.wa_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS pkind
       FROM app.wa_threads t LEFT JOIN app.partner_contacts c ON c.id = t.contact_id
      WHERE ${where.join(' AND ')} ORDER BY t.last_message_at DESC NULLS LAST LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  const unread = await ctx.db.query<{ n: string }>(`SELECT coalesce(sum(unread_n), 0)::text AS n FROM app.wa_threads WHERE partner_id = $1`, [partnerId]);
  return {
    unread: num(unread.rows[0]?.n ?? 0),
    items: rows.rows.map((t) => {
      const phone = decryptText(ctx.config.secret, t.phone_enc);
      return {
        id: t.id, name: t.display_name ?? t.cname ?? maskPhone(phone), phone: maskPhone(phone), unread: t.unread_n, optedOut: t.opted_out, mode: t.mode, state: t.state,
        origin: t.delivery_id ? 'folego' : t.contact_id ? 'base' : 'inbound', lastAt: t.last_message_at ? iso(t.last_message_at) : null, windowOpen: windowOpen(t.last_inbound_at),
        preview: t.preview ? previewOf(t.pkind ?? 'text', decryptText(ctx.config.secret, t.preview)).slice(0, 90) : '', previewOut: t.pdir === 'out', previewKind: t.pkind ?? 'text', avatarMediaId: t.avatar_media_id ?? null,
      };
    }),
  };
}

async function ownThread(ctx: Ctx, partnerId: string, id: string): Promise<ThreadRow> {
  const r = await ctx.db.query<ThreadRow>(`SELECT ${THREAD_COLS} FROM app.wa_threads WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export async function threadDetail(ctx: Ctx, partnerId: string, id: string) {
  const t = await ownThread(ctx, partnerId, id);
  await ctx.db.query(`UPDATE app.wa_threads SET unread_n = 0 WHERE id = $1`, [id]);
  const msgs = await ctx.db.query<{ id: string; direction: string; author: string; kind: string; body_enc: Buffer; status: string; error: string | null; created_at: Date; media_id: string | null; voice: boolean; forwarded: boolean; mime: string | null; filename: string | null; size_bytes: number | null }>(
    `SELECT m.id, m.direction, m.author, m.kind, m.body_enc, m.status, m.error, m.created_at, m.media_id, m.voice, m.forwarded, w.mime, w.filename, w.size_bytes
       FROM app.wa_messages m LEFT JOIN app.wa_media w ON w.id = m.media_id WHERE m.thread_id = $1 ORDER BY m.created_at DESC LIMIT 200`,
    [id],
  );
  const contact = t.contact_id ? await ctx.db.query<{ name: string; wa_optin: string; stage: string }>(`SELECT name, wa_optin, stage FROM app.partner_contacts WHERE id = $1`, [t.contact_id]) : { rows: [] };
  const phone = decryptText(ctx.config.secret, t.phone_enc);
  return {
    id: t.id, name: t.display_name ?? contact.rows[0]?.name ?? maskPhone(phone), phone, optedOut: t.opted_out, mode: t.mode, state: t.state, contactId: t.contact_id, deliveryId: t.delivery_id,
    contactStage: contact.rows[0]?.stage ?? null, waOptin: contact.rows[0]?.wa_optin ?? (t.delivery_id ? 'sim' : t.last_inbound_at ? 'sim' : 'desconhecido'),
    windowOpen: windowOpen(t.last_inbound_at), windowEndsAt: windowEndsAt(t.last_inbound_at), canTemplate: await mayReceiveTemplates(ctx, t),
    avatarMediaId: t.avatar_media_id ?? null, notes: t.notes_enc ? decryptText(ctx.config.secret, t.notes_enc) : '', optin: t.optin === true,
    messages: msgs.rows.reverse().map((m) => ({
      id: m.id, direction: m.direction, author: m.author, kind: m.kind, text: decryptText(ctx.config.secret, m.body_enc), status: m.status, error: m.error, at: iso(m.created_at),
      forwarded: m.forwarded, voice: m.voice, media: m.media_id ? { id: m.media_id, mime: m.mime, filename: m.filename, size: m.size_bytes } : null,
    })),
  };
}

export const sendSchema = z.union([
  z.strictObject({ text: z.string().trim().min(1).max(1000) }),
  z.strictObject({ mediaId: z.string().uuid(), caption: z.string().trim().max(1000).default(''), voice: z.boolean().default(false) }),
  z.strictObject({ templateId: z.string().uuid(), vars: z.array(z.string().trim().max(200)).max(10).default([]) }),
]);

export async function sendInThread(ctx: Ctx, partnerId: string, threadId: string, input: z.infer<typeof sendSchema>, by?: string) {
  await requireActive(ctx, partnerId);
  const t = await ownThread(ctx, partnerId, threadId);
  if (t.opted_out) throw new AppError(409, 'opted_out', 'Este contato pediu para não receber mensagens.');
  let id: string;
  if ('text' in input) {
    if (!windowOpen(t.last_inbound_at)) throw new AppError(409, 'window_closed', 'A janela de 24 h está fechada: o contato não escreveu nas últimas 24 horas. Envie um modelo aprovado.');
    id = await queueMessage(ctx, { partnerId, threadId, author: 'humano', kind: 'text', text: input.text, ...(by ? { sentBy: by } : {}) });
  } else if ('mediaId' in input) {
    if (!windowOpen(t.last_inbound_at)) throw new AppError(409, 'window_closed', 'A janela de 24 h está fechada: o contato não escreveu nas últimas 24 horas. Envie um modelo aprovado antes de mandar arquivos.');
    const file = await ctx.db.query<{ mime: string }>(`SELECT mime FROM app.wa_media WHERE id = $1 AND partner_id = $2 AND origin = 'out'`, [input.mediaId, partnerId]);
    if (!file.rows[0]) throw notFound();
    const kind = classifyOutgoing(file.rows[0].mime);
    id = await queueMessage(ctx, { partnerId, threadId, author: 'humano', kind, text: kind === 'audio' ? '' : input.caption, mediaId: input.mediaId, voice: kind === 'audio' && input.voice, ...(by ? { sentBy: by } : {}) });
  } else {
    const tpl = await approvedTemplate(ctx, partnerId, input.templateId);
    if (!(await mayReceiveTemplates(ctx, t))) throw new AppError(409, 'no_optin', 'Este contato ainda não deu permissão de WhatsApp. Marque a permissão na ficha dele (só se você realmente a tem) ou espere ele escrever.');
    if (input.vars.length < templateSlots(tpl.body)) throw new AppError(422, 'missing_vars', `O modelo tem ${templateSlots(tpl.body)} variável(is). Preencha todas.`);
    id = await queueMessage(ctx, { partnerId, threadId, author: 'humano', kind: 'template', text: renderTemplate(tpl.body, input.vars), templateId: tpl.id, vars: input.vars, ...(by ? { sentBy: by } : {}) });
  }
  await ctx.db.query(`UPDATE app.wa_threads SET mode = 'humano' WHERE id = $1`, [threadId]); // quando uma pessoa responde, a IA sai da conversa
  await processWhatsAppQueue(ctx).catch(() => 0); // tenta já; se falhar, o worker repete
  return { id };
}

export const threadPatchSchema = z.strictObject({ state: z.enum(['aberta', 'fechada']).optional(), mode: z.enum(['humano', 'ia']).optional(), optedOut: z.literal(true).optional() });

export async function patchThread(ctx: Ctx, partnerId: string, id: string, p: z.infer<typeof threadPatchSchema>) {
  const t = await ownThread(ctx, partnerId, id);
  if (p.mode === 'ia') {
    const a = await loadAccount(ctx, partnerId);
    if (!a?.agent.enabled || !ctx.salesAgent) throw new AppError(409, 'agent_off', 'O agente de IA não está ligado.');
    if (t.opted_out) throw new AppError(409, 'opted_out', 'Este contato pediu para não receber mensagens.');
  }
  await ctx.db.query(`UPDATE app.wa_threads SET state = coalesce($2, state), mode = coalesce($3, mode), opted_out = opted_out OR $4 WHERE id = $1`, [id, p.state ?? null, p.mode ?? null, p.optedOut === true]);
  if (p.optedOut && t.contact_id) await ctx.db.query(`UPDATE app.partner_contacts SET wa_optin = 'nao' WHERE id = $1 AND partner_id = $2`, [t.contact_id, partnerId]);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Arquivos, encaminhar, número novo e perfis
// ---------------------------------------------------------------------------------------------------------------------
/** Lê o envio de arquivo: corpo cru (application/octet-stream) e, nos cabeçalhos, o tipo (x-mime), o nome (x-filename) e a finalidade (x-purpose: avatar). */
export function readUpload(req: { body: unknown; headers: Record<string, string | string[] | undefined> }): { bytes: Buffer; mime: string; filename: string | null; avatar: boolean } {
  if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'upload_format', 'Envie o arquivo como corpo da requisição (application/octet-stream).');
  const h = (k: string): string => { const v = req.headers[k]; return typeof v === 'string' ? v : ''; };
  let filename: string | null = null;
  try { filename = decodeURIComponent(h('x-filename')) || null; } catch { filename = null; }
  return { bytes: req.body, mime: h('x-mime'), filename, avatar: h('x-purpose') === 'avatar' };
}

const waFail = (e: unknown): unknown => (e instanceof WaError ? new AppError(422, 'wa_failed', e.message) : e);

/** Guarda um arquivo para enviar depois (foto, áudio, documento, vídeo) ou uma foto de perfil (`avatar`). */
export async function uploadMedia(ctx: Ctx, partnerId: string, a: { bytes: Buffer; mime: string; filename: string | null; avatar?: boolean }) {
  const s = await storeMedia(ctx, partnerId, { mime: a.mime, filename: a.filename, bytes: a.bytes, origin: a.avatar ? 'avatar' : 'out' });
  return { id: s.id, kind: s.kind, mime: s.mime, filename: s.filename, size: s.size };
}

/** Arquivo de uma conversa (só do próprio parceiro). */
export const mediaFile = (ctx: Ctx, partnerId: string, id: string) => loadMedia(ctx, id, partnerId);

export const forwardSchema = z.strictObject({ messageIds: z.array(z.string().uuid()).min(1).max(20), threadIds: z.array(z.string().uuid()).min(1).max(5) });

/** Encaminha mensagens (texto e arquivos) para outras conversas, respeitando a janela de 24 h e quem pediu para não receber. */
export async function forwardMessages(ctx: Ctx, partnerId: string, fromThreadId: string, input: z.infer<typeof forwardSchema>, by?: string) {
  await requireActive(ctx, partnerId);
  await ownThread(ctx, partnerId, fromThreadId);
  const msgs = await ctx.db.query<{ id: string; kind: string; body_enc: Buffer; media_id: string | null; mime: string | null }>(
    `SELECT m.id, m.kind, m.body_enc, m.media_id, w.mime FROM app.wa_messages m LEFT JOIN app.wa_media w ON w.id = m.media_id
      WHERE m.thread_id = $1 AND m.id = ANY($2::uuid[]) AND m.status <> 'falhou' ORDER BY m.created_at`,
    [fromThreadId, input.messageIds],
  );
  if (msgs.rows.length === 0) throw notFound();
  const results: { threadId: string; name: string; sent: number; skipped: string | null }[] = [];
  for (const tid of [...new Set(input.threadIds)]) {
    const t = await ownThread(ctx, partnerId, tid);
    const name = t.display_name ?? maskPhone(decryptText(ctx.config.secret, t.phone_enc));
    if (t.opted_out) { results.push({ threadId: tid, name, sent: 0, skipped: 'Pediu para não receber mensagens.' }); continue; }
    if (!windowOpen(t.last_inbound_at)) { results.push({ threadId: tid, name, sent: 0, skipped: 'A janela de 24 h está fechada: com este contato só dá para enviar um modelo.' }); continue; }
    let sent = 0;
    for (const m of msgs.rows) {
      const text = decryptText(ctx.config.secret, m.body_enc);
      if (m.kind === 'text' || m.kind === 'template') {
        if (!text) continue;
        await queueMessage(ctx, { partnerId, threadId: tid, author: 'humano', kind: 'text', text, forwarded: true, ...(by ? { sentBy: by } : {}) });
        sent += 1;
        continue;
      }
      if (!m.media_id || !m.mime) continue;
      let kind: 'image' | 'audio' | 'document' | 'video';
      try { kind = classifyOutgoing(m.mime); } catch { continue; } // figurinha ou formato que o WhatsApp não reenvia
      await queueMessage(ctx, { partnerId, threadId: tid, author: 'humano', kind, text: kind === 'audio' ? '' : text, mediaId: m.media_id, forwarded: true, ...(by ? { sentBy: by } : {}) });
      sent += 1;
    }
    results.push({ threadId: tid, name, sent, skipped: sent ? null : 'Nada nesta seleção pode ser encaminhado.' });
  }
  await processWhatsAppQueue(ctx).catch(() => 0);
  return { results };
}

/** Adiciona um número novo (com ou sem primeiro modelo). `optin` = quem atende declara que a pessoa autorizou receber mensagens. */
export const newThreadSchema = z.strictObject({
  phone: z.string().trim().min(8).max(24),
  name: z.string().trim().max(60).optional(),
  optin: z.boolean().default(false),
  templateId: z.string().uuid().optional(),
  vars: z.array(z.string().trim().max(200)).max(10).default([]),
});

export async function newThread(ctx: Ctx, partnerId: string, input: z.infer<typeof newThreadSchema>, by?: string) {
  await requireActive(ctx, partnerId);
  const phone = waPhone(input.phone);
  if (!phone) throw new AppError(422, 'invalid_phone', 'Digite o telefone com DDD, por exemplo (41) 99999-0000.');
  const thread = await ensureThread(ctx, partnerId, phone, { name: input.name?.trim() || null });
  if (input.optin) await ctx.db.query(`UPDATE app.wa_threads SET optin = true WHERE id = $1`, [thread.id]);
  if (input.templateId) await sendInThread(ctx, partnerId, thread.id, { templateId: input.templateId, vars: input.vars }, by);
  await audit(ctx.db, by ? `user:${by}` : `partner:${partnerId}`, 'wa_new_thread', 'wa_thread', thread.id, { optin: input.optin, template: Boolean(input.templateId) });
  return { threadId: thread.id, windowOpen: windowOpen(thread.last_inbound_at) };
}

/** Perfil do contato: nome, observações, foto e permissão. A foto e as observações só aparecem para quem atende. */
export const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
  optin: z.boolean().optional(),
});

export async function patchProfile(ctx: Ctx, partnerId: string, id: string, p: z.infer<typeof profileSchema>) {
  const t = await ownThread(ctx, partnerId, id);
  if (p.avatarMediaId) {
    const ok = await ctx.db.query(`SELECT 1 FROM app.wa_media WHERE id = $1 AND partner_id = $2 AND origin = 'avatar'`, [p.avatarMediaId, partnerId]);
    if (!ok.rows[0]) throw notFound();
  }
  const notesSet = p.notes !== undefined;
  const avatarSet = p.avatarMediaId !== undefined;
  await ctx.db.query(
    `UPDATE app.wa_threads SET display_name = coalesce($2, display_name),
            notes_enc = CASE WHEN $3::boolean THEN $4::bytea ELSE notes_enc END,
            avatar_media_id = CASE WHEN $5::boolean THEN $6::uuid ELSE avatar_media_id END,
            optin = coalesce($7::boolean, optin) WHERE id = $1`,
    [id, p.name ?? null, notesSet, notesSet && p.notes ? encryptText(ctx.config.secret, p.notes) : null, avatarSet, p.avatarMediaId ?? null, p.optin ?? null],
  );
  if (avatarSet && t.avatar_media_id && t.avatar_media_id !== p.avatarMediaId) await ctx.db.query(`DELETE FROM app.wa_media WHERE id = $1 AND partner_id = $2 AND origin = 'avatar'`, [t.avatar_media_id, partnerId]);
  return { ok: true };
}

// Perfil da empresa (o que o cliente vê do número): descrição, e-mail, site, endereço e foto. Na Meta é editável aqui; na Bird, no painel da Bird.
export const businessProfileSchema = z.strictObject({
  about: z.string().trim().max(139).optional(),
  description: z.string().trim().max(512).optional(),
  email: z.union([z.string().trim().email().max(128), z.literal('')]).optional(),
  websites: z.array(z.string().trim().url().max(256)).max(2).optional(),
  address: z.string().trim().max(256).optional(),
  vertical: z.string().trim().max(40).optional(),
});

export async function getBusinessProfile(ctx: Ctx, partnerId: string) {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  if (a.provider === 'bird') return { editable: false, photoEditable: false, provider: a.provider, displayPhone: a.displayPhone, note: 'O perfil deste número (foto, descrição, site) é editado no painel da Bird.' };
  const t = transportOf(ctx, a.provider);
  try {
    const p = await need(t.getBusinessProfile?.bind(t), 'ver o perfil da empresa')(credOf(a));
    return { editable: true, photoEditable: Boolean(a.appId), provider: a.provider, displayPhone: a.displayPhone, ...p };
  } catch (e) { throw waFail(e); }
}

export async function saveBusinessProfile(ctx: Ctx, partnerId: string, input: z.infer<typeof businessProfileSchema>) {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  if (a.provider === 'bird') throw new AppError(409, 'wa_profile_bird', 'O perfil deste número é editado no painel da Bird.');
  const t = transportOf(ctx, a.provider);
  try { await need(t.updateBusinessProfile?.bind(t), 'editar o perfil da empresa')(credOf(a), input); } catch (e) { throw waFail(e); }
  await audit(ctx.db, `partner:${partnerId}`, 'wa_business_profile_saved', 'partner', partnerId, { fields: Object.keys(input) });
  return getBusinessProfile(ctx, partnerId);
}

export async function saveBusinessPhoto(ctx: Ctx, partnerId: string, mediaId: string) {
  const a = await loadAccount(ctx, partnerId);
  if (!a) throw notConnected();
  if (a.provider === 'bird') throw new AppError(409, 'wa_profile_bird', 'A foto deste número é trocada no painel da Bird.');
  const f = await loadMedia(ctx, mediaId, partnerId);
  const t = transportOf(ctx, a.provider);
  try { await need(t.setBusinessPhoto?.bind(t), 'trocar a foto do perfil')(credOf(a), f.bytes, f.mime); } catch (e) { throw waFail(e); }
  await ctx.db.query(`DELETE FROM app.wa_media WHERE id = $1 AND partner_id = $2 AND origin = 'avatar'`, [mediaId, partnerId]);
  await audit(ctx.db, `partner:${partnerId}`, 'wa_business_photo_saved', 'partner', partnerId);
  return getBusinessProfile(ctx, partnerId);
}

/** Começa uma conversa a partir de um contato da base ou do Fôlego, com modelo aprovado (a primeira mensagem sempre é modelo). */
export const startSchema = z.strictObject({
  contactId: z.string().uuid().optional(),
  deliveryId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  vars: z.array(z.string().trim().max(200)).max(10).default([]),
}).refine((v) => Boolean(v.contactId) !== Boolean(v.deliveryId), 'Informe o contato da base ou do Fôlego.');

export async function startConversation(ctx: Ctx, partnerId: string, input: z.infer<typeof startSchema>) {
  await requireActive(ctx, partnerId);
  let phone: string | null = null;
  let name: string | null = null;
  if (input.contactId) {
    const c = await ctx.db.query<{ name: string; pii_enc: Buffer }>(`SELECT name, pii_enc FROM app.partner_contacts WHERE id = $1 AND partner_id = $2`, [input.contactId, partnerId]);
    if (!c.rows[0]) throw notFound();
    name = c.rows[0].name;
    const phones = (JSON.parse(decryptText(ctx.config.secret, c.rows[0].pii_enc)) as { phones?: string[] }).phones ?? [];
    phone = phones.map((p) => waPhone(p)).find((p): p is string => p !== null && p.length === 13) ?? phones.map((p) => waPhone(p)).find((p): p is string => p !== null) ?? null; // prefere celular
  } else {
    const d = await ctx.db.query<{ full_name_enc: Buffer | null; phone_enc: Buffer | null }>(
      `SELECT lc.full_name_enc, lc.phone_enc FROM app.lead_deliveries d LEFT JOIN app.lead_contacts lc ON lc.case_id = d.case_id WHERE d.id = $1 AND d.partner_id = $2 AND d.status IN ('delivered','contacted','converted')`,
      [input.deliveryId, partnerId],
    );
    if (!d.rows[0]) throw notFound();
    if (!d.rows[0].phone_enc) throw new AppError(409, 'revoked', 'O titular revogou a autorização. Não dá para escrever para ele.');
    name = d.rows[0].full_name_enc ? decryptText(ctx.config.secret, d.rows[0].full_name_enc) : null;
    phone = waPhone(decryptText(ctx.config.secret, d.rows[0].phone_enc));
  }
  if (!phone) throw new AppError(422, 'no_phone', 'Este contato não tem um telefone válido.');
  const thread = await ensureThread(ctx, partnerId, phone, { name, contactId: input.contactId ?? null, deliveryId: input.deliveryId ?? null });
  if (input.templateId) await sendInThread(ctx, partnerId, thread.id, { templateId: input.templateId, vars: input.vars.map((v) => v.replace(/\{nome\}/gi, firstName(name ?? ''))) });
  return { threadId: thread.id };
}

// ---------------------------------------------------------------------------------------------------------------------
// Disparos (só para quem pode receber: Fôlego autorizado, base marcada "sim", quem escreveu primeiro)
// ---------------------------------------------------------------------------------------------------------------------
export const broadcastSchema = z.strictObject({
  name: z.string().trim().min(3).max(100),
  templateId: z.string().uuid(),
  vars: z.array(z.string().trim().max(200)).max(10).default([]),
  source: z.enum(['base', 'folego', 'ambos']).default('base'),
  filter: z.strictObject({
    stage: z.enum(['novo', 'em_contato', 'proposta', 'fechado', 'sem_interesse']).optional(),
    orgUf: z.string().length(2).optional(),
    status: z.string().trim().max(60).optional(),
    minMarginCents: z.number().int().min(0).max(1_000_000_000).optional(),
  }).default({}),
});
type BroadcastInput = z.infer<typeof broadcastSchema>;
const MAX_BROADCAST = 500;

interface Target { name: string; phone: string; contactId: string | null; deliveryId: string | null }

async function audience(ctx: Ctx, partnerId: string, b: Pick<BroadcastInput, 'source' | 'filter'>): Promise<{ targets: Target[]; noPhone: number; notAllowed: number }> {
  const targets: Target[] = [];
  let noPhone = 0;
  let notAllowed = 0;
  if (b.source !== 'folego') {
    const params: unknown[] = [partnerId];
    const where = ['partner_id = $1'];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (b.filter.stage) add('stage = ?', b.filter.stage);
    if (b.filter.orgUf) add('org_uf = ?', b.filter.orgUf.toUpperCase());
    if (b.filter.status) add('service_status = ?', b.filter.status);
    if (b.filter.minMarginCents) add('available_margin_cents >= ?', b.filter.minMarginCents);
    const all = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.partner_contacts WHERE ${where.join(' AND ')}`, params);
    const ok = await ctx.db.query<{ id: string; name: string; pii_enc: Buffer }>(`SELECT id, name, pii_enc FROM app.partner_contacts WHERE ${where.join(' AND ')} AND wa_optin = 'sim' ORDER BY available_margin_cents DESC NULLS LAST LIMIT ${MAX_BROADCAST}`, params);
    notAllowed += Math.max(0, num(all.rows[0]?.n ?? 0) - ok.rows.length);
    for (const c of ok.rows) {
      const phones = (JSON.parse(decryptText(ctx.config.secret, c.pii_enc)) as { phones?: string[] }).phones ?? [];
      const e = phones.map((p) => waPhone(p)).filter((p): p is string => p !== null);
      const phone = e.find((p) => p.length === 13) ?? e[0];
      if (!phone) noPhone += 1;
      else targets.push({ name: c.name, phone, contactId: c.id, deliveryId: null });
    }
  }
  if (b.source !== 'base' && targets.length < MAX_BROADCAST) {
    const d = await ctx.db.query<{ id: string; full_name_enc: Buffer | null; phone_enc: Buffer | null }>(
      `SELECT d.id, lc.full_name_enc, lc.phone_enc FROM app.lead_deliveries d LEFT JOIN app.lead_contacts lc ON lc.case_id = d.case_id WHERE d.partner_id = $1 AND d.status IN ('delivered','contacted') ORDER BY d.created_at DESC LIMIT ${MAX_BROADCAST}`,
      [partnerId],
    );
    for (const x of d.rows) {
      const phone = x.phone_enc ? waPhone(decryptText(ctx.config.secret, x.phone_enc)) : null;
      if (!phone) noPhone += 1;
      else targets.push({ name: x.full_name_enc ? decryptText(ctx.config.secret, x.full_name_enc) : '', phone, contactId: null, deliveryId: x.id });
    }
  }
  return { targets: targets.slice(0, MAX_BROADCAST), noPhone, notAllowed };
}

export async function previewBroadcast(ctx: Ctx, partnerId: string, b: BroadcastInput) {
  const a = await audience(ctx, partnerId, b);
  return { eligible: a.targets.length, noPhone: a.noPhone, withoutPermission: a.notAllowed, sample: a.targets.slice(0, 5).map((t) => t.name), max: MAX_BROADCAST };
}

export async function createBroadcast(ctx: Ctx, partnerId: string, b: BroadcastInput) {
  const acc = await requireActive(ctx, partnerId);
  const tpl = await approvedTemplate(ctx, partnerId, b.templateId);
  if (b.vars.length < templateSlots(tpl.body)) throw new AppError(422, 'missing_vars', `O modelo tem ${templateSlots(tpl.body)} variável(is). Preencha todas (use {nome} para o primeiro nome).`);
  const a = await audience(ctx, partnerId, b);
  if (a.targets.length === 0) throw new AppError(422, 'empty', 'Nenhum contato com permissão de WhatsApp neste filtro.');
  const bid = (await ctx.db.query<{ id: string }>(`INSERT INTO app.wa_broadcasts(partner_id, name, template_id, filter, total) VALUES ($1,$2,$3,$4::jsonb,0) RETURNING id`, [partnerId, b.name, b.templateId, JSON.stringify({ ...b.filter, source: b.source })])).rows[0]!.id;
  let queued = 0;
  let skippedOptOut = 0;
  let skippedRecent = 0;
  for (const t of a.targets) {
    const thread = await ensureThread(ctx, partnerId, t.phone, { name: t.name || null, contactId: t.contactId, deliveryId: t.deliveryId });
    if (thread.opted_out) {
      skippedOptOut += 1;
      continue;
    }
    // não insiste: quem já recebeu modelo nos últimos 3 dias fica de fora
    const recent = await ctx.db.query(`SELECT 1 FROM app.wa_messages WHERE thread_id = $1 AND kind = 'template' AND direction = 'out' AND status <> 'falhou' AND created_at > now() - interval '3 days' LIMIT 1`, [thread.id]);
    if (recent.rows.length) {
      skippedRecent += 1;
      continue;
    }
    const vars = b.vars.map((v) => v.replace(/\{nome\}/gi, firstName(t.name)));
    await queueMessage(ctx, { partnerId, threadId: thread.id, author: 'humano', kind: 'template', text: renderTemplate(tpl.body, vars), templateId: tpl.id, vars, broadcastId: bid });
    queued += 1;
  }
  await ctx.db.query(`UPDATE app.wa_broadcasts SET total = $2 WHERE id = $1`, [bid, queued]);
  await audit(ctx.db, `partner:${partnerId}`, 'wa_broadcast_created', 'wa_broadcast', bid, { queued, skippedOptOut, skippedRecent });
  void acc;
  return { id: bid, queued, skippedOptOut, skippedRecent, noPhone: a.noPhone, withoutPermission: a.notAllowed };
}

export async function listBroadcasts(ctx: Ctx, partnerId: string) {
  const r = await ctx.db.query<{ id: string; name: string; template: string; total: number; status: string; created_at: Date; fila: string; enviada: string; entregue: string; lida: string; falhou: string }>(
    `SELECT b.id, b.name, t.name AS template, b.total, b.status, b.created_at,
            count(m.id) FILTER (WHERE m.status = 'fila')::text AS fila, count(m.id) FILTER (WHERE m.status = 'enviada')::text AS enviada,
            count(m.id) FILTER (WHERE m.status = 'entregue')::text AS entregue, count(m.id) FILTER (WHERE m.status = 'lida')::text AS lida, count(m.id) FILTER (WHERE m.status = 'falhou')::text AS falhou
       FROM app.wa_broadcasts b JOIN app.wa_templates t ON t.id = b.template_id LEFT JOIN app.wa_messages m ON m.broadcast_id = b.id
      WHERE b.partner_id = $1 GROUP BY b.id, t.name ORDER BY b.created_at DESC LIMIT 50`,
    [partnerId],
  );
  return { broadcasts: r.rows.map((x) => ({ id: x.id, name: x.name, template: x.template, total: x.total, createdAt: iso(x.created_at), queue: num(x.fila), sent: num(x.enviada), delivered: num(x.entregue), read: num(x.lida), failed: num(x.falhou) })) };
}

/** Cancela o que ainda está na fila deste disparo. */
export async function cancelBroadcast(ctx: Ctx, partnerId: string, id: string) {
  const r = await ctx.db.query(`UPDATE app.wa_messages SET status = 'falhou', error = 'Disparo cancelado.' WHERE partner_id = $1 AND broadcast_id = $2 AND status = 'fila'`, [partnerId, id]);
  await ctx.db.query(`UPDATE app.wa_broadcasts SET status = 'cancelado' WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
  return { canceled: r.rowCount ?? 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Verificação do webhook (GET da Meta)
// ---------------------------------------------------------------------------------------------------------------------
export async function verifyChallenge(ctx: Ctx, partnerId: string, q: { mode?: string | undefined; token?: string | undefined; challenge?: string | undefined }): Promise<string | null> {
  const a = await loadAccount(ctx, partnerId);
  if (!a || q.mode !== 'subscribe' || !q.token || !q.challenge) return null;
  return safeEqual(q.token, a.verifyToken) ? q.challenge : null;
}
