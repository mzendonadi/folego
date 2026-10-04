// Detector de cobranças recorrentes: acha, nos lançamentos da pessoa, o que se repete (assinaturas, mensalidades, anuidades),
// avisa de aumento de preço e de cobrança em duplicidade. Cálculo puro, centavos inteiros; não conhece banco nem rede.

import { categorize } from './account.ts';

export interface RecurringEntry {
  date: string; // yyyy-mm-dd
  amountCents: number; // negativo = gasto
  note: string;
}

export type Cadence = 'mensal' | 'anual';

export interface RecurringItem {
  key: string; // identificador estável do estabelecimento (usado para marcar "vou cancelar")
  name: string;
  cadence: Cadence;
  occurrences: number;
  lastDate: string;
  lastCents: number; // valor positivo da última cobrança
  typicalCents: number; // mediana das cobranças anteriores
  monthlyCents: number; // custo por mês equivalente
  yearlyCents: number;
  nextExpected: string;
  priceChange: { fromCents: number; toCents: number; pct: number; since: string } | null;
  duplicate: { date: string; cents: number } | null;
}

export interface RecurringReport {
  items: RecurringItem[];
  monthlyTotalCents: number;
  yearlyTotalCents: number;
  priceIncreases: RecurringItem[];
  duplicates: RecurringItem[];
}

const NOISE = new Set(['COMPRA', 'PIX', 'DEBITO', 'CREDITO', 'CARTAO', 'PAGAMENTO', 'PAG', 'PARC', 'PARCELA', 'ENVIADO', 'RECEBIDO', 'TRANSF', 'TRANSFERENCIA', 'DE', 'DA', 'DO', 'EM', 'NO', 'NA', 'A', 'O', 'E', 'COM', 'PARA', 'LTDA', 'SA', 'ME', 'BR', 'COM.BR', 'ONLINE', 'APP', 'WWW', 'COBRANCA', 'DEB', 'AUT', 'AUTOMATICO', 'MENSALIDADE', 'ASSINATURA', 'REF']);

/** "NETFLIX.COM 12/09 *4421" -> "NETFLIX". Mesmo estabelecimento, mesma chave. */
export function merchantKey(note: string): string {
  const base = note
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\d+[/.\-]\d+([/.\-]\d+)?/g, ' ')
    .replace(/[*#_@]+/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\b\d+\b/g, ' ');
  const tokens = base.split(/\s+/).filter((t) => t.length > 1 && !NOISE.has(t));
  return tokens.slice(0, 2).join(' ');
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function detectRecurring(entries: RecurringEntry[], today: string): RecurringReport {
  const groups = new Map<string, RecurringEntry[]>();
  for (const e of entries) {
    if (e.amountCents >= 0) continue;
    const key = merchantKey(e.note);
    if (key.length < 3) continue;
    // consumo variável (mercado, comida, transporte por app) não é assinatura: gera ruído e tira a confiança do detector
    const cat = categorize(e.note, e.amountCents);
    if (cat === 'mercado' || cat === 'transporte') continue;
    const g = groups.get(key) ?? [];
    g.push(e);
    groups.set(key, g);
  }
  const items: RecurringItem[] = [];
  for (const [key, g] of groups) {
    const list = [...g].sort((a, b) => a.date.localeCompare(b.date));
    // uma cobrança por mês-estabelecimento (o mesmo dia repetido por importação dupla não conta como outro mês)
    const distinct: RecurringEntry[] = [];
    for (const e of list) {
      const prev = distinct[distinct.length - 1];
      if (prev && e.date.slice(0, 7) === prev.date.slice(0, 7)) continue;
      distinct.push(e);
    }
    if (distinct.length < 2) continue;
    const gaps = distinct.slice(1).map((e, i) => days(distinct[i]!.date, e.date));
    const monthly = gaps.filter((d) => d >= 24 && d <= 38).length;
    const yearly = gaps.filter((d) => d >= 340 && d <= 390).length;
    let cadence: Cadence | null = null;
    if (distinct.length >= 3 && monthly >= Math.ceil(gaps.length * 0.7)) cadence = 'mensal';
    else if (distinct.length === 2 && monthly === 1 && Math.abs(Math.abs(distinct[0]!.amountCents) - Math.abs(distinct[1]!.amountCents)) <= Math.abs(distinct[0]!.amountCents) * 0.1) cadence = 'mensal';
    else if (yearly >= 1) cadence = 'anual';
    if (!cadence) continue;
    const amounts = distinct.map((e) => Math.abs(e.amountCents));
    // cobrança fixa tem valor estável; valor que oscila muito (mais de 20% entre as anteriores) é consumo, não assinatura
    if (cadence === 'mensal' && distinct.length >= 3) {
      const before = amounts.slice(0, -1);
      const mid = median(before);
      if (before.some((v) => Math.abs(v - mid) > mid * 0.2)) continue;
    }
    const last = distinct[distinct.length - 1]!;
    const lastCents = Math.abs(last.amountCents);
    const previous = amounts.slice(0, -1);
    const typical = median(previous.length ? previous : amounts);
    const rise = lastCents - typical;
    const priceChange = previous.length >= 2 && rise >= 100 && rise / typical >= 0.03
      ? { fromCents: typical, toCents: lastCents, pct: Math.round((rise / typical) * 100), since: last.date }
      : null;
    // duplicidade: duas cobranças iguais do mesmo estabelecimento em até 5 dias (inclusive no MESMO dia), no mês mais recente.
    // A importação de extrato já descarta linhas repetidas, então duas iguais no mesmo dia são, de fato, cobradas duas vezes.
    let duplicate: RecurringItem['duplicate'] = null;
    const recent = list.filter((e) => days(e.date, today) <= 70);
    for (let i = 1; i < recent.length && !duplicate; i += 1) {
      const a = recent[i - 1]!;
      const b = recent[i]!;
      if (a.amountCents === b.amountCents && days(a.date, b.date) <= 5) duplicate = { date: b.date, cents: Math.abs(b.amountCents) };
    }
    const monthlyCents = cadence === 'mensal' ? lastCents : Math.round(lastCents / 12);
    const step = cadence === 'mensal' ? 30 : 365;
    let next = addDays(last.date, step);
    while (days(next, today) > 15) next = addDays(next, step); // atrasou: projeta a próxima à frente
    items.push({
      key,
      name: key.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' '),
      cadence,
      occurrences: distinct.length,
      lastDate: last.date,
      lastCents,
      typicalCents: typical,
      monthlyCents,
      yearlyCents: cadence === 'mensal' ? lastCents * 12 : lastCents,
      nextExpected: next,
      priceChange,
      duplicate,
    });
  }
  // só mostra o que ainda está vivo (cobrou nos últimos ~2 ciclos)
  const alive = items.filter((i) => days(i.lastDate, today) <= (i.cadence === 'mensal' ? 75 : 400));
  alive.sort((a, b) => b.monthlyCents - a.monthlyCents);
  return {
    items: alive,
    monthlyTotalCents: alive.reduce((s, i) => s + i.monthlyCents, 0),
    yearlyTotalCents: alive.reduce((s, i) => s + i.yearlyCents, 0),
    priceIncreases: alive.filter((i) => i.priceChange),
    duplicates: alive.filter((i) => i.duplicate),
  };
}
