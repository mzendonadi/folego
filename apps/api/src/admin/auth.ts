// Entrada no backoffice: código de 6 dígitos por e-mail (mesmo modelo da assinatura, sem senha guardada).
// O primeiro dono vem de ADMIN_EMAILS; os demais usuários são criados na tela de Configurações.
import { randomInt } from 'node:crypto';
import { hmac, safeEqual } from '../crypto.ts';
import { layout } from '../email.ts';
import { AppError } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import { ROLE_PRESETS, SECTIONS, isSection } from './permissions.ts';
import type { Role, Section } from './permissions.ts';

const CODE_TTL_MIN = 10;
const SESSION_HOURS = 12;

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Section[];
}

const codeHash = (ctx: Ctx, email: string, code: string) => hmac(ctx.config.secret, `admin:${email}:${code}`);

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: string[];
  active: boolean;
}

export const toAdminUser = (r: AdminRow): AdminUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role,
  permissions: r.role === 'owner' ? [...SECTIONS] : r.permissions.filter(isSection),
});

async function findAllowed(ctx: Ctx, email: string): Promise<AdminRow | null> {
  const r = await ctx.db.query<AdminRow>(`SELECT id, email, name, role, permissions, active FROM app.admin_users WHERE email = $1`, [email]);
  const row = r.rows[0];
  if (row) return row.active ? row : null;
  if (!ctx.config.adminEmails.includes(email)) return null;
  // Primeiro acesso de um e-mail da lista ADMIN_EMAILS: vira dono.
  const created = await ctx.db.query<AdminRow>(
    `INSERT INTO app.admin_users(email, name, role, permissions) VALUES ($1, '', 'owner', $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, email, name, role, permissions, active`,
    [email, ROLE_PRESETS.owner],
  );
  return created.rows[0] ?? null;
}

/** Sempre responde igual (não revela se o e-mail tem acesso). Só envia código para quem realmente pode entrar. */
export async function requestAdminCode(ctx: Ctx, email: string): Promise<{ sent: true; devCode?: string }> {
  const admin = await findAllowed(ctx, email);
  if (!admin) return { sent: true };
  const recent = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.login_codes WHERE email = $1 AND purpose = 'admin' AND created_at > now() - interval '10 minutes'`, [email]);
  if (num(recent.rows[0]?.n ?? 0) >= 3) throw new AppError(429, 'too_many_codes', 'Você já pediu alguns códigos. Espere 10 minutos ou use o último que chegou.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(`INSERT INTO app.login_codes(email, code_hash, expires_at, purpose) VALUES ($1,$2, now() + make_interval(mins => ${CODE_TTL_MIN}), 'admin')`, [email, codeHash(ctx, email, code)]);
  if (!ctx.email) {
    if (ctx.config.env === 'production') throw new AppError(503, 'email_off', 'O envio de e-mail não está configurado.');
    return { sent: true, devCode: code };
  }
  const body = layout('Seu código do backoffice Fôlego', [`Use este código para entrar: ${code}`, `Ele vale por ${CODE_TTL_MIN} minutos. Se não foi você, ignore este e-mail.`]);
  try {
    await ctx.email.send({ to: email, subject: `Código do backoffice: ${code}`, ...body });
  } catch {
    throw new AppError(502, 'email_failed', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
  }
  return ctx.config.env === 'development' ? { sent: true, devCode: code } : { sent: true };
}

export async function verifyAdminCode(ctx: Ctx, sessionId: string, email: string, code: string): Promise<AdminUser> {
  const admin = await findAllowed(ctx, email);
  const r = await ctx.db.query<{ id: string; code_hash: Buffer; attempts: number }>(
    `SELECT id, code_hash, attempts FROM app.login_codes WHERE email = $1 AND purpose = 'admin' AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  if (!admin || !row) throw new AppError(401, 'invalid_code', 'Código inválido ou vencido. Peça um novo.');
  if (row.attempts >= 5) throw new AppError(429, 'too_many_attempts', 'Muitas tentativas. Peça um novo código.');
  await ctx.db.query(`UPDATE app.login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  if (!safeEqual(codeHash(ctx, email, code).toString('hex'), Buffer.from(row.code_hash).toString('hex'))) throw new AppError(401, 'invalid_code', 'Código incorreto.');
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.login_codes SET used_at = now() WHERE id = $1`, [row.id]);
    await q.query(`UPDATE app.admin_users SET last_login_at = now() WHERE id = $1`, [admin.id]);
    await q.query(`UPDATE app.sessions SET admin_user_id = $2, admin_login_at = now() WHERE id = $1`, [sessionId, admin.id]);
    await audit(q, `admin:${admin.id}`, 'admin_login', 'admin_user', admin.id);
  });
  return toAdminUser(admin);
}

/** Usuário do backoffice desta sessão (sessão de no máximo 12 h, e o usuário precisa continuar ativo). */
export async function adminOf(ctx: Ctx, sessionId: string): Promise<AdminUser | null> {
  const r = await ctx.db.query<AdminRow>(
    `SELECT u.id, u.email, u.name, u.role, u.permissions, u.active
       FROM app.sessions s JOIN app.admin_users u ON u.id = s.admin_user_id
      WHERE s.id = $1 AND s.admin_login_at > now() - make_interval(hours => ${SESSION_HOURS})`,
    [sessionId],
  );
  const row = r.rows[0];
  return row && row.active ? toAdminUser(row) : null;
}

export async function adminLogout(ctx: Ctx, sessionId: string): Promise<void> {
  await ctx.db.query(`UPDATE app.sessions SET admin_user_id = NULL, admin_login_at = NULL WHERE id = $1`, [sessionId]);
}

export function can(admin: AdminUser, section: Section): boolean {
  return admin.role === 'owner' || admin.permissions.includes(section);
}

export function requirePermission(admin: AdminUser, section: Section): void {
  if (!can(admin, section)) throw new AppError(403, 'forbidden', 'Você não tem permissão para esta área.');
}
