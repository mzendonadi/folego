// Euro no Cenário econômico: a série 21619 do Banco Central entra como o dólar, com plano B se ela falhar. Fontes simuladas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import { loadIndicators, refreshMarket, SERIES } from '../src/market.ts';
import type { Ctx } from '../src/services.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('euro: entra pela série do Banco Central e aparece nos indicadores com variação e histórico', async () => {
  assert.equal(SERIES.eur, 21619);
  const db = await createPgliteDb();
  await ensureSchema(db);
  const ctx = { db, config: loadConfig({ NODE_ENV: 'test' }) } as unknown as Ctx;
  const day = (n: number) => { const d = new Date(Date.now() - n * 86_400_000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('sgs.21619')) return json([{ data: day(100), valor: '6.0000' }, { data: day(1), valor: '6.2500' }]);
    if (u.includes('sgs.1/')) return json([{ data: day(100), valor: '5.1000' }, { data: day(1), valor: '5.4000' }]);
    return json({}, 500);
  }) as typeof fetch;
  await refreshMarket(ctx, { fetchFn, force: true });
  assert.ok(calls.some((u) => u.includes('sgs.21619')), 'pediu o euro ao Banco Central');
  const m = await loadIndicators(ctx);
  assert.equal(m.indicators.eurBrl, 6.25);
  assert.equal(m.indicators.usdBrl, 5.4);
  assert.equal(m.indicators.eurTrend, 0.25, 'subiu R$ 0,25 em ~3 meses');
  assert.ok(m.history.eur.length >= 1);
  await db.close();
});

test('euro: se o Banco Central não responde, usa o plano B (Frankfurter) com a base em euro', async () => {
  const db = await createPgliteDb();
  await ensureSchema(db);
  const ctx = { db, config: loadConfig({ NODE_ENV: 'test' }) } as unknown as Ctx;
  const urls: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('api.frankfurter.dev') && u.includes('base=EUR')) return json({ rates: { '2026-10-20': { BRL: 6.3 }, '2026-10-24': { BRL: 6.31 } } });
    return json({}, 500);
  }) as typeof fetch;
  const saved = await refreshMarket(ctx, { fetchFn, force: true });
  assert.ok(saved >= 2);
  assert.ok(urls.some((u) => u.includes('base=EUR')));
  assert.equal((await loadIndicators(ctx)).indicators.eurBrl, 6.31);
  await db.close();
});
