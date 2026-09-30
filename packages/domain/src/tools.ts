// Ferramentas gratuitas (ganchos): rodam no navegador, sem enviar nada ao servidor.
import type { DebtKind, PrescriptionAssessment } from './types.ts';
import { RULES } from './config.ts';
import { assessPrescription } from './prescription.ts';

/** Calculadora de prescrição: indicativa, nunca conclusiva. */
export function prescriptionCheck(args: { kind: DebtKind; firstDefaultOn: string; asOf: string }): PrescriptionAssessment {
  return assessPrescription(
    { id: 'x', creditorName: 'x', kind: args.kind, balanceCents: 1, daysOverdue: 1, firstDefaultOn: args.firstDefaultOn, rateBps: 0, rateSource: 'default', minPaymentCents: 0 },
    args.asOf,
    RULES,
  );
}

export interface ScamQuestion {
  id: string;
  text: string;
  weight: number; // 1 = sinal fraco, 3 = sinal forte
}

export const SCAM_QUESTIONS: ScamQuestion[] = [
  { id: 'advance_fee', text: 'Pediram pagamento adiantado, taxa ou “custo” para limpar meu nome, liberar crédito ou zerar a dívida.', weight: 3 },
  { id: 'guarantee', text: 'Prometeram limpar o nome ou aumentar o score com prazo e garantia (“em 48 horas”, “100% garantido”).', weight: 3 },
  { id: 'secret_codes', text: 'Pediram senha, código recebido por SMS, acesso remoto ao celular ou dados do meu cartão.', weight: 3 },
  { id: 'third_party_pix', text: 'O Pix ou a conta de pagamento está no nome de uma pessoa física ou de uma empresa diferente da que me cobra.', weight: 3 },
  { id: 'pressure', text: 'Fui pressionado com ameaça ou pressa (“último aviso”, “prisão”, “só hoje”).', weight: 2 },
  { id: 'unknown_channel', text: 'O contato veio por WhatsApp, SMS ou e-mail de número ou endereço que eu não conheço, com link encurtado.', weight: 2 },
  { id: 'unknown_debt', text: 'Não reconheço a dívida ou não consigo informar de onde ela veio (contrato, produto ou data).', weight: 2 },
  { id: 'no_docs', text: 'Não quiseram mandar contrato, demonstrativo ou o nome completo da empresa e o CNPJ.', weight: 2 },
];

export type ScamLevel = 'high' | 'attention' | 'low';

export interface ScamVerdict {
  level: ScamLevel;
  score: number;
  title: string;
  text: string;
  steps: string[];
}

export function scamCheck(answers: Record<string, boolean>): ScamVerdict {
  const score = SCAM_QUESTIONS.reduce((s, q) => s + (answers[q.id] ? q.weight : 0), 0);
  const strong = SCAM_QUESTIONS.some((q) => answers[q.id] && q.weight === 3);
  const common = [
    'Consulte a empresa pelos canais que você já conhece (site e telefone do contrato, fatura ou aplicativo), nunca pelo link recebido.',
    'Peça tudo por escrito: nome da empresa, CNPJ, contrato e demonstrativo da dívida.',
    'Guarde prints e protocolos. Se for golpe, registre boletim de ocorrência e avise o banco.',
  ];
  if (strong || score >= 6) {
    return {
      level: 'high',
      score,
      title: 'Grande chance de ser golpe',
      text: 'Empresa séria não cobra adiantado para “limpar o nome”, não garante resultado e nunca pede senha ou código.',
      steps: ['Não pague, não clique em links e não passe códigos ou senhas.', ...common, 'Se já pagou ou passou dados, ligue agora para o seu banco e peça bloqueio e contestação.'],
    };
  }
  if (score >= 3) {
    return { level: 'attention', score, title: 'Tem sinais de alerta', text: 'Ainda dá para ser uma cobrança legítima, mas confirme antes de pagar qualquer coisa.', steps: common };
  }
  return { level: 'low', score, title: 'Poucos sinais de golpe', text: 'Isso não garante que a cobrança seja legítima nem correta. Confira sempre antes de pagar.', steps: common };
}

export interface RightsTopic {
  id: string;
  title: string;
  points: string[];
}

/** Guia de direitos do consumidor endividado: informativo, com referência à norma para conferir. Revisar com advogado antes do lançamento. */
export const RIGHTS: RightsTopic[] = [
  {
    id: 'cobranca',
    title: 'Como pode ser a cobrança',
    points: [
      'A cobrança não pode expor você a ridículo, nem ameaçar, nem interferir no seu trabalho ou descanso (Código de Defesa do Consumidor, art. 42).',
      'Se você pagou cobrança indevida, pode ter direito à devolução em dobro (CDC, art. 42, parágrafo único), conforme o caso.',
      'Você pode pedir por escrito o contrato e o demonstrativo do saldo, com juros e encargos.',
    ],
  },
  {
    id: 'negativacao',
    title: 'Nome negativado',
    points: [
      'Você deve ser avisado por escrito antes da inclusão do seu nome em cadastro de inadimplentes (CDC, art. 43, § 2º).',
      'A negativação não pode durar mais de 5 anos (CDC, art. 43, § 1º).',
      'Depois de paga, a empresa deve retirar a restrição em poucos dias. Guarde o comprovante.',
    ],
  },
  {
    id: 'prescricao',
    title: 'Dívida antiga',
    points: [
      'Existe prazo para cobrar dívida na Justiça, e muitas dívidas de consumo têm prazo de 5 anos. Ele pode variar conforme o tipo.',
      'Reconhecer a dívida, pagar parte ou negociar pode reiniciar o prazo: confira antes de conversar com o credor.',
      'O prazo não “limpa” o nome sozinho nem apaga a dívida automaticamente: confirme sua situação com a Defensoria Pública ou um advogado.',
    ],
  },
  {
    id: 'superendividamento',
    title: 'Superendividamento',
    points: [
      'A Lei 14.181/2021 permite pedir uma audiência de conciliação com todos os credores, para montar um plano de pagamento, quando o total de dívidas compromete o mínimo para viver.',
      'O pedido é gratuito e pode ser feito no Procon, na Defensoria Pública ou no Tribunal de Justiça do seu estado.',
    ],
  },
  {
    id: 'onde-pedir',
    title: 'Onde buscar ajuda gratuita',
    points: [
      'Procon da sua cidade ou do seu estado.',
      'Defensoria Pública (atendimento gratuito para quem não pode pagar advogado).',
      'consumidor.gov.br: reclamação online que as empresas respondem em poucos dias.',
      'Registrato, do Banco Central, para consultar suas dívidas e relacionamentos com bancos.',
    ],
  },
];
