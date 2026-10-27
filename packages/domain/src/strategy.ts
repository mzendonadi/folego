// "Jogadas" da aba Estratégias (Desbravador): o Prumo cruza contas, investimentos, dívidas e cartões e diz, com conta feita,
// o que mover, resgatar ou quitar primeiro. Educação financeira com os números da própria pessoa; não é recomendação de produto.
import { formatBrl } from './calendar.ts';
import { annualYieldPct, investDaysBetween, nextIrStep, irPctForDays } from './investments.ts';
import type { InvestIndexer, InvestStatus } from './investments.ts';

export interface StrategyWallet {
  name: string;
  kind: string;
  balanceCents: number;
  overdraftLimitCents: number;
  /** Juro do limite da conta em pontos-base ao mês (800 = 8% ao mês). */
  overdraftRateBps: number | null;
  /** Dias do limite que o banco não cobra juros (informado pela pessoa). */
  overdraftFreeDays: number | null;
}
export interface StrategyInvestment {
  name: string;
  positionCents: number;
  appliedCents: number;
  appliedOn: string;
  indexer: InvestIndexer;
  ratePct: number;
  liquidity: 'diaria' | 'vencimento';
  status: InvestStatus;
}
export interface StrategyDebt { name: string; balanceCents: number; monthlyRatePct: number | null }
export interface StrategyCard {
  name: string;
  openCents: number;
  overdue: boolean;
  revolvingMonthlyPct: number;
  /** Parcelas que ainda vão chegar nas próximas faturas (compras parceladas e fatura parcelada): é dívida, mesmo com a fatura de hoje zerada. */
  futureInstallmentsCents?: number;
}
export interface StrategySnapshot {
  today: string;
  cdiAnnualPct: number | null;
  selicPct: number | null;
  monthlyIncomeCents: number;
  monthlyExpenseCents: number;
  wallets: StrategyWallet[];
  investments: StrategyInvestment[];
  debts: StrategyDebt[];
  cards: StrategyCard[];
}

export interface Play {
  id: string;
  title: string;
  text: string;
  tone: 'good' | 'warn' | 'info';
  priority: 'alta' | 'media' | 'baixa';
  /** Economia estimada por mês, quando dá para calcular. */
  monthlySavingCents?: number;
}

const DEFAULT_OVERDRAFT_PCT = 8; // juro típico do limite da conta (cheque especial) por mês, só quando a pessoa não informou
const pct = (n: number): string => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
const monthlyFromAnnual = (a: number): number => (Math.pow(1 + a / 100, 1 / 12) - 1) * 100;

export function buildPlays(s: StrategySnapshot): Play[] {
  const plays: Play[] = [];
  const live = s.investments.filter((i) => i.status === 'ativo' && i.positionCents > 0);
  const liquid = live.filter((i) => i.liquidity === 'diaria');
  const liquidCents = liquid.reduce((a, i) => a + i.positionCents, 0);
  const yearOf = (i: StrategyInvestment): number | null => annualYieldPct(i, { cdiAnnualPct: s.cdiAnnualPct });
  const liquidYears = liquid.map(yearOf).filter((x): x is number => x !== null);
  const liquidMonthlyPct = liquidYears.length ? monthlyFromAnnual(liquidYears.reduce((a, b) => a + b, 0) / liquidYears.length) : null;

  // 1) Conta no negativo x dinheiro aplicado (e os dias de limite sem juros)
  for (const w of s.wallets.filter((x) => x.kind === 'conta' && x.balanceCents < 0)) {
    const debt = -w.balanceCents;
    const rate = w.overdraftRateBps !== null ? w.overdraftRateBps / 100 : DEFAULT_OVERDRAFT_PCT;
    const guessed = w.overdraftRateBps === null ? ' (taxa estimada; informe a do seu banco na carteira para ficar exato)' : '';
    if (w.overdraftFreeDays && w.overdraftFreeDays > 0) {
      plays.push({
        id: `free-${w.name}`, tone: 'good', priority: 'alta',
        title: `Use os ${w.overdraftFreeDays} dias sem juros de ${w.name}`,
        text: `Você está ${formatBrl(debt)} no negativo, mas o banco não cobra juros nos primeiros ${w.overdraftFreeDays} dias do limite. Cubra o saldo no último dia dessa janela (com a próxima entrada ou movendo de outra conta) e deixe o dinheiro lá. Se passar do prazo, o custo estimado é de ${pct(rate)} ao mês, uns ${formatBrl(Math.round((debt * rate) / 100))} por mês sobre o valor atual${guessed}.`,
      });
    }
    if (liquidCents > 0 && liquidMonthlyPct !== null) {
      const move = Math.min(debt, liquidCents);
      if (rate > liquidMonthlyPct) {
        const saving = Math.round((move * (rate - liquidMonthlyPct)) / 100);
        plays.push({
          id: `redeem-${w.name}`, tone: 'warn', priority: 'alta', monthlySavingCents: saving,
          title: `Resgatar ${formatBrl(move)} para zerar o negativo de ${w.name}`,
          text: `O limite da conta custa cerca de ${pct(rate)} ao mês${guessed}; o que você tem aplicado com liquidez diária rende cerca de ${pct(liquidMonthlyPct)} ao mês. Resgatar ${formatBrl(move)} e cobrir o negativo economiza uns ${formatBrl(saving)} por mês. O IR incide só sobre o rendimento resgatado: veja a janela de imposto de cada aplicação.`,
        });
      } else {
        plays.push({
          id: `keep-${w.name}`, tone: 'info', priority: 'media',
          title: `Mesmo no negativo, pode compensar manter ${formatBrl(move)} aplicados`,
          text: `Seu aplicado rende cerca de ${pct(liquidMonthlyPct)} ao mês e o negativo em ${w.name} custa ${pct(rate)}${guessed}. Enquanto o juro do limite for menor que o rendimento, manter a aplicação e usar a janela sem juros é uma opção; reavalie se o prazo sem juros acabar.`,
        });
      }
    }
  }

  // 2) Dívidas: quem quitar primeiro (avalanche) e quando vale resgatar para quitar
  const debts = s.debts.filter((d) => d.balanceCents > 0 && d.monthlyRatePct !== null).sort((a, b) => (b.monthlyRatePct ?? 0) - (a.monthlyRatePct ?? 0));
  if (debts.length > 0) {
    const top = debts[0]!;
    plays.push({
      id: 'avalanche', tone: 'warn', priority: 'alta',
      title: `Quite primeiro: ${top.name} (${pct(top.monthlyRatePct!)} ao mês)`,
      text: `É a dívida mais cara que você informou, ${formatBrl(top.balanceCents)} hoje. Qualquer sobra do mês vai nela antes das outras: cada real a mais aqui economiza mais juros do que em qualquer outra (método avalanche).${debts.length > 1 ? ` Depois: ${debts.slice(1, 3).map((d) => `${d.name} (${pct(d.monthlyRatePct!)})`).join(', ')}.` : ''}`,
    });
    if (liquidMonthlyPct !== null && liquidCents > 0 && (top.monthlyRatePct ?? 0) > liquidMonthlyPct * 1.5) {
      const use = Math.min(top.balanceCents, Math.max(0, liquidCents - Math.round(s.monthlyExpenseCents * 3)));
      if (use > 0) {
        plays.push({
          id: 'redeem-debt', tone: 'good', priority: 'alta', monthlySavingCents: Math.round((use * ((top.monthlyRatePct ?? 0) - liquidMonthlyPct)) / 100),
          title: `Usar ${formatBrl(use)} do que está aplicado para quitar ${top.name}`,
          text: `A dívida custa ${pct(top.monthlyRatePct!)} ao mês e o aplicado rende ${pct(liquidMonthlyPct)}. Mantendo uma reserva de 3 meses de gastos, sobra ${formatBrl(use)} que rende menos do que a dívida custa.`,
        });
      }
    }
  }

  // 3) Cartão: fatura em aberto vira rotativo
  for (const c of s.cards.filter((x) => x.overdue && x.openCents > 0)) {
    plays.push({
      id: `revolving-${c.name}`, tone: 'warn', priority: 'alta', monthlySavingCents: Math.round((c.openCents * c.revolvingMonthlyPct) / 100),
      title: `Fatura em aberto do ${c.name}: ${formatBrl(c.openCents)}`,
      text: `Fatura vencida sem quitar vai para o rotativo, com custo de cerca de ${pct(c.revolvingMonthlyPct)} ao mês (uns ${formatBrl(Math.round((c.openCents * c.revolvingMonthlyPct) / 100))} por mês). Pagar só o mínimo é o jeito mais caro de dever. Antes de parcelar no próprio banco, compare com um empréstimo pessoal, consignado ou resgatar uma aplicação: quase sempre a taxa é menor.`,
    });
  }

  // 4) Imposto: janelas da tabela regressiva
  for (const i of live.filter((x) => x.positionCents > x.appliedCents && x.indexer !== 'poupanca' && x.indexer !== 'outro')) {
    const days = investDaysBetween(i.appliedOn, s.today);
    const step = nextIrStep(days);
    if (step && step.inDays <= 60) {
      const gain = i.positionCents - i.appliedCents;
      const saved = Math.round((gain * (irPctForDays(days) - step.toPct)) / 100);
      plays.push({
        id: `ir-${i.name}-${i.appliedOn}`, tone: 'info', priority: 'media',
        title: `${i.name}: em ${step.inDays} dias o IR cai para ${pct(step.toPct)}`,
        text: `Hoje o IR sobre o rendimento é ${pct(irPctForDays(days))}. Se não precisar do dinheiro agora, esperar ${step.inDays} dias reduz o imposto em uns ${formatBrl(saved)} sobre o rendimento atual. Se precisar antes (ou se a dívida custa mais que isso), resgate: o juro da dívida costuma pesar mais que o IR.`,
      });
    }
  }

  // 5) Rendimento baixo
  for (const i of live) {
    const weak = (i.indexer === 'cdi' || i.indexer === 'selic') && i.ratePct < 100;
    if (weak || i.indexer === 'poupanca') {
      plays.push({
        id: `low-${i.name}`, tone: 'warn', priority: 'media',
        title: `${i.name} rende pouco`,
        text: i.indexer === 'poupanca'
          ? 'A poupança rende menos que o CDI. Um CDB com liquidez diária a 100% do CDI ou mais costuma render mais com a mesma facilidade de resgate (confira o FGC e o banco emissor).'
          : `${pct(i.ratePct)} do CDI está abaixo do que os CDBs de liquidez diária costumam pagar (100% ou mais). Vale procurar uma taxa melhor ou levar o dinheiro para quitar dívida mais cara.`,
      });
    }
  }

  // 6) Reserva de emergência
  if (s.monthlyExpenseCents > 0) {
    const months = liquidCents / s.monthlyExpenseCents;
    if (live.length > 0 && months < 3) {
      plays.push({
        id: 'reserve-low', tone: 'warn', priority: 'media',
        title: 'Reserva de emergência curta',
        text: `O que tem liquidez diária cobre ${months.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mês(es) de gastos. A meta de partida é 3 a 6 meses. Quitar dívida cara continua na frente; a reserva é o próximo passo.`,
      });
    }
  }

  // 7) Dinheiro parado na conta
  for (const w of s.wallets.filter((x) => x.kind === 'conta' && x.balanceCents > s.monthlyExpenseCents && s.monthlyExpenseCents > 0)) {
    const idle = w.balanceCents - s.monthlyExpenseCents;
    const month = s.cdiAnnualPct !== null ? monthlyFromAnnual(s.cdiAnnualPct) : null;
    plays.push({
      id: `idle-${w.name}`, tone: 'info', priority: 'baixa', ...(month !== null ? { monthlySavingCents: Math.round((idle * month) / 100) } : {}),
      title: `${formatBrl(idle)} parados em ${w.name}`,
      text: `Além de um mês de gastos, o saldo da conta não rende. Num CDB com liquidez diária a 100% do CDI${month !== null ? ` renderia uns ${formatBrl(Math.round((idle * month) / 100))} por mês` : ''}.`,
    });
  }

  const order = { alta: 0, media: 1, baixa: 2 } as const;
  return plays.sort((a, b) => order[a.priority] - order[b.priority] || (b.monthlySavingCents ?? 0) - (a.monthlySavingCents ?? 0));
}
