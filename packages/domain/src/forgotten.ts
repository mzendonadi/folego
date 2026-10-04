// Guia de dinheiro esquecido (versão elaborada): a partir de um questionário curto, monta o roteiro personalizado de ONDE procurar,
// o passo a passo e os documentos de cada fonte oficial. Nunca estima valor (não temos acesso às contas da pessoa) e nunca
// cobra para "liberar" nada: todas as consultas oficiais são gratuitas. Cálculo puro, sem rede e sem IA.

export type YesNo = 'sim' | 'nao';
export type YesNoMaybe = 'sim' | 'nao' | 'nao_sei';

export interface ForgottenInput {
  /** Já trabalhou com carteira assinada (CLT)? */
  workedFormal: YesNo;
  /** Trabalhou com carteira assinada antes de 1989? (cotas do PIS/Pasep) */
  workedBefore1989: YesNo;
  /** Teve conta bancária encerrada ou que não usa mais? */
  closedBankAccount: YesMaybe;
  /** Participou de consórcio ou de cooperativa de crédito? */
  consorcioOrCoop: YesMaybe;
  /** Algum parente próximo faleceu deixando conta, investimento ou benefício? */
  relativeDied: YesNo;
  /** Declara ou já declarou Imposto de Renda? */
  declaresIr: YesNo;
  /** Já investiu em ações, fundos ou Tesouro Direto? */
  invested: YesNo;
  /** Tem ou teve seguro de vida (inclusive por empresa ou financiamento)? */
  lifeInsurance: YesNoMaybe;
  /** Já recebeu ou pediu benefício do INSS (aposentadoria, pensão, auxílio)? */
  inssBenefit: YesNo;
}
type YesMaybe = YesNoMaybe;

export type SourceId = 'valores_a_receber' | 'registrato' | 'restituicao_ir' | 'fgts' | 'pis_pasep' | 'b3' | 'susep' | 'inss' | 'herdeiros';

export interface ForgottenSource {
  id: SourceId;
  name: string;
  why: string;
  covers: string;
  link: string;
  linkLabel: string;
  minutes: number;
  docs: string[];
  steps: string[];
  tip: string;
  /** Quanto mais alto, mais cedo na ordem sugerida (chance x facilidade). */
  weight: number;
}

const SOURCES: Record<SourceId, Omit<ForgottenSource, 'why'>> = {
  valores_a_receber: {
    id: 'valores_a_receber',
    name: 'Valores a Receber (Banco Central)',
    covers: 'Contas encerradas com saldo, tarifas cobradas indevidamente, consórcios encerrados e cotas de cooperativas de crédito.',
    link: 'https://valoresareceber.bcb.gov.br',
    linkLabel: 'valoresareceber.bcb.gov.br',
    minutes: 10,
    docs: ['CPF', 'Conta gov.br (nível prata ou ouro) ou reconhecimento facial no próprio sistema'],
    steps: [
      'Acesse o endereço oficial digitando você mesmo no navegador (não clique em links recebidos por mensagem).',
      'Entre com a conta gov.br e informe o CPF.',
      'Se houver valor, o sistema mostra a instituição e o valor. Clique em solicitar a devolução.',
      'Acompanhe a resposta no próprio sistema: a instituição tem prazo para responder e depositar na conta que você indicar.',
      'Se não aparecer nada hoje, repita a consulta a cada alguns meses: novos valores entram com frequência.',
    ],
    tip: 'A consulta e a devolução são gratuitas e feitas só pelo sistema oficial. Ninguém precisa pagar para você receber.',
    weight: 100,
  },
  registrato: {
    id: 'registrato',
    name: 'Registrato (Banco Central)',
    covers: 'Mostra em quais bancos e cooperativas você tem ou teve conta, empréstimo ou chave Pix. É o mapa para saber onde procurar.',
    link: 'https://www.bcb.gov.br/meubc/registrato',
    linkLabel: 'bcb.gov.br/meubc/registrato',
    minutes: 10,
    docs: ['CPF', 'Conta gov.br'],
    steps: [
      'Acesse o Registrato pelo site do Banco Central e entre com a conta gov.br.',
      'Peça o relatório de relacionamentos com instituições financeiras.',
      'Anote cada banco em que você tinha conta e hoje não usa mais.',
      'Para cada um, consulte o Valores a Receber e, se preciso, peça o saldo por escrito ao banco.',
    ],
    tip: 'Gratuito. Serve para descobrir contas esquecidas antes de procurar o dinheiro.',
    weight: 70,
  },
  restituicao_ir: {
    id: 'restituicao_ir',
    name: 'Restituição do Imposto de Renda',
    covers: 'Restituições que ficaram retidas (malha fina), lotes não resgatados e declarações com valor a receber.',
    link: 'https://www.restituicao.receita.fazenda.gov.br',
    linkLabel: 'restituicao.receita.fazenda.gov.br',
    minutes: 10,
    docs: ['CPF', 'Data de nascimento', 'Recibo ou número da declaração (se tiver)'],
    steps: [
      'Acesse a consulta oficial de restituição da Receita Federal.',
      'Informe CPF e data de nascimento e veja a situação dos últimos exercícios.',
      'Se a restituição não foi paga por conta corrente errada, peça o crédito em outra conta pelo portal e-CAC ou pelo banco indicado.',
      'Se estiver em malha fina, siga as instruções para retificar ou enviar documentos.',
    ],
    tip: 'Pagamento de restituição só vem por banco indicado na declaração. A Receita não cobra taxa para liberar.',
    weight: 85,
  },
  fgts: {
    id: 'fgts',
    name: 'FGTS de empregos antigos',
    covers: 'Contas de empregos anteriores com saldo e valores que podem ser sacados em situações permitidas em lei.',
    link: 'https://www.caixa.gov.br/beneficios-trabalhador/fgts',
    linkLabel: 'caixa.gov.br/beneficios-trabalhador/fgts',
    minutes: 15,
    docs: ['CPF', 'Número do PIS/NIS', 'Carteira de Trabalho', 'Aplicativo FGTS (Caixa)'],
    steps: [
      'Baixe o aplicativo oficial FGTS da Caixa ou entre no site da Caixa.',
      'Consulte o extrato: ele lista todas as contas de empregos anteriores.',
      'Veja a regra de saque de cada conta (demissão sem justa causa, aposentadoria, compra de imóvel, saque-aniversário etc.).',
      'Se tiver direito, solicite o saque no próprio aplicativo ou numa agência da Caixa.',
    ],
    tip: 'Atenção: o saque-aniversário pode bloquear o saque total na demissão. Entenda a regra antes de optar.',
    weight: 80,
  },
  pis_pasep: {
    id: 'pis_pasep',
    name: 'PIS/Pasep (abono e cotas)',
    covers: 'Abono salarial do ano-base e, para quem trabalhou entre 1971 e 1988, cotas do PIS ou do Pasep.',
    link: 'https://www.gov.br/trabalho-e-emprego',
    linkLabel: 'gov.br/trabalho-e-emprego',
    minutes: 15,
    docs: ['CPF', 'Número do PIS/Pasep', 'Carteira de Trabalho Digital (aplicativo)'],
    steps: [
      'Abra o aplicativo Carteira de Trabalho Digital e consulte o abono salarial.',
      'Para cotas antigas, consulte o PIS na Caixa ou o Pasep no Banco do Brasil.',
      'Se houver saldo, siga a orientação do próprio banco: saque do abono ou solicitação das cotas.',
      'Guarde o protocolo de qualquer pedido.',
    ],
    tip: 'Só o aplicativo e os bancos oficiais liberam esse dinheiro. Desconfie de quem pede taxa.',
    weight: 60,
  },
  b3: {
    id: 'b3',
    name: 'Canal do Investidor (B3)',
    covers: 'Ações, fundos, Tesouro Direto e proventos (dividendos e juros sobre capital) que você tem e pode ter esquecido.',
    link: 'https://www.investidor.b3.com.br',
    linkLabel: 'investidor.b3.com.br',
    minutes: 10,
    docs: ['CPF', 'Conta gov.br'],
    steps: [
      'Acesse o Canal do Investidor da B3 e entre com a conta gov.br.',
      'Veja a posição consolidada: tudo que você tem em custódia, em qualquer corretora.',
      'Confira proventos a receber ou ativos em corretoras que você não usa mais.',
      'Para ativos parados, peça a transferência ou o resgate pela corretora ou pelo agente de custódia.',
    ],
    tip: 'Gratuito. Se não reconhecer um ativo, procure a corretora indicada antes de qualquer decisão.',
    weight: 55,
  },
  susep: {
    id: 'susep',
    name: 'Seguro de vida esquecido (Susep)',
    covers: 'Seguros de vida (inclusive os contratados por empresa ou junto com financiamento) e capitalização que podem ter valor a devolver.',
    link: 'https://www.gov.br/susep',
    linkLabel: 'gov.br/susep',
    minutes: 15,
    docs: ['CPF', 'Número da apólice, se tiver', 'Documento do beneficiário (se for o caso)'],
    steps: [
      'No site da Susep, procure o serviço de consulta de seguros e capitalização esquecidos para o cidadão.',
      'Informe o CPF e confira se há apólices ou valores em seu nome ou do falecido.',
      'Se houver, a seguradora indicada precisa ser procurada: peça o pagamento por escrito, com protocolo.',
      'Se a seguradora negar ou não responder, registre reclamação na própria Susep e no consumidor.gov.br.',
    ],
    tip: 'O pagamento é feito pela seguradora, sem taxa. Em caso de morte, os beneficiários têm prazo para pedir: não deixe passar.',
    weight: 50,
  },
  inss: {
    id: 'inss',
    name: 'Meu INSS: valores não recebidos',
    covers: 'Parcelas de benefícios não sacadas, diferenças a receber e valores de benefícios de pessoas falecidas, quando houver direito.',
    link: 'https://meu.inss.gov.br',
    linkLabel: 'meu.inss.gov.br',
    minutes: 15,
    docs: ['CPF', 'Conta gov.br', 'Número do benefício (se tiver)'],
    steps: [
      'Entre no Meu INSS (site ou aplicativo) com a conta gov.br.',
      'Consulte extratos e pagamentos e veja se há parcelas não recebidas ou revisões em andamento.',
      'Para valores de pessoa falecida, siga a orientação do INSS para dependentes e herdeiros (pode pedir certidão de óbito e comprovante de parentesco).',
      'Agende o atendimento pelo 135 se precisar de ajuda e guarde o protocolo.',
    ],
    tip: 'O 135 e o Meu INSS são os canais oficiais e gratuitos. Intermediários que cobram porcentagem "para liberar" costumam ser golpe.',
    weight: 45,
  },
  herdeiros: {
    id: 'herdeiros',
    name: 'Valores de pessoa falecida (herdeiros)',
    covers: 'Contas, consórcios e benefícios deixados por parente que faleceu e que os herdeiros podem pedir.',
    link: 'https://valoresareceber.bcb.gov.br',
    linkLabel: 'valoresareceber.bcb.gov.br (consulta de falecidos)',
    minutes: 30,
    docs: ['Certidão de óbito', 'CPF do falecido', 'Documentos do herdeiro (RG, CPF, comprovante de parentesco)', 'Inventário, alvará ou escritura de partilha, quando o banco exigir'],
    steps: [
      'No Valores a Receber há o caminho de consulta para pessoa falecida: separe a certidão de óbito e o CPF dela.',
      'Informe seu parentesco e siga as instruções do sistema para enviar os documentos.',
      'Se o banco pedir inventário, procure um cartório (inventário extrajudicial, se todos forem maiores e concordes) ou a Defensoria Pública, que orienta de graça.',
      'Divida entre os herdeiros conforme a lei; guarde todos os protocolos.',
    ],
    tip: 'É a situação em que mais surgem golpistas. Não pague "taxa de liberação" a ninguém: o processo oficial é gratuito.',
    weight: 65,
  },
};

export class ForgottenInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Respostas inválidas: ${issues.join('; ')}`);
    this.name = 'ForgottenInputError';
    this.issues = issues;
  }
}

const YN = new Set(['sim', 'nao']);
const YNM = new Set(['sim', 'nao', 'nao_sei']);
export function validateForgotten(i: ForgottenInput): void {
  const issues: string[] = [];
  for (const k of ['workedFormal', 'workedBefore1989', 'relativeDied', 'declaresIr', 'invested', 'inssBenefit'] as const) if (!YN.has(i[k])) issues.push(`${k} inválido`);
  for (const k of ['closedBankAccount', 'consorcioOrCoop', 'lifeInsurance'] as const) if (!YNM.has(i[k])) issues.push(`${k} inválido`);
  if (issues.length > 0) throw new ForgottenInputError(issues);
}

export interface ForgottenGuide {
  sources: ForgottenSource[];
  totalMinutes: number;
  scamAlerts: string[];
  honesty: string;
  tracker: { id: SourceId; label: string }[];
}

export function buildForgottenGuide(input: ForgottenInput): ForgottenGuide {
  validateForgotten(input);
  const picked: ForgottenSource[] = [];
  const add = (id: SourceId, why: string, boost = 0) => {
    const base = SOURCES[id];
    picked.push({ ...base, why, weight: base.weight + boost });
  };
  add('valores_a_receber', input.closedBankAccount === 'sim' || input.consorcioOrCoop === 'sim' ? 'Você disse que teve conta encerrada, consórcio ou cooperativa: é exatamente o que esse sistema devolve.' : 'Todo mundo pode consultar: é gratuito e leva poucos minutos.', input.closedBankAccount === 'sim' || input.consorcioOrCoop === 'sim' ? 30 : 0);
  add('registrato', input.closedBankAccount === 'nao_sei' ? 'Você não lembra de todas as contas: o Registrato lista onde você tem ou teve relacionamento.' : 'Mostra em quais instituições você tem relacionamento, para saber onde procurar.', input.closedBankAccount === 'nao_sei' ? 25 : 0);
  if (input.declaresIr === 'sim') add('restituicao_ir', 'Você declara Imposto de Renda: vale conferir se há restituição retida ou não paga.');
  if (input.workedFormal === 'sim') add('fgts', 'Você já trabalhou de carteira assinada: contas de empregos antigos podem ter saldo.');
  if (input.workedFormal === 'sim') add('pis_pasep', input.workedBefore1989 === 'sim' ? 'Você trabalhou antes de 1989: pode haver cotas do PIS/Pasep além do abono.' : 'Quem teve carteira assinada pode ter abono salarial a receber.', input.workedBefore1989 === 'sim' ? 25 : 0);
  if (input.invested === 'sim') add('b3', 'Você já investiu: ações, fundos ou Tesouro podem estar parados em alguma corretora.');
  if (input.lifeInsurance !== 'nao') add('susep', input.lifeInsurance === 'sim' ? 'Você tem ou teve seguro de vida: confira apólices antigas e valores a devolver.' : 'Você não tem certeza: seguro de vida costuma vir junto com financiamento, cartão ou emprego.');
  if (input.inssBenefit === 'sim') add('inss', 'Você tem relação com benefício do INSS: confira parcelas não pagas e revisões.');
  if (input.relativeDied === 'sim') add('herdeiros', 'Um parente faleceu: herdeiros podem pedir valores que ele deixou em bancos, consórcios e benefícios.', 20);

  picked.sort((a, b) => b.weight - a.weight);
  return {
    sources: picked,
    totalMinutes: picked.reduce((s, p) => s + p.minutes, 0),
    scamAlerts: [
      'Nenhum órgão oficial cobra taxa, comissão ou "adiantamento" para liberar dinheiro esquecido. Quem cobra é golpista.',
      'Digite o endereço oficial no navegador. Não clique em links de SMS, WhatsApp, e-mail ou anúncios.',
      'Não passe senha, código de verificação, dados de cartão nem faça Pix para "destravar" valores.',
      'Desconfie de "despachante" ou "advogado" que liga oferecendo achar o seu dinheiro. Você consegue sozinho, de graça.',
      'Se alguém já pediu dinheiro, não pague. Registre boletim de ocorrência e avise a instituição envolvida.',
    ],
    honesty: 'As consultas oficiais são gratuitas e você pode fazê-las sem este guia. O que o Fôlego organiza aqui é o caminho: por onde começar, em que ordem, com quais documentos e como não cair em golpe. Não sabemos se existe dinheiro no seu nome e não prometemos valor.',
    tracker: picked.map((p) => ({ id: p.id, label: `Consultar: ${p.name}` })),
  };
}

export interface ForgottenPreview {
  sourcesCount: number;
  totalMinutes: number;
  firstSourceName: string;
  headline: string;
  hasHeirPath: boolean;
}

export function buildForgottenPreview(g: ForgottenGuide): ForgottenPreview {
  const first = g.sources[0]!;
  return {
    sourcesCount: g.sources.length,
    totalMinutes: g.totalMinutes,
    firstSourceName: first.name,
    headline: `Pelo que você respondeu, vale procurar em ${g.sources.length} ${g.sources.length === 1 ? 'lugar oficial' : 'lugares oficiais'}. Dá cerca de ${g.totalMinutes} minutos no total, e a consulta é gratuita.`,
    hasHeirPath: g.sources.some((s) => s.id === 'herdeiros'),
  };
}
