// Coach financeiro da Assinatura: nota de saúde financeira, jornadas (programas de transformação com missões que se
// confirmam sozinhas pelos dados da conta), métodos aplicados à renda e leitura do cenário econômico.
// Tudo é cálculo puro em centavos inteiros; nada aqui consulta banco, rede ou IA.

export type CoachPlan = 'controle' | 'ousado' | 'desbravador';
const RANK: Record<CoachPlan, number> = { controle: 0, ousado: 1, desbravador: 2 };
export const planAtLeast = (plan: CoachPlan, min: CoachPlan): boolean => RANK[plan] >= RANK[min];

/** O que o servidor sabe da conta da pessoa (calculado do banco). */
export interface CoachFacts {
  incomeCents: number; // entradas do mês
  spentCents: number; // gastos do mês
  avgMonthlySpendCents: number; // média de gasto mensal (3 meses, se houver)
  daysLogged7: number; // dias distintos com lançamento nos últimos 7 dias
  daysLogged14: number;
  limitsCount: number; // categorias com limite
  overLimitCount: number; // categorias acima do limite neste mês
  remindersCount: number;
  walletsCount: number;
  goalsCount: number;
  goalContributions: number;
  savedCents: number; // metas + carteiras de poupança
  debtsCount: number;
  openDebtsCount: number;
  paidOffCount: number;
  debtPaymentsCount: number;
  debtOwedCents: number;
  debtInitialCents: number;
  debtMinPaymentsCents: number;
  expensiveDebtsOpen: number; // dívidas abertas com juros >= 3% ao mês
  debtPayments7: number; // pagamentos de dívida nos últimos 7 dias
  goalContribs7: number; // aportes em metas nos últimos 7 dias
  streakDays: number; // dias seguidos com lançamento (termina hoje ou ontem)
  recurringFlags?: number; // cobranças recorrentes que a pessoa já revisou (manter/cancelar)
  /** Cheque especial (LIS) das contas bancárias: quanto está em uso, quanto custa por mês e se a pessoa acompanha algum. */
  overdraftUsedCents?: number;
  overdraftCostCents?: number;
  overdraftTracked?: boolean;
}

// ---------------------------------------------------------------------------
// Saúde financeira
// ---------------------------------------------------------------------------
export interface HealthPart {
  key: 'poupanca' | 'dividas' | 'reserva' | 'habito';
  label: string;
  score: number;
  max: number;
  detail: string;
  tip: string;
}
export interface HealthScore {
  score: number; // 0..100
  level: 'critico' | 'atencao' | 'bom' | 'otimo';
  label: string;
  parts: HealthPart[];
  hasData: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const brl0 = (c: number) => `R$ ${Math.round(c / 100).toLocaleString('pt-BR')}`;
export const emergencyMonths = (f: CoachFacts): number => (f.avgMonthlySpendCents > 0 ? f.savedCents / f.avgMonthlySpendCents : 0);
export const savingsRatePct = (f: CoachFacts): number => (f.incomeCents > 0 ? ((f.incomeCents - f.spentCents) / f.incomeCents) * 100 : 0);

export function healthScore(f: CoachFacts): HealthScore {
  const hasData = f.incomeCents > 0 || f.spentCents > 0;
  const rate = savingsRatePct(f);
  const poup = f.incomeCents > 0 ? clamp((rate / 20) * 25, 0, 25) : 0; // 20% da renda guardada = nota cheia
  const burden = f.incomeCents > 0 ? f.debtMinPaymentsCents / f.incomeCents : f.debtMinPaymentsCents > 0 ? 1 : 0;
  const div = f.openDebtsCount === 0 ? 25 : clamp(25 - (burden / 0.4) * 25, 0, 25) - Math.min(5, f.expensiveDebtsOpen * 2);
  const months = emergencyMonths(f);
  const res = clamp((months / 6) * 25, 0, 25); // 6 meses de gasto = nota cheia
  const hab = clamp((f.daysLogged14 / 14) * 15, 0, 15) + (f.limitsCount > 0 ? clamp(10 - f.overLimitCount * 3, 0, 10) : 4);
  const parts: HealthPart[] = [
    { key: 'poupanca', label: 'Sobra do mês', score: Math.round(poup), max: 25, detail: f.incomeCents > 0 ? `Você guardou ${rate.toFixed(0)}% da renda neste mês.` : 'Sem renda lançada neste mês.', tip: 'A meta saudável é guardar 20% da renda. Comece por 5% e suba aos poucos.' },
    { key: 'dividas', label: 'Peso das dívidas', score: Math.round(Math.max(0, div)), max: 25, detail: f.openDebtsCount === 0 ? 'Nenhuma dívida aberta cadastrada.' : `As parcelas mínimas levam ${(burden * 100).toFixed(0)}% da renda${f.expensiveDebtsOpen ? `; ${f.expensiveDebtsOpen} com juros acima de 3% ao mês` : ''}.`, tip: 'Até 30% da renda em parcelas é suportável. Acima de 40% é emergência: renegocie e ataque a de juros mais altos.' },
    { key: 'reserva', label: 'Reserva de emergência', score: Math.round(res), max: 25, detail: months > 0 ? `Você tem ${months.toFixed(1)} meses de gastos guardados.` : 'Ainda sem reserva guardada.', tip: 'O alvo é 6 meses de gastos. O primeiro degrau é 1 mês: já evita o cartão no imprevisto.' },
    { key: 'habito', label: 'Hábito e controle', score: Math.round(hab), max: 25, detail: `${f.daysLogged14} de 14 dias com lançamento${f.limitsCount ? `, ${f.overLimitCount} categoria(s) estourada(s)` : ', sem limites definidos'}.`, tip: 'Registrar todo dia leva 1 minuto e é o que mais muda o resultado. Defina limites nas 3 categorias que mais pesam.' },
  ];
  const score = clamp(parts.reduce((s, p) => s + p.score, 0), 0, 100);
  const level = score < 35 ? 'critico' : score < 60 ? 'atencao' : score < 80 ? 'bom' : 'otimo';
  const label = { critico: 'Precisa de atenção urgente', atencao: 'No caminho, com pontos a melhorar', bom: 'Boa saúde financeira', otimo: 'Saúde financeira excelente' }[level];
  return { score, level, label, parts, hasData };
}

// ---------------------------------------------------------------------------
// Jornadas
// ---------------------------------------------------------------------------
export interface Mission {
  id: string;
  text: string;
  why: string;
  done: (f: CoachFacts) => boolean;
  /** Missão que só faz sentido para quem tem a coisa (ex.: cheque especial). Sem isso ela some, em vez de travar o progresso. */
  applies?: (f: CoachFacts) => boolean;
  tab?: string; // aba da conta onde se faz
}
export interface Program {
  id: 'organizar' | 'sair_do_vermelho' | 'reserva' | 'investir';
  title: string;
  promise: string;
  minPlan: CoachPlan;
  missions: Mission[];
}

export const PROGRAMS: Program[] = [
  {
    id: 'organizar', title: 'Organizar o mês', promise: 'Saber para onde vai cada real e nunca mais ser pego de surpresa por uma conta.', minPlan: 'controle',
    missions: [
      { id: 'o1', text: 'Registre seus gastos em 5 dias diferentes nesta semana', why: 'Quem registra todo dia gasta menos: o hábito é o primeiro passo.', done: (f) => f.daysLogged7 >= 5, tab: 'lancamentos' },
      { id: 'o2', text: 'Defina limite para pelo menos 3 categorias', why: 'O limite transforma "acho que gastei muito" em um alerta de verdade.', done: (f) => f.limitsCount >= 3, tab: 'orcamento' },
      { id: 'o3', text: 'Crie lembretes das suas 3 contas fixas', why: 'Conta atrasada vira multa e juros. O lembrete custa 30 segundos.', done: (f) => f.remindersCount >= 3, tab: 'lembretes' },
      { id: 'o4', text: 'Feche o mês gastando menos do que ganhou', why: 'Sobrar dinheiro, mesmo pouco, é o que financia todo o resto.', done: (f) => f.incomeCents > 0 && f.spentCents < f.incomeCents, tab: 'geral' },
      { id: 'o5', text: 'Revise suas cobranças recorrentes e marque o que vai cancelar', why: 'Assinaturas esquecidas custam por ano o que dava para virar reserva.', done: (f) => (f.recurringFlags ?? 0) >= 1, tab: 'cobrancas' },
    ],
  },
  {
    id: 'sair_do_vermelho', title: 'Sair do vermelho', promise: 'Cadastrar o que você deve, escolher a ordem certa e ver o saldo caindo mês a mês.', minPlan: 'ousado',
    missions: [
      { id: 'd1', text: 'Cadastre todas as suas dívidas', why: 'Não se resolve o que não se enxerga: juntar tudo em um lugar reduz a ansiedade.', done: (f) => f.debtsCount >= 1, tab: 'dividas' },
      { id: 'd2', text: 'Registre o primeiro pagamento de uma dívida', why: 'O primeiro abatimento prova que é possível e liga o plano de quitação.', done: (f) => f.debtPaymentsCount >= 1, tab: 'dividas' },
      { id: 'd3', text: 'Registre 3 pagamentos de dívida', why: 'Constância vence valor: três meses seguidos viram rotina.', done: (f) => f.debtPaymentsCount >= 3, tab: 'dividas' },
      { id: 'd4', text: 'Reduza 10% do total que você devia', why: 'Os primeiros 10% são os mais difíceis; depois o plano ganha embalo.', done: (f) => f.debtInitialCents > 0 && (f.debtInitialCents - f.debtOwedCents) / f.debtInitialCents >= 0.1, tab: 'dividas' },
      { id: 'd5', text: 'Quite a primeira dívida', why: 'Libera a parcela dela para atacar a próxima (efeito bola de neve).', done: (f) => f.paidOffCount >= 1, tab: 'dividas' },
      { id: 'd7', text: 'Zere o cheque especial da sua conta', why: 'É a dívida mais cara que existe (até 8% ao mês) e a única que você usa sem perceber. Sair dele economiza todo mês.', done: (f) => (f.overdraftUsedCents ?? 0) === 0, applies: (f) => Boolean(f.overdraftTracked), tab: 'carteiras' },
      { id: 'd6', text: 'Chegue a 50% do total quitado', why: 'Metade do caminho: os juros pesam cada vez menos.', done: (f) => f.debtInitialCents > 0 && (f.debtInitialCents - f.debtOwedCents) / f.debtInitialCents >= 0.5, tab: 'dividas' },
    ],
  },
  {
    id: 'reserva', title: 'Montar a reserva de emergência', promise: 'Ter colchão para o imprevisto sem recorrer ao cartão ou ao cheque especial.', minPlan: 'ousado',
    missions: [
      { id: 'r1', text: 'Crie uma meta chamada "Reserva de emergência"', why: 'Meta com nome e valor é muito mais fácil de cumprir.', done: (f) => f.goalsCount >= 1, tab: 'metas' },
      { id: 'r2', text: 'Faça o primeiro aporte na meta', why: 'Comece pequeno: o que importa é automatizar o hábito.', done: (f) => f.goalContributions >= 1, tab: 'metas' },
      { id: 'r3', text: 'Alcance 1 mês de gastos guardado', why: 'Primeiro degrau: cobre uma conta de luz atrasada ou um conserto.', done: (f) => emergencyMonths(f) >= 1, tab: 'metas' },
      { id: 'r4', text: 'Alcance 3 meses de gastos guardados', why: 'Três meses cobrem a maioria dos imprevistos de renda.', done: (f) => emergencyMonths(f) >= 3, tab: 'metas' },
      { id: 'r5', text: 'Alcance 6 meses de gastos guardados', why: 'Seis meses é a reserva completa: você negocia emprego e contas sem pressão.', done: (f) => emergencyMonths(f) >= 6, tab: 'metas' },
    ],
  },
  {
    id: 'investir', title: 'Começar a investir com base sólida', promise: 'Só investir depois de blindar o essencial: sem dívida cara, com reserva e com sobra todo mês.', minPlan: 'desbravador',
    missions: [
      { id: 'i1', text: 'Zere as dívidas com juros acima de 3% ao mês', why: 'Nenhum investimento rende mais do que a dívida cara custa.', done: (f) => f.expensiveDebtsOpen === 0 && f.daysLogged14 > 0, tab: 'dividas' },
      { id: 'i2', text: 'Tenha 3 meses de reserva', why: 'Sem reserva, o primeiro imprevisto te obriga a resgatar o investimento na hora errada.', done: (f) => emergencyMonths(f) >= 3, tab: 'metas' },
      { id: 'i3', text: 'Guarde pelo menos 10% da renda em um mês', why: 'É a sobra recorrente que forma patrimônio, não o investimento isolado.', done: (f) => f.incomeCents > 0 && savingsRatePct(f) >= 10, tab: 'geral' },
      { id: 'i4', text: 'Rode o simulador comparando cenários', why: 'Entenda juros compostos e a diferença entre rendimento e inflação antes de escolher onde aplicar.', done: () => false, tab: 'simulador' },
    ],
  },
];

export interface ProgramProgress {
  id: Program['id'];
  title: string;
  promise: string;
  minPlan: CoachPlan;
  locked: boolean;
  missions: { id: string; text: string; why: string; done: boolean; tab: string | null }[];
  doneCount: number;
  progressPct: number;
  nextMission: string | null;
}

/** `manualDone` guarda missões que não dá para confirmar pelos dados (ex.: ter usado o simulador). */
export function evaluatePrograms(f: CoachFacts, plan: CoachPlan, manualDone: ReadonlySet<string> = new Set()): ProgramProgress[] {
  return PROGRAMS.map((p) => {
    const missions = p.missions.filter((m) => !m.applies || m.applies(f) || manualDone.has(m.id)).map((m) => ({ id: m.id, text: m.text, why: m.why, done: manualDone.has(m.id) || m.done(f), tab: m.tab ?? null }));
    const doneCount = missions.filter((m) => m.done).length;
    return { id: p.id, title: p.title, promise: p.promise, minPlan: p.minPlan, locked: !planAtLeast(plan, p.minPlan), missions, doneCount, progressPct: Math.round((doneCount / missions.length) * 100), nextMission: missions.find((m) => !m.done)?.text ?? null };
  });
}

// ---------------------------------------------------------------------------
// Métodos
// ---------------------------------------------------------------------------
export interface Method {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  minPlan: CoachPlan;
}
export const METHODS: Method[] = [
  { id: '50_30_20', title: 'Regra 50/30/20', summary: 'Divida a renda líquida: 50% para o essencial, 30% para o que você quer, 20% para o futuro (dívidas e reserva).', steps: ['Some o que você recebe por mês, já com os descontos.', 'Separe o essencial (moradia, mercado, transporte, saúde) até 50%.', 'Limite lazer e desejos a 30%.', 'Transfira 20% para reserva e para quitar dívidas assim que o dinheiro entrar.'], minPlan: 'controle' },
  { id: 'pague_se_primeiro', title: 'Pague-se primeiro', summary: 'Guarde antes de gastar: no dia em que o dinheiro cair, separe a parte do futuro e viva com o resto.', steps: ['Escolha um valor fixo, mesmo pequeno.', 'Faça a transferência no dia do recebimento.', 'Registre como aporte na sua meta.', 'Aumente 1% da renda a cada 3 meses.'], minPlan: 'controle' },
  { id: 'revisao_semanal', title: 'Revisão de 10 minutos por semana', summary: 'Todo domingo, 10 minutos: conferir lançamentos, limites e o que vence nos próximos 7 dias.', steps: ['Lance o que faltou.', 'Olhe as categorias perto do limite.', 'Confira os vencimentos da semana.', 'Escolha UMA coisa para melhorar na semana.'], minPlan: 'controle' },
  { id: 'avalanche', title: 'Avalanche de dívidas', summary: 'Pague o mínimo em todas e jogue todo o extra na dívida de juros mais altos. É o que menos custa.', steps: ['Liste as dívidas com a taxa mensal de cada uma.', 'Pague só o mínimo nas outras.', 'Todo extra vai para a de maior taxa.', 'Quando quitar, a parcela dela passa para a próxima.'], minPlan: 'ousado' },
  { id: 'bola_de_neve', title: 'Bola de neve', summary: 'Quite primeiro a menor dívida para ganhar vitórias rápidas e manter a motivação. Custa um pouco mais de juros.', steps: ['Ordene da menor para a maior.', 'Extra na menor, mínimo nas demais.', 'Comemore cada quitação.', 'Use a parcela liberada na próxima.'], minPlan: 'ousado' },
  { id: 'envelopes', title: 'Método dos envelopes', summary: 'Dê a cada categoria um valor fechado para o mês. Acabou o envelope, acabou o gasto naquela categoria.', steps: ['Defina o limite de cada categoria na aba Orçamento.', 'Acompanhe pelo alerta de limite.', 'Se estourar, tire de outra categoria, nunca do futuro.', 'Ajuste os valores no mês seguinte.'], minPlan: 'ousado' },
  { id: 'regra_24h', title: 'Regra das 24 horas', summary: 'Compra não planejada acima de um valor que você define só se confirma depois de 24 horas.', steps: ['Defina o valor de corte (ex.: R$ 100).', 'Anote o desejo em vez de comprar na hora.', 'Se no dia seguinte ainda fizer sentido e couber no limite, compre.', 'Some o que deixou de gastar e mande para a reserva.'], minPlan: 'ousado' },
  { id: 'juros_compostos', title: 'Juros compostos a seu favor', summary: 'Depois de quitar a dívida cara e montar a reserva, o tempo faz o trabalho: é o que o simulador mostra.', steps: ['Só comece com dívida cara zerada e reserva montada.', 'Invista todo mês, do mesmo valor, sem tentar adivinhar o mercado.', 'Compare sempre o ganho com a inflação (rentabilidade real).', 'Evite mexer no dinheiro: o tempo é o ingrediente.'], minPlan: 'desbravador' },
];

export interface MethodApplied extends Method {
  locked: boolean;
  /** Números da pessoa aplicados ao método (quando dá para calcular). */
  yours: string | null;
}

export function applyMethods(f: CoachFacts, plan: CoachPlan): MethodApplied[] {
  return METHODS.map((m) => {
    let yours: string | null = null;
    if (m.id === '50_30_20' && f.incomeCents > 0) yours = `Na sua renda de ${brl0(f.incomeCents)}: essencial até ${brl0(f.incomeCents * 0.5)}, desejos até ${brl0(f.incomeCents * 0.3)} e futuro ${brl0(f.incomeCents * 0.2)}.`;
    if (m.id === 'pague_se_primeiro' && f.incomeCents > 0) yours = `Comece com 5%: ${brl0(f.incomeCents * 0.05)} por mês vira ${brl0(f.incomeCents * 0.05 * 12)} em um ano.`;
    if (m.id === 'avalanche' && f.openDebtsCount > 0) yours = `Você tem ${f.openDebtsCount} dívida(s) aberta(s) somando ${brl0(f.debtOwedCents)}. A aba Dívidas já mostra a ordem.`;
    if (m.id === 'envelopes' && f.avgMonthlySpendCents > 0) yours = `Seu gasto médio é ${brl0(f.avgMonthlySpendCents)} por mês: distribua esse total nos envelopes.`;
    return { ...m, locked: !planAtLeast(plan, m.minPlan), yours };
  });
}

// ---------------------------------------------------------------------------
// Cenário econômico
// ---------------------------------------------------------------------------
export interface Indicators {
  selicPct: number | null; // meta Selic, % ao ano
  ipca12Pct: number | null; // IPCA acumulado em 12 meses
  cdiPct: number | null; // CDI, % ao ano
  usdBrl: number | null;
  /** Euro em reais (Desbravador, como o dólar). */
  eurBrl?: number | null;
  /** Variação em relação a ~3 meses antes (mesma unidade). */
  selicTrend: number | null;
  ipcaTrend: number | null;
  usdTrend: number | null;
  eurTrend?: number | null;
}
export interface MarketInsight {
  id: string;
  title: string;
  text: string;
  tone: 'good' | 'warn' | 'info';
  minPlan: CoachPlan;
}

/** Juro mensal (%) -> anual composto (%). */
export const annualFromMonthlyPct = (m: number): number => (Math.pow(1 + m / 100, 12) - 1) * 100;

export function marketInsights(ind: Indicators, f: CoachFacts, openDebtRatesBps: number[] = []): MarketInsight[] {
  const out: MarketInsight[] = [];
  const real = ind.cdiPct !== null && ind.ipca12Pct !== null ? ((1 + ind.cdiPct / 100) / (1 + ind.ipca12Pct / 100) - 1) * 100 : null;
  if (ind.selicPct !== null) {
    const dir = ind.selicTrend === null || Math.abs(ind.selicTrend) < 0.01 ? 'estável' : ind.selicTrend > 0 ? 'em alta' : 'em queda';
    out.push({ id: 'selic', title: `Selic em ${ind.selicPct.toLocaleString('pt-BR')}% ao ano (${dir})`, tone: 'info', minPlan: 'controle', text: 'A Selic é o juro básico da economia: ela puxa o custo de todo o crédito e o rendimento da renda fixa. Selic alta encarece o seu financiamento e o seu cartão, mas também faz a reserva render mais.' });
  }
  if (ind.ipca12Pct !== null) out.push({ id: 'ipca', title: `Inflação (IPCA) de ${ind.ipca12Pct.toLocaleString('pt-BR')}% em 12 meses`, tone: ind.ipca12Pct > 6 ? 'warn' : 'info', minPlan: 'controle', text: `Seu dinheiro parado perde poder de compra nesse ritmo: o que custava R$ 100 há um ano custa hoje cerca de R$ ${(100 * (1 + ind.ipca12Pct / 100)).toFixed(0)}. Revise no orçamento os itens que mais subiram.` });
  if (real !== null) out.push({ id: 'juro_real', title: `Juro real da renda fixa: ${real.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% ao ano`, tone: real > 0 ? 'good' : 'warn', minPlan: 'ousado', text: real > 0 ? 'O CDI está acima da inflação: guardar a reserva em renda fixa de liquidez diária (que acompanha o CDI) faz o dinheiro render de verdade, e não só repor a inflação.' : 'O CDI está abaixo da inflação: manter dinheiro parado perde valor. Priorize quitar dívida cara, que é um "investimento" certo.' });
  const worst = openDebtRatesBps.length ? Math.max(...openDebtRatesBps) / 100 : 0;
  if (worst > 0 && ind.cdiPct !== null) {
    const yr = annualFromMonthlyPct(worst);
    out.push({ id: 'divida_vs_cdi', title: 'Sua dívida mais cara versus o mercado', tone: 'warn', minPlan: 'ousado', text: `Sua dívida de ${worst.toLocaleString('pt-BR')}% ao mês equivale a cerca de ${Math.round(yr)}% ao ano, contra ${ind.cdiPct.toLocaleString('pt-BR')}% do CDI. Cada real usado para quitá-la rende, na prática, ${(yr / ind.cdiPct).toFixed(1)} vezes mais do que qualquer aplicação segura.` });
  }
  if (ind.usdBrl !== null) out.push({ id: 'dolar', title: `Dólar a R$ ${ind.usdBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, tone: 'info', minPlan: 'desbravador', text: `${ind.usdTrend !== null && ind.usdTrend > 0 ? 'O dólar subiu nos últimos meses: ' : ''}pesa em combustível, eletrônicos e viagens. Se você tem gastos em dólar (assinaturas, compras internacionais), coloque um limite próprio para eles no orçamento.` });
  if (ind.eurBrl !== null && ind.eurBrl !== undefined) out.push({ id: 'euro', title: `Euro a R$ ${ind.eurBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, tone: 'info', minPlan: 'desbravador', text: `${ind.eurTrend !== null && ind.eurTrend !== undefined && ind.eurTrend > 0 ? 'O euro subiu nos últimos meses: ' : ''}pesa em viagens à Europa, anúncios e compras no exterior. A fatura do cartão converte pelo câmbio do dia da compra e soma o IOF: deixe uma folga no orçamento para esses gastos.` });
  if (f.expensiveDebtsOpen > 0 && ind.selicTrend !== null && ind.selicTrend < 0) out.push({ id: 'renegociar', title: 'Juros caindo: hora de renegociar', tone: 'good', minPlan: 'ousado', text: 'Com a Selic em queda, peça redução de taxa ou portabilidade das dívidas caras: o banco tem menos desculpa para manter o juro alto.' });
  return out;
}

// ---------------------------------------------------------------------------
// Desafios da semana e comparação de meses
// ---------------------------------------------------------------------------
export interface Challenge {
  id: string;
  text: string;
  tab: string;
  done: boolean;
}

interface ChallengeDef {
  id: string;
  text: string;
  tab: string;
  applies: (f: CoachFacts) => boolean;
  done: (f: CoachFacts) => boolean;
}

const CHALLENGES: ChallengeDef[] = [
  { id: 'w_registrar', text: 'Lance seus gastos em 5 dos próximos 7 dias', tab: 'lancamentos', applies: () => true, done: (f) => f.daysLogged7 >= 5 },
  { id: 'w_limites', text: 'Passe a semana sem estourar nenhum limite', tab: 'orcamento', applies: (f) => f.limitsCount > 0, done: (f) => f.limitsCount > 0 && f.overLimitCount === 0 && f.daysLogged7 >= 3 },
  { id: 'w_divida', text: 'Registre um pagamento de dívida nesta semana', tab: 'dividas', applies: (f) => f.openDebtsCount > 0, done: (f) => f.debtPayments7 >= 1 },
  { id: 'w_meta', text: 'Faça um aporte na sua meta, mesmo pequeno', tab: 'metas', applies: (f) => f.goalsCount > 0, done: (f) => f.goalContribs7 >= 1 },
  { id: 'w_lembretes', text: 'Cadastre as contas que vencem nas próximas semanas', tab: 'lembretes', applies: (f) => f.remindersCount < 5, done: (f) => f.remindersCount >= 5 },
  { id: 'w_sobra', text: 'Feche a semana gastando menos do que entrou no mês', tab: 'geral', applies: (f) => f.incomeCents > 0, done: (f) => f.incomeCents > 0 && f.spentCents < f.incomeCents },
];

/** Três desafios por semana: o conjunto roda com o número da semana e só entram os que fazem sentido para a conta. */
export function weeklyChallenges(f: CoachFacts, weekIndex: number): Challenge[] {
  const pool = CHALLENGES.filter((c) => c.applies(f));
  if (pool.length === 0) return [];
  const first = pool[0]!; // lançar é sempre o desafio-base: é o hábito que sustenta tudo
  const rest = pool.slice(1);
  const picked = [first];
  for (let i = 0; i < Math.min(2, rest.length); i += 1) picked.push(rest[(weekIndex + i) % rest.length]!);
  return [...new Map(picked.map((c) => [c.id, c])).values()].map((c) => ({ id: c.id, text: c.text, tab: c.tab, done: c.done(f) }));
}

/** Número da semana (a partir de 1970) de uma data ISO yyyy-mm-dd. */
export const weekIndexOf = (iso: string): number => Math.floor(Date.parse(iso + 'T00:00:00Z') / (7 * 86_400_000));

export interface CategoryChange {
  category: string;
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  deltaPct: number | null;
}
export interface MonthComparison {
  currentCents: number;
  previousCents: number;
  deltaCents: number;
  deltaPct: number | null;
  verdict: 'menos' | 'igual' | 'mais' | 'sem_base';
  changes: CategoryChange[];
}

/** Compara o gasto do mês até hoje com o mês anterior até o mesmo dia (mapas categoria -> centavos de gasto). */
export function compareMonths(current: Record<string, number>, previous: Record<string, number>): MonthComparison {
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const cur = sum(current);
  const prev = sum(previous);
  const cats = new Set([...Object.keys(current), ...Object.keys(previous)]);
  const changes = [...cats]
    .map((category) => {
      const c = current[category] ?? 0;
      const p = previous[category] ?? 0;
      return { category, currentCents: c, previousCents: p, deltaCents: c - p, deltaPct: p > 0 ? Math.round(((c - p) / p) * 100) : null };
    })
    .filter((x) => x.deltaCents !== 0)
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
    .slice(0, 4);
  const deltaPct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  const verdict = prev === 0 ? 'sem_base' : Math.abs(cur - prev) <= prev * 0.03 ? 'igual' : cur < prev ? 'menos' : 'mais';
  return { currentCents: cur, previousCents: prev, deltaCents: cur - prev, deltaPct, verdict, changes };
}

// ---------------------------------------------------------------------------
// Objetivo e modelos de meta
// ---------------------------------------------------------------------------
export const OBJECTIVES: { id: Program['id']; label: string; hint: string }[] = [
  { id: 'organizar', label: 'Organizar o meu dinheiro', hint: 'Saber para onde vai cada real e parar de ser surpreendido por contas.' },
  { id: 'sair_do_vermelho', label: 'Sair do vermelho', hint: 'Quitar dívidas na ordem certa, pagando o mínimo de juros.' },
  { id: 'reserva', label: 'Montar uma reserva de emergência', hint: 'Ter colchão para o imprevisto sem recorrer ao cartão.' },
  { id: 'investir', label: 'Começar a investir', hint: 'Construir a base certa e só então fazer o dinheiro render.' },
];

export interface GoalTemplate {
  id: string;
  name: string;
  hint: string;
  targetCents: number | null; // null = a pessoa define
  months: number; // prazo sugerido
}

/** Modelos de meta com o valor calculado da conta: reserva = N meses do gasto médio; quitar = o que se deve. */
export function goalTemplates(f: Pick<CoachFacts, 'avgMonthlySpendCents' | 'debtOwedCents'>): GoalTemplate[] {
  const spend = f.avgMonthlySpendCents;
  const months = (n: number) => (spend > 0 ? Math.round(spend * n) : null);
  const list: GoalTemplate[] = [
    { id: 'reserva_1', name: 'Reserva de emergência: 1 mês', hint: 'Primeiro degrau: um mês de gastos guardado.', targetCents: months(1), months: 4 },
    { id: 'reserva_3', name: 'Reserva de emergência: 3 meses', hint: 'Cobre a maioria dos imprevistos de renda.', targetCents: months(3), months: 12 },
    { id: 'reserva_6', name: 'Reserva de emergência completa: 6 meses', hint: 'O alvo completo para negociar sem pressão.', targetCents: months(6), months: 24 },
  ];
  if (f.debtOwedCents > 0) list.push({ id: 'quitar', name: 'Quitar minhas dívidas', hint: 'O total que você ainda deve, para acompanhar junto com a aba Dívidas.', targetCents: f.debtOwedCents, months: 18 });
  list.push(
    { id: 'viagem', name: 'Viagem', hint: 'Defina o valor do roteiro e o prazo.', targetCents: null, months: 12 },
    { id: 'estudo', name: 'Curso ou estudo', hint: 'Investir em você é o que mais rende.', targetCents: null, months: 8 },
    { id: 'imprevistos', name: 'Fundo para manutenção da casa/carro', hint: 'Evita que um conserto vire dívida de cartão.', targetCents: null, months: 10 },
  );
  return list;
}
