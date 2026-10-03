// Simulador de cenários "e se...?": compara o mês de hoje com o mês depois de uma mudança (renda, custos, dívida) e
// projeta o saldo acumulado mês a mês. Cálculo puro em centavos; roda no servidor e no navegador (sliders instantâneos).

export interface ScenarioBase {
  incomeCents: number; // renda líquida mensal média
  essentialCents: number; // gastos essenciais mensais
  flexibleCents: number; // gastos variáveis/lazer mensais
  debtPaymentsCents: number; // parcelas de dívida por mês
  reserveCents: number; // dinheiro guardado hoje (reserva)
}

export interface ScenarioChange {
  newIncomeCents: number | null; // null = não muda
  essentialDeltaCents: number; // + aumenta custo (ex.: transporte), - reduz
  flexibleDeltaCents: number;
  extraDebtCents: number; // quanto a mais por mês vai para dívidas
  oneTimeCostCents: number; // custo único no mês 1 (mudança, curso, multa)
  gapMonths: number; // meses SEM renda até a nova começar (transição)
  months: number; // horizonte da projeção (6 a 60)
}

export interface ScenarioMonth {
  month: number;
  before: number; // saldo acumulado se nada mudar
  after: number; // saldo acumulado com a mudança
}

export interface ScenarioResult {
  beforeMonthlyCents: number; // sobra/falta mensal hoje
  afterMonthlyCents: number; // sobra/falta mensal depois (já passada a transição)
  deltaMonthlyCents: number;
  deltaYearlyCents: number;
  timeline: ScenarioMonth[];
  /** Menor saldo acumulado no cenário novo (o "fundo do poço" da transição). */
  lowestAfterCents: number;
  /** Mês em que o saldo acumulado do cenário novo passa o do cenário atual (null = nunca no horizonte). */
  breakEvenMonth: number | null;
  /** Mês em que o dinheiro guardado acaba no cenário novo (null = não acaba no horizonte). */
  reserveRunsOutMonth: number | null;
  verdict: 'melhora' | 'igual' | 'piora';
  warnings: string[];
}

export const DEFAULT_CHANGE: ScenarioChange = { newIncomeCents: null, essentialDeltaCents: 0, flexibleDeltaCents: 0, extraDebtCents: 0, oneTimeCostCents: 0, gapMonths: 0, months: 24 };

export function simulateScenario(base: ScenarioBase, change: ScenarioChange): ScenarioResult {
  const months = Math.max(6, Math.min(60, Math.round(change.months || 24)));
  const gap = Math.max(0, Math.min(months, Math.round(change.gapMonths || 0)));
  const income = change.newIncomeCents ?? base.incomeCents;
  const before = base.incomeCents - base.essentialCents - base.flexibleCents - base.debtPaymentsCents;
  const afterRegular = income - Math.max(0, base.essentialCents + change.essentialDeltaCents) - Math.max(0, base.flexibleCents + change.flexibleDeltaCents) - (base.debtPaymentsCents + Math.max(0, change.extraDebtCents));
  const afterGap = -Math.max(0, base.essentialCents + change.essentialDeltaCents) - Math.max(0, base.flexibleCents + change.flexibleDeltaCents) - base.debtPaymentsCents; // sem renda: sem o extra para dívida
  let accBefore = base.reserveCents;
  let accAfter = base.reserveCents;
  let lowest = base.reserveCents;
  let breakEven: number | null = null;
  let runsOut: number | null = null;
  const timeline: ScenarioMonth[] = [{ month: 0, before: accBefore, after: accAfter }];
  for (let m = 1; m <= months; m += 1) {
    accBefore += before;
    accAfter += m <= gap ? afterGap : afterRegular;
    if (m === 1) accAfter -= Math.max(0, change.oneTimeCostCents);
    lowest = Math.min(lowest, accAfter);
    if (runsOut === null && accAfter < 0 && base.reserveCents >= 0) runsOut = m;
    if (breakEven === null && m > gap && accAfter >= accBefore && afterRegular > before) breakEven = m;
    timeline.push({ month: m, before: accBefore, after: accAfter });
  }
  const delta = afterRegular - before;
  const warnings: string[] = [];
  if (afterRegular < 0) warnings.push('Neste cenário o mês fecha no vermelho: gasta mais do que entra.');
  if (gap > 0 && base.reserveCents < gap * (-afterGap)) warnings.push(`A reserva atual não cobre os ${gap} mês(es) sem renda.`);
  if (runsOut !== null) warnings.push(`O dinheiro guardado acaba no mês ${runsOut} deste cenário.`);
  if (base.incomeCents <= 0) warnings.push('Sem renda lançada nos últimos meses: os números partem de zero.');
  return {
    beforeMonthlyCents: before,
    afterMonthlyCents: afterRegular,
    deltaMonthlyCents: delta,
    deltaYearlyCents: delta * 12 - Math.max(0, change.oneTimeCostCents),
    timeline,
    lowestAfterCents: lowest,
    breakEvenMonth: breakEven,
    reserveRunsOutMonth: runsOut,
    verdict: Math.abs(delta) < 5000 && gap === 0 && change.oneTimeCostCents === 0 ? 'igual' : delta >= 0 ? 'melhora' : 'piora',
    warnings,
  };
}

/** Modelos prontos: preenchem o formulário com um ponto de partida que a pessoa ajusta. */
export const SCENARIO_PRESETS: { id: string; title: string; hint: string; build: (b: ScenarioBase) => ScenarioChange }[] = [
  { id: 'novo_emprego', title: 'Mudar de emprego', hint: 'Salário novo, transporte diferente e uns meses de transição.', build: (b) => ({ ...DEFAULT_CHANGE, newIncomeCents: Math.round(b.incomeCents * 1.2), essentialDeltaCents: 15000, gapMonths: 1 }) },
  { id: 'cortar_jornada', title: 'Reduzir a jornada', hint: 'Ganhar menos para ter mais tempo: quanto isso pesa no mês?', build: (b) => ({ ...DEFAULT_CHANGE, newIncomeCents: Math.round(b.incomeCents * 0.8) }) },
  { id: 'cortar_gastos', title: 'Cortar gastos variáveis', hint: 'E se os gastos variáveis caírem 20%?', build: (b) => ({ ...DEFAULT_CHANGE, flexibleDeltaCents: -Math.round(b.flexibleCents * 0.2) }) },
  { id: 'quitar_divida', title: 'Atacar a dívida com um extra', hint: 'Mandar um valor a mais por mês para as dívidas.', build: (b) => ({ ...DEFAULT_CHANGE, extraDebtCents: Math.max(10000, Math.round(b.incomeCents * 0.1)) }) },
  { id: 'mudar_casa', title: 'Mudar de casa', hint: 'Aluguel diferente e custo da mudança.', build: () => ({ ...DEFAULT_CHANGE, essentialDeltaCents: 30000, oneTimeCostCents: 300000 }) },
  { id: 'renda_extra', title: 'Começar uma renda extra', hint: 'Mais uma entrada por mês, sem mexer no resto.', build: (b) => ({ ...DEFAULT_CHANGE, newIncomeCents: b.incomeCents + 50000 }) },
];
