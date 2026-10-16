// WhatsApp do próprio Fôlego pela Bird (número +55 11 91379-2370): mesmo motor de conversas dos parceiros, com a Bird como transporte.
// O Fôlego é um "parceiro interno" (partners.internal): não aparece na lista de parceiros e não recebe leads.
// Envio por /v1/whatsapp/messages (texto livre dentro das 24 h, mídia por endereço https público assinado, modelo aprovado fora da janela).
import { newToken } from './crypto.ts';
import type { Config } from './config.ts';
import type { Ctx } from './services.ts';
import { WaError, ingestInbound, loadAccount, waPhone } from './whatsapp.ts';
import type { BusinessProfile, MediaSend, WaAccount, WaCredentials, WaTemplateCall, WaTransport } from './whatsapp.ts';
import { MAX_BYTES } from './wa-media.ts';

export const HOUSE_PARTNER_ID = '0192f000-0000-7000-8000-000000000001';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export class BirdWaTransport implements WaTransport {
  private readonly cfg: Config['bird'];
  private readonly fetchFn: typeof fetch;
  constructor(cfg: Config['bird'], fetchFn: typeof fetch = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  private conf() {
    if (!this.cfg) throw new WaError('O WhatsApp do Fôlego ainda não está configurado (chave da Bird).', 503, null);
    return this.cfg;
  }

  private async post(body: Record<string, unknown>, ref?: string): Promise<{ id: string }> {
    const c = this.conf();
    if (ref) body = { ...body, metadata: { ref } };
    let res: Response;
    try {
      res = await this.fetchFn(`${c.baseUrl}/v1/whatsapp/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new WaError(`Sem resposta da Bird: ${e instanceof Error ? e.message.slice(0, 80) : 'rede'}`, 0, null);
    }
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string };
      return { id: String(j.id ?? j.message_id ?? '') };
    }
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    throw new WaError(`Bird ${res.status}${detail ? `: ${detail}` : ''}`, res.status, null);
  }

  async sendText(cred: WaCredentials, to: string, text: string): Promise<{ id: string }> {
    return this.post({ from: cred.phoneNumberId, to: `+${to}`, text: { body: text } }, cred.ref);
  }

  async sendTemplate(cred: WaCredentials, to: string, tpl: WaTemplateCall): Promise<{ id: string }> {
    const names = tpl.paramNames ?? null;
    const parameters = tpl.params.map((text, i) => (names?.[i] ? { type: 'text', name: names[i], text } : { type: 'text', text }));
    return this.post({
      from: cred.phoneNumberId, to: `+${to}`,
      template: { slug: tpl.name, language: tpl.language.replace('_', '-'), ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}) },
    }, cred.ref);
  }

  async sendMedia(cred: WaCredentials, to: string, m: MediaSend): Promise<{ id: string }> {
    const content: Obj = { url: m.publicUrl };
    if (m.kind === 'audio') {
      if (m.voice) content.voice = true;
    } else {
      if (m.caption) content.caption = m.caption;
      if (m.kind === 'document' && m.filename) content.filename = m.filename;
    }
    return this.post({ from: cred.phoneNumberId, to: `+${to}`, [m.kind]: content }, cred.ref);
  }

  /** Mídia recebida: a Bird responde 302 para um endereço assinado; esse segundo pedido NÃO leva a chave. */
  async downloadMedia(_cred: WaCredentials, ref: { id?: string; url?: string }): Promise<{ bytes: Buffer; mime: string }> {
    const c = this.conf();
    if (!ref.url || !ref.url.startsWith('https://')) throw new WaError('Mídia sem endereço.', 422, null);
    const first = await this.fetchFn(ref.url, { headers: { authorization: `Bearer ${c.apiKey}` }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    let res = first;
    if (first.status >= 300 && first.status < 400) {
      const loc = first.headers.get('location');
      if (!loc || !loc.startsWith('https://')) throw new WaError('A Bird não indicou onde baixar o arquivo.', 502, null);
      res = await this.fetchFn(loc, { signal: AbortSignal.timeout(30_000) });
    }
    if (!res.ok) throw new WaError(`Não consegui baixar o arquivo (erro ${res.status}).`, res.status, null);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new WaError('Arquivo grande demais.', 413, null);
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async profile(cred: WaCredentials): Promise<{ displayPhone: string | null; verifiedName: string | null }> {
    this.conf();
    return { displayPhone: cred.phoneNumberId, verifiedName: null };
  }

  async getBusinessProfile(): Promise<BusinessProfile> {
    throw new WaError('O perfil deste número (foto, descrição, site) é editado no painel da Bird.', 422, null);
  }
  async updateBusinessProfile(): Promise<void> {
    throw new WaError('O perfil deste número (foto, descrição, site) é editado no painel da Bird.', 422, null);
  }
  async setBusinessPhoto(): Promise<void> {
    throw new WaError('A foto deste número é trocada no painel da Bird.', 422, null);
  }
}

/** Garante o "parceiro interno" e a conta do número do Fôlego (a partir da configuração). Sem chave da Bird, não existe. */
export async function ensureHouseAccount(ctx: Ctx): Promise<WaAccount | null> {
  const cfg = ctx.config.bird;
  if (!cfg) return null;
  const digits = waPhone(cfg.from);
  if (!digits) return null;
  await ctx.db.query(
    `INSERT INTO app.partners(id, legal_name, trade_name, cnpj, category, status, internal) VALUES ($1,'Emegetech Soluções em Tecnologia LTDA','Fôlego (interno)','08896800000144','fintech','suspended',true) ON CONFLICT DO NOTHING`,
    [HOUSE_PARTNER_ID],
  );
  await ctx.db.query(
    `INSERT INTO app.wa_accounts(partner_id, phone_number_id, display_phone, verify_token, provider) VALUES ($1,$2,$3,$4,'bird')
     ON CONFLICT (partner_id) DO UPDATE SET phone_number_id = EXCLUDED.phone_number_id, display_phone = EXCLUDED.display_phone, provider = 'bird'`,
    [HOUSE_PARTNER_ID, digits, `+${digits}`, newToken().slice(0, 24)],
  );
  return loadAccount(ctx, HOUSE_PARTNER_ID);
}

/** Mensagem recebida pelo número do Fôlego (webhook `whatsapp.received`). Devolve false se não houver conta ou número legível. */
export async function ingestBirdInbound(ctx: Ctx, data: Obj, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<boolean> {
  const acc = (await loadAccount(ctx, HOUSE_PARTNER_ID)) ?? (await ensureHouseAccount(ctx));
  if (!acc || acc.provider !== 'bird') return false;
  const e164 = waPhone(str(obj(data.from).phone_number) ?? '');
  const waId = str(data.id) ?? str(data.message_id) ?? str(data.whatsapp_id);
  if (!e164 || !waId) return false;
  const name = str(data.display_name) ?? str(data.username);
  const base = { waId, e164, name };
  const transport = () => ctx.whatsapp ?? new BirdWaTransport(ctx.config.bird);
  for (const kind of ['image', 'audio', 'video', 'document', 'sticker'] as const) {
    const x = obj(data[kind]);
    const url = str(x.url);
    const id = str(x.id);
    if (!url && !id) continue;
    return ingestInbound(ctx, acc, {
      ...base, kind, text: str(x.caption) ?? '', voice: x.voice === true,
      media: {
        mime: str(x.mime_type) ?? 'application/octet-stream', filename: str(x.filename),
        fetch: () => {
          const t = transport();
          if (!t.downloadMedia) throw new WaError('Este número não baixa arquivos.', 422, null);
          return t.downloadMedia({ phoneNumberId: acc.phoneNumberId, token: '', provider: 'bird' }, { ...(id ? { id } : {}), ...(url ? { url } : {}) });
        },
      },
    }, opts);
  }
  const text = str(obj(data.text).body) ?? '';
  const body = text || (Object.keys(obj(data.location)).length ? '[Localização recebida: abra no WhatsApp para ver]' : obj(data.unsupported).type ? '[Mensagem de um tipo que não aparece aqui: abra no WhatsApp para ver]' : '');
  if (!body) return false;
  return ingestInbound(ctx, acc, { ...base, kind: 'text', text: body }, opts);
}

const RANK: Record<string, number> = { fila: 0, enviada: 1, entregue: 2, lida: 3 };
const TO_STATUS: Record<string, 'enviada' | 'entregue' | 'lida' | 'falhou' | null> = { 'whatsapp.accepted': null, 'whatsapp.sent': 'enviada', 'whatsapp.delivered': 'entregue', 'whatsapp.read': 'lida', 'whatsapp.failed': 'falhou', 'whatsapp.rejected': 'falhou' };

/** Aviso de status de uma mensagem enviada pela caixa de entrada. Devolve true se era uma delas. */
export async function applyBirdStatus(ctx: Ctx, type: string, data: Obj, why: string): Promise<boolean> {
  if (!(type in TO_STATUS)) return false;
  const ref = str(obj(data.metadata).ref) ?? '';
  const ids = [str(data.id), str(data.message_id), str(data.whatsapp_id)].filter((x): x is string => x !== null);
  const uuid = /^[0-9a-f-]{36}$/i.test(ref) ? ref : '00000000-0000-0000-0000-000000000000';
  const r = await ctx.db.query<{ id: string; status: string }>(
    `SELECT id, status FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND (id = $2::uuid OR wa_id = ANY($3::text[])) LIMIT 1`,
    [HOUSE_PARTNER_ID, uuid, ids],
  );
  const m = r.rows[0];
  if (!m) return false;
  const next = TO_STATUS[type];
  if (next === null) return true; // "aceita": já está "enviada"
  if (next === 'falhou') {
    if ((RANK[m.status] ?? 0) >= RANK.entregue!) return true;
    await ctx.db.query(`UPDATE app.wa_messages SET status = 'falhou', error = $2 WHERE id = $1`, [m.id, why.slice(0, 300)]);
  } else if (next && ((RANK[next] ?? 0) > (RANK[m.status] ?? 0) || m.status === 'falhou')) {
    await ctx.db.query(`UPDATE app.wa_messages SET status = $2, error = NULL WHERE id = $1`, [m.id, next]);
  }
  return true;
}
