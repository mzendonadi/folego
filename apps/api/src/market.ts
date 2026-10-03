// Indicadores econômicos oficiais (Banco Central, SGS), guardados no banco e relidos pelo worker a cada 12 h.
// Se a fonte cair, continua valendo o último dado, sempre mostrado com a data. Nunca inventamos número.
import type { Ctx } from './services.ts';
import { num } from './services.ts';
import type { Indicators } from './engine.ts';

export const SERIES = { selic: 432, ipca12: 13522, cdi: 4389, usd: 1 } as const;
type Code = keyof typeof SERIES;
const REFRESH_HOURS = 12;

const brDate = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export async function refreshMarket(ctx: Ctx, opts: { fetchFn?: typeof fetch; force?: boolean; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!opts.force) {
    const last = await ctx.db.query<{ fresh: boolean }>(`SELECT coalesce(max(fetched_at) > now() - make_interval(hours => ${REFRESH_HOURS}), false) AS fresh FROM app.market_indicators`);
    if (last.rows[0]?.fresh) return 0;
  }
  const f = opts.fetchFn ?? fetch;
  let saved = 0;
  for (const [code, serie] of Object.entries(SERIES) as [Code, number][]) {
    try {
      const n = code === 'usd' ? 130 : 30;
      const res = await f(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/${n}?formato=json`, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`bcb_http_${res.status}`);
      const rows = (await res.json()) as Array<{ data?: string; valor?: string }>;
      for (const r of rows) {
        const d = brDate(r.data ?? '');
        const v = Number(String(r.valor ?? '').replace(',', '.'));
        if (!d || !Number.isFinite(v)) continue;
        await ctx.db.query(`INSERT INTO app.market_indicators(code, ref_date, value) VALUES ($1,$2,$3) ON CONFLICT (code, ref_date) DO UPDATE SET value = EXCLUDED.value, fetched_at = now()`, [code, d, v]);
        saved += 1;
      }
    } catch {
      opts.log?.({ evento: 'mercado_falhou', serie: code });
    }
  }
  await ctx.db.query(`DELETE FROM app.market_indicators WHERE ref_date < current_date - 800`);
  return saved;
}

interface Point { date: string; value: number }

async function series(ctx: Ctx, code: Code, limit: number): Promise<Point[]> {
  const r = await ctx.db.query<{ ref_date: Date | string; value: string }>(`SELECT ref_date, value FROM app.market_indicators WHERE code = $1 ORDER BY ref_date DESC LIMIT $2`, [code, limit]);
  return r.rows.map((x) => ({ date: new Date(x.ref_date as string).toISOString().slice(0, 10), value: num(x.value) })).reverse();
}

/** CDI da SGS 4389 já vem anualizado (% a.a.). Selic 432 é a meta (% a.a.). */
export async function loadIndicators(ctx: Ctx): Promise<{ indicators: Indicators; updatedAt: string | null; history: Record<Code, Point[]> }> {
  const [selic, ipca, cdi, usd] = await Promise.all([series(ctx, 'selic', 400), series(ctx, 'ipca12', 14), series(ctx, 'cdi', 400), series(ctx, 'usd', 130)]);
  const last = (s: Point[]) => (s.length ? s[s.length - 1]!.value : null);
  const ago = (s: Point[], days: number) => {
    if (s.length === 0) return null;
    const target = Date.parse(`${s[s.length - 1]!.date}T00:00:00Z`) - days * 86_400_000;
    const older = [...s].reverse().find((p) => Date.parse(`${p.date}T00:00:00Z`) <= target);
    return older ? older.value : null;
  };
  const trend = (s: Point[], days: number) => {
    const a = last(s);
    const b = ago(s, days);
    return a !== null && b !== null ? Math.round((a - b) * 10000) / 10000 : null;
  };
  const upd = await ctx.db.query<{ at: Date | null }>(`SELECT max(fetched_at) AS at FROM app.market_indicators`);
  return {
    indicators: { selicPct: last(selic), ipca12Pct: last(ipca), cdiPct: last(cdi), usdBrl: last(usd), selicTrend: trend(selic, 90), ipcaTrend: trend(ipca, 90), usdTrend: trend(usd, 90) },
    updatedAt: upd.rows[0]?.at ? new Date(upd.rows[0].at).toISOString() : null,
    history: { selic: selic.filter((_, i) => i % 20 === 0 || i === selic.length - 1), ipca12: ipca, cdi: cdi.filter((_, i) => i % 20 === 0 || i === cdi.length - 1), usd: usd.filter((_, i) => i % 7 === 0 || i === usd.length - 1) },
  };
}
