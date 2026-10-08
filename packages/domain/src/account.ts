// Assinatura: planos, categorização, importação de extrato (CSV/OFX), resumo do mês, alertas, treinador e simulador.
// Tudo determinístico e em centavos. O treinador aqui é regra explicável (a IA, quando ligada, só reescreve o texto).
import { addDaysIso, formatBrl } from './calendar.ts';

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------
export type PlanCode = 'controle' | 'ousado' | 'desbravador';
export type Feature = 'health' | 'debts' | 'reminders' | 'ledger' | 'import' | 'alerts' | 'coach_limited' | 'goals' | 'coach' | 'simulator' | 'planner' | 'journeys' | 'market' | 'market_pro' | 'household' | 'ebook' | 'recurring' | 'scenarios';

export interface Plan {
  code: PlanCode;
  name: string;
  priceCents: number;
  productCode: string;
  tagline: string;
  features: Feature[];
  /** O que ainda não existe (dito com franqueza na tela de planos). */
  soon: string[];
}

export const PLANS: Plan[] = [
  {
    code: 'controle', name: 'Controle', priceCents: 1999, productCode: 'sub_controle',
    tagline: 'Saber para onde vai o dinheiro e organizar o mês',
    features: ['health', 'ledger', 'import', 'alerts', 'debts', 'reminders', 'coach_limited', 'market', 'recurring'],
    soon: [],
  },
  {
    code: 'ousado', name: 'Ousado', priceCents: 3999, productCode: 'sub_ousado',
    tagline: 'Sair do vermelho, criar reserva e cumprir metas',
    features: ['health', 'ledger', 'import', 'alerts', 'debts', 'reminders', 'goals', 'coach', 'market', 'journeys', 'household', 'ebook', 'recurring', 'scenarios'],
    soon: [],
  },
  {
    code: 'desbravador', name: 'Desbravador', priceCents: 5999, productCode: 'sub_desbravador',
    tagline: 'Tudo, mais planejador com IA, dólar e histórico de mercado',
    features: ['health', 'ledger', 'import', 'alerts', 'debts', 'reminders', 'goals', 'coach', 'simulator', 'planner', 'market', 'journeys', 'market_pro', 'household', 'ebook', 'recurring', 'scenarios'],
    soon: ['Contas conectadas (Open Finance): depende de parceiro autorizado pelo Banco Central.'],
  },
];

export const planByCode = (code: string): Plan | undefined => PLANS.find((p) => p.code === code);
export const planHas = (code: PlanCode, feature: Feature): boolean => Boolean(planByCode(code)?.features.includes(feature));

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export const CATEGORIES = ['renda', 'moradia', 'mercado', 'transporte', 'saude', 'contas', 'lazer', 'educacao', 'dividas', 'outros'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  renda: 'Renda', moradia: 'Moradia', mercado: 'Mercado e comida', transporte: 'Transporte', saude: 'Saúde', contas: 'Contas de casa',
  lazer: 'Lazer e compras', educacao: 'Educação', dividas: 'Dívidas e parcelas', outros: 'Outros',
};

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const RULES: [Category, RegExp][] = [
  ['renda', /(salario|pagamento de sal|rendimento|pro.?labore|recebimento|deposito|pix recebido|transferencia recebida|13o|ferias|beneficio inss)/],
  ['moradia', /(aluguel|condominio|iptu|financiamento imob|reforma)/],
  ['mercado', /(mercado|supermercado|padaria|acougue|hortifruti|atacadao|assai|carrefour|ifood|restaurante|lanchonete|comida)/],
  ['transporte', /(uber|99app|99 |combustivel|posto|gasolina|estacionamento|onibus|metro|bilhete|pedagio|ipva|oficina)/],
  ['saude', /(farmacia|drogaria|droga|consulta|medic|plano de saude|dentista|exame|hospital|academia|smartfit|smart fit|gympass|crossfit|pilates|psicolog|terapia|clinica)/],
  ['contas', /(energia|luz|cemig|enel|copel|agua|sabesp|saneamento|internet|vivo|claro|tim |oi |telefone|gas )/],
  ['educacao', /(escola|faculdade|curso|mensalidade|livro|colegio)/],
  ['dividas', /(fatura|cartao|emprestimo|parcela|financiamento|consignado|cheque especial|juros|iof)/],
  ['lazer', /(netflix|spotify|cinema|streaming|bar |shopping|loja|amazon|mercado livre|shopee|viagem|jogo|disney|hbo|prime video|youtube|deezer|globoplay|paramount|apple.com|icloud|google one|xbox|playstation|steam)/],
];

export function categorize(note: string, amountCents: number): Category {
  const t = fold(note);
  for (const [cat, re] of RULES) if (re.test(t)) return cat === 'renda' && amountCents < 0 ? 'outros' : cat;
  return amountCents > 0 ? 'renda' : 'outros';
}

// ---------------------------------------------------------------------------
// Importação de extrato (roda no navegador; só os lançamentos vão ao servidor)
// ---------------------------------------------------------------------------
export interface ImportedEntry {
  date: string; // YYYY-MM-DD
  amountCents: number;
  note: string;
}

const isoOk = (y: number, m: number, d: number): string | null => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};

export function parseDateAny(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return isoOk(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return isoOk(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX
  if (m) return isoOk(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Aceita "1.234,56", "-1234.56", "R$ 12,00", "(45,90)" e "45,90-" (débito). Devolve centavos com sinal. */
export function parseMoneyBr(raw: string): number | null {
  let s = raw.trim().replace(/R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma !== -1) s = s.replace(/,/g, '');
  else if (lastComma !== -1) s = s.replace(',', '.');
  const v = Math.round(Number(s) * 100);
  if (!Number.isFinite(v) || v === 0 || Math.abs(v) > 100_000_000_00) return null;
  return neg ? -v : v;
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsvExtract(text: string): { entries: ImportedEntry[]; skipped: number } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { entries: [], skipped: 0 };
  const sample = lines.slice(0, 5).join('\n');
  const delimiter = sample.includes(';') ? ';' : sample.includes('	') ? '	' : ',';
  const rows = lines.map((l) => splitLine(l, delimiter));
  // cabeçalho: procura colunas pelo nome; senão, adivinha pelo conteúdo
  const head = rows[0]!.map(fold);
  let dateCol = head.findIndex((h) => /^(data|date|dt)/.test(h));
  let amountCol = head.findIndex((h) => /(valor|amount|montante)/.test(h));
  let noteCol = head.findIndex((h) => /(descri|historico|lancamento|memo|estabelecimento|detalhe)/.test(h));
  const hasHeader = dateCol !== -1 || amountCol !== -1;
  const body = hasHeader ? rows.slice(1) : rows;
  if (dateCol === -1) dateCol = rows[hasHeader ? 1 : 0]?.findIndex((c) => parseDateAny(c) !== null) ?? -1;
  if (amountCol === -1) {
    const r = body[0] ?? [];
    amountCol = r.findIndex((c, i) => i !== dateCol && parseMoneyBr(c) !== null && /[\d]/.test(c) && /[,.]/.test(c));
  }
  if (noteCol === -1) noteCol = (body[0] ?? []).findIndex((_, i) => i !== dateCol && i !== amountCol);
  const entries: ImportedEntry[] = [];
  let skipped = 0;
  for (const r of body) {
    const date = dateCol >= 0 ? parseDateAny(r[dateCol] ?? '') : null;
    const amount = amountCol >= 0 ? parseMoneyBr(r[amountCol] ?? '') : null;
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    entries.push({ date, amountCents: amount, note: (noteCol >= 0 ? r[noteCol] ?? '' : '').slice(0, 120) });
  }
  return { entries, skipped };
}

export function parseOfx(text: string): { entries: ImportedEntry[]; skipped: number } {
  const entries: ImportedEntry[] = [];
  let skipped = 0;
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const tag = (name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1]?.trim() ?? '';
    const date = parseDateAny(tag('DTPOSTED'));
    const amount = parseMoneyBr(tag('TRNAMT'));
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    entries.push({ date, amountCents: amount, note: (tag('MEMO') || tag('NAME')).slice(0, 120) });
  }
  return { entries, skipped };
}

// ---------------------------------------------------------------------------
// Extrato em PDF: o texto sai do PDF no navegador (pdf.js) e este leitor transforma as linhas em lançamentos.
// Entende os formatos mais comuns (data no começo da linha; valor com sinal, com "D"/"C", entre parênteses, com "-" no fim ou
// sem sinal). Quando o valor não tem sinal, decide pela descrição (recebido, crédito, estorno... = entrada; o resto = saída).
// ---------------------------------------------------------------------------
const PDF_MONTHS: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const PDF_MONEY = /(?<s1>[-+])?\s*(?:R\$)?\s*(?<s2>[-+])?\s*(?<par>\()?(?<num>\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\)?(?<trail>-)?(?:\s+(?<dc>DB|CR|D|C)(?![A-Za-zÀ-ú]))?/gi;
const PDF_INCOME_WORDS = /recebid|receb\.|cr[eé]dito em conta|dep[oó]sito|sal[aá]rio|rendimento|estorno|reembolso|cashback|devolu|provento|resgate/i;
const PDF_SKIP_DESC = /^(saldo|total|subtotal|limite|vencimento|pagamento m[ií]nimo|valor da fatura)/i;

function pdfDate(line: string, refYear: number | null, now: Date): { iso: string; rest: string } | null {
  let m: RegExpExecArray | null;
  let d: number;
  let mo: number;
  let y: number | null = null;
  let rest = '';
  if ((m = /^(\d{2})[/.-](\d{2})[/.-](\d{4}|\d{2})\b/.exec(line))) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})\b/.exec(line))) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else if ((m = /^(\d{1,2})\s+(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?(?:\s+(?:de\s+)?(\d{4}))?\b/i.exec(line))) {
    d = Number(m[1]);
    mo = PDF_MONTHS[m[2]!.toLowerCase()]!;
    y = m[3] ? Number(m[3]) : null;
  } else if ((m = /^(\d{2})[/.](\d{2})\b(?![/.]\d)/.exec(line))) {
    d = Number(m[1]);
    mo = Number(m[2]);
  } else return null;
  rest = line.slice(m[0].length).trim();
  if (y === null) {
    y = refYear ?? now.getFullYear();
    // sem ano e no futuro (ex.: extrato de dezembro lido em janeiro): é do ano anterior
    if (Date.UTC(y, mo - 1, d) > now.getTime() + 31 * 86_400_000) y -= 1;
  }
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return { iso: t.toISOString().slice(0, 10), rest };
}

/** Resultado da conferência do PDF: a soma dos lançamentos lidos bate com o que o próprio extrato informa (saldos ou totais)? */
export interface PdfExtractCheck {
  ok: boolean;
  source: 'saldo' | 'totais';
  expectedCents: number;
  parsedCents: number;
}

const PDF_AMT = String.raw`[-+]?\s?(?:R\$\s?)?\(?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?`;
// [descrição] [marcador de coluna "-" ou nº de documento] VALOR [D/C] [SALDO [D/C]]
const PDF_TAIL = new RegExp(String.raw`^(?<desc>.*?)(?:\s+(?<doc>-|\d{3,12}))?\s+(?<a1>${PDF_AMT})(?:\s+(?<d1>DB|CR|D|C)(?![A-Za-zÀ-ú]))?(?:\s+(?<a2>${PDF_AMT})(?:\s+(?<d2>DB|CR|D|C)(?![A-Za-zÀ-ú]))?)?$`, 'i');
const PDF_NUM = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/;
const PDF_HEADER = /^data\b.*\b(descri[cç][aã]o|hist[oó]rico|lan[cç]amentos?)\b.*\b(movimento|valor|d[eé]bito|cr[eé]dito|saldo)\b/i;
const PDF_SECTION_END = /^(saldos? por per[ií]odo|comprovantes? de pagamento|compras com cart[aã]o|cr[eé]ditos contratados|lan[cç]amentos futuros|informa[cç][oõ]es complementares)/i;

const centsOf = (s: string): number => Math.round(Number(PDF_NUM.exec(s)![0].replace(/\./g, '').replace(',', '.')) * 100);

/**
 * Lê o texto de um extrato em PDF. Funciona com extratos de uma linha por lançamento ("12/03 PIX ... -45,90") e com os que
 * quebram o lançamento em várias linhas e só mostram a data uma vez por dia (ex.: Santander: descrição numa linha, valor em
 * outra, sinal no fim do número). Só olha a tabela de movimentação (ignora comprovantes, resumos e tabelas repetidas) e
 * CONFERE o resultado: soma dos lançamentos x saldo anterior/final (ou totais de créditos/débitos) que o próprio extrato traz.
 */
export function parsePdfExtract(text: string, now: Date = new Date()): { entries: ImportedEntry[]; skipped: number; check: PdfExtractCheck | null } {
  const all = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Ano do extrato: o "setembro/2026" do cabeçalho vale mais; senão, o ano que mais aparece nas datas completas (uma data solta
  // do rodapé, como a versão do modelo do extrato, não decide)
  const header = /\b(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(20\d{2})\b/i.exec(text)?.[1];
  const years = new Map<string, number>();
  for (const y of text.matchAll(/\b\d{2}[/.-]\d{2}[/.-](20\d{2})\b/g)) years.set(y[1]!, (years.get(y[1]!) ?? 0) + 1);
  const common = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const refYear = header ?? common;
  const ref = refYear ? Number(refYear) : null;

  // só a tabela de movimentação (do cabeçalho "Data Descrição ... Valor" até o fim da tabela); sem cabeçalho, o texto todo
  const start = all.findIndex((l) => PDF_HEADER.test(l));
  let end = all.length;
  if (start >= 0) {
    const e = all.findIndex((l, i) => i > start && PDF_SECTION_END.test(l));
    if (e > start) end = e;
  }
  const lines = start >= 0 ? all.slice(start, end) : all;

  // estilo "menos no fim" (4.734,09-): então um "-" solto antes do número é só a coluna vazia do documento, não um sinal
  const trailingStyle = (lines.join('\n').match(/\d,\d{2}-(?!\d)/g) ?? []).length >= 2;

  const entries: ImportedEntry[] = [];
  let skipped = 0;
  let currentDate: string | null = null;
  let pending: string[] = [];
  let openDated = false; // começou um lançamento (linha com data) que ainda não achou o valor
  const balances: Array<{ cents: number; at: number }> = [];

  for (const raw of lines) {
    if (PDF_HEADER.test(raw)) {
      if (openDated) skipped += 1;
      openDated = false;
      pending = []; // cabeçalho repetido a cada página: descarta o que sobrou do rodapé
      continue;
    }
    let body = raw;
    const dated = pdfDate(raw, ref, now);
    if (dated) {
      let rest = dated.rest;
      const second = pdfDate(rest, ref, now);
      if (second) rest = second.rest;
      const hasAmount = PDF_TAIL.test(` ${rest}`);
      // data que volta no tempo no meio de um lançamento ("15/09 Uber ..." detalhe da compra) não troca o dia corrente
      const detail = currentDate !== null && pending.length > 0 && !hasAmount && dated.iso < currentDate;
      if (!detail) {
        if (openDated) {
          skipped += 1; // o lançamento anterior nunca achou o valor
          pending = [];
        }
        openDated = false;
        currentDate = dated.iso;
      }
      body = rest;
    }
    if (!body) continue;
    const m = PDF_TAIL.exec(` ${body}`);
    if (!m) {
      if (currentDate) {
        pending.push(body);
        if (pending.length > 3) pending.shift();
        if (dated) openDated = true;
      }
      continue;
    }
    openDated = false;
    const g = m.groups!;
    const descHere = g.desc!.trim();
    const label = descHere || pending.join(' ');
    const a1 = g.a1!.trim();
    const dc = (g.d1 ?? '').toUpperCase();
    const trailMinus = /-\s*$/.test(a1);
    const leadMinus = /^-/.test(a1);
    const leadPlus = /^\+/.test(a1);
    const explicitNeg = trailMinus || leadMinus || /^\(.*\)$/.test(a1.replace(/-$/, '')) || dc === 'D' || dc === 'DB' || (g.doc === '-' && !trailingStyle);
    const explicitPos = leadPlus || dc === 'C' || dc === 'CR';
    const cents = centsOf(a1);

    // linha de saldo = a descrição COMEÇA com "saldo" ("SALDO EM 31/08", "Saldo anterior"); "JUROS SALDO UTILIZ" é um lançamento
    if (/^(?:\(=\)\s*)?saldo\b/i.test(label)) {
      balances.push({ cents: explicitNeg ? -cents : cents, at: entries.length }); // saldo anterior/final: serve para conferir, não é lançamento
      pending = [];
      continue;
    }
    if (PDF_SKIP_DESC.test(label) || !currentDate) {
      pending = [];
      continue;
    }
    if (!Number.isFinite(cents) || cents === 0 || cents > 100_000_000_00) {
      skipped += 1;
      pending = [];
      continue;
    }
    let note = (descHere ? [...pending, descHere] : pending).join(' ');
    note = note
      .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}|\*{3}\.\d{3}\.\d{3}-\*{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, ' ')
      .replace(/\d{6,}/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-–:\s]+|[-–:\s]+$/g, '')
      .trim();
    const negative = trailingStyle ? explicitNeg : explicitNeg || (!explicitPos && !PDF_INCOME_WORDS.test(note));
    entries.push({ date: currentDate, amountCents: negative ? -cents : cents, note: (note || 'Lançamento').slice(0, 120) });
    pending = [];
  }

  if (openDated) skipped += 1;
  // conferência com o que o extrato informa
  const parsedCents = entries.reduce((s, e) => s + e.amountCents, 0);
  let check: PdfExtractCheck | null = null;
  const first = balances[0];
  const last = balances[balances.length - 1];
  if (entries.length > 0 && balances.length >= 2 && first && last && first.at === 0 && last.at === entries.length) {
    const expectedCents = last.cents - first.cents;
    check = { ok: expectedCents === parsedCents, source: 'saldo', expectedCents, parsedCents };
  }
  if (!check?.ok && entries.length > 0) {
    const total = (re: RegExp) => {
      const hit = all.map((l) => re.exec(l)).find(Boolean);
      return hit ? centsOf(hit[1]!) : null;
    };
    const cred = total(/total de cr[eé]ditos\s+(\S+)$/i);
    const deb = total(/total de d[eé]bitos\s+(\S+)$/i);
    if (cred !== null && deb !== null) {
      const sumPos = entries.filter((e) => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0);
      const sumNeg = -entries.filter((e) => e.amountCents < 0).reduce((s, e) => s + e.amountCents, 0);
      const ok = sumPos === cred && sumNeg === deb;
      if (ok || !check) check = { ok, source: 'totais', expectedCents: cred - deb, parsedCents };
    }
  }
  return { entries, skipped, check };
}

export function parseExtract(text: string, filename = ''): { entries: ImportedEntry[]; skipped: number } {
  return /\.ofx$/i.test(filename) || /<OFX>/i.test(text) ? parseOfx(text) : parseCsvExtract(text);
}

// ---------------------------------------------------------------------------
// Resumo do mês, alertas e treinador
// ---------------------------------------------------------------------------
export interface LedgerEntry {
  id?: string;
  date: string;
  amountCents: number;
  category: string;
  note: string;
}

export interface MonthSummary {
  month: string;
  incomeCents: number;
  spendCents: number; // positivo
  balanceCents: number;
  byCategory: { category: string; cents: number; limitCents: number | null; over: boolean }[];
  savingsRate: number | null; // (entrada - gasto) / entrada
}

export const monthOf = (iso: string) => iso.slice(0, 7);

export function summarizeMonth(entries: LedgerEntry[], limits: Record<string, number>, month: string): MonthSummary {
  const inMonth = entries.filter((e) => monthOf(e.date) === month);
  const incomeCents = inMonth.filter((e) => e.amountCents > 0).reduce((s, e) => s + e.amountCents, 0);
  const spend = new Map<string, number>();
  for (const e of inMonth) if (e.amountCents < 0) spend.set(e.category, (spend.get(e.category) ?? 0) - e.amountCents);
  const spendCents = [...spend.values()].reduce((s, v) => s + v, 0);
  const cats = new Set([...spend.keys(), ...Object.keys(limits)]);
  const byCategory = [...cats]
    .map((category) => {
      const cents = spend.get(category) ?? 0;
      const limitCents = limits[category] ?? null;
      return { category, cents, limitCents, over: limitCents !== null && cents > limitCents };
    })
    .sort((a, b) => b.cents - a.cents);
  return { month, incomeCents, spendCents, balanceCents: incomeCents - spendCents, byCategory, savingsRate: incomeCents > 0 ? (incomeCents - spendCents) / incomeCents : null };
}

export interface Goal {
  id?: string;
  name: string;
  targetCents: number;
  savedCents: number;
  dueOn: string | null;
  /** Quando o total guardado alcançou o alvo (nulo = em andamento). */
  completedAt?: string | null;
  /** Últimos aportes (mais recente primeiro). */
  contributions?: { id: string; date: string; amountCents: number; note: string }[];
}

// ---------------------------------------------------------------------------
// Cheque especial (LIS): o que a pessoa está usando do limite da conta e quanto isso custa por mês.
// ---------------------------------------------------------------------------
export interface OverdraftStatus {
  usedCents: number; // quanto do saldo está negativo
  withinLimitCents: number; // parte dentro do limite contratado
  overLimitCents: number; // parte que passa do limite (conta estourada)
  availableCents: number; // o que ainda resta do limite
  usedPct: number; // % do limite em uso (100 se não há limite e a conta está negativa)
  monthlyCostCents: number; // juros estimados de um mês com esse uso
  level: 'none' | 'low' | 'high' | 'over';
}

export function overdraftStatus(input: { balanceCents: number; limitCents: number; rateBps: number }): OverdraftStatus {
  const used = Math.max(0, -input.balanceCents);
  const limit = Math.max(0, input.limitCents);
  const within = Math.min(used, limit);
  const over = used - within;
  const usedPct = used === 0 ? 0 : limit > 0 ? Math.min(100, Math.round((within / limit) * 100)) : 100;
  const level: OverdraftStatus['level'] = used === 0 ? 'none' : over > 0 ? 'over' : usedPct >= 50 ? 'high' : 'low';
  return {
    usedCents: used,
    withinLimitCents: within,
    overLimitCents: over,
    availableCents: Math.max(0, limit - used),
    usedPct,
    monthlyCostCents: Math.round((used * Math.max(0, input.rateBps)) / 10_000),
    level,
  };
}

export function overdraftAlerts(wallets: { name: string; balanceCents: number; limitCents: number; rateBps: number }[]): AlertItem[] {
  const out: AlertItem[] = [];
  for (const w of wallets) {
    const s = overdraftStatus(w);
    if (s.level === 'none') continue;
    const cost = `Se ficar assim por um mês, o banco cobra cerca de ${formatBrl(s.monthlyCostCents)} de juros.`;
    if (s.level === 'over') out.push({ level: 'warn', title: `${w.name}: passou do limite do cheque especial`, detail: `A conta está ${formatBrl(s.usedCents)} no negativo, ${formatBrl(s.overLimitCents)} acima do limite de ${formatBrl(w.limitCents)}. ${cost}` });
    else out.push({ level: s.level === 'high' ? 'warn' : 'info', title: `${w.name}: você está usando o cheque especial`, detail: `Usando ${formatBrl(s.usedCents)} de ${formatBrl(w.limitCents)} (${s.usedPct}% do limite). ${cost}` });
  }
  return out;
}

export interface AlertItem {
  level: 'warn' | 'info';
  title: string;
  detail: string;
}

export function buildAlerts(entries: LedgerEntry[], limits: Record<string, number>, goals: Goal[], today: string): AlertItem[] {
  const month = monthOf(today);
  const s = summarizeMonth(entries, limits, month);
  const label = (c: string) => CATEGORY_LABEL[c as Category] ?? c;
  const out: AlertItem[] = [];
  for (const c of s.byCategory) {
    if (c.limitCents === null) continue;
    if (c.over) out.push({ level: 'warn', title: `${label(c.category)}: passou do limite`, detail: `Você gastou ${formatBrl(c.cents)} de um limite de ${formatBrl(c.limitCents)} neste mês.` });
    else if (c.cents >= c.limitCents * 0.8) out.push({ level: 'warn', title: `${label(c.category)}: perto do limite`, detail: `Já foram ${formatBrl(c.cents)} de ${formatBrl(c.limitCents)}. Faltam ${formatBrl(c.limitCents - c.cents)}.` });
  }
  if (s.incomeCents > 0 && s.spendCents > s.incomeCents) out.push({ level: 'warn', title: 'Gastos acima das entradas', detail: `Neste mês saíram ${formatBrl(s.spendCents)} e entraram ${formatBrl(s.incomeCents)}.` });
  for (const g of goals) {
    if (!g.dueOn || g.savedCents >= g.targetCents) continue;
    const days = Math.round((Date.parse(`${g.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days < 0) out.push({ level: 'warn', title: `Meta vencida: ${g.name}`, detail: `Faltam ${formatBrl(g.targetCents - g.savedCents)}. Ajuste o prazo ou o valor.` });
    else if (days <= 30) out.push({ level: 'info', title: `Meta perto do prazo: ${g.name}`, detail: `Faltam ${formatBrl(g.targetCents - g.savedCents)} em ${days} dias.` });
  }
  return out;
}

export interface Insight {
  id: string;
  title: string;
  detail: string;
}

/** Treinador por regras (explicável). Sempre cita números do próprio lançamento. */
export function coachInsights(entries: LedgerEntry[], limits: Record<string, number>, today: string): Insight[] {
  const month = monthOf(today);
  const prev = monthOf(addDaysIso(`${month}-01`, -1));
  const cur = summarizeMonth(entries, limits, month);
  const old = summarizeMonth(entries, limits, prev);
  const label = (c: string) => CATEGORY_LABEL[c as Category] ?? c;
  const out: Insight[] = [];

  const top = cur.byCategory.find((c) => c.cents > 0);
  if (top && cur.spendCents > 0) {
    const share = Math.round((top.cents / cur.spendCents) * 100);
    out.push({ id: 'top', title: `${label(top.category)} é o que mais pesa`, detail: `${share}% dos seus gastos do mês (${formatBrl(top.cents)}). Se der para reduzir 10%, você libera ${formatBrl(Math.round(top.cents * 0.1))} por mês.` });
  }
  for (const c of cur.byCategory) {
    const before = old.byCategory.find((o) => o.category === c.category)?.cents ?? 0;
    if (c.category !== 'renda' && before > 0 && c.cents > before * 1.25 && c.cents - before >= 5000) {
      out.push({ id: `up-${c.category}`, title: `${label(c.category)} subiu em relação ao mês passado`, detail: `De ${formatBrl(before)} para ${formatBrl(c.cents)} (+${formatBrl(c.cents - before)}). Vale olhar o que mudou.` });
    }
  }
  if (cur.savingsRate !== null) {
    const pct = Math.round(cur.savingsRate * 100);
    out.push(
      cur.savingsRate < 0
        ? { id: 'rate', title: 'Você está gastando mais do que entra', detail: `O mês está fechando em ${formatBrl(cur.balanceCents)}. Comece cortando o que não é essencial na categoria que mais pesa.` }
        : cur.savingsRate < 0.1
          ? { id: 'rate', title: 'Sobra pouco no fim do mês', detail: `Você guarda ${pct}% do que entra. Uma meta simples é chegar a 10%: separe o valor no dia em que o dinheiro cair.` }
          : { id: 'rate', title: 'Boa margem no mês', detail: `Você está guardando ${pct}% do que entra. Considere mandar parte para a reserva de emergência.` },
    );
  }
  // gastos que se repetem todo mês (assinaturas e afins)
  const byNote = new Map<string, Set<string>>();
  for (const e of entries) if (e.amountCents < 0 && e.note) byNote.set(fold(e.note).replace(/\d+/g, '').trim(), (byNote.get(fold(e.note).replace(/\d+/g, '').trim()) ?? new Set()).add(monthOf(e.date)));
  const repeats = [...byNote.entries()].filter(([k, m]) => k.length > 2 && m.size >= 3).length;
  if (repeats > 0) out.push({ id: 'recurring', title: `${repeats} ${repeats === 1 ? 'gasto se repete' : 'gastos se repetem'} todo mês`, detail: 'Revise se você ainda usa cada assinatura ou serviço recorrente: cancelar o que não usa é dinheiro que volta na hora.' });

  // reserva de emergência (média dos meses com gasto)
  const months = [...new Set(entries.filter((e) => e.amountCents < 0).map((e) => monthOf(e.date)))];
  if (months.length > 0) {
    const total = entries.filter((e) => e.amountCents < 0).reduce((s, e) => s - e.amountCents, 0);
    const avg = Math.round(total / months.length);
    out.push({ id: 'reserve', title: 'Quanto de reserva de emergência', detail: `Seu gasto médio é ${formatBrl(avg)} por mês. Uma reserva de 3 meses seria ${formatBrl(avg * 3)} e de 6 meses, ${formatBrl(avg * 6)}.` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simulador educativo (Desbravador). NÃO é recomendação de investimento.
// ---------------------------------------------------------------------------
export interface SimInput {
  initialCents: number;
  monthlyCents: number;
  months: number;
  /** Cenários com taxas ANUAIS informadas pela pessoa (hipóteses, não previsões). */
  scenarios: { name: string; annualPct: number }[];
  inflationAnnualPct: number;
}

export interface SimScenarioResult {
  name: string;
  annualPct: number;
  finalCents: number;
  investedCents: number;
  gainCents: number;
  realFinalCents: number; // descontada a inflação hipotética
}

export function simulateInvestment(i: SimInput): SimScenarioResult[] {
  const months = Math.max(1, Math.min(600, Math.round(i.months)));
  const invested = i.initialCents + i.monthlyCents * months;
  const infl = (1 + i.inflationAnnualPct / 100) ** (months / 12);
  return i.scenarios.slice(0, 5).map((s) => {
    const r = (1 + s.annualPct / 100) ** (1 / 12) - 1;
    let bal = i.initialCents;
    for (let m = 0; m < months; m++) bal = bal * (1 + r) + i.monthlyCents;
    const finalCents = Math.round(bal);
    return { name: s.name, annualPct: s.annualPct, finalCents, investedCents: invested, gainCents: finalCents - invested, realFinalCents: Math.round(finalCents / infl) };
  });
}
