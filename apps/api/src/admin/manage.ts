// Gestão do que o dono controla pelo backoffice: catálogo (preços, gratuito/pago, IA), usuários e permissões, auditoria.
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import type { AdminUser } from './auth.ts';
import { ROLE_PRESETS, ROLES, isSection } from './permissions.ts';
import type { Role, Section } from './permissions.ts';

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);

// ---------------------------------------------------------------------------
// Catálogo: produtos pagos (editáveis) e recursos gratuitos (informativo)
// ---------------------------------------------------------------------------
/** Recursos gratuitos do site. Não passam por pedido, então não têm preço; ficam aqui para o dono ver o mapa completo. */
export const FREE_FEATURES = [
  { id: 'preview', name: 'Diagnóstico grátis (resultado inicial)', description: 'Nota de saúde, manchete e por onde começar. A entrega completa é o Mapa da Virada.', usesAi: false },
  { id: 'translator_preview', name: 'Leitura rápida do Tradutor de Cobrança', description: 'Risco e resumo da cobrança; a explicação completa é paga.', usesAi: false },
  { id: 'prescription_tool', name: 'Calculadora de prescrição', description: 'Indica se a dívida pode ter prescrito, com base nas datas informadas.', usesAi: false },
  { id: 'scam_tool', name: 'Detector de golpe de cobrança', description: 'Sinais de golpe em mensagens de cobrança.', usesAi: false },
  { id: 'rights_guide', name: 'Guia de direitos do endividado', description: 'Conteúdo educativo.', usesAi: false },
  { id: 'forgotten_money_guide', name: 'Guia de dinheiro esquecido', description: 'Links oficiais (Valores a Receber, FGTS, PIS/PASEP, restituição).', usesAi: false },
];

export interface ProductRow {
  code: string;
  name: string;
  kind: 'one_off' | 'subscription';
  priceCents: number;
  accessDays: number;
  active: boolean;
  usesAi: boolean;
  description: string;
  updatedAt: string | null;
  history: { at: string | null; oldCents: number | null; newCents: number; by: string | null }[];
}

export async function listProducts(ctx: Ctx) {
  const p = await ctx.db.query<{ code: string; name: string; kind: 'one_off' | 'subscription'; price_cents: string; access_days: number; active: boolean; uses_ai: boolean; description: string; updated_at: Date }>(
    `SELECT code, name, kind, price_cents, access_days, active, uses_ai, description, updated_at FROM app.products ORDER BY sort, code`,
  );
  const h = await ctx.db.query<{ product_code: string; old_price_cents: string | null; new_price_cents: string; changed_at: Date; email: string | null }>(
    `SELECT h.product_code, h.old_price_cents, h.new_price_cents, h.changed_at, u.email::text AS email
       FROM app.product_price_history h LEFT JOIN app.admin_users u ON u.id = h.changed_by ORDER BY h.changed_at DESC LIMIT 200`,
  );
  const products: ProductRow[] = p.rows.map((x) => ({
    code: x.code,
    name: x.name,
    kind: x.kind,
    priceCents: num(x.price_cents),
    accessDays: x.access_days,
    active: x.active,
    usesAi: x.uses_ai,
    description: x.description,
    updatedAt: iso(x.updated_at),
    history: h.rows.filter((r) => r.product_code === x.code).slice(0, 5).map((r) => ({ at: iso(r.changed_at), oldCents: r.old_price_cents === null ? null : num(r.old_price_cents), newCents: num(r.new_price_cents), by: r.email })),
  }));
  return { products, free: FREE_FEATURES, bundlePriceCents: ctx.config.bundlePriceCents };
}

export interface ProductPatch {
  name?: string | undefined;
  priceCents?: number | undefined;
  accessDays?: number | undefined;
  active?: boolean | undefined;
  usesAi?: boolean | undefined;
  description?: string | undefined;
}

export async function updateProduct(ctx: Ctx, admin: AdminUser, code: string, patch: ProductPatch): Promise<void> {
  await ctx.db.tx(async (q) => {
    const cur = await q.query<{ price_cents: string; kind: string; name: string; active: boolean }>(`SELECT price_cents, kind, name, active FROM app.products WHERE code = $1 FOR UPDATE`, [code]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (patch.priceCents !== undefined) {
      if (!Number.isInteger(patch.priceCents) || patch.priceCents < 0 || patch.priceCents > 1_000_000) throw new AppError(422, 'invalid_price', 'Preço inválido (de R$ 0 a R$ 10.000).');
      if (patch.priceCents === 0 && row.kind === 'subscription') throw new AppError(422, 'invalid_price', 'Assinatura não pode ter preço zero.');
    }
    if (patch.accessDays !== undefined && (!Number.isInteger(patch.accessDays) || patch.accessDays < 1 || patch.accessDays > 365)) throw new AppError(422, 'invalid_days', 'Dias de acesso: de 1 a 365.');
    const sets: string[] = [];
    const params: unknown[] = [code];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) add('name', patch.name.trim().slice(0, 80) || row.name);
    if (patch.priceCents !== undefined) add('price_cents', patch.priceCents);
    if (patch.accessDays !== undefined) add('access_days', patch.accessDays);
    if (patch.active !== undefined) add('active', patch.active);
    if (patch.usesAi !== undefined) add('uses_ai', patch.usesAi);
    if (patch.description !== undefined) add('description', patch.description.trim().slice(0, 400));
    if (sets.length === 0) return;
    await q.query(`UPDATE app.products SET ${sets.join(', ')}, updated_at = now() WHERE code = $1`, params);
    if (patch.priceCents !== undefined && patch.priceCents !== num(row.price_cents)) {
      await q.query(`INSERT INTO app.product_price_history(product_code, old_price_cents, new_price_cents, changed_by) VALUES ($1,$2,$3,$4)`, [code, num(row.price_cents), patch.priceCents, admin.id]);
    }
    await audit(q, `admin:${admin.id}`, 'admin_product_update', 'product', code, { ...patch, by: admin.email, oldPriceCents: num(row.price_cents) });
  });
}

/** Catálogo público: o que o site mostra (preços vêm daqui, nunca fixos no navegador). */
export async function publicCatalog(ctx: Ctx) {
  const p = await ctx.db.query<{ code: string; name: string; kind: string; price_cents: string; active: boolean; access_days: number }>(`SELECT code, name, kind, price_cents, active, access_days FROM app.products ORDER BY sort`);
  return {
    products: p.rows.map((x) => ({ code: x.code, name: x.name, kind: x.kind, priceCents: num(x.price_cents), active: x.active, accessDays: x.access_days })),
    bundlePriceCents: ctx.config.bundlePriceCents,
    salesPaused: ctx.config.salesPaused,
    announcement: ctx.config.announcement,
  };
}

// ---------------------------------------------------------------------------
// Usuários e permissões do backoffice
// ---------------------------------------------------------------------------
export async function listUsers(ctx: Ctx) {
  const r = await ctx.db.query<{ id: string; email: string; name: string; role: Role; permissions: string[]; active: boolean; created_at: Date; last_login_at: Date | null }>(
    `SELECT id, email::text AS email, name, role, permissions, active, created_at, last_login_at FROM app.admin_users ORDER BY (role = 'owner') DESC, created_at`,
  );
  return r.rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, permissions: u.role === 'owner' ? ROLE_PRESETS.owner : u.permissions.filter(isSection), active: u.active, createdAt: iso(u.created_at), lastLoginAt: iso(u.last_login_at) }));
}

const cleanPerms = (list: unknown[]): Section[] => [...new Set(list.filter(isSection))];

export async function createUser(ctx: Ctx, admin: AdminUser, input: { email: string; name: string; role: string; permissions?: string[] | undefined }): Promise<string> {
  if (!(ROLES as readonly string[]).includes(input.role)) throw new AppError(422, 'invalid_role', 'Papel inválido.');
  const role = input.role as Role;
  const perms = role === 'owner' ? ROLE_PRESETS.owner : input.permissions ? cleanPerms(input.permissions) : ROLE_PRESETS[role];
  const exists = await ctx.db.query(`SELECT 1 FROM app.admin_users WHERE email = $1`, [input.email]);
  if (exists.rows.length > 0) throw new AppError(409, 'exists', 'Este e-mail já tem acesso.');
  const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.admin_users(email, name, role, permissions, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [input.email, input.name.trim().slice(0, 80), role, perms, admin.id]);
  const id = r.rows[0]!.id;
  await audit(ctx.db, `admin:${admin.id}`, 'admin_user_create', 'admin_user', id, { email: input.email, role, permissions: perms, by: admin.email });
  return id;
}

export async function updateUser(ctx: Ctx, admin: AdminUser, id: string, patch: { name?: string | undefined; role?: string | undefined; permissions?: string[] | undefined; active?: boolean | undefined }): Promise<void> {
  await ctx.db.tx(async (q) => {
    const cur = await q.query<{ role: Role; active: boolean; email: string }>(`SELECT role, active, email::text AS email FROM app.admin_users WHERE id = $1 FOR UPDATE`, [id]);
    const row = cur.rows[0];
    if (!row) throw notFound();
    if (patch.role !== undefined && !(ROLES as readonly string[]).includes(patch.role)) throw new AppError(422, 'invalid_role', 'Papel inválido.');
    const nextRole = (patch.role as Role | undefined) ?? row.role;
    const nextActive = patch.active ?? row.active;
    // Sempre precisa restar pelo menos um dono ativo (senão ninguém mais consegue gerir usuários).
    if (row.role === 'owner' && (nextRole !== 'owner' || !nextActive)) {
      const owners = await q.query<{ n: string }>(`SELECT count(*) AS n FROM app.admin_users WHERE role = 'owner' AND active AND id <> $1`, [id]);
      if (num(owners.rows[0]?.n ?? 0) === 0) throw new AppError(409, 'last_owner', 'Precisa existir pelo menos um dono ativo.');
    }
    if (id === admin.id && patch.active === false) throw new AppError(409, 'self', 'Você não pode desativar o seu próprio acesso.');
    const sets: string[] = [];
    const params: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.name !== undefined) add('name', patch.name.trim().slice(0, 80));
    if (patch.role !== undefined) add('role', nextRole);
    if (patch.permissions !== undefined || patch.role !== undefined) add('permissions', nextRole === 'owner' ? ROLE_PRESETS.owner : patch.permissions ? cleanPerms(patch.permissions) : ROLE_PRESETS[nextRole]);
    if (patch.active !== undefined) add('active', patch.active);
    if (sets.length === 0) return;
    await q.query(`UPDATE app.admin_users SET ${sets.join(', ')} WHERE id = $1`, params);
    if (patch.active === false) await q.query(`UPDATE app.sessions SET admin_user_id = NULL, admin_login_at = NULL WHERE admin_user_id = $1`, [id]);
    await audit(q, `admin:${admin.id}`, 'admin_user_update', 'admin_user', id, { ...patch, target: row.email, by: admin.email });
  });
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
export async function listAudit(ctx: Ctx, opts: { scope?: string; page?: number }) {
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const where = opts.scope === 'todos' ? '' : `WHERE actor LIKE 'admin:%'`;
  const r = await ctx.db.query<{ id: string; occurred_at: Date; actor: string; action: string; entity: string; entity_id: string | null; data: Record<string, unknown>; email: string | null }>(
    `SELECT a.id, a.occurred_at, a.actor, a.action, a.entity, a.entity_id, a.data, u.email::text AS email
       FROM app.audit_log a LEFT JOIN app.admin_users u ON a.actor = 'admin:' || u.id::text
       ${where.replace('actor', 'a.actor')} ORDER BY a.id DESC LIMIT 60 OFFSET ${page * 60}`,
  );
  return r.rows.map((a) => ({ id: num(a.id), at: iso(a.occurred_at), actor: a.email ?? a.actor, action: a.action, entity: a.entity, entityId: a.entity_id, data: a.data }));
}
