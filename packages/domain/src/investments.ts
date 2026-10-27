// Investimentos lançados à mão (Desbravador): posição, rendimento e imposto estimados.
// Não é recomendação de investimento: são contas simples sobre o que a pessoa informou. O valor oficial é o do app da corretora.

export type InvestIndexer = 'cdi' | 'selic' | 'ipca' | 'prefixado' | 'poupanca' | 'outro';
export type InvestStatus = 'ativo' | 'processando' | 'resgatado';

export interface InvestmentInput {
  appliedCents: number;
  indexer: InvestIndexer;
  /** CDI/Selic: percentual do índice (102 = 102% do CDI). Prefixado: % ao ano. IPCA: taxa real % ao ano acima da inflação. */
  ratePct: number;
  appliedOn: string; // AAAA-MM-DD
  status: InvestStatus;
  /** Posição informada pela pessoa (a do app da corretora). Se vier, vale mais que a estimativa. */
  positionCents?: number | null;
}

export interface MarketRates {
  cdiAnnualPct: number | null;
  ipcaAnnualPct?: number | null;
}

export interface InvestmentView {
  positionCents: number;
  yieldCents: number;
  yieldPct: number;
  /** true quando a posição foi calculada aqui (não informada). */
  estimated: boolean;
  daysHeld: number;
  /** Alíquota de IR da tabela regressiva (renda fixa) para o prazo atual. */
  irPct: number;
  /** Rendimento depois do IR, se resgatasse hoje. */
  netYieldCents: number;
}

const DAY = 86_400_000;
const t = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
export const investDaysBetween = (from: string, to: string): number => Math.max(0, Math.round((t(to) - t(from)) / DAY));

/** Dias úteis (segunda a sexta) depois de `from` até `to`, inclusive. Sem feriados: serve para estimar. */
export function businessDays(from: string, to: string): number {
  let n = 0;
  for (let d = t(from) + DAY; d <= t(to); d += DAY) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/** Tabela regressiva do IR sobre o rendimento de renda fixa (CDB, Tesouro, debêntures comuns). */
export const irPctForDays = (days: number): number => (days <= 180 ? 22.5 : days <= 360 ? 20 : days <= 720 ? 17.5 : 15);

/** Próximo degrau da tabela regressiva: quantos dias faltam e qual passa a ser a alíquota. */
export function nextIrStep(days: number): { inDays: number; toPct: number } | null {
  const steps: Array<[number, number]> = [[181, 20], [361, 17.5], [721, 15]];
  const s = steps.find(([d]) => days < d);
  return s ? { inDays: s[0] - days, toPct: s[1] } : null;
}

/** Rendimento anual nominal estimado (% ao ano) do ativo, ou null se não dá para estimar. */
export function annualYieldPct(inv: Pick<InvestmentInput, 'indexer' | 'ratePct'>, rates: MarketRates): number | null {
  if (inv.indexer === 'cdi' || inv.indexer === 'selic') return rates.cdiAnnualPct === null ? null : (rates.cdiAnnualPct * inv.ratePct) / 100;
  if (inv.indexer === 'prefixado') return inv.ratePct;
  if (inv.indexer === 'ipca') return rates.ipcaAnnualPct == null ? null : ((1 + rates.ipcaAnnualPct / 100) * (1 + inv.ratePct / 100) - 1) * 100;
  return null;
}

/** Posição estimada (bruta de IR) hoje, por dias úteis (252 ao ano). */
export function estimatePositionCents(inv: InvestmentInput, today: string, rates: MarketRates): number | null {
  if (inv.status === 'processando') return inv.appliedCents;
  const bd = businessDays(inv.appliedOn, today);
  if (inv.indexer === 'cdi' || inv.indexer === 'selic') {
    if (rates.cdiAnnualPct === null) return null;
    const daily = Math.pow(1 + rates.cdiAnnualPct / 100, 1 / 252) - 1;
    return Math.round(inv.appliedCents * Math.pow(1 + (daily * inv.ratePct) / 100, bd));
  }
  const a = annualYieldPct(inv, rates);
  if (a === null) return null;
  return Math.round(inv.appliedCents * Math.pow(1 + a / 100, bd / 252));
}

export function viewInvestment(inv: InvestmentInput, today: string, rates: MarketRates): InvestmentView {
  const informed = inv.positionCents ?? null;
  const est = informed === null ? estimatePositionCents(inv, today, rates) : null;
  const positionCents = informed ?? est ?? inv.appliedCents;
  const yieldCents = positionCents - inv.appliedCents;
  const daysHeld = investDaysBetween(inv.appliedOn, today);
  const irPct = irPctForDays(daysHeld);
  return {
    positionCents, yieldCents,
    yieldPct: inv.appliedCents > 0 ? Math.round((yieldCents / inv.appliedCents) * 10_000) / 100 : 0,
    estimated: informed === null && est !== null,
    daysHeld, irPct,
    netYieldCents: yieldCents > 0 ? Math.round(yieldCents * (1 - irPct / 100)) : yieldCents,
  };
}

export interface InvestmentTotals {
  appliedCents: number;
  positionCents: number;
  yieldCents: number;
  yieldPct: number;
  count: number;
  processingCents: number;
  processingCount: number;
}

/** Totais da carteira: "ativos" entram no total investido; "processando" (aplicação ainda não creditada) ficam à parte. */
export function summarizeInvestments(list: Array<{ input: InvestmentInput }>, today: string, rates: MarketRates): InvestmentTotals {
  const out: InvestmentTotals = { appliedCents: 0, positionCents: 0, yieldCents: 0, yieldPct: 0, count: 0, processingCents: 0, processingCount: 0 };
  for (const { input } of list) {
    if (input.status === 'resgatado') continue;
    if (input.status === 'processando') {
      out.processingCents += input.appliedCents;
      out.processingCount += 1;
      continue;
    }
    const v = viewInvestment(input, today, rates);
    out.appliedCents += input.appliedCents;
    out.positionCents += v.positionCents;
    out.yieldCents += v.yieldCents;
    out.count += 1;
  }
  out.yieldPct = out.appliedCents > 0 ? Math.round((out.yieldCents / out.appliedCents) * 10_000) / 100 : 0;
  return out;
}
