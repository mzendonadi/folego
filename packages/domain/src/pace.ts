// Ritmo do mês: quanto a pessoa gastou até hoje, comparado ao mês anterior no mesmo ponto, o gasto de cada dia (mapa de calor)
// e o maior gasto. Cálculo puro sobre os lançamentos; centavos inteiros.
export interface PaceEntry {
  date: string; // YYYY-MM-DD
  amountCents: number; // negativo = gasto
  note: string;
}

export interface Pace {
  month: string;
  daysInMonth: number;
  /** Quantos dias do mês já contam: até hoje no mês corrente; o mês todo nos meses passados. */
  daysCounted: number;
  /** Gasto de cada dia do mês (centavos, positivo). Dias que ainda não chegaram ficam em 0. */
  spendByDay: number[];
  cumulative: number[];
  /** Gasto acumulado do mês anterior, dia a dia (mês inteiro). */
  previousCumulative: number[];
  spentSoFarCents: number;
  previousSameDayCents: number;
  /** Diferença percentual contra o mês anterior no mesmo dia; null se o mês anterior não tem gasto. */
  diffPct: number | null;
  /** Estimativa de fechar o mês no ritmo atual; só no mês corrente e depois de 5 dias de dados. */
  projectionCents: number | null;
  biggest: { note: string; amountCents: number; date: string } | null;
}

const daysIn = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const prevMonth = (month: string): string => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

function spendPerDay(entries: PaceEntry[], month: string): number[] {
  const out = new Array<number>(daysIn(month)).fill(0);
  for (const e of entries) {
    if (e.amountCents >= 0 || !e.date.startsWith(month)) continue;
    const d = Number(e.date.slice(8, 10));
    if (d >= 1 && d <= out.length) out[d - 1]! += -e.amountCents;
  }
  return out;
}
const accumulate = (v: number[]): number[] => { let s = 0; return v.map((x) => (s += x)); };

/** `today` é a data de hoje em Brasília (YYYY-MM-DD). */
export function buildPace(entries: PaceEntry[], month: string, today: string): Pace {
  const total = daysIn(month);
  const current = today.startsWith(month);
  const daysCounted = current ? Math.min(Number(today.slice(8, 10)), total) : today > `${month}-31` ? total : 0;
  const perDay = spendPerDay(entries, month).map((v, i) => (i < daysCounted ? v : 0));
  const cum = accumulate(perDay).slice(0, daysCounted);
  const prevCum = accumulate(spendPerDay(entries, prevMonth(month)));
  const spent = cum[daysCounted - 1] ?? 0;
  const prevSame = daysCounted > 0 ? (prevCum[Math.min(daysCounted, prevCum.length) - 1] ?? 0) : 0;
  let biggest: Pace['biggest'] = null;
  for (const e of entries) {
    if (e.amountCents >= 0 || !e.date.startsWith(month) || Number(e.date.slice(8, 10)) > daysCounted) continue;
    if (!biggest || -e.amountCents > -biggest.amountCents) biggest = { note: e.note, amountCents: e.amountCents, date: e.date };
  }
  return {
    month, daysInMonth: total, daysCounted, spendByDay: perDay, cumulative: cum, previousCumulative: prevCum,
    spentSoFarCents: spent, previousSameDayCents: prevSame,
    diffPct: prevSame > 0 ? Math.round(((spent - prevSame) / prevSame) * 100) : null,
    projectionCents: current && daysCounted >= 5 ? Math.round((spent / daysCounted) * total) : null,
    biggest,
  };
}
