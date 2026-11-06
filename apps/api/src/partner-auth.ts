// Portal do parceiro: "Esqueci minha senha". Código de 6 dígitos por e-mail (10 minutos, 5 tentativas), depois senha nova.
// A resposta do pedido é sempre a mesma (não revela se o e-mail existe) e só parceiro ATIVO recebe o código.
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { checkPasswordPolicy } from './admin/auth.ts';
import { hashPassword, hmac, safeEqual } from './crypto.ts';
import { layout } from './email.ts';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num } from './services.ts';

const CODE_TTL_MIN = 10;
const PURPOSE = 'partner_reset';
const codeHash = (ctx: Ctx, email: string, code: string) => hmac(ctx.config.secret, `partner:${email}:${code}`);

export const partnerForgotSchema = z.strictObject({ email: z.string().trim().toLowerCase().email().max(200) });
export const partnerResetSchema = z.strictObject({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().regex(/^\d{6}$/), password: z.string().min(1).max(200) });

async function activeUser(ctx: Ctx, email: string): Promise<{ id: string; partner_id: string } | null> {
  const r = await ctx.db.query<{ id: string; partner_id: string }>(
    `SELECT u.id, u.partner_id FROM app.partner_users u JOIN app.partners p ON p.id = u.partner_id WHERE u.email = $1 AND p.status = 'active'`,
    [email],
  );
  return r.rows[0] ?? null;
}

export async function partnerRequestReset(ctx: Ctx, email: string): Promise<{ sent: true; devCode?: string }> {
  const u = await activeUser(ctx, email);
  if (!u) return { sent: true };
  const recent = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.login_codes WHERE email = $1 AND purpose = $2 AND created_at > now() - interval '10 minutes'`, [email, PURPOSE]);
  if (num(recent.rows[0]?.n ?? 0) >= 3) throw new AppError(429, 'too_many_codes', 'Você já pediu alguns códigos. Espere 10 minutos ou use o último que chegou.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(`INSERT INTO app.login_codes(email, code_hash, expires_at, purpose) VALUES ($1,$2, now() + make_interval(mins => ${CODE_TTL_MIN}), $3)`, [email, codeHash(ctx, email, code), PURPOSE]);
  await audit(ctx.db, `partner_user:${u.id}`, 'partner_password_forgot_requested', 'partner', u.partner_id, {});
  if (!ctx.email) {
    if (ctx.config.env === 'production') throw new AppError(503, 'email_off', 'O envio de e-mail não está configurado.');
    return ctx.config.exposeDevCodes || ctx.config.env === 'test' ? { sent: true, devCode: code } : { sent: true };
  }
  const body = layout('Redefinir a senha do portal do parceiro', [`Seu código: ${code}`, `Ele vale por ${CODE_TTL_MIN} minutos. Se não foi você que pediu, ignore este e-mail: a senha atual continua valendo.`]);
  try {
    await ctx.email.send({ to: email, subject: `Código para redefinir a senha: ${code}`, ...body });
  } catch {
    throw new AppError(502, 'email_failed', 'Não consegui enviar o e-mail agora. Tente de novo em instantes.');
  }
  return ctx.config.exposeDevCodes ? { sent: true, devCode: code } : { sent: true };
}

/** Confere o código e troca a senha. Não entra no portal: depois é preciso entrar com a senha nova. */
export async function partnerCompleteReset(ctx: Ctx, email: string, code: string, password: string): Promise<void> {
  const problem = checkPasswordPolicy(password, email);
  if (problem) throw new AppError(422, 'weak_password', problem);
  const u = await activeUser(ctx, email);
  const r = await ctx.db.query<{ id: string; code_hash: Buffer; attempts: number }>(
    `SELECT id, code_hash, attempts FROM app.login_codes WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [email, PURPOSE],
  );
  const row = r.rows[0];
  if (!u || !row) throw new AppError(401, 'invalid_code', 'Código inválido ou vencido. Peça um novo.');
  if (row.attempts >= 5) throw new AppError(429, 'too_many_attempts', 'Muitas tentativas. Peça um novo código.');
  await ctx.db.query(`UPDATE app.login_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
  if (!safeEqual(codeHash(ctx, email, code).toString('hex'), Buffer.from(row.code_hash).toString('hex'))) throw new AppError(401, 'invalid_code', 'Código incorreto.');
  await ctx.db.tx(async (q) => {
    await q.query(`UPDATE app.login_codes SET used_at = now() WHERE id = $1`, [row.id]);
    await q.query(`UPDATE app.partner_users SET password_hash = $2 WHERE id = $1`, [u.id, hashPassword(password)]);
    await audit(q, `partner_user:${u.id}`, 'partner_password_reset_self', 'partner', u.partner_id, {});
  });
}
