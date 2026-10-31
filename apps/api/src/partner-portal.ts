// Portal de gestão do parceiro ("Euro Multiplan & Fôlego"): tudo o que o parceiro faz depois de entrar.
// Duas origens de contatos que NUNCA se misturam:
//   - Contatos do Fôlego: entregas de lead_deliveries (a pessoa autorizou; vale a comissão da campanha sobre o contrato fechado);
//   - Base própria: planilhas que o parceiro importa (partner_contacts). Sem comissão para o Fôlego.
// Dados pessoais da base própria ficam criptografados (AES-256-GCM); o CPF também vira um HMAC para achar repetidos.
import { z } from 'zod';
import { decryptText, encryptText, hmac } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import { cleanCpf } from './engine.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import { phoneKey, waPhone } from './whatsapp.ts';

const PAGE = 30;
const iso = (d: unknown): string => new Date(d as string).toISOString();
const day = (d: unknown): string => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export const STAGES = ['novo', 'em_contato', 'proposta', 'fechado', 'sem_interesse'] as const;
export const PRODUCTS = ['consignado', 'cartao_consignado', 'refinanciamento', 'portabilidade', 'outro'] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Importação da base própria (planilha lida no navegador; o servidor revalida cada linha e nunca duplica)
// ---------------------------------------------------------------------------------------------------------------------
const text = (max: number) => z.string().trim().min(1).max(max);
export const importRowSchema = z.strictObject({
  cpf: z.string().regex(/^\d{11}$/).refine((v) => cleanCpf(v) !== null, 'CPF inválido'),
  name: text(120),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  age: z.number().int().min(0).max(130).optional(),
  sex: z.enum(['F', 'M']).optional(),
  motherName: text(120).optional(),
  matricula: text(40).optional(),
  orgUf: z.string().length(2).optional(),
  orgCode: text(40).optional(),
  serviceStatus: text(60).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  baseCents: z.number().int().min(0).max(10_000_000_000).optional(),
  marginUsedCents: z.number().int().min(0).max(10_000_000_000).optional(),
  availableMarginCents: z.number().int().min(-10_000_000_000).max(10_000_000_000).optional(),
  cardMarginCents: z.number().int().min(-10_000_000_000).max(10_000_000_000).optional(),
  // Telefone ou e-mail ruim não barra o contato: é descartado e o resto da linha entra.
  phones: z.array(z.string()).max(12).transform((a) => a.filter((p) => /^\d{10,11}$/.test(p)).slice(0, 10)),
  emails: z.array(z.string()).max(12).transform((a) => a.filter((e) => e.length <= 120 && z.string().email().safeParse(e).success).slice(0, 5)),
  address: z.strictObject({ street: text(120).optional(), number: text(20).optional(), complement: text(60).optional(), district: text(80).optional(), city: text(80).optional(), uf: z.string().length(2).optional(), cep: z.string().regex(/^\d{8}$/).optional() }),
  bank: z.strictObject({ payer: text(80).optional(), agency: text(20).optional(), account: text(30).optional(), kind: text(20).optional() }),
  extra: z.record(z.string().max(4), z.string().max(160)).refine((o) => Object.keys(o).length <= 90),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importStartSchema = z.strictObject({ filename: z.string().trim().min(1).max(200), layout: z.enum(['siape', 'cabecalho']), total: z.number().int().min(0).max(2_000_000), invalid: z.number().int().min(0).max(2_000_000).default(0), repeatedInFile: z.number().int().min(0).max(2_000_000).default(0),
  /** O parceiro declara que tem autorização destes contatos para WhatsApp (quem não tinha permissão passa a "sim"). */
  waOptin: z.boolean().default(false),
});
/** O lote chega "cru": cada linha é validada separadamente, para uma linha ruim não derrubar as outras 199. */
export const importBatchSchema = z.strictObject({ rows: z.array(z.unknown()).min(1).max(250) });

const cpfKey = (ctx: Ctx, partnerId: string, cpf: string): string => hmac(ctx.config.secret, `pcpf:${partnerId}:${cpf}`).toString('hex');
/** Chaves dos telefones (para achar a conversa do WhatsApp de quem escreve), sem guardar o número em claro. */
const keysOf = (secret: string, partnerId: string, phones: string[]): string[] => [...new Set(phones.map((p) => waPhone(p)).filter((p): p is string => p !== null).map((e) => phoneKey(secret, partnerId, e)))];

/** O que fica criptografado: tudo o que identifica ou contata a pessoa. */
const piiOf = (r: ImportRow) => ({
  cpf: r.cpf, birthDate: r.birthDate, sex: r.sex, motherName: r.motherName, matricula: r.matricula, orgCode: r.orgCode, entryDate: r.entryDate,
  baseCents: r.baseCents, marginUsedCents: r.marginUsedCents, phones: r.phones, emails: r.emails, address: r.address, bank: r.bank, extra: r.extra,
});
type Pii = ReturnType<typeof piiOf>;

/** Une o que já existe com o que chegou: preenche o que faltava e soma telefones/e-mails novos, sem apagar nada. */
function mergePii(old: Pii, next: Pii): Pii {
  const pickObj = <T extends Record<string, unknown>>(a: T, b: T): T => {
    const out = { ...a } as Record<string, unknown>;
    for (const [k, v] of Object.entries(b)) if (v !== undefined && v !== '') out[k] = v;
    return out as T;
  };
  return {
    ...pickObj(old as Record<string, unknown>, next as Record<string, unknown>),
    cpf: old.cpf,
    phones: [...new Set([...old.phones, ...next.phones])].slice(0, 10),
    emails: [...new Set([...old.emails, ...next.emails])].slice(0, 5),
    address: pickObj(old.address, next.address),
    bank: pickObj(old.bank, next.bank),
    extra: { ...old.extra, ...next.extra },
  } as Pii;
}

const stable = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x));

export async function startImport(ctx: Ctx, partnerId: string, input: z.infer<typeof importStartSchema>): Promise<{ importId: string }> {
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.partner_imports(partner_id, filename, layout, rows_total, invalid_n, repeated_n, wa_optin) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [partnerId, input.filename, input.layout, input.total, input.invalid, input.repeatedInFile, input.waOptin],
  );
  await audit(ctx.db, `partner:${partnerId}`, 'partner_import_started', 'partner_import', r.rows[0]!.id, { filename: input.filename, total: input.total });
  return { importId: r.rows[0]!.id };
}

export interface BatchResult { created: number; updated: number; same: number; rejected: number }

export async function importBatch(ctx: Ctx, partnerId: string, importId: string, raw: unknown[]): Promise<BatchResult> {
  const own = await ctx.db.query<{ wa_optin: boolean }>(`SELECT wa_optin FROM app.partner_imports WHERE id = $1 AND partner_id = $2 AND finished_at IS NULL`, [importId, partnerId]);
  if (own.rows.length === 0) throw notFound();
  const optin = own.rows[0]!.wa_optin ? 'sim' : 'desconhecido';
  const secret = ctx.config.secret;
  const rows: ImportRow[] = [];
  let rejected = 0;
  for (const r of raw) {
    const p = importRowSchema.safeParse(r);
    if (p.success) rows.push(p.data);
    else rejected += 1;
  }
  const unique = new Map<string, ImportRow>();
  for (const r of rows) if (!unique.has(r.cpf)) unique.set(r.cpf, r);
  const keyed = [...unique.values()].map((r) => ({ r, key: cpfKey(ctx, partnerId, r.cpf) }));
  const out: BatchResult = { created: 0, updated: 0, same: 0, rejected };
  await ctx.db.tx(async (q) => {
    const found = await q.query<{ id: string; cpf_hmac: string; pii_enc: Buffer; available_margin_cents: string | null; card_margin_cents: string | null; service_status: string | null; name: string; wa_optin: string }>(
      `SELECT id, cpf_hmac, pii_enc, available_margin_cents::text, card_margin_cents::text, service_status, name, wa_optin FROM app.partner_contacts WHERE partner_id = $1 AND cpf_hmac = ANY($2::text[])`,
      [partnerId, keyed.map((k) => k.key)],
    );
    const byKey = new Map(found.rows.map((x) => [x.cpf_hmac, x]));
    for (const { r, key } of keyed) {
      const cur = byKey.get(key);
      const next = piiOf(r);
      if (!cur) {
        const ins = await q.query(
          `INSERT INTO app.partner_contacts(partner_id, cpf_hmac, name, org_uf, city, uf, service_status, age, available_margin_cents, card_margin_cents, pii_enc, import_id, phone_keys, wa_optin)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text[],$14) ON CONFLICT (partner_id, cpf_hmac) DO NOTHING`,
          [partnerId, key, r.name, r.orgUf ?? null, r.address.city ?? null, r.address.uf ?? null, r.serviceStatus ?? null, r.age ?? null, r.availableMarginCents ?? null, r.cardMarginCents ?? null, encryptText(secret, JSON.stringify(next)), importId, keysOf(secret, partnerId, r.phones), optin],
        );
        if ((ins.rowCount ?? 0) > 0) out.created += 1;
        else out.same += 1;
        continue;
      }
      const old = JSON.parse(decryptText(secret, cur.pii_enc)) as Pii;
      const merged = mergePii(old, next);
      const margin = r.availableMarginCents ?? (cur.available_margin_cents === null ? null : num(cur.available_margin_cents));
      const card = r.cardMarginCents ?? (cur.card_margin_cents === null ? null : num(cur.card_margin_cents));
      const grants = optin === 'sim' && cur.wa_optin === 'desconhecido'; // a importação declara autorização: só promove quem ainda não tinha resposta
      const same = !grants && stable(merged) === stable(old) && margin === (cur.available_margin_cents === null ? null : num(cur.available_margin_cents)) && card === (cur.card_margin_cents === null ? null : num(cur.card_margin_cents)) && (r.serviceStatus ?? cur.service_status) === cur.service_status;
      if (same) {
        out.same += 1;
        continue;
      }
      await q.query(
        `UPDATE app.partner_contacts SET pii_enc = $3, available_margin_cents = $4, card_margin_cents = $5, service_status = coalesce($6, service_status), org_uf = coalesce($7, org_uf), city = coalesce($8, city), uf = coalesce($9, uf), age = coalesce($10, age), import_id = $11,
                phone_keys = $12::text[], wa_optin = CASE WHEN $13 = 'sim' AND wa_optin = 'desconhecido' THEN 'sim' ELSE wa_optin END
          WHERE id = $1 AND partner_id = $2`,
        [cur.id, partnerId, encryptText(secret, JSON.stringify(merged)), margin, card, r.serviceStatus ?? null, r.orgUf ?? null, r.address.city ?? null, r.address.uf ?? null, r.age ?? null, importId, keysOf(secret, partnerId, merged.phones), optin],
      );
      out.updated += 1;
    }
    await q.query(`UPDATE app.partner_imports SET created_n = created_n + $2, updated_n = updated_n + $3, same_n = same_n + $4, invalid_n = invalid_n + $5 WHERE id = $1`, [importId, out.created, out.updated, out.same, rejected]);
  });
  return out;
}

export async function finishImport(ctx: Ctx, partnerId: string, importId: string) {
  const r = await ctx.db.query<{ filename: string; rows_total: number; created_n: number; updated_n: number; same_n: number; invalid_n: number; repeated_n: number }>(
    `UPDATE app.partner_imports SET finished_at = now() WHERE id = $1 AND partner_id = $2 AND finished_at IS NULL RETURNING filename, rows_total, created_n, updated_n, same_n, invalid_n, repeated_n`,
    [importId, partnerId],
  );
  const x = r.rows[0];
  if (!x) throw notFound();
  await audit(ctx.db, `partner:${partnerId}`, 'partner_import_finished', 'partner_import', importId, { created: x.created_n, updated: x.updated_n });
  return { filename: x.filename, total: x.rows_total, created: x.created_n, updated: x.updated_n, same: x.same_n, invalid: x.invalid_n, repeatedInFile: x.repeated_n };
}

export async function listImports(ctx: Ctx, partnerId: string) {
  const r = await ctx.db.query<{ id: string; filename: string; layout: string; rows_total: number; created_n: number; updated_n: number; same_n: number; invalid_n: number; repeated_n: number; created_at: Date; finished_at: Date | null }>(
    `SELECT id, filename, layout, rows_total, created_n, updated_n, same_n, invalid_n, repeated_n, created_at, finished_at FROM app.partner_imports WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [partnerId],
  );
  return { imports: r.rows.map((x) => ({ id: x.id, filename: x.filename, layout: x.layout, total: x.rows_total, created: x.created_n, updated: x.updated_n, same: x.same_n, invalid: x.invalid_n, repeatedInFile: x.repeated_n, at: iso(x.created_at), finished: x.finished_at !== null })) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Base própria: lista, filtros, ficha
// ---------------------------------------------------------------------------------------------------------------------
export interface ContactQuery { q?: string | undefined; stage?: string | undefined; orgUf?: string | undefined; uf?: string | undefined; status?: string | undefined; minMarginCents?: number | undefined; due?: boolean | undefined; sort?: string | undefined; page?: number | undefined }

export async function listContacts(ctx: Ctx, partnerId: string, o: ContactQuery) {
  const page = Math.max(0, Math.floor(o.page ?? 0));
  const params: unknown[] = [partnerId];
  const where = ['c.partner_id = $1'];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  const q = (o.q ?? '').trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    if (digits.length === 11 && cleanCpf(digits)) add('c.cpf_hmac = ?', cpfKey(ctx, partnerId, digits));
    else add(`lower(c.name) LIKE ?`, `%${q.toLowerCase().replace(/[%_\\]/g, '')}%`);
  }
  if (o.stage && (STAGES as readonly string[]).includes(o.stage)) add('c.stage = ?', o.stage);
  if (o.orgUf && /^[A-Za-z]{2}$/.test(o.orgUf)) add('c.org_uf = ?', o.orgUf.toUpperCase());
  if (o.uf && /^[A-Za-z]{2}$/.test(o.uf)) add('c.uf = ?', o.uf.toUpperCase());
  if (o.status) add('c.service_status = ?', o.status.slice(0, 60));
  if (o.minMarginCents && o.minMarginCents > 0) add('c.available_margin_cents >= ?', o.minMarginCents);
  if (o.due) add('c.next_action_on <= ?::date', todaySaoPaulo());
  const order = { margem: 'c.available_margin_cents DESC NULLS LAST, c.name', nome: 'lower(c.name)', acao: 'c.next_action_on ASC NULLS LAST, c.name', recentes: 'c.updated_at DESC' }[o.sort ?? ''] ?? 'c.updated_at DESC';
  const base = `FROM app.partner_contacts c WHERE ${where.join(' AND ')}`;
  const total = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n ${base}`, params);
  const rows = await ctx.db.query<{ id: string; name: string; stage: string; org_uf: string | null; city: string | null; uf: string | null; service_status: string | null; age: number | null; available_margin_cents: string | null; card_margin_cents: string | null; next_action_on: Date | string | null; last_contact_at: Date | null; pii_enc: Buffer }>(
    `SELECT c.id, c.name, c.stage, c.org_uf, c.city, c.uf, c.service_status, c.age, c.available_margin_cents::text, c.card_margin_cents::text, c.next_action_on, c.last_contact_at, c.pii_enc
       ${base} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  return {
    total: num(total.rows[0]?.n ?? 0),
    pageSize: PAGE,
    items: rows.rows.map((x) => {
      const pii = JSON.parse(decryptText(ctx.config.secret, x.pii_enc)) as Pii;
      return {
        id: x.id, name: x.name, stage: x.stage, orgUf: x.org_uf, city: x.city, uf: x.uf, serviceStatus: x.service_status, age: x.age,
        availableMarginCents: x.available_margin_cents === null ? null : num(x.available_margin_cents), cardMarginCents: x.card_margin_cents === null ? null : num(x.card_margin_cents),
        nextActionOn: x.next_action_on ? day(x.next_action_on) : null, lastContactAt: x.last_contact_at ? iso(x.last_contact_at) : null,
        phone: pii.phones[0] ?? null, email: pii.emails[0] ?? null,
      };
    }),
  };
}

export async function contactFacets(ctx: Ctx, partnerId: string) {
  const [stages, orgUfs, statuses] = await Promise.all([
    ctx.db.query<{ k: string; n: string }>(`SELECT stage AS k, count(*)::text AS n FROM app.partner_contacts WHERE partner_id = $1 GROUP BY stage`, [partnerId]),
    ctx.db.query<{ k: string; n: string }>(`SELECT org_uf AS k, count(*)::text AS n FROM app.partner_contacts WHERE partner_id = $1 AND org_uf IS NOT NULL GROUP BY org_uf ORDER BY count(*) DESC`, [partnerId]),
    ctx.db.query<{ k: string; n: string }>(`SELECT service_status AS k, count(*)::text AS n FROM app.partner_contacts WHERE partner_id = $1 AND service_status IS NOT NULL GROUP BY service_status ORDER BY count(*) DESC LIMIT 30`, [partnerId]),
  ]);
  const m = (r: { rows: { k: string; n: string }[] }) => r.rows.map((x) => ({ key: x.k, count: num(x.n) }));
  return { stages: m(stages), orgUfs: m(orgUfs), statuses: m(statuses) };
}

async function dealsOf(ctx: Ctx, partnerId: string, where: string, id: string) {
  const r = await ctx.db.query<DealRow>(`${DEAL_SELECT} WHERE d.partner_id = $1 AND ${where} ORDER BY d.signed_on DESC, d.created_at DESC`, [partnerId, id]);
  return r.rows.map(dealOut);
}

export async function contactDetail(ctx: Ctx, partnerId: string, id: string) {
  const r = await ctx.db.query<{ id: string; name: string; stage: string; org_uf: string | null; service_status: string | null; age: number | null; available_margin_cents: string | null; card_margin_cents: string | null; next_action_on: Date | string | null; last_contact_at: Date | null; created_at: Date; pii_enc: Buffer; wa_optin: string }>(
    `SELECT id, name, stage, org_uf, service_status, age, available_margin_cents::text, card_margin_cents::text, next_action_on, last_contact_at, created_at, pii_enc, wa_optin FROM app.partner_contacts WHERE id = $1 AND partner_id = $2`,
    [id, partnerId],
  );
  const x = r.rows[0];
  if (!x) throw notFound();
  const events = await ctx.db.query<{ id: string; kind: string; body: string; created_at: Date }>(`SELECT id, kind, body, created_at FROM app.partner_events WHERE contact_id = $1 AND partner_id = $2 ORDER BY created_at DESC LIMIT 100`, [id, partnerId]);
  return {
    id: x.id, name: x.name, stage: x.stage, orgUf: x.org_uf, serviceStatus: x.service_status, age: x.age, waOptin: x.wa_optin,
    availableMarginCents: x.available_margin_cents === null ? null : num(x.available_margin_cents), cardMarginCents: x.card_margin_cents === null ? null : num(x.card_margin_cents),
    nextActionOn: x.next_action_on ? day(x.next_action_on) : null, lastContactAt: x.last_contact_at ? iso(x.last_contact_at) : null, createdAt: iso(x.created_at),
    pii: JSON.parse(decryptText(ctx.config.secret, x.pii_enc)) as Pii,
    events: events.rows.map((e) => ({ id: e.id, kind: e.kind, body: e.body, at: iso(e.created_at) })),
    deals: await dealsOf(ctx, partnerId, 'd.contact_id = $2', id),
  };
}

export const contactPatchSchema = z.strictObject({
  stage: z.enum(STAGES).optional(),
  nextActionOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Permissão de WhatsApp: 'sim' só quando o parceiro realmente tem a autorização do contato. */
  waOptin: z.enum(['desconhecido', 'sim', 'nao']).optional(),
});

export async function patchContact(ctx: Ctx, partnerId: string, id: string, patch: z.infer<typeof contactPatchSchema>) {
  const cur = await ctx.db.query<{ stage: string }>(`SELECT stage FROM app.partner_contacts WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
  if (!cur.rows[0]) throw notFound();
  await ctx.db.tx(async (q) => {
    if (patch.stage && patch.stage !== cur.rows[0]!.stage) {
      await q.query(`UPDATE app.partner_contacts SET stage = $3, last_contact_at = CASE WHEN $3 = 'em_contato' THEN now() ELSE last_contact_at END WHERE id = $1 AND partner_id = $2`, [id, partnerId, patch.stage]);
      await q.query(`INSERT INTO app.partner_events(partner_id, contact_id, kind, body) VALUES ($1,$2,'etapa',$3)`, [partnerId, id, `Etapa: ${cur.rows[0]!.stage} → ${patch.stage}`]);
    }
    if (patch.nextActionOn !== undefined) await q.query(`UPDATE app.partner_contacts SET next_action_on = $3 WHERE id = $1 AND partner_id = $2`, [id, partnerId, patch.nextActionOn]);
    if (patch.waOptin) {
      await q.query(`UPDATE app.partner_contacts SET wa_optin = $3 WHERE id = $1 AND partner_id = $2`, [id, partnerId, patch.waOptin]);
      if (patch.waOptin === 'nao') await q.query(`UPDATE app.wa_threads SET opted_out = true WHERE contact_id = $1 AND partner_id = $2`, [id, partnerId]);
      await audit(q, `partner:${partnerId}`, 'wa_optin_changed', 'partner_contact', id, { value: patch.waOptin });
    }
  });
  return { ok: true };
}

export const eventSchema = z.strictObject({ kind: z.enum(['nota', 'ligacao', 'whatsapp']), body: z.string().trim().min(1).max(1000) });

export async function addEvent(ctx: Ctx, partnerId: string, target: { contactId?: string; deliveryId?: string }, e: z.infer<typeof eventSchema>) {
  if (target.contactId) {
    const r = await ctx.db.query(`UPDATE app.partner_contacts SET last_contact_at = CASE WHEN $3 IN ('ligacao','whatsapp') THEN now() ELSE last_contact_at END WHERE id = $1 AND partner_id = $2`, [target.contactId, partnerId, e.kind]);
    if ((r.rowCount ?? 0) === 0) throw notFound();
    await ctx.db.query(`INSERT INTO app.partner_events(partner_id, contact_id, kind, body) VALUES ($1,$2,$3,$4)`, [partnerId, target.contactId, e.kind, e.body]);
  } else if (target.deliveryId) {
    const r = await ctx.db.query(`SELECT 1 FROM app.lead_deliveries WHERE id = $1 AND partner_id = $2 AND status IN ('delivered','contacted','converted')`, [target.deliveryId, partnerId]);
    if (r.rows.length === 0) throw notFound();
    await ctx.db.query(`INSERT INTO app.partner_events(partner_id, delivery_id, kind, body) VALUES ($1,$2,$3,$4)`, [partnerId, target.deliveryId, e.kind, e.body]);
  } else throw notFound();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contatos do Fôlego (entregas) com histórico e contratos
// ---------------------------------------------------------------------------------------------------------------------
export async function leadDetail(ctx: Ctx, partnerId: string, deliveryId: string) {
  const own = await ctx.db.query<{ commission_bps: number }>(`SELECT c.commission_bps FROM app.lead_deliveries d JOIN app.partner_campaigns c ON c.id = d.campaign_id WHERE d.id = $1 AND d.partner_id = $2`, [deliveryId, partnerId]);
  if (!own.rows[0]) throw notFound();
  const events = await ctx.db.query<{ id: string; kind: string; body: string; created_at: Date }>(`SELECT id, kind, body, created_at FROM app.partner_events WHERE delivery_id = $1 AND partner_id = $2 ORDER BY created_at DESC LIMIT 100`, [deliveryId, partnerId]);
  return { commissionBps: own.rows[0].commission_bps, events: events.rows.map((e) => ({ id: e.id, kind: e.kind, body: e.body, at: iso(e.created_at) })), deals: await dealsOf(ctx, partnerId, 'd.delivery_id = $2', deliveryId) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contratos fechados e comissão do Fôlego
// ---------------------------------------------------------------------------------------------------------------------
interface DealRow {
  id: string; origin: string; delivery_id: string | null; contact_id: string | null; client_name: string | null; product: string; amount_cents: string; installments: number | null; monthly_cents: string | null; bank: string | null;
  signed_on: Date | string; commission_bps: number; commission_cents: string; commission_status: string; received_on: Date | string | null; status: string; note: string | null; created_at: Date;
}
const DEAL_SELECT = `SELECT d.id, d.origin, d.delivery_id, d.contact_id, d.client_name, d.product, d.amount_cents::text, d.installments, d.monthly_cents::text, d.bank, d.signed_on, d.commission_bps, d.commission_cents::text, d.commission_status, d.received_on, d.status, d.note, d.created_at FROM app.partner_deals d`;
const dealOut = (x: DealRow) => ({
  id: x.id, origin: x.origin, deliveryId: x.delivery_id, contactId: x.contact_id, clientName: x.client_name, product: x.product, amountCents: num(x.amount_cents), installments: x.installments,
  monthlyCents: x.monthly_cents === null ? null : num(x.monthly_cents), bank: x.bank, signedOn: day(x.signed_on), commissionBps: x.commission_bps, commissionCents: num(x.commission_cents),
  commissionStatus: x.commission_status, receivedOn: x.received_on ? day(x.received_on) : null, status: x.status, note: x.note, createdAt: iso(x.created_at),
});

export const dealSchema = z.strictObject({
  source: z.enum(['lead', 'contact', 'avulso']),
  refId: z.string().uuid().optional(),
  clientName: z.string().trim().min(2).max(120).optional(),
  product: z.enum(PRODUCTS),
  amountCents: z.number().int().positive().max(100_000_000_000),
  installments: z.number().int().min(1).max(240).optional(),
  monthlyCents: z.number().int().positive().max(1_000_000_000).optional(),
  bank: z.string().trim().min(2).max(80).optional(),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

export const commissionOf = (amountCents: number, bps: number): number => Math.round((amountCents * bps) / 10_000);

export async function createDeal(ctx: Ctx, partnerId: string, input: z.infer<typeof dealSchema>) {
  if (input.signedOn > todaySaoPaulo()) throw new AppError(422, 'future_date', 'A data do contrato não pode ser no futuro.');
  let origin: 'folego' | 'propria' = 'propria';
  let deliveryId: string | null = null;
  let contactId: string | null = null;
  let bps = 0;
  let client = input.clientName ?? null;
  if (input.source === 'lead') {
    if (!input.refId) throw new AppError(422, 'missing_ref', 'Escolha o contato do Fôlego.');
    const d = await ctx.db.query<{ commission_bps: number; full_name_enc: Buffer | null; status: string }>(
      `SELECT c.commission_bps, coalesce(lc.full_name_enc, d.kept_name_enc) AS full_name_enc, d.status FROM app.lead_deliveries d JOIN app.partner_campaigns c ON c.id = d.campaign_id LEFT JOIN app.lead_contacts lc ON lc.case_id = d.case_id WHERE d.id = $1 AND d.partner_id = $2`,
      [input.refId, partnerId],
    );
    const x = d.rows[0];
    if (!x || !['delivered', 'contacted', 'converted'].includes(x.status)) throw notFound();
    if (!x.full_name_enc) throw new AppError(409, 'revoked', 'O titular revogou a autorização. Não dá para registrar contrato nesse contato.');
    origin = 'folego';
    deliveryId = input.refId;
    bps = x.commission_bps;
    client = decryptText(ctx.config.secret, x.full_name_enc);
  } else if (input.source === 'contact') {
    if (!input.refId) throw new AppError(422, 'missing_ref', 'Escolha o contato da sua base.');
    const c = await ctx.db.query<{ name: string }>(`SELECT name FROM app.partner_contacts WHERE id = $1 AND partner_id = $2`, [input.refId, partnerId]);
    if (!c.rows[0]) throw notFound();
    contactId = input.refId;
    client = c.rows[0].name;
  } else if (!client) throw new AppError(422, 'missing_name', 'Informe o nome do cliente.');
  const commission = origin === 'folego' ? commissionOf(input.amountCents, bps) : 0;
  const id = await ctx.db.tx(async (q) => {
    const r = await q.query<{ id: string }>(
      `INSERT INTO app.partner_deals(partner_id, origin, delivery_id, contact_id, client_name, product, amount_cents, installments, monthly_cents, bank, signed_on, commission_bps, commission_cents, commission_status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [partnerId, origin, deliveryId, contactId, client, input.product, input.amountCents, input.installments ?? null, input.monthlyCents ?? null, input.bank ?? null, input.signedOn, bps, commission, origin === 'folego' && commission > 0 ? 'a_receber' : 'nao_se_aplica', input.note ?? null],
    );
    const dealId = r.rows[0]!.id;
    if (deliveryId) {
      await q.query(`UPDATE app.lead_deliveries SET status = 'converted' WHERE id = $1`, [deliveryId]);
      await q.query(`INSERT INTO app.partner_events(partner_id, delivery_id, kind, body) VALUES ($1,$2,'contrato',$3)`, [partnerId, deliveryId, `Contrato de ${(input.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} registrado`]);
    }
    if (contactId) {
      await q.query(`UPDATE app.partner_contacts SET stage = 'fechado' WHERE id = $1 AND partner_id = $2`, [contactId, partnerId]);
      await q.query(`INSERT INTO app.partner_events(partner_id, contact_id, kind, body) VALUES ($1,$2,'contrato',$3)`, [partnerId, contactId, `Contrato de ${(input.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} registrado`]);
    }
    await audit(q, `partner:${partnerId}`, 'partner_deal_created', 'partner_deal', dealId, { origin, amountCents: input.amountCents, commissionCents: commission });
    return dealId;
  });
  return { id, commissionCents: commission, commissionBps: bps };
}

export const dealPatchSchema = z.strictObject({
  amountCents: z.number().int().positive().max(100_000_000_000).optional(),
  product: z.enum(PRODUCTS).optional(),
  installments: z.number().int().min(1).max(240).nullable().optional(),
  monthlyCents: z.number().int().positive().max(1_000_000_000).nullable().optional(),
  bank: z.string().trim().min(2).max(80).nullable().optional(),
  signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  status: z.enum(['fechado', 'cancelado']).optional(),
});

export async function patchDeal(ctx: Ctx, partnerId: string, id: string, p: z.infer<typeof dealPatchSchema>) {
  const cur = await ctx.db.query<{ origin: string; amount_cents: string; commission_bps: number; commission_status: string; status: string }>(`SELECT origin, amount_cents::text, commission_bps, commission_status, status FROM app.partner_deals WHERE id = $1 AND partner_id = $2`, [id, partnerId]);
  const x = cur.rows[0];
  if (!x) throw notFound();
  if (x.commission_status === 'recebida') throw new AppError(409, 'commission_paid', 'A comissão deste contrato já foi baixada pelo Fôlego. Fale com o Fôlego para corrigir.');
  if (p.signedOn && p.signedOn > todaySaoPaulo()) throw new AppError(422, 'future_date', 'A data do contrato não pode ser no futuro.');
  const amount = p.amountCents ?? num(x.amount_cents);
  const cancelled = (p.status ?? x.status) === 'cancelado';
  const commission = x.origin === 'folego' && !cancelled ? commissionOf(amount, x.commission_bps) : 0;
  await ctx.db.query(
    `UPDATE app.partner_deals SET amount_cents = $3::bigint, product = coalesce($4::text, product), installments = CASE WHEN $5::boolean THEN $6::smallint ELSE installments END, monthly_cents = CASE WHEN $7::boolean THEN $8::bigint ELSE monthly_cents END,
            bank = CASE WHEN $9::boolean THEN $10::text ELSE bank END, signed_on = coalesce($11::date, signed_on), note = CASE WHEN $12::boolean THEN $13::text ELSE note END, status = $14::text,
            commission_cents = $15::bigint, commission_status = CASE WHEN $16::boolean THEN 'nao_se_aplica' WHEN origin = 'folego' AND $15::bigint > 0 THEN 'a_receber' ELSE 'nao_se_aplica' END
      WHERE id = $1 AND partner_id = $2`,
    [id, partnerId, amount, p.product ?? null, p.installments !== undefined, p.installments ?? null, p.monthlyCents !== undefined, p.monthlyCents ?? null, p.bank !== undefined, p.bank ?? null, p.signedOn ?? null, p.note !== undefined, p.note ?? null, cancelled ? 'cancelado' : 'fechado', commission, cancelled],
  );
  await audit(ctx.db, `partner:${partnerId}`, 'partner_deal_updated', 'partner_deal', id, { fields: Object.keys(p) });
  return { ok: true, commissionCents: commission };
}

export async function listDeals(ctx: Ctx, partnerId: string, o: { month?: string | undefined; origin?: string | undefined; status?: string | undefined }) {
  const params: unknown[] = [partnerId];
  const where = ['d.partner_id = $1'];
  if (o.month && /^\d{4}-\d{2}$/.test(o.month)) {
    params.push(`${o.month}-01`);
    where.push(`d.signed_on >= $${params.length}::date AND d.signed_on < ($${params.length}::date + interval '1 month')`);
  }
  if (o.origin === 'folego' || o.origin === 'propria') {
    params.push(o.origin);
    where.push(`d.origin = $${params.length}`);
  }
  if (o.status === 'fechado' || o.status === 'cancelado') {
    params.push(o.status);
    where.push(`d.status = $${params.length}`);
  }
  const rows = await ctx.db.query<DealRow>(`${DEAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY d.signed_on DESC, d.created_at DESC LIMIT 500`, params);
  const deals = rows.rows.map(dealOut);
  const live = deals.filter((d) => d.status === 'fechado');
  const sum = (f: (d: (typeof deals)[number]) => boolean, g: (d: (typeof deals)[number]) => number) => live.filter(f).reduce((s, d) => s + g(d), 0);
  return {
    deals,
    totals: {
      count: live.length,
      volumeCents: sum(() => true, (d) => d.amountCents),
      folegoVolumeCents: sum((d) => d.origin === 'folego', (d) => d.amountCents),
      commissionDueCents: sum((d) => d.commissionStatus === 'a_receber', (d) => d.commissionCents),
      commissionPaidCents: sum((d) => d.commissionStatus === 'recebida', (d) => d.commissionCents),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------------------------------------------------
export async function summary(ctx: Ctx, partnerId: string) {
  const [leads, base, deals, series, camps, next] = await Promise.all([
    ctx.db.query<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM app.lead_deliveries WHERE partner_id = $1 GROUP BY status`, [partnerId]),
    ctx.db.query<{ stage: string; n: string }>(`SELECT stage, count(*)::text AS n FROM app.partner_contacts WHERE partner_id = $1 GROUP BY stage`, [partnerId]),
    ctx.db.query<{ origin: string; n: string; volume: string; due: string; paid: string }>(
      `SELECT origin, count(*)::text AS n, coalesce(sum(amount_cents),0)::text AS volume,
              coalesce(sum(commission_cents) FILTER (WHERE commission_status = 'a_receber'),0)::text AS due, coalesce(sum(commission_cents) FILTER (WHERE commission_status = 'recebida'),0)::text AS paid
         FROM app.partner_deals WHERE partner_id = $1 AND status = 'fechado' GROUP BY origin`,
      [partnerId],
    ),
    ctx.db.query<{ m: string; volume: string; commission: string; n: string }>(
      `SELECT to_char(date_trunc('month', signed_on), 'YYYY-MM') AS m, coalesce(sum(amount_cents),0)::text AS volume, coalesce(sum(commission_cents),0)::text AS commission, count(*)::text AS n
         FROM app.partner_deals WHERE partner_id = $1 AND status = 'fechado' AND signed_on >= date_trunc('month', current_date) - interval '5 months' GROUP BY 1 ORDER BY 1`,
      [partnerId],
    ),
    ctx.db.query<{ name: string; price: string; bps: number; status: string }>(`SELECT name, price_per_lead_cents::text AS price, commission_bps AS bps, status FROM app.partner_campaigns WHERE partner_id = $1 ORDER BY created_at`, [partnerId]),
    ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.partner_contacts WHERE partner_id = $1 AND next_action_on <= $2::date`, [partnerId, todaySaoPaulo()]),
  ]);
  const L = Object.fromEntries(leads.rows.map((x) => [x.status, num(x.n)])) as Record<string, number>;
  const B = Object.fromEntries(base.rows.map((x) => [x.stage, num(x.n)])) as Record<string, number>;
  const D = (o: string) => deals.rows.find((x) => x.origin === o);
  const received = (L.delivered ?? 0) + (L.contacted ?? 0) + (L.converted ?? 0);
  const folego = D('folego');

  // Visão consolidada de TODA a operação do parceiro (base própria + contatos do Fôlego + contratos + WhatsApp), não só do que vem do Fôlego.
  const [months2, margin, wa, activity] = await Promise.all([
    ctx.db.query<{ m: string; n: string; volume: string }>(
      `SELECT to_char(date_trunc('month', signed_on), 'YYYY-MM') AS m, count(*)::text AS n, coalesce(sum(amount_cents),0)::text AS volume
         FROM app.partner_deals WHERE partner_id = $1 AND status = 'fechado' AND signed_on >= date_trunc('month', current_date) - interval '1 month' GROUP BY 1`,
      [partnerId],
    ),
    ctx.db.query<{ cents: string; n: string }>(
      `SELECT coalesce(sum(available_margin_cents),0)::text AS cents, count(*) FILTER (WHERE available_margin_cents > 0)::text AS n
         FROM app.partner_contacts WHERE partner_id = $1 AND stage IN ('novo','em_contato','proposta')`,
      [partnerId],
    ),
    ctx.db.query<{ connected: boolean; threads: string; unread: string; open_n: string; opted: string; sent: string; received: string; delivered: string; read: string; contacted: string; replied: string; broadcasts: string }>(
      `SELECT EXISTS (SELECT 1 FROM app.wa_accounts WHERE partner_id = $1) AS connected,
              (SELECT count(*) FROM app.wa_threads WHERE partner_id = $1)::text AS threads,
              (SELECT coalesce(sum(unread_n),0) FROM app.wa_threads WHERE partner_id = $1)::text AS unread,
              (SELECT count(*) FROM app.wa_threads WHERE partner_id = $1 AND state = 'aberta')::text AS open_n,
              (SELECT count(*) FROM app.wa_threads WHERE partner_id = $1 AND opted_out)::text AS opted,
              (SELECT count(*) FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND status <> 'falhou' AND status <> 'fila' AND created_at > now() - interval '30 days')::text AS sent,
              (SELECT count(*) FROM app.wa_messages WHERE partner_id = $1 AND direction = 'in' AND created_at > now() - interval '30 days')::text AS received,
              (SELECT count(*) FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND status IN ('entregue','lida') AND created_at > now() - interval '30 days')::text AS delivered,
              (SELECT count(*) FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND status = 'lida' AND created_at > now() - interval '30 days')::text AS read,
              (SELECT count(DISTINCT thread_id) FROM app.wa_messages WHERE partner_id = $1 AND direction = 'out' AND author <> 'sistema' AND status <> 'falhou' AND created_at > now() - interval '30 days')::text AS contacted,
              (SELECT count(DISTINCT m.thread_id) FROM app.wa_messages m WHERE m.partner_id = $1 AND m.direction = 'in' AND m.created_at > now() - interval '30 days'
                  AND EXISTS (SELECT 1 FROM app.wa_messages o WHERE o.thread_id = m.thread_id AND o.direction = 'out' AND o.author <> 'sistema' AND o.created_at < m.created_at))::text AS replied,
              (SELECT count(*) FROM app.wa_broadcasts WHERE partner_id = $1 AND created_at > now() - interval '30 days')::text AS broadcasts`,
      [partnerId],
    ),
    ctx.db.query<{ kind: string; n: string }>(`SELECT kind, count(*)::text AS n FROM app.partner_events WHERE partner_id = $1 AND created_at > now() - interval '30 days' GROUP BY kind`, [partnerId]),
  ]);
  const baseTotal = Object.values(B).reduce((s, n) => s + n, 0);
  const folegoTotal = received + (L.rejected ?? 0);
  const contactsTotal = baseTotal + folegoTotal;
  const dealCount = deals.rows.reduce((s, x) => s + num(x.n), 0);
  const dealVolume = deals.rows.reduce((s, x) => s + num(x.volume), 0);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const month = (ym: string) => {
    const r = months2.rows.find((x) => x.m === ym);
    return { count: num(r?.n ?? 0), volumeCents: num(r?.volume ?? 0) };
  };
  const today = todaySaoPaulo();
  const prevYm = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const W = wa.rows[0]!;
  const ev = Object.fromEntries(activity.rows.map((x) => [x.kind, num(x.n)])) as Record<string, number>;
  const overview = {
    contacts: { total: contactsTotal, base: baseTotal, folego: folegoTotal },
    // Funil único: etapas da base própria somadas ao andamento dos contatos do Fôlego (novo, contatado, contrato, descartado).
    funnel: {
      novo: (B.novo ?? 0) + (L.delivered ?? 0),
      em_contato: (B.em_contato ?? 0) + (L.contacted ?? 0),
      proposta: B.proposta ?? 0,
      fechado: (B.fechado ?? 0) + (L.converted ?? 0),
      sem_interesse: (B.sem_interesse ?? 0) + (L.rejected ?? 0),
    },
    conversion: { overallPct: pct((B.fechado ?? 0) + (L.converted ?? 0), contactsTotal), basePct: pct(B.fechado ?? 0, baseTotal), folegoPct: pct(L.converted ?? 0, folegoTotal) },
    deals: {
      count: dealCount, volumeCents: dealVolume, avgTicketCents: dealCount ? Math.round(dealVolume / dealCount) : 0,
      thisMonth: month(today.slice(0, 7)), prevMonth: month(prevYm),
      byOrigin: { folego: { count: num(folego?.n ?? 0), volumeCents: num(folego?.volume ?? 0) }, propria: { count: num(D('propria')?.n ?? 0), volumeCents: num(D('propria')?.volume ?? 0) } },
    },
    marginOpen: { cents: num(margin.rows[0]?.cents ?? 0), count: num(margin.rows[0]?.n ?? 0) },
    whatsapp: {
      connected: W.connected, threads: num(W.threads), unread: num(W.unread), open: num(W.open_n), optedOut: num(W.opted),
      sent30: num(W.sent), received30: num(W.received), broadcasts30: num(W.broadcasts),
      replyPct: pct(Math.min(num(W.replied), num(W.contacted)), num(W.contacted)), readPct: pct(num(W.read), num(W.delivered)),
    },
    activity30: { calls: ev.ligacao ?? 0, whatsapp: ev.whatsapp ?? 0, notes: ev.nota ?? 0 },
  };
  return {
    overview,
    folego: { received, pending: L.delivered ?? 0, contacted: L.contacted ?? 0, converted: L.converted ?? 0, discarded: L.rejected ?? 0, conversionPct: received ? Math.round(((L.converted ?? 0) / received) * 1000) / 10 : 0 },
    base: { total: Object.values(B).reduce((s, n) => s + n, 0), byStage: B, dueToday: num(next.rows[0]?.n ?? 0) },
    deals: {
      folego: { count: num(folego?.n ?? 0), volumeCents: num(folego?.volume ?? 0), commissionDueCents: num(folego?.due ?? 0), commissionPaidCents: num(folego?.paid ?? 0) },
      propria: { count: num(D('propria')?.n ?? 0), volumeCents: num(D('propria')?.volume ?? 0) },
    },
    months: series.rows.map((x) => ({ month: x.m, volumeCents: num(x.volume), commissionCents: num(x.commission), count: num(x.n) })),
    campaigns: camps.rows.map((c) => ({ name: c.name, status: c.status, pricePerLeadCents: num(c.price), commissionBps: c.bps })),
  };
}

export async function partnerProfile(ctx: Ctx, partnerId: string) {
  const r = await ctx.db.query<{ legal_name: string; trade_name: string | null; cnpj: string; phone: string | null; city: string | null; uf: string | null }>(`SELECT legal_name, trade_name, cnpj, phone, city, uf FROM app.partners WHERE id = $1`, [partnerId]);
  const x = r.rows[0];
  if (!x) throw notFound();
  return { legalName: x.legal_name, tradeName: x.trade_name, cnpj: x.cnpj, phone: x.phone, city: x.city, uf: x.uf };
}
