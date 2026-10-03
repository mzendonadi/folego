// Entrada no backoffice: código de 6 dígitos por e-mail (mesmo modelo da assinatura, sem senha guardada).
// O primeiro dono vem de ADMIN_EMAILS; os demais usuários são criados na tela de Configurações.
import { randomInt } from 'node:crypto';
import { hashPassword, hmac, safeEqual, verifyPassword } from '../crypto.ts';
import { layout } from '../email.ts';
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import { ROLE_PRESETS, SECTIONS, isSection } from './permissions.ts';
import type { Role, Section } from './permissions.ts';

const CODE_TTL_MIN = 10;
const SESSION_HOURS = 8;

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

const PW_MIN = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const COMMON = ['123456789012', 'senha1234567', 'password1234', 'qwertyuiop12', 'folego123456', 'administrador1'];
const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos, ou acesso bloqueado por tentativas. Se errou várias vezes, espere 15 minutos.';
// Para o tempo de resposta não revelar se o e-mail existe: sempre se gasta uma verificação de senha.
const DUMMY_HASH = hashPassword('senha-falsa-para-igualar-o-tempo');

/** Regras de senha: 12+ caracteres, letra e número, nada de e-mail ou senhas óbvias. */
export function checkPasswordPolicy(password: string, email: string): string | null {
  if (password.length < PW_MIN) return `A senha precisa ter pelo menos ${PW_MIN} caracteres.`;
  if (password.length > 200) return 'A senha é longa demais.';
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return 'Use letras e números na senha.';
  if (new Set(password.toLowerCase()).size < 5) return 'Essa senha é repetitiva demais. Misture mais caracteres.';
  const local = email.split('@')[0]!.toLowerCase();
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'A senha não pode conter o seu e-mail.';
  if (COMMON.includes(password.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}

async function sendCode(ctx: Ctx, email: string, purpose: 'admin' | 'admin_setup'): Promise<{ sent: true; devCode?: string }> {
  const recent = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.login_codes WHERE email = $1 AND purpose = $2 AND created_at > now() - interval '10 minutes'`, [email, purpose]);
  if (num(recent.rows[0]?.n ?? 0) >= 3) throw new AppError(429, 'too_many_codes', 'Você já pediu alguns códigos. Espere 10 minutos ou use o último que chegou.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(`INSERT INTO app.login_codes(email, code_hash, expires_at, purpose) VALUES ($1,$2, now() + make_interval(mins => ${CODE_TTL_MIN}), $3)`, [email, codeHash(ctx, email, code), purpose]);
  if (!ctx.email) {
    if (ctx.config.env === 'production') throw new AppError(503, 'email_off', 'O envio de e-mail não está configurado.');
    return { sent: true, devCode: code };
  }
  const title = purpose === 'admin' ? 'Seu código do backoffice Fôlego' : 'Definir sua senha do backoffice Fôlego';
  const body = layout(title, [`Seu código: ${code}`, `Ele vale por ${CODE_TTL_MIN} minutos. Se não foi você, ignore este e-mail e avise o dono: alguém pode estar tentando entrar.`]);
  try {
    await ctx.email.send({ to: email, subject: `${purpose === 'admin' ? 'Código do backoffice' : 'Código para definir a senha'}: ${code}`, ...body });
  } catch {
    throw new AppError(502, 'email_failed', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
  }
  return ctx.config.env === 'development' ? { sent: true, devCode: code } : { sent: true };
}

interface CredRow extends AdminRow {
  password_hash: string | null;
  password_set_at: Date | null;
  setup_allowed_until: Date | null;
  failed_attempts: number;
  locked_until: Date | null;
}

async function credentials(ctx: Ctx, email: string): Promise<CredRow | null> {
  await findAllowed(ctx, email); // cria o dono inicial listado em ADMIN_EMAILS, se for o caso
  const r = await ctx.db.query<CredRow>(`SELECT id, email, name, role, permissions, active, password_hash, password_set_at, setup_allowed_until, failed_attempts, locked_until FROM app.admin_users WHERE email = $1`, [email]);
  const row = r.rows[0];
  return row && row.active ? row : null;
}

/** Login: e-mail + senha. O e-mail já foi provado por código no primeiro acesso (ou na redefinição), então aqui não há 2º código. */
export async function passwordLogin(ctx: Ctx, sessionId: string, email: string, password: string): Promise<AdminUser> {
  const u = await credentials(ctx, email);
  const locked = Boolean(u?.locked_until && new Date(u.locked_until).getTime() > Date.now());
  const ok = verifyPassword(password, u?.password_hash ?? DUMMY_HASH) && Boolean(u?.password_hash) && !locked;
  if (!u || !ok) {
    if (u && !locked) {
      const fails = u.failed_attempts + 1;
      await ctx.db.query(`UPDATE app.admin_users SET failed_attempts = $2, locked_until = CASE WHEN $2 >= ${MAX_FAILS} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE locked_until END WHERE id = $1`, [u.id, fails]);
      await audit(ctx.db, `admin:${u.id}`, 'admin_login_failed', 'admin_user', u.id, { tentativa: fails, bloqueado: fails >= MAX_FAILS });
    }
    throw new AppError(401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
  }
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [u.id]);
    await q.query(`UPDATE app.sessions SET admin_user_id = $2, admin_login_at = now() WHERE id = $1`, [sessionId, u.id]);
    await audit(q, `admin:${u.id}`, 'admin_login', 'admin_user', u.id);
  });
  return toAdminUser(u as never);
}

/** Primeiro acesso ou senha liberada pelo dono: manda um código para provar que o e-mail é da pessoa. Resposta sempre igual. */
export async function requestSetupCode(ctx: Ctx, email: string): Promise<{ sent: true; devCode?: string }> {
  const u = await credentials(ctx, email);
  const allowed = Boolean(u && !u.password_hash && (u.password_set_at === null || (u.setup_allowed_until && new Date(u.setup_allowed_until).getTime() > Date.now())));
  if (!allowed) return { sent: true };
  return sendCode(ctx, email, 'admin_setup');
}

/** Define a senha (código do e-mail + senha nova). Não entra no sistema: depois é preciso fazer o login normal. */
export async function completeSetup(ctx: Ctx, email: string, code: string, password: string): Promise<void> {
  const u = await credentials(ctx, email);
  const allowed = Boolean(u && !u.password_hash && (u.password_set_at === null || (u.setup_allowed_until && new Date(u.setup_allowed_until).getTime() > Date.now())));
  const problem = checkPasswordPolicy(password, email);
  if (problem) throw new AppError(422, 'weak_password', problem);
  const r = await ctx.db.query<{ id: string; code_hash: Buffer; attempts: number }>(
    `SELECT id, code_hash, attempts FROM app.login_codes WHERE email = $1 AND purpose = 'admin_setup' AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  if (!u || !allowed || !row) throw new AppError(401, 'invalid_code', 'Código inválido ou vencido. Peça um novo.');
  if (row.attempts >= 5) throw new AppError(429, 'too_many_attempts', 'Muitas tentativas. Peça um novo código.');
  await ctx.db.query(`UPDATE app.login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  if (!safeEqual(codeHash(ctx, email, code).toString('hex'), Buffer.from(row.code_hash).toString('hex'))) throw new AppError(401, 'invalid_code', 'Código incorreto.');
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.login_codes SET used_at = now() WHERE id = $1`, [row.id]);
    await q.query(`UPDATE app.admin_users SET password_hash = $2, password_set_at = now(), setup_allowed_until = NULL, failed_attempts = 0, locked_until = NULL WHERE id = $1`, [u.id, hashPassword(password)]);
    await q.query(`UPDATE app.sessions SET admin_user_id = NULL, admin_login_at = NULL WHERE admin_user_id = $1`, [u.id]);
    await audit(q, `admin:${u.id}`, 'admin_password_set', 'admin_user', u.id);
  });
}

/** Troca de senha por quem já está logado: exige a senha atual e derruba as outras sessões. */
export async function changePassword(ctx: Ctx, sessionId: string, admin: AdminUser, current: string, next: string): Promise<void> {
  const r = await ctx.db.query<{ password_hash: string | null }>(`SELECT password_hash FROM app.admin_users WHERE id = $1`, [admin.id]);
  if (!r.rows[0]?.password_hash || !verifyPassword(current, r.rows[0].password_hash)) throw new AppError(401, 'invalid_credentials', 'A senha atual está incorreta.');
  const problem = checkPasswordPolicy(next, admin.email);
  if (problem) throw new AppError(422, 'weak_password', problem);
  if (verifyPassword(next, r.rows[0].password_hash)) throw new AppError(422, 'same_password', 'A senha nova precisa ser diferente da atual.');
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.admin_users SET password_hash = $2, password_set_at = now() WHERE id = $1`, [admin.id, hashPassword(next)]);
    await q.query(`UPDATE app.sessions SET admin_user_id = NULL, admin_login_at = NULL WHERE admin_user_id = $1 AND id <> $2`, [admin.id, sessionId]);
    await audit(q, `admin:${admin.id}`, 'admin_password_change', 'admin_user', admin.id);
  });
}

/** Dono libera a redefinição: apaga a senha, derruba as sessões e abre uma janela de 24 h para a pessoa criar outra. */
export async function releasePasswordReset(ctx: Ctx, owner: AdminUser, targetId: string): Promise<void> {
  const r = await ctx.db.query(`UPDATE app.admin_users SET password_hash = NULL, setup_allowed_until = now() + interval '24 hours', failed_attempts = 0, locked_until = NULL WHERE id = $1`, [targetId]);
  if (r.rowCount === 0) throw notFound();
  await ctx.db.query(`UPDATE app.sessions SET admin_user_id = NULL, admin_login_at = NULL WHERE admin_user_id = $1`, [targetId]);
  await audit(ctx.db, `admin:${owner.id}`, 'admin_password_reset_released', 'admin_user', targetId, { by: owner.email });
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
