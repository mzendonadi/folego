// Cartões de crédito: ciclo da fatura, limite usado, parcelas, simulação do rotativo, estratégias e leitura de fatura em PDF.
// Tudo determinístico e em centavos. Datas em AAAA-MM-DD (o "hoje" vem de quem chama; aqui nada lê o relógio, exceto o ano padrão do leitor de PDF).
import { addMonthsIso } from './calendar.ts';
import { parseMoneyBr } from './account.ts';

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const clampDay = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};
const diffDays = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
const monthOf = (iso: string) => iso.slice(0, 7);

// ---------------------------------------------------------------------------
// Ciclo da fatura
// ---------------------------------------------------------------------------
export interface CardTerms {
  closingDay: number;
  dueDay: number;
}

/** Mês de fechamento (AAAA-MM) da fatura que recebe uma compra feita em `dateIso`. Compra no dia do fechamento (ou depois) vai para a fatura seguinte. */
export function invoiceKeyOf(dateIso: string, t: CardTerms): string {
  const [y, m] = dateIso.slice(0, 7).split('-').map(Number) as [number, number];
  const closing = Math.min(t.closingDay, daysIn(y, m));
  return Number(dateIso.slice(8, 10)) >= closing ? nextMonth(dateIso.slice(0, 7)) : dateIso.slice(0, 7);
}

/** Fechamento e vencimento da fatura que fecha no mês `key`. Se o vencimento é antes do fechamento no calendário, cai no mês seguinte. */
export function invoiceDates(key: string, t: CardTerms): { closingOn: string; dueOn: string } {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const dueKey = t.dueDay > t.closingDay ? key : nextMonth(key);
  const [dy, dm] = dueKey.split('-').map(Number) as [number, number];
  return { closingOn: clampDay(y, m, t.closingDay), dueOn: clampDay(dy, dm, t.dueDay) };
}

/** Quantos dias de prazo uma compra feita em `dateIso` tem até a fatura vencer (quanto maior, mais tempo para pagar). */
export function floatDays(dateIso: string, t: CardTerms): number {
  return diffDays(dateIso, invoiceDates(invoiceKeyOf(dateIso, t), t).dueOn);
}

// ---------------------------------------------------------------------------
// Resumo do cartão
// ---------------------------------------------------------------------------
export interface CardCharge {
  date: string;
  /** Gasto, sempre positivo. */
  amountCents: number;
  category?: string;
  note?: string;
  installmentNo?: number | null;
  installmentTotal?: number | null;
}
export interface CardPayment {
  date: string;
  amountCents: number;
}
export interface InstallmentPlan {
  perCents: number;
  totalN: number;
  /** Quantas parcelas já viraram lançamento. */
  postedN: number;
  firstOn: string;
  note?: string;
}

export type InvoiceStatus = 'open' | 'closed' | 'overdue' | 'paid';
export interface InvoiceView {
  key: string;
  closingOn: string;
  dueOn: string;
  status: InvoiceStatus;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  count: number;
  /** Dias até vencer (negativo = vencida). */
  daysToDue: number;
}
export type LimitLevel = 'none' | 'ok' | 'attention' | 'high' | 'over';
export interface CardSummary {
  limitCents: number;
  /** Dívida do cartão: faturas não pagas + parcelas que ainda vão entrar. */
  usedCents: number;
  availableCents: number;
  usedPct: number | null;
  level: LimitLevel;
  /** Fatura aberta (a que recebe as compras de hoje). */
  current: InvoiceView;
  /** Próxima fatura a pagar: a fechada com saldo mais antiga; se não houver, a aberta. */
  due: InvoiceView | null;
  /** Mais nova primeiro. */
  invoices: InvoiceView[];
  /** Parcelas de compras já feitas que ainda vão chegar nas próximas faturas. */
  futureInstallmentsCents: number;
}

export function limitLevel(usedCents: number, limitCents: number): LimitLevel {
  if (limitCents <= 0) return 'none';
  const pct = (usedCents / limitCents) * 100;
  return pct > 100 ? 'over' : pct >= 90 ? 'high' : pct >= 70 ? 'attention' : 'ok';
}

export function summarizeCard(
  card: CardTerms & { limitCents: number },
  charges: CardCharge[],
  payments: CardPayment[],
  plans: InstallmentPlan[],
  today: string,
): CardSummary {
  const totals = new Map<string, { cents: number; count: number }>();
  for (const c of charges) {
    const key = invoiceKeyOf(c.date, card);
    const t = totals.get(key) ?? { cents: 0, count: 0 };
    t.cents += c.amountCents;
    t.count += 1;
    totals.set(key, t);
  }
  const currentKey = invoiceKeyOf(today, card);
  if (!totals.has(currentKey)) totals.set(currentKey, { cents: 0, count: 0 });
  const keys = [...totals.keys()].sort();
  // O que foi pago abate as faturas mais antigas primeiro.
  let pool = payments.reduce((s, p) => s + p.amountCents, 0);
  const asc: InvoiceView[] = keys.map((key) => {
    const t = totals.get(key)!;
    const d = invoiceDates(key, card);
    const paidCents = Math.min(pool, t.cents);
    pool -= paidCents;
    const remainingCents = t.cents - paidCents;
    const closed = d.closingOn <= today;
    const daysToDue = diffDays(today, d.dueOn);
    const status: InvoiceStatus = closed ? (remainingCents === 0 ? 'paid' : daysToDue < 0 ? 'overdue' : 'closed') : 'open';
    return { key, closingOn: d.closingOn, dueOn: d.dueOn, status, totalCents: t.cents, paidCents, remainingCents, count: t.count, daysToDue };
  });
  const future = plans.reduce((s, p) => s + p.perCents * Math.max(0, p.totalN - p.postedN), 0);
  const owed = asc.reduce((s, i) => s + i.remainingCents, 0);
  const usedCents = owed + future;
  const current = asc.find((i) => i.key === currentKey)!;
  const due = asc.find((i) => (i.status === 'closed' || i.status === 'overdue') && i.remainingCents > 0) ?? (current.remainingCents > 0 ? current : null);
  return {
    limitCents: card.limitCents,
    usedCents,
    availableCents: Math.max(0, card.limitCents - usedCents),
    usedPct: card.limitCents > 0 ? Math.round((usedCents / card.limitCents) * 100) : null,
    level: limitLevel(usedCents, card.limitCents),
    current,
    due,
    invoices: [...asc].reverse().slice(0, 8),
    futureInstallmentsCents: future,
  };
}

// ---------------------------------------------------------------------------
// Parcelas
// ---------------------------------------------------------------------------
/** Parcelas que já devem virar lançamento hoje (a primeira na data da compra, as outras a cada mês). */
export function dueInstallments(plan: InstallmentPlan, today: string): { no: number; date: string }[] {
  const out: { no: number; date: string }[] = [];
  for (let n = plan.postedN + 1; n <= plan.totalN; n++) {
    const date = addMonthsIso(plan.firstOn, n - 1);
    if (date > today) break;
    out.push({ no: n, date });
  }
  return out;
}

/** Quanto das compras parceladas já feitas cai em cada um dos próximos meses (começando no mês de `today`). */
export function installmentCommitments(plans: InstallmentPlan[], today: string, months = 12): { month: string; cents: number }[] {
  const out: { month: string; cents: number }[] = [];
  let ym = monthOf(today);
  for (let i = 0; i < months; i++) {
    out.push({ month: ym, cents: 0 });
    ym = nextMonth(ym);
  }
  const at = new Map(out.map((o) => [o.month, o]));
  for (const p of plans) {
    for (let n = p.postedN + 1; n <= p.totalN; n++) {
      const slot = at.get(monthOf(addMonthsIso(p.firstOn, n - 1)));
      if (slot) slot.cents += p.perCents;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rotativo: o que acontece se pagar só parte da fatura
// ---------------------------------------------------------------------------
export interface RevolvingOption {
  id: 'full' | 'minimum' | 'half' | 'fixed';
  label: string;
  months: number;
  totalInterestCents: number;
  neverPaysOff: boolean;
}

/** Quita `balanceCents` pagando, todo mês, `pay(balanceNoMês)`, com juros de `rateBps` ao mês sobre o que sobra. */
function revolve(balanceCents: number, rateBps: number, pay: (balance: number) => number): { months: number; interest: number; never: boolean } {
  let b = balanceCents;
  let interest = 0;
  let months = 0;
  while (b > 100 && months < 600) {
    const p = Math.min(b, Math.max(1, pay(b)));
    b -= p;
    const j = Math.round((b * rateBps) / 10_000);
    interest += j;
    b += j;
    months += 1;
  }
  return { months, interest, never: b > 100 };
}

/** Pagar tudo, só o mínimo (15% do que deve), metade ou um valor fixo por mês: quantos meses leva e quanto vai de juros. */
export function revolvingOptions(balanceCents: number, rateBps: number, fixedCents = 0): RevolvingOption[] {
  const mk = (id: RevolvingOption['id'], label: string, pay: (b: number) => number): RevolvingOption => {
    const r = revolve(balanceCents, rateBps, pay);
    return { id, label, months: r.months, totalInterestCents: r.interest, neverPaysOff: r.never };
  };
  const out: RevolvingOption[] = [{ id: 'full', label: 'Pagar a fatura toda', months: balanceCents > 0 ? 1 : 0, totalInterestCents: 0, neverPaysOff: false }];
  out.push(mk('minimum', 'Pagar só o mínimo (15%)', (b) => Math.max(Math.round(b * 0.15), 5_000)));
  out.push(mk('half', 'Pagar metade todo mês', (b) => Math.round(b * 0.5)));
  if (fixedCents > 0) out.push(mk('fixed', 'Pagar um valor fixo por mês', () => fixedCents));
  return out;
}

// ---------------------------------------------------------------------------
// Estratégias (Desbravador)
// ---------------------------------------------------------------------------
export interface StrategyCardInput {
  id: string;
  name: string;
  terms: CardTerms;
  rateBps: number;
  summary: CardSummary;
}
export interface CardStrategy {
  id: string;
  level: 'info' | 'tip' | 'warn' | 'alert';
  title: string;
  text: string;
  cardId?: string;
}

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dayBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;

export function cardStrategies(cards: StrategyCardInput[], opts: { today: string; incomeCents?: number | null; commitments?: { month: string; cents: number }[] }): CardStrategy[] {
  const out: CardStrategy[] = [];
  const { today } = opts;

  for (const c of cards) {
    const s = c.summary;
    const d = s.due;
    if (d && d.status === 'overdue') {
      const jur = Math.round((d.remainingCents * c.rateBps) / 10_000);
      out.push({ id: `overdue-${c.id}`, level: 'alert', cardId: c.id, title: `A fatura do ${c.name} venceu`, text: `Venceu em ${dayBr(d.dueOn)} e faltam ${brl(d.remainingCents)}. Cada mês de atraso custa cerca de ${brl(jur)} só de juros (${(c.rateBps / 100).toLocaleString('pt-BR')}% ao mês), fora multa. Pague o quanto antes; se não der tudo, negocie o parcelamento da fatura com o banco antes de entrar no rotativo.` });
    } else if (d && d.status === 'closed' && d.daysToDue <= 5) {
      const min = revolvingOptions(d.remainingCents, c.rateBps).find((o) => o.id === 'minimum')!;
      out.push({ id: `due-${c.id}`, level: 'warn', cardId: c.id, title: `A fatura do ${c.name} vence ${d.daysToDue <= 0 ? 'hoje' : d.daysToDue === 1 ? 'amanhã' : `em ${d.daysToDue} dias`}`, text: `São ${brl(d.remainingCents)} para pagar até ${dayBr(d.dueOn)}. Pagar só o mínimo parece alívio, mas leva ${min.neverPaysOff ? 'uma eternidade' : `${min.months} meses`} e custa ${brl(min.totalInterestCents)} de juros. Pagar a fatura inteira custa zero.` });
    }
    if (s.level === 'over' || s.level === 'high' || s.level === 'attention') {
      out.push({ id: `limit-${c.id}`, level: s.level === 'attention' ? 'tip' : 'warn', cardId: c.id, title: `Você usa ${s.usedPct}% do limite do ${c.name}`, text: `${brl(s.usedCents)} de ${brl(s.limitCents)}. Passar de 30% do limite costuma pesar na análise de crédito, e perto de 100% qualquer imprevisto trava o cartão.${s.futureInstallmentsCents > 0 ? ` ${brl(s.futureInstallmentsCents)} disso são parcelas que ainda vão chegar.` : ''}` });
    }
  }

  // Melhor cartão e melhor dia para compras grandes
  if (cards.length > 0) {
    const ranked = cards.map((c) => ({ c, days: floatDays(today, c.terms) })).sort((a, b) => b.days - a.days);
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    if (ranked.length > 1 && best.days - worst.days >= 5) {
      out.push({ id: 'best-card', level: 'tip', cardId: best.c.id, title: `Para comprar hoje, use o ${best.c.name}`, text: `A compra de hoje só vence em ${best.days} dias nele, contra ${worst.days} no ${worst.c.name}. Mais prazo para pagar sem juros.` });
    }
    const [ty, tm] = today.slice(0, 7).split('-').map(Number) as [number, number];
    const bestDay = floatDays(clampDay(ty, tm, best.c.terms.closingDay), best.c.terms);
    out.push({ id: 'best-day', level: 'info', cardId: best.c.id, title: 'O melhor dia para compras grandes', text: `No ${best.c.name}, a fatura fecha no dia ${best.c.terms.closingDay}. Comprar nesse dia (ou logo depois) joga a compra para a fatura seguinte e dá cerca de ${bestDay} dias até vencer.` });
  }

  // Parcelas nos próximos meses
  const peak = (opts.commitments ?? []).filter((x) => x.cents > 0).sort((a, b) => b.cents - a.cents)[0];
  if (peak) {
    const income = opts.incomeCents && opts.incomeCents > 0 ? opts.incomeCents : null;
    const heavy = income !== null && peak.cents / income >= 0.3;
    out.push({ id: 'installments', level: heavy ? 'warn' : 'info', title: heavy ? 'As parcelas já comprometem boa parte da renda' : 'Parcelas que ainda vão chegar', text: `${monthName(peak.month)} é o mês mais pesado: ${brl(peak.cents)} em parcelas de compras já feitas${heavy && income ? `, ${Math.round((peak.cents / income) * 100)}% da sua renda` : ''}. ${heavy ? 'Evite novas compras parceladas até esse número cair.' : 'Antes de parcelar mais, some isso ao que você já assumiu.'}` });
  }

  // Vários cartões com saldo: ataca primeiro o de juros mais altos
  const carrying = cards.filter((c) => (c.summary.due?.remainingCents ?? 0) > 0 && c.summary.due?.status !== 'open').sort((a, b) => b.rateBps - a.rateBps);
  if (carrying.length >= 2 && carrying[0]!.rateBps > carrying[carrying.length - 1]!.rateBps) {
    out.push({ id: 'avalanche', level: 'tip', cardId: carrying[0]!.id, title: 'Se não der para pagar tudo, comece pelo mais caro', text: `Você tem ${carrying.length} faturas em aberto. O ${carrying[0]!.name} cobra ${(carrying[0]!.rateBps / 100).toLocaleString('pt-BR')}% ao mês, o maior. Use o dinheiro extra nele primeiro e pague o mínimo dos outros: é o que menos custa no total.` });
  }

  const order = { alert: 0, warn: 1, tip: 2, info: 3 } as const;
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------
// Leitura de fatura em PDF (roda no navegador: o arquivo não vai ao servidor, só as linhas que a pessoa confirma)
// ---------------------------------------------------------------------------
export interface InvoiceEntry {
  date: string;
  /** Gasto, positivo. */
  amountCents: number;
  note: string;
  installmentNo: number | null;
  installmentTotal: number | null;
}
export interface InvoiceCredit {
  date: string;
  /** Pagamento ou estorno, positivo (abate a fatura). */
  amountCents: number;
  note: string;
}
export interface InvoiceParse {
  entries: InvoiceEntry[];
  credits: InvoiceCredit[];
  skipped: number;
  meta: { closingOn: string | null; dueOn: string | null; totalCents: number | null; year: number };
  /** A soma lida (compras − créditos) bate com o "total da fatura" que o próprio PDF informa? */
  check: { ok: boolean; expectedCents: number; parsedCents: number } | null;
}

const MON3: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Data com dia e mês (e ano, se vier) no começo do texto: "12/10", "12/10/2026", "12 OUT", "12 out 2026", "12 de outubro de 2026". */
function parseLooseDate(raw: string): { day: number; month: number; year: number | null; rest: string } | null {
  const s = raw.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?!\d)\s*(.*)$/.exec(s);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    return { day: Number(m[1]), month: Number(m[2]), year: y, rest: m[4] ?? '' };
  }
  m = /^(\d{1,2})\s+(?:de\s+)?([A-Za-zÀ-ú]{3,9})\.?(?:\s+(?:de\s+)?(\d{4}))?(?!\d)\s*(.*)$/.exec(s);
  if (m) {
    const word = fold(m[2]!);
    const mon = MON3[word.slice(0, 3)];
    const fullName = /^(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/.test(word);
    if (mon && (word.length === 3 || fullName)) return { day: Number(m[1]), month: mon, year: m[3] ? Number(m[3]) : null, rest: m[4] ?? '' };
  }
  return null;
}

const isoOk = (y: number, mo: number, d: number): string | null => {
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || y < 2000 || y > 2100) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
};

const INVOICE_AMT = /(-?\s?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}-?)\s*(CR|DB|C|D)?$/i;
const INVOICE_SKIP = /^(total\b|subtotal|saldo\b|limite\b|pagamento m[ií]nimo|m[ií]nimo\b|valor\b|resumo|fatura anterior|juros do rotativo|encargos? (do pr[oó]ximo|financeiros do per)|compras? parceladas? (pr[oó]ximas|futuras)|pr[oó]xima fatura|simula[cç][aã]o|parcelamento da fatura|cr[eé]dito rotativo|taxa|cet\b|data\b|descri[cç][aã]o|lan[cç]amentos? (do|no) per)/i;
const CREDIT_WORDS = /^(pagamento (recebido|efetuado|da fatura|fatura|em dinheiro|de fatura)|pgto (fatura|cart)|estorno|cr[eé]dito (de|em|por)|devolu[cç][aã]o|cashback|desconto (da|de) anuidade)/i;
const INSTALL = /(?:^|\s)(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i;

/**
 * Lê o texto de uma fatura de cartão: compras (com parcela "03/10" quando houver), pagamentos e estornos, vencimento, fechamento e o
 * total da fatura, e CONFERE a soma com o total que o próprio PDF informa. Cobre os dois jeitos comuns de data ("12/10" e "12 OUT").
 */
export function parseCardInvoice(text: string, now: Date = new Date()): InvoiceParse {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // vencimento e fechamento (a data pode estar na mesma linha ou na seguinte)
  const labeledDate = (label: RegExp): string | null => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const hit = label.exec(fold(l));
      if (!hit) continue;
      const tail = `${l.slice(hit.index + hit[0].length)} ${lines[i + 1] ?? ''}`.trim().replace(/^[^\d]+/, '');
      const d = parseLooseDate(tail);
      if (d) {
        const v = isoOk(d.year ?? now.getUTCFullYear(), d.month, d.day);
        if (v) return v;
      }
    }
    return null;
  };
  const dueOn = labeledDate(/vencimento\b/);
  const closingOn = labeledDate(/fechamento\b/);
  let totalCents: number | null = null;
  for (let i = 0; i < lines.length && totalCents === null; i++) {
    if (/^(total (da|desta|a pagar)?\s*(sua )?fatura|total a pagar|valor total( da fatura)?|total desta fatura|fatura atual)\b/.test(fold(lines[i]!))) {
      const m = /(-?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2})/.exec(`${lines[i]} ${lines[i + 1] ?? ''}`);
      if (m) totalCents = parseMoneyBr(m[1]!);
    }
  }

  // ano de referência: o do fechamento ou do vencimento; senão o ano que mais aparece; senão o do relógio
  const refDate = closingOn ?? dueOn;
  let year = refDate ? Number(refDate.slice(0, 4)) : null;
  if (!year) {
    const years = new Map<string, number>();
    for (const y of text.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](20\d{2})\b/g)) years.set(y[1]!, (years.get(y[1]!) ?? 0) + 1);
    const common = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    year = common ? Number(common) : now.getUTCFullYear();
  }
  const refMonth = refDate ? Number(refDate.slice(5, 7)) : null;

  const entries: InvoiceEntry[] = [];
  const credits: InvoiceCredit[] = [];
  let skipped = 0;
  for (const raw of lines) {
    const d = parseLooseDate(raw);
    if (!d) continue;
    const am = INVOICE_AMT.exec(d.rest);
    if (!am) continue;
    let desc = d.rest.slice(0, am.index).trim();
    if (!desc || INVOICE_SKIP.test(fold(desc))) continue;
    const cents = parseMoneyBr(am[1]!);
    if (cents === null || cents === 0) {
      skipped += 1;
      continue;
    }
    // ano da compra: o da fatura; se o mês é bem depois do mês do fechamento, foi no ano anterior (fatura de janeiro com compra de dezembro)
    let y = d.year ?? year;
    if (!d.year && refMonth !== null && d.month > refMonth + 1) y -= 1;
    const date = isoOk(y, d.month, d.day);
    if (!date) {
      skipped += 1;
      continue;
    }
    const mark = (am[2] ?? '').toUpperCase();
    if (cents < 0 || mark === 'CR' || mark === 'C' || CREDIT_WORDS.test(fold(desc))) {
      credits.push({ date, amountCents: Math.abs(cents), note: desc.slice(0, 120) });
      continue;
    }
    let installmentNo: number | null = null;
    let installmentTotal: number | null = null;
    const ins = INSTALL.exec(desc);
    if (ins) {
      const a = Number(ins[1]);
      const b = Number(ins[2]);
      if (b >= 2 && b <= 60 && a >= 1 && a <= b && (/parc/i.test(desc) || /\s\d{1,2}\/\d{1,2}$/.test(desc))) {
        installmentNo = a;
        installmentTotal = b;
        desc = desc.slice(0, ins.index).replace(/\bparc(ela)?\.?\s*$/i, '').trim() || desc;
      }
    }
    entries.push({ date, amountCents: cents, note: desc.replace(/^[-–:\s]+|[-–:\s]+$/g, '').slice(0, 120) || 'Compra no cartão', installmentNo, installmentTotal });
  }

  const parsedCents = entries.reduce((s, e) => s + e.amountCents, 0) - credits.reduce((s, c) => s + c.amountCents, 0);
  const check = totalCents !== null && entries.length > 0 ? { ok: totalCents === parsedCents, expectedCents: totalCents, parsedCents } : null;
  return { entries, credits, skipped, meta: { closingOn, dueOn, totalCents, year }, check };
}
