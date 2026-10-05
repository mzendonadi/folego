// Contas de teste (demo): o dono liga e desliga pelo backoffice (Contas de teste).
// Ligada: o Prumo abre completo (plano Desbravador, sem cobrança) e os produtos avulsos são liberados sem Pix nem cartão.
// Desligada: volta a ser uma conta comum. O código de entrada é gerado no backoffice (não depende de caixa de e-mail).
import { randomInt } from 'node:crypto';
import { hmac } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit } from './services.ts';

const CODE_TTL_MIN = 15;
const normalize = (email: string) => email.trim().toLowerCase();

/** A sessão está entrada numa conta de teste que o dono deixou LIGADA? */
export async function isDemoSession(ctx: Ctx, sessionId: string): Promise<boolean> {
  const r = await ctx.db.query(
    `SELECT 1 FROM app.sessions se JOIN app.subscribers s ON s.id = se.subscriber_id AND s.deleted_at IS NULL
       JOIN app.demo_accounts d ON d.email = s.email AND d.active WHERE se.id = $1`,
    [sessionId],
  );
  return r.rows.length > 0;
}

/** Esta conta (por id de assinante) é de teste e está ligada? Usado para mostrar o aviso no Prumo. */
export async function isDemoSubscriber(ctx: Ctx, subscriberId: string): Promise<boolean> {
  const r = await ctx.db.query(`SELECT 1 FROM app.subscribers s JOIN app.demo_accounts d ON d.email = s.email AND d.active WHERE s.id = $1`, [subscriberId]);
  return r.rows.length > 0;
}

export async function list(ctx: Ctx) {
  const r = await ctx.db.query<{ id: string; email: string; label: string; active: boolean; created_at: Date; last_login_at: Date | null }>(
    `SELECT d.id, d.email::text AS email, d.label, d.active, d.created_at, s.last_login_at
       FROM app.demo_accounts d LEFT JOIN app.subscribers s ON s.email = d.email AND s.deleted_at IS NULL ORDER BY d.created_at`,
  );
  return {
    accounts: r.rows.map((x) => ({ id: x.id, email: x.email, label: x.label, active: x.active, createdAt: new Date(x.created_at).toISOString(), lastLoginAt: x.last_login_at ? new Date(x.last_login_at).toISOString() : null })),
  };
}

export async function create(ctx: Ctx, adminId: string, input: { email: string; label?: string | undefined }) {
  const email = normalize(input.email);
  try {
    await ctx.db.query(`INSERT INTO app.demo_accounts(email, label, active) VALUES ($1, $2, false)`, [email, (input.label ?? '').trim().slice(0, 80)]);
  } catch (e) {
    if (e instanceof Error && /duplicate key|demo_accounts_email_key/i.test(e.message)) throw new AppError(409, 'duplicate', 'Esta conta de teste já existe.');
    throw e;
  }
  await audit(ctx.db, `admin:${adminId}`, 'demo_account_created', 'demo_account', email, {});
  return { ok: true };
}

/** Liga ou desliga. Ligar cria a conta (se preciso) e dá o plano Desbravador por 10 anos; desligar encerra o plano na hora. */
export async function setActive(ctx: Ctx, adminId: string, id: string, active: boolean) {
  await ctx.db.tx(async (q) => {
    const d = await q.query<{ email: string }>(`UPDATE app.demo_accounts SET active = $2 WHERE id = $1 RETURNING email::text AS email`, [id, active]);
    const row = d.rows[0];
    if (!row) throw notFound();
    const s = await q.query<{ id: string }>(`INSERT INTO app.subscribers(email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET deleted_at = NULL RETURNING id`, [row.email]);
    const subscriberId = s.rows[0]!.id;
    if (active) {
      await q.query(
        `INSERT INTO app.subscriptions(subscriber_id, plan, status, current_period_end) VALUES ($1, 'desbravador', 'active', now() + interval '10 years')
         ON CONFLICT (subscriber_id) DO UPDATE SET plan = 'desbravador', status = 'active', cancel_at_period_end = false, current_period_end = now() + interval '10 years'`,
        [subscriberId],
      );
    } else {
      await q.query(`UPDATE app.subscriptions SET status = 'expired', current_period_end = now() WHERE subscriber_id = $1`, [subscriberId]);
    }
    await audit(q, `admin:${adminId}`, active ? 'demo_account_on' : 'demo_account_off', 'demo_account', id, {});
  });
  return { ok: true };
}

/** Gera um código de entrada (vale 15 minutos), mostrado uma única vez ao dono. */
export async function issueCode(ctx: Ctx, adminId: string, id: string) {
  const d = await ctx.db.query<{ email: string; active: boolean }>(`SELECT email::text AS email, active FROM app.demo_accounts WHERE id = $1`, [id]);
  const row = d.rows[0];
  if (!row) throw notFound();
  if (!row.active) throw new AppError(409, 'demo_off', 'Ligue a conta de teste antes de gerar o código.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ctx.db.query(`UPDATE app.login_codes SET used_at = now() WHERE email = $1 AND used_at IS NULL`, [row.email]);
  await ctx.db.query(`INSERT INTO app.login_codes(email, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => ${CODE_TTL_MIN}))`, [row.email, hmac(ctx.config.secret, `login:${row.email}:${code}`)]);
  await audit(ctx.db, `admin:${adminId}`, 'demo_code_issued', 'demo_account', id, {});
  return { email: row.email, code, minutes: CODE_TTL_MIN };
}

export async function remove(ctx: Ctx, adminId: string, id: string) {
  await setActive(ctx, adminId, id, false);
  const r = await ctx.db.query(`DELETE FROM app.demo_accounts WHERE id = $1`, [id]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, `admin:${adminId}`, 'demo_account_removed', 'demo_account', id, {});
  return { ok: true };
}
