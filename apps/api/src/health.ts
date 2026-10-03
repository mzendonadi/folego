// Saúde do sistema para o monitoramento externo (GitHub Actions a cada 10 min) e para o backoffice.
// Só devolve verdadeiro/falso e contagens: nada sensível. Em desenvolvimento/teste, o que depende do servidor (worker, backup, disco) é ignorado.
import { statfs } from 'node:fs/promises';
import type { Ctx } from './services.ts';
import { num } from './services.ts';

export interface Check {
  ok: boolean;
  detail: string;
}
export interface Health {
  ok: boolean;
  at: string;
  checks: Record<string, Check>;
}

const ageMin = (iso: unknown) => (iso ? (Date.now() - Date.parse(String(iso))) / 60_000 : Infinity);

async function setting<T>(ctx: Ctx, key: string): Promise<T | null> {
  const r = await ctx.db.query<{ value: T }>(`SELECT value FROM app.settings WHERE key = $1`, [key]).catch(() => ({ rows: [] as { value: T }[] }));
  return r.rows[0]?.value ?? null;
}

/** O worker chama a cada ~30 s: se o batimento para, o monitor avisa. */
export async function workerBeat(ctx: Ctx): Promise<void> {
  await ctx.db.query(`INSERT INTO app.settings(key, value) VALUES ('worker_heartbeat', jsonb_build_object('at', now())) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`).catch(() => undefined);
}

export async function deepHealth(ctx: Ctx): Promise<Health> {
  const prod = ctx.config.env === 'production';
  const checks: Record<string, Check> = {};
  try {
    await ctx.db.query('SELECT 1');
    checks.banco = { ok: true, detail: 'responde' };
  } catch {
    checks.banco = { ok: false, detail: 'sem resposta' };
    return { ok: false, at: new Date().toISOString(), checks };
  }
  const beat = await setting<{ at: string }>(ctx, 'worker_heartbeat');
  const beatAge = ageMin(beat?.at);
  checks.worker = prod ? { ok: beatAge < 4, detail: Number.isFinite(beatAge) ? `último sinal há ${Math.round(beatAge)} min` : 'nunca deu sinal' } : { ok: true, detail: 'ignorado fora de produção' };
  const stuck = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.deliverables WHERE product_code IN ('negotiation_scripts', 'defense_letters', 'extra_income_plan') AND status IN ('pending','generating') AND created_at < now() - interval '15 minutes' AND updated_at < now() - interval '15 minutes'`);
  checks.fila = { ok: num(stuck.rows[0]?.n ?? 0) === 0, detail: `${num(stuck.rows[0]?.n ?? 0)} entrega(s) parada(s) há mais de 15 min` };
  const hooks = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.payment_events WHERE processed_at IS NULL AND received_at < now() - interval '10 minutes'`).catch(() => ({ rows: [{ n: '0' }] }));
  checks.webhooks = { ok: num(hooks.rows[0]?.n ?? 0) === 0, detail: `${num(hooks.rows[0]?.n ?? 0)} evento(s) de pagamento sem processar há mais de 10 min` };
  const gifts = await ctx.db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM app.subscribers b JOIN app.subscriptions s ON s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now()
      WHERE b.deleted_at IS NULL AND b.ebook_sent_at IS NULL AND s.plan IN ('ousado','desbravador') AND s.updated_at < now() - interval '30 minutes'`,
  ).catch(() => ({ rows: [{ n: '0' }] }));
  checks.ebook = { ok: !ctx.config.email || num(gifts.rows[0]?.n ?? 0) === 0, detail: ctx.config.email ? `${num(gifts.rows[0]?.n ?? 0)} presente(s) esperando há mais de 30 min` : 'e-mail não configurado' };
  const bk = await setting<{ at: string; bytes?: number }>(ctx, 'last_backup');
  const bkAge = ageMin(bk?.at);
  checks.backup = prod ? { ok: bkAge < 36 * 60, detail: Number.isFinite(bkAge) ? `último backup há ${Math.round(bkAge / 60)} h` : 'nenhum backup registrado' } : { ok: true, detail: 'ignorado fora de produção' };
  try {
    const st = await statfs('/');
    const free = (Number(st.bavail) / Number(st.blocks)) * 100;
    checks.disco = { ok: !prod || free >= 15, detail: `${free.toFixed(0)}% livre` };
  } catch {
    checks.disco = { ok: true, detail: 'não medido' };
  }
  return { ok: Object.values(checks).every((c) => c.ok), at: new Date().toISOString(), checks };
}
