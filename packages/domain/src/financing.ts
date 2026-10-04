// Comparador honesto de financiamento: compara propostas de crédito pelo que elas custam DE VERDADE (CET e total pago),
// não pela parcela. Cálculo puro em centavos, sem rede e sem IA. Resultado indicativo: o contrato do banco é o que vale.
import { formatBrl } from './calendar.ts';

export type FinancingKind = 'veiculo' | 'imovel' | 'pessoal' | 'outro';
export type AmortSystem = 'price' | 'sac';

export interface FinancingOffer {
  name: string;
  termMonths: number;
  /** Juros nominais ao mês, em pontos-base (1,5% = 150). */
  monthlyRateBps: number;
  system: AmortSystem;
  /** Pago no ato: IOF, tarifas de avaliação/registro, seguros pagos à vista etc. */
  upfrontFeesCents: number;
  /** Cobrado todo mês além da parcela: seguro prestamista, tarifa de manutenção. */
  monthlyExtrasCents: number;
}

export interface FinancingInput {
  kind: FinancingKind;
  priceCents: number;
  downPaymentCents: number;
  netIncomeCents?: number | undefined;
  /** Quanto a pessoa consegue guardar por mês: serve para mostrar o custo de esperar e comprar à vista. */
  savingMonthlyCents?: number | undefined;
  offers: FinancingOffer[];
}

export interface OfferResult {
  name: string;
  system: AmortSystem;
  termMonths: number;
  financedCents: number;
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  totalPaidCents: number; // tudo que sai do bolso no contrato (parcelas, extras e tarifas do ato)
  costOfCreditCents: number; // total pago - valor financiado
  costPctOfFinanced: number; // custo do crédito sobre o valor financiado, em %
  cetMonthlyPct: number;
  cetAnnualPct: number;
  nominalRateMonthlyPct: number;
  incomeSharePct: number | null; // 1ª parcela / renda líquida
  flags: OfferFlag[];
}

export type OfferFlagCode = 'cet_above_rate' | 'upfront_fees' | 'monthly_extras' | 'income_heavy' | 'income_tight' | 'long_vehicle_term' | 'zero_rate' | 'down_payment_zero';
export interface OfferFlag {
  code: OfferFlagCode;
  tone: 'attention' | 'info';
  text: string;
}

export interface FinancingResult {
  priceCents: number;
  downPaymentCents: number;
  financedCents: number;
  offers: OfferResult[];
  /** Índices de `offers` do mais barato (menor CET) para o mais caro. */
  ranking: number[];
  bestIndex: number;
  worstIndex: number;
  /** Quanto a mais o contrato mais caro custa em relação ao mais barato (total pago). */
  spreadCents: number;
  waiting: { months: number; avoidedCostCents: number } | null;
  tips: string[];
  questions: string[];
}

export class FinancingInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Dados do financiamento inválidos: ${issues.join('; ')}`);
    this.name = 'FinancingInputError';
    this.issues = issues;
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Parcelas mês a mês (centavos inteiros). A última absorve o resto do arredondamento, e o saldo fecha em zero. */
export function installments(principalCents: number, termMonths: number, monthlyRateBps: number, system: AmortSystem): number[] {
  const i = monthlyRateBps / 10_000;
  const out: number[] = [];
  if (system === 'price') {
    const pmt = i === 0 ? principalCents / termMonths : (principalCents * i) / (1 - Math.pow(1 + i, -termMonths));
    let balance = principalCents;
    for (let k = 1; k <= termMonths; k += 1) {
      const interest = Math.round(balance * i);
      let pay = Math.round(pmt);
      if (k === termMonths) pay = balance + interest;
      balance = balance + interest - pay;
      out.push(pay);
    }
  } else {
    const amort = principalCents / termMonths;
    let balance = principalCents;
    for (let k = 1; k <= termMonths; k += 1) {
      const interest = Math.round(balance * i);
      const a = k === termMonths ? balance : Math.round(amort);
      out.push(a + interest);
      balance -= a;
    }
  }
  return out;
}

/** Taxa mensal que iguala o que a pessoa recebe (valor financiado - tarifas do ato) ao valor presente das parcelas. */
export function monthlyIrr(netReceivedCents: number, payments: number[]): number {
  const npv = (r: number) => payments.reduce((s, p, k) => s + p / Math.pow(1 + r, k + 1), 0) - netReceivedCents;
  if (netReceivedCents <= 0 || payments.reduce((s, p) => s + p, 0) <= netReceivedCents) return 0;
  let lo = 0;
  let hi = 1;
  while (npv(hi) > 0 && hi < 64) hi *= 2;
  for (let n = 0; n < 200; n += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function validateFinancing(input: FinancingInput): void {
  const issues: string[] = [];
  if (!(input.priceCents > 0)) issues.push('o valor do bem precisa ser maior que zero');
  if (input.downPaymentCents < 0 || input.downPaymentCents >= input.priceCents) issues.push('a entrada precisa ser menor que o valor do bem');
  if (input.offers.length < 1 || input.offers.length > 4) issues.push('informe de 1 a 4 propostas');
  input.offers.forEach((o, n) => {
    if (!Number.isInteger(o.termMonths) || o.termMonths < 1 || o.termMonths > 480) issues.push(`proposta ${n + 1}: prazo de 1 a 480 meses`);
    if (o.monthlyRateBps < 0 || o.monthlyRateBps > 3000) issues.push(`proposta ${n + 1}: taxa ao mês de 0% a 30%`);
    if (o.upfrontFeesCents < 0 || o.monthlyExtrasCents < 0) issues.push(`proposta ${n + 1}: tarifas não podem ser negativas`);
  });
  if (issues.length > 0) throw new FinancingInputError(issues);
}

export function compareFinancing(input: FinancingInput): FinancingResult {
  validateFinancing(input);
  const financed = input.priceCents - input.downPaymentCents;
  const offers: OfferResult[] = input.offers.map((o) => {
    const base = installments(financed, o.termMonths, o.monthlyRateBps, o.system);
    const pays = base.map((p) => p + o.monthlyExtrasCents);
    const sum = pays.reduce((s, p) => s + p, 0);
    const total = sum + o.upfrontFeesCents;
    const r = monthlyIrr(financed - o.upfrontFeesCents, pays);
    const cetMonthly = round2(r * 100);
    const cetAnnual = round2((Math.pow(1 + r, 12) - 1) * 100);
    const first = pays[0]!;
    const share = input.netIncomeCents && input.netIncomeCents > 0 ? round2((first / input.netIncomeCents) * 100) : null;
    const flags: OfferFlag[] = [];
    const nominal = o.monthlyRateBps / 100;
    if (cetMonthly > nominal + 0.3) flags.push({ code: 'cet_above_rate', tone: 'attention', text: `O custo efetivo (${cetMonthly.toLocaleString('pt-BR')}% ao mês) é maior que a taxa de juros anunciada (${nominal.toLocaleString('pt-BR')}% ao mês): tarifas e seguros estão encarecendo o contrato.` });
    if (o.upfrontFeesCents > 0) flags.push({ code: 'upfront_fees', tone: 'info', text: `Há ${formatBrl(o.upfrontFeesCents)} de tarifas pagas no ato. Peça o detalhamento de cada uma: a tarifa de abertura de crédito (TAC) não pode ser cobrada, e a de cadastro só vale no início do relacionamento com o banco.` });
    if (o.monthlyExtrasCents > 0) flags.push({ code: 'monthly_extras', tone: 'info', text: `Os ${formatBrl(o.monthlyExtrasCents)} mensais de seguro ou tarifa somam ${formatBrl(o.monthlyExtrasCents * o.termMonths)} no contrato. Seguro não pode ser imposto: você pode contratar onde quiser.` });
    if (share !== null && share > 35) flags.push({ code: 'income_heavy', tone: 'attention', text: `A primeira parcela leva ${share.toLocaleString('pt-BR')}% da sua renda líquida. Acima de 30% o orçamento costuma apertar.` });
    else if (share !== null && share > 30) flags.push({ code: 'income_tight', tone: 'attention', text: `A primeira parcela leva ${share.toLocaleString('pt-BR')}% da sua renda: no limite do que é saudável (30%).` });
    if (input.kind === 'veiculo' && o.termMonths > 60) flags.push({ code: 'long_vehicle_term', tone: 'attention', text: `Prazo de ${o.termMonths} meses para veículo: o carro perde valor mais rápido do que a dívida cai e os juros pesam muito no fim.` });
    if (o.monthlyRateBps === 0) flags.push({ code: 'zero_rate', tone: 'info', text: 'Juros zero: confira se o preço do bem não está acima do preço à vista (o custo pode estar embutido no preço).' });
    if (input.downPaymentCents === 0) flags.push({ code: 'down_payment_zero', tone: 'info', text: 'Sem entrada, você financia 100% e paga juros sobre tudo. Quanto maior a entrada, menor o contrato.' });
    return {
      name: o.name,
      system: o.system,
      termMonths: o.termMonths,
      financedCents: financed,
      firstInstallmentCents: first,
      lastInstallmentCents: pays[pays.length - 1]!,
      totalPaidCents: total,
      costOfCreditCents: total - financed,
      costPctOfFinanced: round2(((total - financed) / financed) * 100),
      cetMonthlyPct: cetMonthly,
      cetAnnualPct: cetAnnual,
      nominalRateMonthlyPct: nominal,
      incomeSharePct: share,
      flags,
    };
  });
  const ranking = offers.map((_, i) => i).sort((a, b) => offers[a]!.cetMonthlyPct - offers[b]!.cetMonthlyPct || offers[a]!.totalPaidCents - offers[b]!.totalPaidCents);
  const bestIndex = ranking[0]!;
  const worstIndex = ranking[ranking.length - 1]!;
  const spread = offers[worstIndex]!.totalPaidCents - offers[bestIndex]!.totalPaidCents;

  let waiting: FinancingResult['waiting'] = null;
  const saving = input.savingMonthlyCents ?? 0;
  if (saving > 0) {
    const needed = Math.max(0, input.priceCents - input.downPaymentCents);
    const months = Math.ceil(needed / saving);
    waiting = { months, avoidedCostCents: offers[bestIndex]!.costOfCreditCents };
  }

  return {
    priceCents: input.priceCents,
    downPaymentCents: input.downPaymentCents,
    financedCents: financed,
    offers,
    ranking,
    bestIndex,
    worstIndex,
    spreadCents: spread,
    waiting,
    tips: [
      'Compare sempre pelo CET (custo efetivo total) e pelo total pago, nunca só pela parcela: parcela baixa em prazo longo costuma sair mais cara.',
      'Peça a simulação por escrito, com o CET, o cronograma de parcelas e a lista de tarifas e seguros. O banco é obrigado a informar o CET antes da contratação.',
      'Você pode quitar ou amortizar antes do prazo e tem direito à redução proporcional dos juros (Código de Defesa do Consumidor, art. 52, § 2º).',
      'Coloque a mesma entrada em todas as simulações; só assim a comparação é justa.',
      'Não aceite seguro, título de capitalização ou "pacote" como condição do crédito: isso é venda casada.',
      'Antes de assinar, confira se o valor financiado, o prazo e a taxa do contrato são exatamente os da simulação.',
    ],
    questions: [
      'Qual é o CET mensal e anual deste contrato, por escrito?',
      'Quais tarifas e seguros estão incluídos e quais são opcionais?',
      'Posso quitar antes do prazo? Como fica o desconto dos juros?',
      'O valor das parcelas é fixo ou corrigido por algum índice (TR, IPCA)?',
      'Qual é o valor total que vou pagar até o fim do contrato?',
      'Se eu aumentar a entrada, qual taxa o banco pode oferecer?',
    ],
  };
}

export interface FinancingPreview {
  financedCents: number;
  offersCount: number;
  best: { name: string; cetAnnualPct: number; totalPaidCents: number };
  spreadCents: number;
  flagCount: number;
  headline: string;
}

export function buildFinancingPreview(r: FinancingResult): FinancingPreview {
  const best = r.offers[r.bestIndex]!;
  const flagCount = r.offers.reduce((s, o) => s + o.flags.filter((f) => f.tone === 'attention').length, 0);
  const headline =
    r.offers.length > 1
      ? `A proposta mais barata é "${best.name}": custa ${formatBrl(r.spreadCents)} a menos que a mais cara.`
      : `Esta proposta custa ${formatBrl(best.costOfCreditCents)} de crédito (${best.costPctOfFinanced.toLocaleString('pt-BR')}% do valor financiado), com CET de ${best.cetAnnualPct.toLocaleString('pt-BR')}% ao ano.`;
  return { financedCents: r.financedCents, offersCount: r.offers.length, best: { name: best.name, cetAnnualPct: best.cetAnnualPct, totalPaidCents: best.totalPaidCents }, spreadCents: r.spreadCents, flagCount, headline };
}
