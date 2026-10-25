// Lançar rápido: transforma uma frase ("almoço 45 no débito", "recebi 1.200 de salário ontem") ou o texto lido de um
// comprovante em um lançamento. Roda no navegador (digitado, falado ou foto) e no servidor (WhatsApp), com a mesma regra.
// Não adivinha o que não sabe: sem valor, devolve null e a tela pede para a pessoa digitar.
import type { Category } from './account.ts';
import { categorize, parseDateAny } from './account.ts';

export interface QuickEntry {
  date: string; // YYYY-MM-DD
  amountCents: number; // negativo = gasto, positivo = entrada
  note: string;
  category: Category;
}

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAX_CENTS = 100_000_000_00;

const INCOME = /\b(recebi|recebimento|recebido|ganhei|salario|entrou|entrada|vendi|venda|deposito|depositaram|reembolso|rendimento|pro.?labore|13o|ferias)\b/;
const VERBS = /^(?:(?:eu\s+)?(?:gastei|paguei|comprei|gasto|despesa|lancei|lancar|lanca|lance|coloca|coloque|anota|anote|registra|registre|registrar|adiciona|adicione|recebi|ganhei|vendi|foi|deu|saiu|custou)\s+)+/;
const FILLER_START = /^(?:(?:no|na|nos|nas|em|de|do|da|dos|das|com|pro|pra|para|por|um|uma|o|a|e)\s+)+/;

const MONTH_NAMES: Record<string, number> = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

const isoOf = (y: number, m: number, d: number): string | null => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
const addDays = (iso: string, delta: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

interface Hit { start: number; end: number }

/** Valor em centavos de "45", "45,90", "1.234,56", "45.90" ou "R$ 45". */
function centsOf(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.234 = mil duzentos e trinta e quatro
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** Data dita na frase, e o trecho dela (para não confundir "dia 12" com valor). `t` já vem sem acento e em minúsculas. */
function findDate(t: string, today: string): { date: string; hit: Hit } | null {
  let m = /\b(anteontem)\b/.exec(t);
  if (m) return { date: addDays(today, -2), hit: { start: m.index, end: m.index + m[0].length } };
  m = /\b(ontem)\b/.exec(t);
  if (m) return { date: addDays(today, -1), hit: { start: m.index, end: m.index + m[0].length } };
  m = /\b(hoje)\b/.exec(t);
  if (m) return { date: today, hit: { start: m.index, end: m.index + m[0].length } };
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m) {
    const year = Number(today.slice(0, 4));
    let d = parseDateAny(m[3] ? m[0] : `${m[1]}/${m[2]}/${year}`);
    if (d && !m[3] && d > today) d = parseDateAny(`${m[1]}/${m[2]}/${year - 1}`); // "28/12" dito em janeiro é do ano passado
    if (d) return { date: d, hit: { start: m.index, end: m.index + m[0].length } };
  }
  m = /\bdia\s+(\d{1,2})(?:\s+de\s+([a-z]+))?\b/.exec(t);
  if (m) {
    const day = Number(m[1]);
    const year = Number(today.slice(0, 4));
    const tm = Number(today.slice(5, 7));
    const month = m[2] && MONTH_NAMES[m[2]] ? MONTH_NAMES[m[2]]! : tm;
    let d = isoOf(year, month, day);
    if (d && d > today) d = month === 1 ? isoOf(year - 1, 12, day) : isoOf(year, month - 1, day); // "dia 28" dito no dia 3 é do mês passado
    if (d) return { date: d, hit: { start: m.index, end: m.index + m[0].length } };
  }
  return null;
}

/**
 * "gastei 62 na farmácia" → gasto de R$ 62,00 em Saúde, hoje.
 * `today` é a data de hoje em Brasília (YYYY-MM-DD).
 */
export function parseQuickEntry(input: string, today: string): QuickEntry | null {
  const original = input.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!original) return null;
  const t = fold(original);

  const dateHit = findDate(t, today);
  const blocked: Hit[] = dateHit ? [dateHit.hit] : [];
  // parcelas ("3x", "em 3 vezes") não são o valor
  for (const m of t.matchAll(/\b\d+\s*(?:x|vezes)\b/g)) blocked.push({ start: m.index!, end: m.index! + m[0].length });

  type Cand = { cents: number; start: number; end: number; marked: boolean };
  const cands: Cand[] = [];
  for (const m of t.matchAll(/(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:reais|real|pilas|pila|contos|conto))?/g)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (blocked.some((b) => start < b.end && end > b.start)) continue;
    const cents = centsOf(m[2]!);
    if (cents === null) continue;
    cands.push({ cents, start, end, marked: Boolean(m[1] || m[3]) });
  }
  if (cands.length === 0) return null;
  const chosen = cands.find((c) => c.marked) ?? cands[cands.length - 1]!;

  const income = INCOME.test(t);
  // A descrição vem do texto original (com acento), sem o valor, sem a data e sem os verbos do começo.
  let note = original;
  for (const h of [chosen, ...blocked].sort((a, b) => b.start - a.start)) note = `${note.slice(0, h.start)} ${note.slice(h.end)}`;
  note = note.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i += 1) {
    const v = VERBS.exec(fold(note));
    if (v) note = note.slice(v[0].length).trim();
    const p = FILLER_START.exec(fold(note));
    if (p) note = note.slice(p[0].length).trim();
  }
  note = note.replace(/(?:\s+(?:em|no|na|de|do|da|com|por|pra|para))+$/i, ''); // sobra de "em 12/10" ou "em 3 vezes" depois de tirar a data e a parcela
  note = note.replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '').slice(0, 120);
  if (!note) note = income ? 'Entrada' : 'Gasto';
  note = note.charAt(0).toUpperCase() + note.slice(1);

  const amountCents = income ? chosen.cents : -chosen.cents;
  return { date: dateHit?.date ?? today, amountCents, note, category: categorize(note, amountCents) };
}

const TOTAL_LINE = /(valor\s*(?:total|a\s*pagar|pago)|total\s*(?:a\s*pagar|geral|r\$)?|a\s*pagar|vl\.?\s*total)/;
const SKIP_NAME = /(cnpj|cpf|cupom|nota fiscal|nfc-?e|danfe|documento auxiliar|extrato|via do|consumidor|ie:|im:|inscri|tel|fone|rua |av\.? |avenida|cep|www\.|http)/;

/** Texto lido de um comprovante ou cupom (OCR) → lançamento. O OCR erra: a tela sempre mostra o resultado para conferir. */
export function parseReceiptText(text: string, today: string): QuickEntry | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const moneyRe = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\b/g;
  const money = (l: string) => [...fold(l).matchAll(moneyRe)].map((m) => centsOf(m[1]!)).filter((c): c is number => c !== null);

  let total: number | null = null;
  for (const l of lines) {
    const f = fold(l);
    if (!TOTAL_LINE.test(f) || /subtotal|desconto|troco|tributos|impostos/.test(f)) continue;
    const vals = money(l);
    if (vals.length) total = Math.max(total ?? 0, vals[vals.length - 1]!);
  }
  if (total === null) { // sem linha de total: o maior valor com centavos do papel
    const all = lines.flatMap(money);
    if (all.length === 0) return null;
    total = Math.max(...all);
  }

  let date = today;
  for (const l of lines) {
    const m = /\b(\d{2}\/\d{2}\/\d{2,4})\b/.exec(l);
    const d = m ? parseDateAny(m[1]!) : null;
    if (d && d <= today) { date = d; break; }
  }

  const name = lines.find((l) => /[a-zA-ZÀ-ú]{3,}/.test(l) && !SKIP_NAME.test(fold(l)) && !TOTAL_LINE.test(fold(l)) && money(l).length === 0);
  const clean = (name ?? '').replace(/[^\p{L}\p{N}\s&.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const label = clean.length >= 3 ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : 'Compra no comprovante';
  return { date, amountCents: -total, note: label, category: categorize(label, -total) };
}
