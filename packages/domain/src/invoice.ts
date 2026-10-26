// Leitura inteligente de fatura de cartão em PDF (texto já extraído no aparelho). Entende o que a fatura diz sobre si mesma:
// qual cartão é, limite, período, vencimento, saldo anterior, o que foi pago, compras (inclusive em dólar/euro, com o IOF no valor),
// e de qual fatura é cada pagamento. Também reconhece se o PDF é fatura ou extrato de conta, e quando uma linha do extrato é pagamento de fatura.
// Cálculo puro e determinístico, em centavos; nada aqui lê relógio nem rede.
import { parseMoneyBr } from './account.ts';
import { addMonthsIso } from './calendar.ts';

export type DocumentKind = 'fatura' | 'extrato' | 'desconhecido';

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Como o PDF entrega o texto, com espaços e quebras irregulares ("Total a   Pagar"), para comparar frases. */
const squash = (t: string) => fold(t).replace(/\s+/g, ' ');
const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoOk = (y: number, m: number, d: number): string | null => (m < 1 || m > 12 || d < 1 || d > daysIn(y, m) || y < 2000 || y > 2100 ? null : `${y}-${pad(m)}-${pad(d)}`);
const money = (raw: string): number | null => parseMoneyBr(raw.replace(/R\$\s?/i, ''));

/** "fatura" se o texto tem a cara de uma fatura de cartão; "extrato" se parece extrato de conta; senão "desconhecido". */
export function detectDocumentKind(text: string): DocumentKind {
  const t = squash(text);
  const invoiceHits = [
    /fatura/, /vencimento/, /pagamento minimo/, /limite (disponivel|utilizado|total)|seu limite/, /total (desta )?fatura|saldo desta fatura|total a pagar/,
    /detalhamento da fatura|resumo da fatura|compras e pagamentos realizados/, /rotativo|parcelamento de fatura/, /melhor dia (para )?compras?/,
  ].filter((re) => re.test(t)).length;
  if (/fatura/.test(t) && invoiceHits >= 4) return 'fatura';
  const statementHits = [/extrato/, /saldo (anterior|final|disponivel|do dia|em conta)/, /conta[- ]corrente/, /agencia/, /lancamentos|movimentacao/].filter((re) => re.test(t)).length;
  return statementHits >= 2 ? 'extrato' : 'desconhecido';
}

/** A linha do extrato da conta é pagamento de fatura de cartão? "forte" = o texto diz; "possivel" = só diz que pagou boleto a um banco (confirmar pelo valor). */
export function cardPaymentHint(note: string): 'forte' | 'possivel' | null {
  const t = squash(note);
  if (/(pagamento|pgto|pag\.?)\s*(de\s*)?(da\s*)?fatura|fatura\s*(do\s*)?(cartao|cc|master|visa|elo)|(cartao|cartoes)\s*de\s*credito|pagto?\s*cartao|pagamento\s*(de\s*)?cartao|pgto\s*cart|debito\s*automatico\s*fatura/.test(t)) return 'forte';
  if (/pagamento de boleto(?!.*outros bancos).*(banco|santander|itau|bradesco|nubank|inter\b|caixa|c6|xp\b|porto|next|original|safra|btg|mercado pago)/.test(t)) return 'possivel';
  return null;
}

// ---------------------------------------------------------------------------
// Fatura
// ---------------------------------------------------------------------------
export interface InvoiceLine {
  /** Data do lançamento nesta fatura (parcela já deslocada para o mês dela). */
  date: string;
  /** Gasto, positivo. Compra no exterior já vem com o IOF somado. */
  amountCents: number;
  note: string;
  installmentNo: number | null;
  installmentTotal: number | null;
  /** Final do cartão (titular, adicional ou virtual) a que a linha pertence. */
  cardLast4: string | null;
  iofCents: number;
  /** Valor em moeda estrangeira, quando a fatura informa ("35,48 EURO"). */
  foreign: string | null;
}
export interface InvoiceMoney {
  date: string;
  /** Positivo: abate a fatura. */
  amountCents: number;
  note: string;
}
export interface InvoiceHistoryRow {
  key: string;
  label: string;
  totalCents: number;
  paidCents: number | null;
  periodStart: string;
  periodEnd: string;
  state: 'paga' | 'esta' | 'aberta';
}
export interface InvoiceDoc {
  card: { name: string | null; brand: string | null; last4s: string[]; primaryLast4: string | null; limitCents: number | null; usedCents: number | null; availableCents: number | null };
  invoice: {
    /** Mês de fechamento, AAAA-MM: é assim que o Prumo identifica cada fatura. */
    key: string | null;
    periodStart: string | null;
    closingOn: string | null;
    dueOn: string | null;
    totalCents: number | null;
    minPaymentCents: number | null;
    previousCents: number | null;
    paymentsCents: number | null;
    refundsCents: number | null;
    domesticCents: number | null;
    foreignCents: number | null;
  };
  history: InvoiceHistoryRow[];
  entries: InvoiceLine[];
  /** Pagamentos feitos nesta fatura: quitam a fatura ANTERIOR (a de `previousKey`). */
  payments: InvoiceMoney[];
  refunds: InvoiceMoney[];
  previousKey: string | null;
  byCard: { last4: string | null; totalCents: number }[];
  skipped: number;
  /** O que aconteceu com a fatura anterior: o saldo anterior foi pago por inteiro? */
  previous: { status: 'quitada' | 'parcial' | 'sem_pagamento' | 'sem_saldo' | 'desconhecido'; leftCents: number };
  /** Compras − estornos lidos batem com o que a fatura informa (total menos o que sobrou da anterior)? */
  check: { ok: boolean; expectedCents: number; parsedCents: number } | null;
}

const MON3: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const AMT = '(-?\\s?(?:R\\$\\s?)?\\d{1,3}(?:\\.\\d{3})*,\\d{2}-?)';
const TRAIL_AMT = new RegExp(`${AMT}\\s*$`, 'i');
const SECTION: Record<string, 'payments' | 'installments' | 'expenses'> = { 'pagamento e demais creditos': 'payments', 'pagamentos e creditos': 'payments', parcelamentos: 'installments', despesas: 'expenses' };
const PAYMENT_WORDS = /^(pagamento|pgto|pag\.?\s*fatura|debito automatico|credito de pagamento)/i;
const FOREIGN = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(euro|eur|usd|dolar|libra|gbp|iene|jpy|cad|aud|chf)\b/i;

function looseDate(raw: string): { day: number; month: number; year: number | null; rest: string } | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?!\d)\s*(.*)$/.exec(raw.trim());
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null, rest: m[4] ?? '' };
  const w = /^(\d{1,2})\s+(?:de\s+)?([A-Za-zÀ-ú]{3})[A-Za-zÀ-ú]*\.?(?:\s+(?:de\s+)?(\d{4}))?(?!\d)\s*(.*)$/.exec(raw.trim());
  if (w && MON3[fold(w[2]!)]) return { day: Number(w[1]), month: MON3[fold(w[2]!)]!, year: w[3] ? Number(w[3]) : null, rest: w[4] ?? '' };
  return null;
}
const slashDate = (s: string): string | null => {
  const m = /(\d{2})\/(\d{2})\/(\d{2,4})/.exec(s);
  return m ? isoOk(m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1])) : null;
};
const monthKey = (iso: string) => iso.slice(0, 7);
const prevKeyOf = (key: string) => monthKey(addMonthsIso(`${key}-01`, -1));

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (_m, a: string, b: string) => `${a}${b.toUpperCase()}`);
}

/** Primeiro valor em reais que aparece depois do rótulo (na mesma linha ou na seguinte). */
function afterLabel(lines: string[], label: RegExp): number | null {
  for (let i = 0; i < lines.length; i++) {
    const hit = label.exec(fold(lines[i]!));
    if (!hit) continue;
    const tail = `${lines[i]!.slice(hit.index + hit[0].length)} ${lines[i + 1] ?? ''}`;
    const m = /(-?\s?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2})/.exec(tail);
    if (m) return money(m[1]!);
  }
  return null;
}

export function parseInvoiceDocument(text: string, now: Date = new Date()): InvoiceDoc {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = lines.join(' ');

  // ---- cartão ----
  const nameM = /fatura do seu cart[aã]o\s+([A-Za-zÀ-ú0-9 ]+?)\s+contendo/i.exec(flat) ?? /cart[aã]o\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 ]{4,40}?)\s+(?:contendo|final)/.exec(flat);
  const rawName = nameM ? nameM[1]!.replace(/\s+/g, ' ').trim() : null;
  const brand = ['mastercard', 'visa', 'elo', 'amex', 'hipercard'].find((b) => new RegExp(b, 'i').test(rawName ?? flat.slice(0, 3000))) ?? null;
  const last4s = [...new Set([...flat.matchAll(/(?:X{2,4}|\*{2,4})\s*(?:X{2,4}|\*{2,4})?\s*(\d{4})\b/gi)].map((m) => m[1]!))];
  const limitCents = afterLabel(lines, /seu limite (e|é)?\s*|limite total\s*/);
  const usedCents = afterLabel(lines, /limite utilizado\s*/);
  const availableCents = afterLabel(lines, /limite dispon[ií]vel:?\s*/);

  // ---- histórico de faturas (mês, total, pago, período) ----
  const history: InvoiceHistoryRow[] = [];
  const histRe = /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\.?\s+R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2})\s+(?:R\$\s?(\d{1,3}(?:\.\d{3})*,\d{2})|(Esta Fatura)|(Fatura Aberta))\s+(\d{2}\/\d{2}\/\d{2,4})\s+a\s+(\d{2}\/\d{2}\/\d{2,4})/g;
  for (const m of flat.matchAll(histRe)) {
    const start = slashDate(m[6]!);
    const end = slashDate(m[7]!);
    if (!start || !end) continue;
    history.push({ key: monthKey(end), label: m[1]!, totalCents: money(m[2]!) ?? 0, paidCents: m[3] ? money(m[3]) : null, periodStart: start, periodEnd: end, state: m[4] ? 'esta' : m[5] ? 'aberta' : 'paga' });
  }
  const thisRow = history.find((h) => h.state === 'esta') ?? null;

  // ---- datas e totais da fatura ----
  const labeled = (label: RegExp): string | null => {
    for (let i = 0; i < lines.length; i++) {
      const hit = label.exec(fold(lines[i]!));
      if (!hit) continue;
      const d = slashDate(`${lines[i]!.slice(hit.index + hit[0].length)} ${lines[i + 1] ?? ''}`);
      if (d) return d;
    }
    return null;
  };
  const dueOn = labeled(/^vencimento\b/) ?? labeled(/vencimento\b/);
  const untilM = /realizados at[eé]\s+(\d{1,2})\/(\d{1,2})/i.exec(flat);
  let closingOn: string | null = labeled(/fechamento\b/) ?? thisRow?.periodEnd ?? null;
  if (!closingOn && untilM) {
    const y = dueOn ? Number(dueOn.slice(0, 4)) : now.getUTCFullYear();
    closingOn = isoOk(y, Number(untilM[2]), Number(untilM[1]));
  }
  const key = closingOn ? monthKey(closingOn) : null;
  const periodStart = thisRow?.periodStart ?? null;

  // total da fatura, do rótulo mais confiável para o menos: o "Saldo desta fatura" do resumo, o "Total desta fatura" do boleto,
  // "Total a Pagar" sozinho na linha. Nunca o "valor total a pagar" do parcelamento ofertado (que inclui juros).
  const saldoDesta = afterLabel(lines, /saldo desta fatura\s*/);
  const totalDesta = afterLabel(lines, /total desta fatura\s*(r\$)?/);
  let totalAPagar: number | null = null;
  for (let i = 0; i < lines.length && totalAPagar === null; i++) {
    if (/^total a pagar\b/.test(fold(lines[i]!)) && !/parcel|juros|cet/.test(fold(lines[i]!))) {
      const m = /(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(`${lines[i]} ${lines[i + 1] ?? ''}`);
      if (m) totalAPagar = money(m[1]!);
    }
  }
  const totalCents = saldoDesta ?? totalDesta ?? totalAPagar ?? thisRow?.totalCents ?? null;
  const minPaymentCents = afterLabel(lines, /pagamento m[ií]nimo\s*(r\$)?/);
  const previousCents = afterLabel(lines, /saldo anterior\s*/);
  const paymentsTotal = afterLabel(lines, /\(-\)\s*total de pagamentos\s*/);
  const refundsTotal = afterLabel(lines, /\(-\)\s*total de cr[eé]ditos\s*/);
  const domesticCents = afterLabel(lines, /total despesas\/d[eé]bitos no brasil\s*/);
  const foreignCents = afterLabel(lines, /total despesas\/d[eé]bitos no exterior\s*/);

  // ano de referência para datas sem ano: o do fechamento (ou vencimento)
  const refYear = Number((closingOn ?? dueOn ?? `${now.getUTCFullYear()}-01-01`).slice(0, 4));
  const dateOf = (day: number, month: number, explicitYear: number | null): string | null => {
    if (explicitYear) return isoOk(explicitYear, month, day);
    const same = isoOk(refYear, month, day);
    if (same && (!closingOn || same <= closingOn)) return same;
    return isoOk(refYear - 1, month, day) ?? same; // fatura de janeiro com compra de dezembro
  };

  // ---- linhas ----
  const entries: InvoiceLine[] = [];
  const payments: InvoiceMoney[] = [];
  const refunds: InvoiceMoney[] = [];
  let skipped = 0;
  let section: 'payments' | 'installments' | 'expenses' | null = null;
  let cardLast4: string | null = null;
  const byCard = new Map<string | null, number>();
  const add = (l: InvoiceLine) => { entries.push(l); byCard.set(l.cardLast4, (byCard.get(l.cardLast4) ?? 0) + l.amountCents); };

  for (const raw of lines) {
    const f = fold(raw);
    if (SECTION[f]) { section = SECTION[f]!; continue; }
    const cardHdr = /(?:x{2,4}|\*{2,4})\s*(?:x{2,4}|\*{2,4})?\s*(\d{4})\s*$/i.exec(raw);
    if (cardHdr && /-\s*\d{4}\s*x/i.test(raw)) { cardLast4 = cardHdr[1]!; continue; }
    if (/^cota[cç][aã]o/i.test(raw)) continue;
    // IOF de compra no exterior vem em linha própria, logo abaixo da compra: soma ao valor dela (é o gasto de verdade)
    const iof = /^iof despesa no exterior\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/i.exec(raw);
    if (iof) {
      const last = entries[entries.length - 1];
      const v = money(iof[1]!);
      if (last && v) { last.amountCents += v; last.iofCents += v; byCard.set(last.cardLast4, (byCard.get(last.cardLast4) ?? 0) + v); }
      continue;
    }
    // juros e IOF de parcelamento ("*Juros = 8,85 / IOF = 1,20"): já estão dentro do valor da linha de cima; só avisamos na descrição
    const fin = /\*?juros\s*=\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*\/\s*iof\s*=\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(raw);
    if (fin) {
      const last = entries[entries.length - 1];
      const total = (money(fin[1]!) ?? 0) + (money(fin[2]!) ?? 0);
      if (last && total > 0 && !/inclui juros/i.test(last.note)) last.note = `${last.note} (inclui R$ ${(total / 100).toFixed(2).replace('.', ',')} de juros e IOF)`.slice(0, 100);
      continue;
    }

    // tira "@ " e o número de sequência que alguns bancos põem antes da data ("3 17/07 POSTO ...")
    const clean = raw.replace(/^@\s*/, '').replace(/^\d{1,2}\s+(?=\d{1,2}\/\d{2}\b)/, '');
    const d = looseDate(clean);
    if (!d) continue;
    const am = TRAIL_AMT.exec(d.rest);
    if (!am) continue;
    let cents = money(am[1]!);
    let before = d.rest.slice(0, am.index).trim();
    // duas colunas no fim da linha (R$ e US$): o primeiro valor é em reais
    const two = TRAIL_AMT.exec(before);
    if (two && cents !== null) {
      const first = money(two[1]!);
      if (first !== null && first > 0) { cents = first; before = before.slice(0, two.index).trim(); }
    }
    if (!before || /^(total|valor|saldo|subtotal)\b/i.test(fold(before))) continue;
    if (cents === null) { skipped += 1; continue; }
    const date = dateOf(d.day, d.month, d.year);
    if (!date) { skipped += 1; continue; }
    const isCredit = cents < 0 || section === 'payments' || PAYMENT_WORDS.test(fold(before));
    if (isCredit) {
      const v = Math.abs(cents);
      if (v === 0) continue;
      const item: InvoiceMoney = { date, amountCents: v, note: before.replace(/\s+/g, ' ').slice(0, 100) };
      (PAYMENT_WORDS.test(fold(before)) || /fatura/.test(fold(before)) ? payments : refunds).push(item);
      continue;
    }
    if (cents === 0) continue; // anuidade zerada, por exemplo
    let note = before;
    let foreign: string | null = null;
    const fm = FOREIGN.exec(note);
    if (fm) { foreign = `${fm[1]} ${fm[2]!.toUpperCase()}`; note = note.replace(FOREIGN, '').replace(/\s+/g, ' ').trim(); }
    let installmentNo: number | null = null;
    let installmentTotal: number | null = null;
    const ins = /(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(note);
    if (ins) {
      const a = Number(ins[1]);
      const b = Number(ins[2]);
      if (b >= 2 && b <= 60 && a >= 1 && a <= b) { installmentNo = a; installmentTotal = b; }
      note = note.slice(0, ins.index).trim() || note; // "01/01" não é parcelamento, só o jeito da fatura escrever
    }
    note = note.replace(/^[-–:\s]+|[-–:\s]+$/g, '');
    // parcela: a fatura mostra a data da compra original; o lançamento vai para o mês desta parcela
    let when = date;
    if (installmentNo && installmentNo > 1) {
      const shifted = addMonthsIso(date, installmentNo - 1);
      if ((!closingOn || shifted <= closingOn) && (!periodStart || shifted >= addMonthsIso(periodStart, -1))) when = shifted;
    }
    add({ date: when, amountCents: cents, note: (foreign ? `${note} (${foreign})` : note).slice(0, 100) || 'Compra no cartão', installmentNo, installmentTotal, cardLast4, iofCents: 0, foreign });
  }

  // ---- diagnóstico da fatura anterior e conferência ----
  const paidNow = paymentsTotal ?? payments.reduce((s, p) => s + p.amountCents, 0);
  let previous: InvoiceDoc['previous'] = { status: 'desconhecido', leftCents: 0 };
  if (previousCents !== null) {
    if (previousCents === 0) previous = { status: 'sem_saldo', leftCents: 0 };
    else if (paidNow >= previousCents) previous = { status: 'quitada', leftCents: 0 };
    else previous = { status: paidNow > 0 ? 'parcial' : 'sem_pagamento', leftCents: previousCents - paidNow };
  }
  const parsedCents = entries.reduce((s, e) => s + e.amountCents, 0) - refunds.reduce((s, r) => s + r.amountCents, 0);
  const carry = previous.status === 'desconhecido' ? 0 : previous.leftCents;
  const check = totalCents !== null && entries.length > 0 ? { ok: Math.abs(totalCents - carry - parsedCents) <= 1, expectedCents: totalCents - carry, parsedCents } : null;

  const primaryLast4 = last4s[0] ?? null;
  return {
    card: { name: rawName ? titleCase(rawName) : null, brand, last4s, primaryLast4, limitCents, usedCents, availableCents },
    invoice: { key, periodStart, closingOn, dueOn, totalCents, minPaymentCents, previousCents, paymentsCents: paymentsTotal, refundsCents: refundsTotal, domesticCents, foreignCents },
    history, entries, payments, refunds, previousKey: key ? prevKeyOf(key) : null,
    byCard: [...byCard.entries()].map(([last4, total]) => ({ last4, totalCents: total })),
    skipped, previous, check,
  };
}

const foldName = (s: string | null | undefined): string => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export interface CardLike { id: string; name: string; last4: string | null; limitCents: number; closingDay: number; dueDay: number }

/** Qual cartão cadastrado é o da fatura? Pelo final (qualquer um dos finais da fatura) e, na falta dele, pelo nome. Ambíguo ou desconhecido: null. */
export function matchInvoiceCard<T extends CardLike>(cards: T[], doc: InvoiceDoc): T | null {
  const byLast4 = cards.filter((c) => c.last4 && doc.card.last4s.includes(c.last4));
  if (byLast4.length === 1) return byLast4[0]!;
  const name = foldName(doc.card.name);
  if (!name) return null;
  const byName = cards.filter((c) => foldName(c.name) && (name.includes(foldName(c.name)) || foldName(c.name).includes(name)));
  return byName.length === 1 ? byName[0]! : null;
}

/** O que a fatura informa de diferente do cadastro do cartão (só o que ela de fato traz). `availableCents` é o limite disponível do dia da fatura. */
export function invoiceCardChanges(c: CardLike, doc: InvoiceDoc): { limitCents?: number; closingDay?: number; dueDay?: number; last4?: string; availableCents?: number } {
  const want = cardFromInvoice(doc);
  const out: { limitCents?: number; closingDay?: number; dueDay?: number; last4?: string; availableCents?: number } = {};
  if (doc.card.limitCents && doc.card.limitCents !== c.limitCents) out.limitCents = doc.card.limitCents;
  if (doc.invoice.closingOn && want.closingDay !== c.closingDay) out.closingDay = want.closingDay;
  if (doc.invoice.dueOn && want.dueDay !== c.dueDay) out.dueDay = want.dueDay;
  if (!c.last4 && want.last4) out.last4 = want.last4;
  if (doc.card.availableCents !== null) out.availableCents = doc.card.availableCents;
  return out;
}

/** O corpo que a importação de fatura espera (o mesmo no site e no WhatsApp). `skip` são as compras que a pessoa desmarcou. */
export function invoiceImportBody(doc: InvoiceDoc, opts: { skip?: Set<number>; card?: ReturnType<typeof invoiceCardChanges> | undefined } = {}) {
  const inv = doc.invoice;
  return {
    entries: doc.entries.filter((_, i) => !opts.skip?.has(i)).map((e) => ({ date: e.date, amountCents: e.amountCents, note: e.note, installmentNo: e.installmentNo, installmentTotal: e.installmentTotal })),
    credits: doc.refunds.map((x) => ({ date: x.date, amountCents: x.amountCents, note: x.note })),
    payments: doc.payments.map((x) => ({ date: x.date, amountCents: x.amountCents, note: x.note })),
    ...(inv.key && inv.closingOn && inv.totalCents !== null ? {
      invoice: {
        key: inv.key, periodStart: inv.periodStart, closingOn: inv.closingOn, dueOn: inv.dueOn, totalCents: inv.totalCents, minPaymentCents: inv.minPaymentCents, previousCents: inv.previousCents, previousKey: doc.previousKey,
        history: doc.history.filter((h) => h.state === 'paga' && h.key !== inv.key).map((h) => ({ key: h.key, periodStart: h.periodStart, closingOn: h.periodEnd, totalCents: h.totalCents, paidCents: h.paidCents })),
      },
    } : {}),
    ...(opts.card && Object.keys(opts.card).length ? { card: opts.card } : {}),
  };
}

/** Dados sugeridos para cadastrar o cartão a partir da fatura. */
export function cardFromInvoice(doc: InvoiceDoc): { name: string; brand: string; last4: string | null; limitCents: number; closingDay: number; dueDay: number } {
  const closing = doc.invoice.closingOn;
  const day = closing ? Number(closing.slice(8, 10)) : 0;
  // o ciclo do Prumo manda a compra do dia de fechamento para a fatura seguinte; o PDF informa o último dia da fatura, então o fechamento é o dia seguinte
  const closingDay = closing ? (day + 1 > daysIn(Number(closing.slice(0, 4)), Number(closing.slice(5, 7))) ? 1 : day + 1) : 1;
  return {
    name: (doc.card.name ?? 'Cartão importado').slice(0, 40),
    brand: doc.card.brand ?? 'outra',
    last4: doc.card.primaryLast4,
    limitCents: doc.card.limitCents ?? 0,
    closingDay,
    dueDay: doc.invoice.dueOn ? Number(doc.invoice.dueOn.slice(8, 10)) : 10,
  };
}
