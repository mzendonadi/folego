// Estratégias do Mapa: transforma o diagnóstico em decisões com número — comparação de caminhos, quanto pagar em cada
// dívida mês a mês, o efeito de cada real a mais, dinheiro extraordinário, quitação com desconto, troca por crédito
// mais barato, marcos do plano e um roteiro de estratégias que se aplicam ao caso.
// Tudo determinístico (mesmo motor da simulação): nenhum número aqui vem de IA.
import type { DebtInput, DiagnoseInput, Diagnosis, ResolvedDebt, SimulationResult } from './types.ts';
import { RULES } from './config.ts';
import type { Rules } from './config.ts';
import { diagnose } from './diagnose.ts';
import { resolveDebt } from './rates.ts';
import { simulate } from './simulate.ts';
import { formatBrl } from './calendar.ts';

export interface StrategyScenario {
  id: 'baseline' | 'plan' | 'avalanche' | 'snowball';
  label: string;
  description: string;
  months: number | null;
  interestCents: number;
  totalPaidCents: number;
  recommended: boolean;
}

export interface WhatIfExtra {
  extraCents: number;
  months: number | null;
  monthsSaved: number | null;
  interestSavedCents: number | null;
}

export interface LumpSumScenario {
  lumpCents: number;
  appliedTo: string[]; // nomes dos credores, na ordem em que o valor foi usado
  months: number | null;
  monthsSaved: number | null;
  interestSavedCents: number | null;
}

export interface SettlementOption {
  debtId: string;
  creditorName: string;
  balanceCents: number;
  /** Quanto pagar se conseguir o desconto alto e o desconto baixo (faixas usuais; não é garantia). */
  bestCaseCents: number;
  worstCaseCents: number;
  monthsToSave: number | null; // juntando o extra do mês, em quantos meses chega ao melhor caso
}

export interface MonthPlanRow {
  month: number;
  ym: string; // YYYY-MM
  payments: { debtId: string; creditorName: string; cents: number; payoff: boolean }[];
  totalCents: number;
  remainingCents: number;
}

export interface Milestone {
  month: number;
  ym: string;
  kind: 'first_month' | 'payoff' | 'half' | 'debt_free';
  title: string;
  detail: string;
  debtId?: string;
}

export interface PlaybookItem {
  id: string;
  title: string;
  /** Por que isso se aplica a ESTE caso (com número quando houver). */
  why: string;
  steps: string[];
  caution?: string;
}

export interface Strategies {
  asOf: string;
  comparison: StrategyScenario[];
  /** Quando a ordem de pagamento não muda o resultado (ex.: uma dívida só), explica em vez de repetir linhas iguais. */
  comparisonNote: string | null;
  verdict: string;
  whatIfExtra: WhatIfExtra[];
  lumpSum: LumpSumScenario | null;
  settlements: SettlementOption[];
  refinance: { creditorName: string; oldRatePct: number; newRatePct: number; newPaymentCents: number; termMonths: number; savingsCents: number }[];
  schedule: MonthPlanRow[];
  milestones: Milestone[];
  playbook: PlaybookItem[];
}

const pct = (bps: number) => Math.round(bps) / 100;
const ymAfter = (asOf: string, months: number): string => {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7)) - 1 + months;
  return `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
};
const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

export function buildStrategies(input: DiagnoseInput, rules: Rules = RULES, given?: Diagnosis): Strategies {
  const d = given ?? diagnose(input, rules);
  const byId = new Map<string, DebtInput>(input.debts.map((x) => [x.id, x]));
  const name = (id: string) => byId.get(id)?.creditorName ?? id;
  const held = new Set(d.heldAsideIds);
  const included: ResolvedDebt[] = input.debts.map((x) => resolveDebt(x, rules)).filter((x) => !held.has(x.id));
  const pool = d.budget.poolCents;
  const run = (debts: ResolvedDebt[], poolCents: number, traceMonths?: number): SimulationResult =>
    simulate(debts, { mode: 'pooled', poolCents, priority: d.order, maxMonths: rules.maxMonths, ...(traceMonths ? { traceMonths } : {}) });

  // ---- 1) comparação de caminhos ----
  const scen = (id: StrategyScenario['id'], label: string, description: string, s: SimulationResult): StrategyScenario => ({ id, label, description, months: s.months, interestCents: s.totalInterestCents, totalPaidCents: s.totalPaidCents, recommended: id === 'plan' });
  const allScenarios: StrategyScenario[] = included.length === 0 ? [] : [
    scen('baseline', 'Seguir como está', 'Pagar só as parcelas atuais, sem direcionar nada a mais.', d.baseline),
    scen('plan', 'Plano Fôlego', 'Essenciais em atraso primeiro; depois, os juros mais altos. A parcela de cada dívida quitada passa para a próxima.', d.plan),
    scen('avalanche', 'Avalanche (juros mais altos primeiro)', 'A que mais economiza juros no papel, sem olhar o que é essencial.', d.alternatives.avalanche),
    scen('snowball', 'Bola de neve (menor dívida primeiro)', 'Quita logo as menores para dar ânimo; costuma custar um pouco mais de juros.', d.alternatives.snowball),
  ];
  // Linhas iguais ao Plano não acrescentam nada: só aparecem as que dão resultado diferente.
  const plan = allScenarios.find((x) => x.id === 'plan');
  const same = (x: StrategyScenario) => plan !== undefined && x.months === plan.months && x.interestCents === plan.interestCents && x.totalPaidCents === plan.totalPaidCents;
  const comparison = allScenarios.filter((x) => x.id === 'baseline' || x.id === 'plan' || !same(x));
  const hidden = allScenarios.filter((x) => (x.id === 'avalanche' || x.id === 'snowball') && same(x));
  const comparisonNote = hidden.length === 0 ? null : included.length === 1 ? 'Você tem uma dívida só, então a ordem de pagamento não muda nada: avalanche e bola de neve dão o mesmo resultado do Plano Fôlego.' : 'Com as suas dívidas, trocar a ordem (juros mais altos ou menor saldo primeiro) dá o mesmo resultado do Plano Fôlego, por isso não repetimos essas linhas.';
  let verdict = '';
  if (included.length > 0) {
    if (d.budget.deficit) verdict = `Hoje faltam ${formatBrl(d.budget.gapCents)} por mês: nenhuma ordem de pagamento resolve enquanto a conta não fechar. O primeiro passo é abrir espaço no orçamento (veja as estratégias abaixo).`;
    else if (d.plan.months !== null && d.plan.months > rules.longHorizonMonths) verdict = `Mesmo seguindo o plano, a quitação levaria ${Math.round(d.plan.months / 12)} anos: é uma conta teórica, não um prazo realista. Para ficar livre de verdade é preciso renegociar a taxa ou o desconto e aumentar o que sobra para as dívidas (veja as estratégias abaixo).`;
    else if (d.plan.months === null) verdict = 'Com o valor disponível hoje, as dívidas não acabam: a parcela não cobre os juros. A saída passa por renegociar a taxa ou trocar a dívida por uma mais barata.';
    else {
      const saved = d.interestSavedCents ?? 0;
      const faster = diff(d.baseline.months, d.plan.months);
      const snow = d.alternatives.snowball.totalInterestCents - d.plan.totalInterestCents;
      verdict = `Seguindo o plano você fica livre em ${d.plan.months} ${d.plan.months === 1 ? 'mês' : 'meses'}${saved > 0 ? ` e deixa de pagar ${formatBrl(saved)} em juros` : ''}${faster && faster > 0 ? `, ${faster} ${faster === 1 ? 'mês' : 'meses'} antes do que seguindo como está` : ''}.${snow > 0 ? ` Se preferir a bola de neve pelo ânimo de quitar as pequenas primeiro, ela custa ${formatBrl(snow)} a mais de juros.` : ''}`;
    }
  }

  // ---- 2) efeito de cada real a mais por mês ----
  const whatIfExtra: WhatIfExtra[] = included.length === 0 ? [] : [5_000, 10_000, 20_000, 50_000].map((extraCents) => {
    const s = run(included, pool + extraCents);
    return { extraCents, months: s.months, monthsSaved: diff(d.plan.months, s.months), interestSavedCents: s.months === null || d.plan.months === null ? null : d.plan.totalInterestCents - s.totalInterestCents };
  });

  // ---- 3) dinheiro extraordinário (13º, restituição, FGTS): um salário aplicado na ordem do plano ----
  let lumpSum: LumpSumScenario | null = null;
  const lumpCents = input.profile.netIncomeCents;
  if (included.length > 0 && lumpCents > 0 && !d.budget.deficit) {
    let left = lumpCents;
    const appliedTo: string[] = [];
    const reduced = included.map((x) => ({ ...x }));
    for (const id of d.order) {
      if (left <= 0) break;
      const t = reduced.find((x) => x.id === id);
      if (!t || t.balanceCents <= 0) continue;
      const pay = Math.min(left, t.balanceCents);
      t.balanceCents -= pay;
      left -= pay;
      appliedTo.push(name(id));
    }
    const s = run(reduced, pool);
    lumpSum = { lumpCents, appliedTo, months: s.months, monthsSaved: diff(d.plan.months, s.months), interestSavedCents: s.months === null || d.plan.months === null ? null : d.plan.totalInterestCents - s.totalInterestCents };
  }

  // ---- 4) quitação à vista com desconto (só dívida em atraso que não é conta essencial) ----
  const essential = new Set(d.debts.filter((x) => x.tier === 'essential_overdue').map((x) => x.debtId));
  const settlements: SettlementOption[] = included
    .filter((x) => x.daysOverdue > 0 && !essential.has(x.id))
    .map((x) => {
      const bestCaseCents = Math.round(x.balanceCents * (1 - rules.negotiationDiscount.highPct));
      const worstCaseCents = Math.round(x.balanceCents * (1 - rules.negotiationDiscount.lowPct));
      const monthly = d.budget.extraToDebtCents;
      return { debtId: x.id, creditorName: x.creditorName, balanceCents: x.balanceCents, bestCaseCents, worstCaseCents, monthsToSave: monthly > 0 ? Math.ceil(bestCaseCents / monthly) : null };
    });

  // ---- 5) troca por crédito mais barato ----
  const refinance = d.refinance.candidates.map((c) => ({ creditorName: name(c.debtId), oldRatePct: pct(c.oldMonthlyRateBps), newRatePct: pct(c.newMonthlyRateBps), newPaymentCents: c.newPaymentCents, termMonths: c.termMonths, savingsCents: c.estimatedSavingsCents }));

  // ---- 6) plano mês a mês (6 primeiros meses) ----
  const traced = included.length > 0 && !d.budget.deficit ? run(included, pool, 6) : null;
  const schedule: MonthPlanRow[] = (traced?.schedule ?? []).map((row) => {
    const payments = d.order
      .filter((id) => (row.paidById[id] ?? 0) > 0)
      .map((id) => ({ debtId: id, creditorName: name(id), cents: row.paidById[id] ?? 0, payoff: (row.balanceById[id] ?? 0) === 0 }));
    return { month: row.month, ym: ymAfter(d.asOf, row.month), payments, totalCents: payments.reduce((s, p) => s + p.cents, 0), remainingCents: Object.values(row.balanceById).reduce((s, v) => s + v, 0) };
  });

  // ---- 7) marcos ----
  const milestones: Milestone[] = [];
  if (d.plan.months !== null && included.length > 0 && !d.budget.deficit) {
    const first = d.order[0];
    if (first) milestones.push({ month: 1, ym: ymAfter(d.asOf, 1), kind: 'first_month', title: 'Primeiro mês do plano', detail: `Parcelas em dia e ${formatBrl(d.budget.extraToDebtCents)} a mais em ${name(first)}.`, debtId: first });
    const payoffs = d.order.map((id) => ({ id, month: d.plan.payoffMonthById[id] ?? null })).filter((p): p is { id: string; month: number } => p.month !== null && p.month > 0).sort((a, b) => a.month - b.month);
    payoffs.forEach((p, i) => {
      const next = payoffs[i + 1];
      const freed = included.find((x) => x.id === p.id)?.minPaymentCents ?? 0;
      milestones.push({ month: p.month, ym: ymAfter(d.asOf, p.month), kind: 'payoff', debtId: p.id, title: `${name(p.id)} quitada`, detail: next ? `A parcela de ${formatBrl(freed)} que ia para ela passa para ${name(next.id)}. Não gaste esse valor: é ele que acelera o resto.` : 'Última dívida do plano.' });
    });
    if (d.plan.months >= 6) {
      const half = Math.ceil(d.plan.months / 2);
      milestones.push({ month: half, ym: ymAfter(d.asOf, half), kind: 'half', title: 'Metade do caminho', detail: 'Bom momento para refazer o diagnóstico com os saldos atualizados e conferir se o plano continua o melhor.' });
    }
    milestones.push({ month: d.plan.months, ym: ymAfter(d.asOf, d.plan.months), kind: 'debt_free', title: 'Livre das dívidas do plano', detail: `O valor que ia para as dívidas (${formatBrl(pool)} por mês) pode virar reserva de emergência.` });
    milestones.sort((a, b) => a.month - b.month || (a.kind === 'debt_free' ? 1 : -1));
  }

  // ---- 8) roteiro de estratégias que se aplicam ao caso ----
  const playbook: PlaybookItem[] = [];
  const b = d.budget;
  const income = input.profile.netIncomeCents;
  const has = (kinds: string[]) => included.filter((x) => kinds.includes(x.kind));
  const dsr = Math.round(b.debtServiceRatio * 100);

  if (b.deficit) {
    playbook.push({
      id: 'fechar_conta', title: 'Primeiro, fechar a conta do mês',
      why: `Suas despesas e parcelas passam da renda em ${formatBrl(b.gapCents)} por mês. Sem resolver isso, qualquer acordo novo vira atraso de novo.`,
      steps: ['Liste as despesas fixas e marque o que dá para cortar ou pausar por 90 dias (assinaturas, planos, tarifas de banco).', 'Peça ao credor da parcela mais pesada para alongar o prazo e reduzir a parcela — parcela menor agora, mesmo com prazo maior, é melhor do que atrasar.', `Procure uma renda extra de pelo menos ${formatBrl(b.gapCents)} por mês (o Criador de Renda Extra monta esse plano).`],
      caution: 'Busque recursos de forma consciente: compare o custo efetivo total (CET) e confirme que a parcela cabe no seu mês. Se precisar de mais ajuda, podemos te direcionar para um parceiro Fôlego!',
    });
  }
  if (dsr >= 50 || (b.deficit && included.length >= 2)) {
    playbook.push({
      id: 'superendividamento', title: 'Você pode pedir a renegociação de todas as dívidas juntas',
      why: `As parcelas tomam ${dsr}% da sua renda. A Lei do Superendividamento (Lei 14.181/2021) dá o direito de propor um plano único de pagamento a todos os credores, preservando o mínimo para viver.`,
      steps: ['Reúna contratos, faturas e comprovante de renda.', 'Procure o Procon, a Defensoria Pública ou o núcleo de conciliação (CEJUSC) do Tribunal de Justiça do seu estado e peça a "repactuação de dívidas por superendividamento".', 'Leve seu orçamento do Mapa: ele mostra quanto cabe por mês, que é a base do plano.'],
      caution: 'Não vale para dívidas feitas de má-fé, pensão alimentícia, impostos, financiamento imobiliário nem crédito rural.',
    });
  }
  const revolving = has(['credit_card', 'overdraft']).filter((x) => x.rateBps >= 600);
  if (revolving.length > 0) {
    const worst = [...revolving].sort((x, y) => y.rateBps - x.rateBps)[0]!;
    playbook.push({
      id: 'sair_do_rotativo', title: 'Sair do rotativo e do cheque especial',
      why: `${worst.creditorName} cobra cerca de ${pct(worst.rateBps).toLocaleString('pt-BR')}% ao mês: é o crédito mais caro que existe. Em ${formatBrl(worst.balanceCents)}, isso dá perto de ${formatBrl(Math.round((worst.balanceCents * worst.rateBps) / 10_000))} de juros só no próximo mês.`,
      steps: ['Pare de usar o cartão ou o limite enquanto o plano estiver rodando.', 'Peça ao banco o parcelamento da fatura ou a troca do saldo por um empréstimo pessoal com parcela fixa e taxa menor — compare o custo efetivo total (CET), não só a parcela.', 'Desde 2024, juros e encargos do rotativo e do parcelamento da fatura não podem passar de 100% do valor original da dívida: se a cobrança passou disso, conteste por escrito.'],
      caution: 'Parcelar a fatura só ajuda se você parar de fazer novas compras no cartão.',
    });
  }
  if (settlements.length > 0) {
    const total = settlements.reduce((s, x) => s + x.balanceCents, 0);
    const best = settlements.reduce((s, x) => s + x.bestCaseCents, 0);
    playbook.push({
      id: 'quitar_com_desconto', title: 'Negociar as dívidas em atraso com desconto à vista',
      why: `Você tem ${formatBrl(total)} em atraso. Credor prefere receber uma parte agora a esperar: nessas condições costuma-se conseguir de ${Math.round(rules.negotiationDiscount.lowPct * 100)}% a ${Math.round(rules.negotiationDiscount.highPct * 100)}% de desconto. No melhor caso, ${formatBrl(best)} quita tudo.`,
      steps: ['Junte o valor antes de ligar: proposta à vista com dinheiro na mão é a que mais consegue desconto.', 'Use o roteiro de negociação do Mapa (abertura, alvo e limite) e peça a proposta por escrito.', 'Consulte também os canais oficiais do credor e feirões de renegociação (Serasa Limpa Nome, mutirões do Procon e dos bancos): às vezes a oferta lá é melhor.', 'Só pague por boleto ou Pix em nome do credor, e guarde o comprovante e o termo de quitação.'],
      caution: 'Desconto não é garantido. Não aceite parcela que passe do que sobra no seu mês.',
    });
  }
  if (refinance.length > 0) {
    const top = refinance[0]!;
    playbook.push({
      id: 'trocar_por_consignado', title: 'Trocar dívida cara por crédito com desconto em folha',
      why: `Pelo seu vínculo, você pode ter acesso ao consignado, que costuma cobrar perto de ${top.newRatePct.toLocaleString('pt-BR')}% ao mês. Trocando ${top.creditorName} (${top.oldRatePct.toLocaleString('pt-BR')}% ao mês), a economia estimada é de ${formatBrl(top.savingsCents)}.`,
      steps: ['Simule no banco onde recebe e em mais dois: a taxa varia bastante.', 'Use o dinheiro só para quitar a dívida cara, no mesmo dia.', 'Confira o custo efetivo total (CET) e recuse seguro ou pacote embutido.'],
      caution: 'Consignado desconta direto do salário ou benefício: a parcela não pode ser adiada. Só faz sentido se o custo total cair.',
    });
  } else if (has(['personal_loan', 'financing', 'payroll_loan']).some((x) => x.rateBps >= 250 && x.daysOverdue === 0)) {
    playbook.push({
      id: 'portabilidade', title: 'Levar o empréstimo para um banco mais barato (portabilidade)',
      why: 'Você tem empréstimo ou financiamento em dia. Levar a dívida para outra instituição com taxa menor é um direito seu, regulado pelo Banco Central, e o banco atual não pode cobrar por isso.',
      steps: ['Peça ao banco atual o saldo devedor e o custo efetivo total (CET) do contrato.', 'Leve esses dados a outros bancos ou cooperativas e peça uma proposta de portabilidade.', 'Mostre a melhor proposta ao banco atual: muitas vezes ele cobre a oferta para não perder você.'],
      caution: 'Compare o custo total. Prazo maior com parcela menor pode sair mais caro no fim.',
    });
  }
  if (lumpSum && lumpSum.interestSavedCents !== null && lumpSum.interestSavedCents > 0) {
    playbook.push({
      id: 'dinheiro_extra', title: 'Dar destino certo ao dinheiro que entra fora do mês',
      why: `13º, restituição do Imposto de Renda, férias, FGTS ou um valor esquecido em banco: se ${formatBrl(lumpSum.lumpCents)} forem direto para ${lumpSum.appliedTo.join(' e ')}, você economiza ${formatBrl(lumpSum.interestSavedCents)} em juros${lumpSum.monthsSaved && lumpSum.monthsSaved > 0 ? ` e termina ${lumpSum.monthsSaved} ${lumpSum.monthsSaved === 1 ? 'mês' : 'meses'} antes` : ''}.`,
      steps: ['Consulte o Valores a Receber do Banco Central e o saldo do FGTS (guia no fim do Mapa).', 'Decida ANTES de o dinheiro entrar para onde ele vai: no dia em que cair, pague a dívida da vez.', 'Se usar o saque-aniversário do FGTS, lembre que ele bloqueia o saque total em caso de demissão.'],
    });
  }
  const bestExtra = whatIfExtra.find((w) => w.interestSavedCents !== null && w.interestSavedCents > 0);
  if (bestExtra) {
    playbook.push({
      id: 'cada_real', title: 'Cada real a mais encurta o caminho',
      why: `Com ${formatBrl(bestExtra.extraCents)} a mais por mês, você economiza ${formatBrl(bestExtra.interestSavedCents ?? 0)} em juros${bestExtra.monthsSaved && bestExtra.monthsSaved > 0 ? ` e termina ${bestExtra.monthsSaved} ${bestExtra.monthsSaved === 1 ? 'mês' : 'meses'} antes` : ''}. A tabela acima mostra outros valores.`,
      steps: ['Programe o pagamento extra para o dia em que o salário cai, antes de qualquer outro gasto.', 'Cancele uma despesa fixa e mande exatamente esse valor para a dívida da vez.', 'Quando quitar uma dívida, some a parcela dela ao pagamento da próxima (efeito bola de neve).'],
    });
  }
  if (!b.deficit && b.surplusCents - b.extraToDebtCents > 0) {
    playbook.push({
      id: 'reserva', title: 'Manter uma pequena reserva enquanto paga',
      why: `O plano usa ${formatBrl(b.extraToDebtCents)} do que sobra e deixa ${formatBrl(b.surplusCents - b.extraToDebtCents)} por mês livres. Sem nenhuma folga, um imprevisto vira dívida nova no cartão.`,
      steps: [`Junte primeiro o equivalente a um mês de despesas fixas (${formatBrl(input.profile.fixedExpensesCents)}) em uma conta separada, com rendimento diário.`, 'Depois disso, mande a folga inteira para as dívidas.'],
    });
  }
  if (d.heldAsideIds.length > 0) {
    playbook.push({
      id: 'prescricao', title: 'Não reconhecer dívida que pode estar prescrita',
      why: `${d.heldAsideIds.map(name).join(', ')}: pelo tempo de atraso, a cobrança pode ter perdido a força na Justiça. Pagar ou negociar qualquer parte pode reiniciar o prazo.`,
      steps: ['Não confirme a dívida por telefone nem aceite "acordo relâmpago".', 'Peça por escrito a origem, o contrato e a data do primeiro atraso.', 'Confirme a situação com a Defensoria Pública ou um advogado antes de pagar.'],
    });
  }
  if (income > 0 && included.some((x) => x.rateSource === 'default')) {
    playbook.push({
      id: 'descobrir_taxas', title: 'Descobrir a taxa real de cada dívida',
      why: 'Em algumas dívidas usamos a média de mercado porque a taxa não foi informada. A ordem de pagamento fica mais certeira com a taxa do seu contrato.',
      steps: ['Procure "juros ao mês" ou "CET" na fatura, no contrato ou no aplicativo do banco.', 'Se não achar, peça ao credor por escrito: é obrigação dele informar.', 'Refaça o diagnóstico com as taxas reais.'],
    });
  }

  return { asOf: d.asOf, comparison, comparisonNote, verdict, whatIfExtra, lumpSum, settlements, refinance, schedule, milestones, playbook };
}
