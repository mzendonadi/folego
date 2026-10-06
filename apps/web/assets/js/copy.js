// Textos do produto (tom: 80% amiga esperta, 20% consultoria). O motor devolve CÓDIGOS; as palavras ficam aqui.
import { brlWhole, formatMonths, plural } from './format.js';

export const EMPLOYMENT = [
  { value: 'clt', label: 'CLT (carteira assinada)', hint: 'Empresa privada' },
  { value: 'inss_retiree', label: 'Aposentadoria ou pensão', hint: 'Benefício do INSS' },
  { value: 'public_servant', label: 'Serviço público', hint: 'Concursado ou estatutário' },
  { value: 'self_employed', label: 'Autônomo ou MEI', hint: 'Conta própria' },
  { value: 'other', label: 'Outra situação', hint: 'Bicos, sem renda fixa…' },
];

export const CLT_CONTRACTS = [
  { value: 'permanent', label: 'Prazo indeterminado', hint: 'Contrato sem data para acabar', short: 'prazo indeterminado' },
  { value: 'temporary', label: 'Contratação temporária', hint: 'Contrato com data para terminar', short: 'contrato temporário' },
];

export const AGE_BANDS = [
  ['18-24', '18 a 24 anos'], ['25-34', '25 a 34 anos'], ['35-44', '35 a 44 anos'], ['45-54', '45 a 54 anos'],
  ['55-64', '55 a 64 anos'], ['65-74', '65 a 74 anos'], ['75+', '75 anos ou mais'],
];

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export const DEBT_KINDS = [
  ['credit_card', 'Cartão de crédito'],
  ['overdraft', 'Cheque especial'],
  ['personal_loan', 'Empréstimo pessoal'],
  ['payroll_loan', 'Empréstimo consignado'],
  ['financing', 'Financiamento (carro, moto, casa)'],
  ['store_credit', 'Crediário ou compra parcelada em loja'],
  ['utility', 'Conta de casa (luz, água, internet, telefone)'],
  ['rent', 'Aluguel ou condomínio'],
  ['other', 'Outra'],
];
export const KIND_LABEL = Object.fromEntries(DEBT_KINDS);
/** Rótulo do tipo de dívida; em "Outra", usa o que a pessoa escreveu. */
export const kindText = (debt) => (debt.kind === 'other' && debt.kindNote ? debt.kindNote : (KIND_LABEL[debt.kind] ?? debt.kind));

// Faixa de atraso → dias aproximados (o motor trabalha com dias).
export const OVERDUE_BANDS = [
  ['15', 'Menos de 1 mês'],
  ['60', 'De 1 a 3 meses'],
  ['210', 'De 3 meses a 1 ano'],
  ['730', 'De 1 a 3 anos'],
  ['1460', 'De 3 a 5 anos'],
  ['2200', 'Mais de 5 anos'],
];

export const BAND = {
  under_control: { label: 'Sob controle', tone: 'ok', text: 'Você está no controle. Dá pra ajustar o que falta com tranquilidade.' },
  attention: { label: 'Atenção', tone: 'attention', text: 'Dá pra respirar, mas tem pontos que merecem cuidado agora.' },
  tight: { label: 'Apertado', tone: 'tight', text: 'Está pesado, mas tem caminho. A gente vai por partes.' },
  critical: { label: 'Urgente', tone: 'critical', text: 'Isso pede atenção já, e tem saída. Vamos por partes, sem pressa de culpa.' },
};

export function headlineCopy(preview) {
  const h = preview.headline;
  if (h.kind === 'interest_saved') {
    return {
      title: `Seguindo o Mapa, você deixa de pagar cerca de ${brlWhole(h.cents)} em juros.`,
      note: 'Estimativa comparando com pagar só as parcelas de hoje.',
    };
  }
  if (h.kind === 'too_long') {
    return {
      title: 'Do jeito que está, essas dívidas não acabam em um prazo razoável.',
      note: 'Pagar só a parcela de hoje não resolve. O Mapa mostra o que renegociar e por onde começar.',
    };
  }
  if (h.kind === 'debt_free_in') {
    return {
      title: `Dá pra quitar tudo em ${formatMonths(h.months)} seguindo o Mapa.`,
      note: 'Estimativa com o que sobra hoje, mantendo uma reserva.',
    };
  }
  if (h.kind === 'monthly_gap') {
    return {
      title: `Hoje faltam cerca de ${brlWhole(h.cents)} por mês pra fechar as contas.`,
      note: 'O Mapa mostra onde ajustar primeiro pra parar de piorar.',
    };
  }
  if (preview.prescriptionTeaser.possibleCount > 0) {
    return {
      title: 'Antes de pagar qualquer coisa, vale conferir uma coisa importante.',
      note: 'Suas dívidas podem estar prescritas. Veja o aviso abaixo.',
    };
  }
  return { title: 'Vamos olhar com calma o que dá pra fazer.', note: 'O Mapa organiza o próximo passo.' };
}

export function firstPriorityReason(tier) {
  if (tier === 'essential_overdue') return 'Conta essencial em atraso: perder o serviço ou a moradia pesa mais que os juros.';
  return 'É a dívida que mais cresce com os juros. Atacar ela primeiro economiza mais.';
}

export function prescriptionTeaser(count) {
  return count === 1
    ? '1 dívida pode estar prescrita. Não pague antes de conferir: no Mapa a gente explica como.'
    : `${count} dívidas podem estar prescritas. Não pague antes de conferir: no Mapa a gente explica como.`;
}

export function confidenceNote(confidence) {
  if (confidence === 'high') return null;
  return 'Em algumas dívidas usamos taxas médias de mercado, porque você não informou a taxa. Se souber a real, o resultado fica mais preciso.';
}

// Seções do Mapa completo (ids vêm do motor). A simulação de troca de crédito é um fluxo opt-in separado, não aparece aqui.
export const LOCKED_LABELS = {
  full_priority_order: ['Ordem completa de pagamento', 'Qual dívida atacar primeiro, segundo, terceiro… e por quê'],
  monthly_budget: ['Seu orçamento do mês', 'Quanto sobra, quanto vai pra dívida e quanto fica de reserva'],
  per_debt_payoff_timeline: ['Quando cada dívida acaba', 'A linha do tempo até você quitar tudo'],
  negotiation_scripts: ['Roteiros de negociação', 'O que dizer (e evitar) em cada conversa com o credor'],
  prescription_details: ['Detalhes sobre prescrição', 'O que conferir antes de pagar uma dívida antiga'],
};

export function tierReason(tier) {
  if (tier === 'essential_overdue') return 'Conta essencial em atraso: proteja primeiro.';
  if (tier === 'verify_prescription') return 'Confira a prescrição antes de pagar.';
  return 'Juros mais altos primeiro.';
}

export const countLabel = (n, one, many) => `${n} ${plural(n, one, many)}`;
