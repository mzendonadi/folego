// Acessos de 30 dias dos produtos pagos no Pix: quem tem acesso, até quando, quantas vezes refez, e o controle do dono
// (prorrogar ou encerrar). O prazo padrão de cada produto é definido em "Produtos e preços" (dias de acesso).
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';

const PAGE = 25;
const iso = (d: unknown): string => new Date(d as string).toISOString();

export type AccessFilter = 'ativos' | 'vencendo' | 'vencidos' | 'todos';

export async function overview(ctx: Ctx, o: { filter?: AccessFilter | undefined; product?: string | undefined; page?: number | undefined }) {
  const page = Math.max(0, Math.floor(o.page ?? 0));
  const params: unknown[] = [];
  const where: string[] = [`c.status <> 'purged'`];
  if (o.filter === 'ativos') where.push(`e.expires_at > now()`);
  else if (o.filter === 'vencendo') where.push(`e.expires_at > now() AND e.expires_at <= now() + interval '7 days'`);
  else if (o.filter === 'vencidos') where.push(`e.expires_at <= now()`);
  if (o.product) {
    params.push(o.product);
    where.push(`e.product_code = $${params.length}`);
  }
  const base = `FROM app.entitlements e JOIN app.cases c ON c.id = e.case_id JOIN app.products p ON p.code = e.product_code WHERE ${where.join(' AND ')}`;
  const total = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n ${base}`, params);
  const r = await ctx.db.query<{ id: string; case_id: string; order_id: string; product_code: string; name: string; granted_at: Date; expires_at: Date; redo_count: number; last_redo_at: Date | null; extended_days: number; days_left: string }>(
    `SELECT e.id, e.case_id, e.order_id, e.product_code, p.name, e.granted_at, e.expires_at, e.redo_count, e.last_redo_at, e.extended_days,
            ceil(extract(epoch FROM (e.expires_at - now())) / 86400.0)::text AS days_left
       ${base} ORDER BY e.expires_at DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`,
    params,
  );
  const k = await ctx.db.query<{ active: string; soon: string; expired: string; redos: string }>(
    `SELECT count(*) FILTER (WHERE e.expires_at > now())::text AS active,
            count(*) FILTER (WHERE e.expires_at > now() AND e.expires_at <= now() + interval '7 days')::text AS soon,
            count(*) FILTER (WHERE e.expires_at <= now())::text AS expired,
            coalesce(sum(e.redo_count), 0)::text AS redos
       FROM app.entitlements e JOIN app.cases c ON c.id = e.case_id WHERE c.status <> 'purged'`,
  );
  const kk = k.rows[0];
  return {
    total: num(total.rows[0]?.n ?? 0),
    pageSize: PAGE,
    summary: { active: num(kk?.active ?? 0), expiringSoon: num(kk?.soon ?? 0), expired: num(kk?.expired ?? 0), redos: num(kk?.redos ?? 0) },
    items: r.rows.map((x) => ({
      id: x.id,
      caseId: x.case_id,
      orderId: x.order_id,
      productCode: x.product_code,
      product: x.name,
      grantedAt: iso(x.granted_at),
      expiresAt: iso(x.expires_at),
      daysLeft: Math.max(0, num(x.days_left)),
      expired: new Date(x.expires_at).getTime() <= Date.now(),
      redoCount: x.redo_count,
      lastRedoAt: x.last_redo_at ? iso(x.last_redo_at) : null,
      extendedDays: x.extended_days,
    })),
  };
}

/** Prorroga o acesso: soma os dias a partir de hoje (se já venceu) ou da data final atual. Também adia a eliminação dos dados. */
export async function extend(ctx: Ctx, adminId: string, id: string, days: number) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError(422, 'invalid_days', 'Dias a somar: de 1 a 365.');
  await ctx.db.tx(async (q) => {
    const r = await q.query<{ case_id: string; expires_at: Date }>(
      `UPDATE app.entitlements SET expires_at = greatest(expires_at, now()) + make_interval(days => $2), extended_days = extended_days + $2
        WHERE id = $1 RETURNING case_id, expires_at`,
      [id, days],
    );
    const row = r.rows[0];
    if (!row) throw notFound();
    await q.query(`UPDATE app.cases SET purge_after = greatest(purge_after, $2::timestamptz + interval '1 day') WHERE id = $1`, [row.case_id, row.expires_at]);
    await audit(q, `admin:${adminId}`, 'admin_access_extended', 'entitlement', id, { days });
  });
  return { ok: true };
}

/** Encerra o acesso agora (o conteúdo continua guardado até o prazo de eliminação). */
export async function endNow(ctx: Ctx, adminId: string, id: string) {
  const r = await ctx.db.query(`UPDATE app.entitlements SET expires_at = now() WHERE id = $1`, [id]);
  if (!r.rowCount) throw notFound();
  await audit(ctx.db, `admin:${adminId}`, 'admin_access_ended', 'entitlement', id);
  return { ok: true };
}
