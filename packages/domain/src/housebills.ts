// Renegociador de contas de casa (luz, água, gás, internet, celular, TV): monta o plano de acordo e os textos para negociar
// com a empresa, em centavos inteiros. Não negocia por ninguém e não promete desconto: dá o roteiro e os números de referência.
import { formatBrl } from './calendar.ts';

export type BillKind = 'energia' | 'agua' | 'gas' | 'internet' | 'celular' | 'tv';
export type CutStatus = 'nao' | 'aviso' | 'cortado';
export type LowIncome = 'sim' | 'nao' | 'nao_sei';

export interface HouseBillInput {
  kind: BillKind;
  overdueCents: number;
  monthsOverdue: number;
  /** Quanto a pessoa consegue pagar por mês nesta conta (além da fatura do mês). */
  monthlyCapacityCents: number;
  netIncomeCents?: number | undefined;
  cutStatus: CutStatus;
  lowIncome: LowIncome;
  /** A pessoa acha que o valor está errado (consumo alto, cobrança duplicada, serviço que não usou). */
  disputesAmount: boolean;
}

export const BILL_LABEL: Record<BillKind, string> = { energia: 'Energia elétrica', agua: 'Água e esgoto', gas: 'Gás', internet: 'Internet', celular: 'Celular', tv: 'TV por assinatura' };
const ESSENTIAL: Record<BillKind, boolean> = { energia: true, agua: true, gas: true, internet: false, celular: false, tv: false };

const CHANNEL: Record<BillKind, { regulator: string; phone: string | null; note: string }> = {
  energia: { regulator: 'ANEEL', phone: '167', note: 'Fale primeiro com a ouvidoria da distribuidora; se não resolver, a ANEEL (167) recebe a reclamação.' },
  agua: { regulator: 'a agência reguladora do seu estado ou município', phone: null, note: 'O serviço de água é regulado por agência estadual ou municipal: procure o nome dela na própria fatura. Antes, use a ouvidoria da companhia.' },
  gas: { regulator: 'a agência reguladora do seu estado', phone: null, note: 'O gás encanado é regulado por agência estadual; o nome costuma estar na fatura. Antes, use a ouvidoria da distribuidora.' },
  internet: { regulator: 'a Anatel', phone: '1331', note: 'Telecomunicações: ouvidoria da operadora primeiro; se não resolver, a Anatel (1331) e o consumidor.gov.br.' },
  celular: { regulator: 'a Anatel', phone: '1331', note: 'Telecomunicações: ouvidoria da operadora primeiro; se não resolver, a Anatel (1331) e o consumidor.gov.br.' },
  tv: { regulator: 'a Anatel', phone: '1331', note: 'TV por assinatura: ouvidoria da operadora primeiro; se não resolver, a Anatel (1331) e o consumidor.gov.br.' },
};

export interface Installment {
  count: number;
  installmentCents: number;
  totalCents: number;
}

export interface HouseBillPlan {
  kind: BillKind;
  label: string;
  essential: boolean;
  overdueCents: number;
  /** Estimativa de quanto da dívida é multa e juros de atraso (2% de multa + 1% ao mês), para dar uma meta de pedido. */
  estimatedPrincipalCents: number;
  estimatedPenaltyCents: number;
  /** Acordo à vista: o que pedir (só o principal) e um valor intermediário realista. */
  cashAsk: { askCents: number; fallbackCents: number };
  /** Parcelamento dentro da capacidade da pessoa. */
  installment: Installment;
  priority: 'alta' | 'media';
  priorityWhy: string;
  channel: { regulator: string; phone: string | null; note: string };
  steps: string[];
  phoneScript: string[];
  objections: { they: string; you: string }[];
  askInWriting: string[];
  letter: string;
  rights: string[];
  lowIncomeNote: string | null;
  cutNote: string | null;
  disputeNote: string | null;
  warnings: string[];
}

export class HouseBillInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Dados da conta inválidos: ${issues.join('; ')}`);
    this.name = 'HouseBillInputError';
    this.issues = issues;
  }
}

export function validateHouseBill(i: HouseBillInput): void {
  const issues: string[] = [];
  if (!(i.overdueCents > 0)) issues.push('o valor em atraso precisa ser maior que zero');
  if (!Number.isInteger(i.monthsOverdue) || i.monthsOverdue < 1 || i.monthsOverdue > 120) issues.push('meses em atraso: de 1 a 120');
  if (!(i.monthlyCapacityCents > 0)) issues.push('informe quanto cabe por mês');
  if (issues.length > 0) throw new HouseBillInputError(issues);
}

export function buildHouseBillPlan(input: HouseBillInput): HouseBillPlan {
  validateHouseBill(input);
  const label = BILL_LABEL[input.kind];
  const essential = ESSENTIAL[input.kind];
  // dívida = principal × (1 + 2% de multa + 1% ao mês de juros): inverte para estimar o principal
  const factor = 1 + 0.02 + 0.01 * input.monthsOverdue;
  const principal = Math.round(input.overdueCents / factor);
  const penalty = input.overdueCents - principal;
  const askCents = principal;
  const fallbackCents = principal + Math.round(penalty * 0.4); // meio-termo: tira a maior parte dos encargos
  const count = Math.min(60, Math.max(1, Math.ceil(input.overdueCents / input.monthlyCapacityCents)));
  const installmentCents = Math.ceil(input.overdueCents / count);

  const priorityWhy = essential
    ? `${label} é serviço essencial: atrasar mais leva a corte e a religação com custo. Entra na frente de dívidas de cartão e de loja.`
    : `${label} pode ser suspensa, mas não é essencial para morar. Negocie depois das contas de luz, água e gás e da moradia.`;

  const steps = [
    `Peça o demonstrativo de débito detalhado: principal, multa, juros e correção de cada fatura em atraso (${formatBrl(input.overdueCents)} no total hoje).`,
    'Anote o número do protocolo de toda ligação, chat ou mensagem. Sem protocolo, nada do que foi prometido vale.',
    input.disputesAmount ? 'Antes de pagar, conteste o que está errado e peça o histórico de consumo dos últimos 12 a 24 meses.' : 'Confira se as faturas em atraso batem com o seu consumo normal e peça o histórico dos últimos 12 meses.',
    `Peça primeiro o desconto dos encargos: o ideal é pagar perto de ${formatBrl(askCents)} (o valor original estimado) em vez de ${formatBrl(input.overdueCents)}.`,
    `Se não der à vista, proponha ${count} ${count === 1 ? 'parcela' : 'parcelas'} de ${formatBrl(installmentCents)}, sem juros ou com juros reduzidos, e peça o acordo por escrito.`,
    'Só pague depois de receber o acordo por escrito (e-mail, mensagem do aplicativo ou boleto com o valor combinado). Guarde o comprovante.',
  ];

  const phoneScript = [
    `"Boa tarde. Quero regularizar uma dívida de ${label.toLowerCase()} do meu endereço e preciso de uma proposta de acordo."`,
    '"Pode me passar o demonstrativo com principal, multa e juros de cada fatura? Anote, por favor, o número do protocolo."',
    `"Consigo pagar ${formatBrl(input.monthlyCapacityCents)} por mês. Pode tirar a multa e os juros e parcelar o principal?"`,
    '"Se não puder tirar tudo, qual o maior desconto que consegue? Prefiro receber a proposta por escrito."',
    '"Obrigado. Vou analisar e retorno com o protocolo na mão."',
  ];

  const objections = [
    { they: '"O sistema não permite tirar multa e juros."', you: '"Entendo. Há algum setor de acordos ou retenção que possa avaliar? Posso falar com ele? Preciso do protocolo."' },
    { they: '"Só consigo parcelar com os encargos."', you: '"Então me mande a simulação por escrito com a taxa de juros do parcelamento. Vou comparar com pagar à vista."' },
    { they: '"Ou paga hoje, ou corto o serviço."', you: '"Peço a notificação de corte por escrito e o prazo previsto na regra da agência. Enquanto isso quero formalizar a proposta."' },
    { they: '"Você precisa pagar a entrada total agora."', you: '"Posso dar uma entrada de uma parcela e o restante em parcelas. Qual a menor entrada que a empresa aceita?"' },
  ];

  const askInWriting = [
    'Demonstrativo de débito discriminado (principal, multa, juros, correção) de cada fatura em atraso',
    'Histórico de consumo dos últimos 12 a 24 meses',
    'Proposta de acordo com valor total, número de parcelas, vencimento e juros',
    'Confirmação por escrito do prazo para religação ou de que o serviço não será cortado enquanto o acordo estiver em dia',
    'Número do protocolo e nome do atendente',
  ];

  const letter = [
    'À Ouvidoria / Setor de Acordos da [NOME DA EMPRESA]',
    '',
    `Assunto: pedido de acordo e de demonstrativo de débito — ${label}`,
    '',
    'Eu, [SEU NOME], titular da unidade [ENDEREÇO / NÚMERO DA INSTALAÇÃO OU CONTRATO], solicito:',
    `1. o demonstrativo discriminado do débito de ${formatBrl(input.overdueCents)} (principal, multa, juros e correção, fatura a fatura);`,
    input.disputesAmount ? '2. a análise e a revisão das cobranças que contesto: [DESCREVA O QUE ESTÁ ERRADO E O MÊS];' : '2. o histórico de consumo dos últimos 12 meses;',
    `3. proposta de acordo com a retirada da multa e dos juros de atraso, ou o seu maior desconto possível, em ${count === 1 ? 'parcela única' : `até ${count} parcelas de ${formatBrl(installmentCents)}`};`,
    '4. a resposta por escrito, com número de protocolo, no prazo previsto na regulamentação.',
    '',
    'Estou à disposição para regularizar o débito dentro das minhas condições. Sem a resposta, levarei o caso à agência reguladora e ao Procon.',
    '',
    '[CIDADE], [DATA]',
    '[SEU NOME]  ·  [TELEFONE OU E-MAIL PARA RESPOSTA]',
  ].join('\n');

  const rights = [
    'Você tem direito a saber exatamente como o valor foi calculado: peça o demonstrativo.',
    'Cobrança de valor indevido pode dar direito à devolução; contestar por escrito protege você.',
    'Reclamações podem ser registradas gratuitamente no consumidor.gov.br e no Procon da sua cidade.',
    'Nada do que está aqui é parecer jurídico. Na dúvida, procure a Defensoria Pública.',
  ];

  const lowIncomeNote =
    input.kind === 'energia' && input.lowIncome !== 'nao'
      ? input.lowIncome === 'sim'
        ? 'Como você informou que a família é de baixa renda, pergunte à distribuidora se a unidade já está na Tarifa Social de Energia Elétrica e peça a inclusão. Ela dá desconto na conta todo mês.'
        : 'Pergunte à distribuidora e ao CRAS se a sua família tem direito à Tarifa Social de Energia Elétrica (famílias inscritas no CadÚnico com baixa renda ou que recebem BPC, entre outros critérios). Dá desconto na conta todo mês.'
      : input.kind === 'agua' && input.lowIncome !== 'nao'
        ? 'Várias companhias de água têm tarifa social para famílias de baixa renda. Pergunte se a sua cidade tem e quais documentos pedem.'
        : null;

  const cutNote =
    input.cutStatus === 'cortado'
      ? essential
        ? 'O serviço já foi cortado: peça a religação junto com a proposta. Muitas empresas religam com a entrada do acordo, mas a regra varia; peça o prazo de religação por escrito.'
        : 'O serviço já foi suspenso: negocie o acordo e peça a reativação com data por escrito.'
      : input.cutStatus === 'aviso'
        ? 'Você recebeu aviso de corte. Em serviço essencial, o corte exige aviso prévio por escrito e prazo mínimo definido pela agência. Guarde a notificação e negocie antes do prazo.'
        : null;

  const disputeNote = input.disputesAmount ? 'Se a cobrança está errada, conteste por escrito antes de pagar e peça a suspensão do corte enquanto o pedido é analisado. Pagar sem contestar pode dificultar a devolução depois.' : null;

  const warnings = [
    'Pague só pelos canais oficiais da empresa. Golpistas ligam oferecendo "desconto especial" e mandam boleto falso.',
    'Confira o beneficiário do boleto antes de pagar: tem que ser o CNPJ da empresa.',
    'Não passe senha, código de aplicativo nem dados de cartão por telefone.',
  ];

  return {
    kind: input.kind,
    label,
    essential,
    overdueCents: input.overdueCents,
    estimatedPrincipalCents: principal,
    estimatedPenaltyCents: penalty,
    cashAsk: { askCents, fallbackCents },
    installment: { count, installmentCents, totalCents: installmentCents * count },
    priority: essential ? 'alta' : 'media',
    priorityWhy,
    channel: CHANNEL[input.kind],
    steps,
    phoneScript,
    objections,
    askInWriting,
    letter,
    rights,
    lowIncomeNote,
    cutNote,
    disputeNote,
    warnings,
  };
}

export interface HouseBillPreview {
  label: string;
  essential: boolean;
  overdueCents: number;
  installment: Installment;
  possibleSavingCents: number;
  headline: string;
  hasCutNote: boolean;
  hasLowIncomeNote: boolean;
}

export function buildHouseBillPreview(p: HouseBillPlan): HouseBillPreview {
  const saving = p.overdueCents - p.cashAsk.askCents; // o máximo que a retirada total dos encargos economizaria
  return {
    label: p.label,
    essential: p.essential,
    overdueCents: p.overdueCents,
    installment: p.installment,
    possibleSavingCents: Math.max(0, saving),
    headline: `Dá para tentar um acordo em ${p.installment.count === 1 ? 'parcela única' : `${p.installment.count} parcelas de ${formatBrl(p.installment.installmentCents)}`}, pedindo a retirada de multa e juros (no melhor caso, cerca de ${formatBrl(Math.max(0, saving))} de diferença).`,
    hasCutNote: p.cutNote !== null,
    hasLowIncomeNote: p.lowIncomeNote !== null,
  };
}
