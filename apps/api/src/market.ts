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

const fmtBr = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

/** Uma série do SGS: tenta "últimos N" e, se o Banco Central recusar, a consulta por intervalo de datas. */
async function fetchSeries(f: typeof fetch, serie: number, last: number, days: number): Promise<Array<{ data?: string; valor?: string }>> {
  const headers = { accept: 'application/json', 'user-agent': 'Folego/1.0 (+https://folego.online)' };
  const base = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados`;
  const urls = [`${base}/ultimos/${last}?formato=json`, `${base}?formato=json&dataInicial=${fmtBr(new Date(Date.now() - days * 86_400_000))}&dataFinal=${fmtBr(new Date())}`];
  let lastError = 'bcb_sem_resposta';
  for (const url of urls) {
    try {
      const res = await f(url, { signal: AbortSignal.timeout(15_000), headers });
      if (!res.ok) {
        lastError = `bcb_http_${res.status}`;
        continue;
      }
      const rows = (await res.json()) as Array<{ data?: string; valor?: string }>;
      if (Array.isArray(rows) && rows.length > 0) return rows;
      lastError = 'bcb_vazio';
    } catch (e) {
      lastError = `bcb_rede: ${reason(e)}`;
    }
  }
  throw new Error(lastError);
}

export interface MarketRun {
  saved: number;
  errors: Record<string, string>;
  at: string;
}

async function saveStatus(ctx: Ctx, run: MarketRun): Promise<void> {
  try {
    await ctx.db.query(
      `INSERT INTO app.settings(key, value) VALUES ('market_status', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(run)],
    );
  } catch {
    /* diagnóstico é opcional */
  }
}

export async function marketStatus(ctx: Ctx): Promise<MarketRun | null> {
  const r = await ctx.db.query<{ value: MarketRun }>(`SELECT value FROM app.settings WHERE key = 'market_status'`).catch(() => ({ rows: [] as { value: MarketRun }[] }));
  return r.rows[0]?.value ?? null;
}

type Row = { date: string; value: number };

const spToday = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const reason = (e: unknown) => {
  if (!(e instanceof Error)) return 'erro';
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  return `${e.message.slice(0, 60)}${cause?.code ? ` [${cause.code}]` : cause?.message ? ` [${cause.message.slice(0, 50)}]` : ''}`;
};

/** Banco Central (SGS): fonte oficial. */
async function viaBcb(f: typeof fetch, serie: number, last: number, days: number): Promise<Row[]> {
  const rows = await fetchSeries(f, serie, last, days);
  return rows.flatMap((r) => {
    const d = brDate(r.data ?? '');
    const v = Number(String(r.valor ?? '').replace(',', '.'));
    return d && Number.isFinite(v) ? [{ date: d, value: v }] : [];
  });
}

/** BrasilAPI (espelha Selic e CDI do Banco Central): só o valor de hoje. */
async function viaBrasilApi(f: typeof fetch, nome: 'Selic' | 'CDI'): Promise<Row[]> {
  const res = await f('https://brasilapi.com.br/api/taxas/v1', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': 'Folego/1.0' } });
  if (!res.ok) throw new Error(`brasilapi_http_${res.status}`);
  const list = (await res.json()) as Array<{ nome?: string; valor?: number }>;
  const item = list.find((x) => x.nome === nome);
  if (!item || typeof item.valor !== 'number') throw new Error('brasilapi_sem_' + nome);
  return [{ date: spToday(), value: item.valor }];
}

/** IBGE (SIDRA): IPCA acumulado em 12 meses, uma linha por mês. */
async function viaIbge(f: typeof fetch): Promise<Row[]> {
  const res = await f('https://servicodados.ibge.gov.br/api/v3/agregados/1737/periodos/-14/variaveis/2265?localidades=N1[all]', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': 'Folego/1.0' } });
  if (!res.ok) throw new Error(`ibge_http_${res.status}`);
  const body = (await res.json()) as Array<{ resultados?: Array<{ series?: Array<{ serie?: Record<string, string> }> }> }>;
  const serie = body[0]?.resultados?.[0]?.series?.[0]?.serie ?? {};
  return Object.entries(serie).flatMap(([ym, v]) => {
    const value = Number(v);
    return /^\d{6}$/.test(ym) && Number.isFinite(value) ? [{ date: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01`, value }] : [];
  });
}

/** AwesomeAPI: dólar comercial, um valor por dia. */
async function viaAwesome(f: typeof fetch): Promise<Row[]> {
  const res = await f('https://economia.awesomeapi.com.br/json/daily/USD-BRL/60', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': 'Folego/1.0' } });
  if (!res.ok) throw new Error(`awesome_http_${res.status}`);
  const list = (await res.json()) as Array<{ bid?: string; timestamp?: string }>;
  const byDay = new Map<string, number>();
  for (const x of list) {
    const v = Number(x.bid);
    const t = Number(x.timestamp);
    if (Number.isFinite(v) && Number.isFinite(t)) byDay.set(new Date(t * 1000 - 3 * 3_600_000).toISOString().slice(0, 10), v);
  }
  return [...byDay.entries()].map(([date, value]) => ({ date, value }));
}

/** Frankfurter (taxas de referência do Banco Central Europeu): dólar em reais, um valor por dia útil. */
async function viaFrankfurter(f: typeof fetch): Promise<Row[]> {
  const from = new Date(Date.now() - 200 * 86_400_000).toISOString().slice(0, 10);
  const res = await f(`https://api.frankfurter.dev/v1/${from}..?base=USD&symbols=BRL`, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': 'Folego/1.0' } });
  if (!res.ok) throw new Error(`frankfurter_http_${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, { BRL?: number }> };
  return Object.entries(body.rates ?? {}).flatMap(([date, r]) => (typeof r.BRL === 'number' ? [{ date, value: r.BRL }] : []));
}

/** open.er-api.com: só o valor de hoje (último recurso para o dólar). */
async function viaErApi(f: typeof fetch): Promise<Row[]> {
  const res = await f('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', 'user-agent': 'Folego/1.0' } });
  if (!res.ok) throw new Error(`erapi_http_${res.status}`);
  const body = (await res.json()) as { rates?: { BRL?: number } };
  if (typeof body.rates?.BRL !== 'number') throw new Error('erapi_sem_brl');
  return [{ date: spToday(), value: body.rates.BRL }];
}

/**
 * Cada série é independente e tem plano B: o Banco Central é a fonte oficial; se ele não responder (rede, certificado ou
 * bloqueio do provedor da VPS), usamos o espelho público equivalente. `errors` guarda o motivo de cada tentativa.
 */
export async function refreshMarket(ctx: Ctx, opts: { fetchFn?: typeof fetch; force?: boolean; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!opts.force) {
    // "Fresco" = todas as séries têm dado recente; se alguma faltar, tenta de novo (no máximo a cada 30 min).
    const last = await ctx.db.query<{ n: string; fresh: string }>(`SELECT count(DISTINCT code)::text AS n, count(DISTINCT code) FILTER (WHERE fetched_at > now() - make_interval(hours => ${REFRESH_HOURS}))::text AS fresh FROM app.market_indicators`);
    if (num(last.rows[0]?.fresh ?? 0) >= Object.keys(SERIES).length) return 0;
    const st = await marketStatus(ctx);
    if (st && Date.now() - Date.parse(st.at) < 30 * 60_000 && num(last.rows[0]?.n ?? 0) > 0) return 0;
  }
  const f = opts.fetchFn ?? fetch;
  const run: MarketRun = { saved: 0, errors: {}, at: new Date().toISOString() };
  let bcbDown = false; // se o Banco Central nem responde pela rede, não perdemos tempo com as outras séries dele
  const plans: Record<Code, Array<[string, () => Promise<Row[]>]>> = {
    selic: [['bcb', () => viaBcb(f, SERIES.selic, 30, 400)], ['brasilapi', () => viaBrasilApi(f, 'Selic')]],
    cdi: [['bcb', () => viaBcb(f, SERIES.cdi, 30, 400)], ['brasilapi', () => viaBrasilApi(f, 'CDI')]],
    ipca12: [['bcb', () => viaBcb(f, SERIES.ipca12, 14, 800)], ['ibge', () => viaIbge(f)]],
    usd: [['bcb', () => viaBcb(f, SERIES.usd, 130, 200)], ['frankfurter', () => viaFrankfurter(f)], ['awesomeapi', () => viaAwesome(f)], ['er-api', () => viaErApi(f)]],
  };
  for (const code of Object.keys(plans) as Code[]) {
    const tried: string[] = [];
    let ok = false;
    for (const [name, get] of plans[code]) {
      if (name === 'bcb' && bcbDown) {
        tried.push('bcb: pulado (sem rede)');
        continue;
      }
      try {
        const rows = await get();
        let any = 0;
        for (const r of rows) {
          await ctx.db.query(`INSERT INTO app.market_indicators(code, ref_date, value) VALUES ($1,$2,$3) ON CONFLICT (code, ref_date) DO UPDATE SET value = EXCLUDED.value, fetched_at = now()`, [code, r.date, r.value]);
          any += 1;
        }
        if (any === 0) throw new Error('formato_inesperado');
        run.saved += any;
        ok = true;
        break;
      } catch (e) {
        const why = reason(e);
        tried.push(`${name}: ${why}`);
        if (name === 'bcb' && /bcb_rede/.test(why)) bcbDown = true;
      }
    }
    if (!ok) {
      run.errors[code] = tried.join(' · ');
      opts.log?.({ evento: 'mercado_falhou', serie: code, motivo: run.errors[code] });
    }
  }
  await ctx.db.query(`DELETE FROM app.market_indicators WHERE ref_date < current_date - 800`);
  await saveStatus(ctx, run);
  return run.saved;
}

let lastLazy = 0;
/** Chamado pela API quando alguém abre o Cenário econômico e ainda não há dado (ou ele está velho): não depende só do worker. */
export async function refreshIfNeeded(ctx: Ctx): Promise<void> {
  const r = await ctx.db.query<{ n: string; fresh: string }>(`SELECT count(DISTINCT code)::text AS n, count(DISTINCT code) FILTER (WHERE fetched_at > now() - interval '36 hours')::text AS fresh FROM app.market_indicators`);
  if (num(r.rows[0]?.fresh ?? 0) >= 3) return;
  if (Date.now() - lastLazy < 5 * 60_000) return;
  lastLazy = Date.now();
  await refreshMarket(ctx, { force: true });
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
