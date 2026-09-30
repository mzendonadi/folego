import type { CaseFacts, DebtFacts } from './facts.ts';
import { KIND_LABEL, brl } from './facts.ts';
import type { DebtScript, Letter, LettersContent, ScriptsCore, ScriptsContent } from './schema.ts';

const ESSENTIAL = new Set(['rent', 'utility', 'financing']);

function tempoAtraso(days: number): string {
  if (days < 30) return 'menos de 1 mês';
  if (days < 365) return `cerca de ${Math.max(1, Math.round(days / 30))} ${Math.round(days / 30) === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(days / 365);
  return `mais de ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

const TIPS = [
  'Só feche acordo que caiba no seu orçamento. Uma parcela que você não consegue pagar vira uma dívida nova.',
  'Peça sempre o acordo por escrito (e-mail ou aplicativo) e anote nome do atendente e número de protocolo.',
  'Desconfie de quem cobra adiantado para "resolver seu nome" ou "cancelar dívida". Negocie direto com o credor ou pelos canais oficiais dele.',
  'Não passe senha, código de segurança ou dados do cartão por telefone ou mensagem que você não iniciou.',
  'Depois de pagar, guarde o comprovante e peça a confirmação por escrito de que a dívida foi baixada.',
];

/** Modelo determinístico de roteiro. Também é o plano B quando a IA falha ou reprova no verificador. */
export function templateDebtScript(f: DebtFacts, capacityCents: number): DebtScript {
  const label = KIND_LABEL[f.kind] ?? 'dívida';
  const cap = capacityCents > 0 ? brl(capacityCents) : null;

  if (ESSENTIAL.has(f.kind) && f.overdue) {
    return {
      id: f.id,
      resumo: `Conta essencial em atraso (${label}) de ${brl(f.balanceCents)} há ${tempoAtraso(f.daysOverdue)}. Prioridade: proteger a moradia ou o serviço e combinar um jeito de pôr o atraso em dia.`,
      antes_de_ligar: [
        'Veja quanto você consegue separar por mês só para este acordo, sem deixar de pagar o mês corrente.',
        'Tenha em mãos os comprovantes dos últimos pagamentos. Anote nome e protocolo de cada contato.',
      ],
      abertura: 'Olá, tudo bem? Quero regularizar o atraso com a {{credor}} e manter tudo em dia daqui para frente. Podemos combinar um parcelamento do valor atrasado?',
      argumentos: [
        'Quero continuar pagando o mês corrente em dia e dividir só o atraso.',
        'Prefiro um acordo que eu consiga cumprir do que prometer algo que não consigo pagar.',
        'Pergunte se há multa ou juros que possam ser reduzidos no parcelamento.',
      ],
      proposta: cap
        ? `Peça para parcelar o atraso em parcelas de até ${cap} por mês (esse é o limite para todos os seus acordos somados), mantendo o vencimento atual em dia. Peça o novo valor total e as datas por escrito antes de aceitar.`
        : 'Peça para parcelar o atraso na menor parcela possível, mantendo o vencimento atual em dia. Hoje o orçamento está sem folga, então diga com sinceridade o que consegue pagar. Peça o novo valor total e as datas por escrito.',
      mensagem_whatsapp: 'Olá! Quero regularizar o atraso com a {{credor}} e manter os pagamentos em dia. Pode me enviar o valor atualizado e as opções de parcelamento por escrito? Obrigado(a).',
      evitar: [
        'Não deixe para negociar depois que o serviço for cortado ou o contrato rescindido: é mais difícil.',
        'Não aceite parcela que você já sabe que não vai conseguir pagar.',
      ],
      se_recusarem: 'Peça para falar com um supervisor ou com o setor de negociação, e pergunte qual é o prazo para uma nova proposta. Registre o protocolo e tente outro canal.',
    };
  }

  if (f.overdue && f.offer) {
    const o = f.offer;
    return {
      id: f.id,
      resumo: `${label[0]?.toUpperCase()}${label.slice(1)} em atraso de ${brl(f.balanceCents)} há ${tempoAtraso(f.daysOverdue)}. Meta: quitar com desconto ou parcelar dentro do seu orçamento.`,
      antes_de_ligar: [
        cap ? `Defina o teto mensal: no máximo ${cap} por mês para todos os acordos juntos.` : 'Defina quanto você consegue pagar sem faltar comida e contas.',
        'Peça o saldo atualizado e o valor original da dívida antes de falar em números.',
        'Anote nome do atendente e protocolo de cada contato.',
      ],
      abertura: 'Olá, tudo bem? Quero regularizar minha dívida com a {{credor}}. Antes de qualquer coisa, pode me passar o saldo atualizado e os descontos disponíveis para pagamento à vista?',
      argumentos: [
        'Estou em atraso e quero resolver, mas preciso de uma condição que caiba no meu orçamento.',
        'Peça o desconto sobre o valor total, e não só sobre os juros e a multa.',
        'Pergunte se existe alguma campanha de renegociação ativa neste mês.',
      ],
      proposta: `Comece oferecendo ${brl(o.openingCents)} à vista (${o.openingPct}% de desconto). Se não aceitarem, suba aos poucos até cerca de ${brl(o.targetCents)} (${o.targetPct}% de desconto). Não passe de ${brl(o.limitCents)} (${o.limitPct}% de desconto), a não ser que realmente caiba no seu orçamento.${cap ? ` Se for parcelar, peça parcelas de até ${cap} por mês.` : ''}`,
      mensagem_whatsapp: 'Olá! Quero regularizar minha dívida com a {{credor}}. Pode me enviar o saldo atualizado, as opções de desconto para pagamento à vista e a proposta por escrito? Obrigado(a).',
      evitar: [
        'Não aceite a primeira oferta do atendente.',
        'Não pague nada antes de receber o acordo por escrito, com valor, vencimento e a informação de que a dívida será baixada.',
        'Não passe dados de cartão ou senha por telefone ou mensagem.',
      ],
      se_recusarem: 'Peça para falar com o setor de negociação ou volte a ligar em alguns dias: as condições mudam. Registre o protocolo e tente outro canal (aplicativo, e-mail ou atendimento presencial).',
    };
  }

  // Em dia: o objetivo é reduzir o custo (juros), não pedir desconto sobre atraso.
  const parcelaAtual = f.monthlyPaymentCents ? `Compare com a parcela atual de ${brl(f.monthlyPaymentCents)} antes de aceitar. ` : '';
  return {
    id: f.id,
    resumo: `${label[0]?.toUpperCase()}${label.slice(1)} em dia, com saldo de ${brl(f.balanceCents)} e juros altos. Meta: reduzir o custo trocando por uma condição de juros menores, sem atrasar.`,
    antes_de_ligar: [
      'Tenha em mãos o valor da parcela atual e quanto falta pagar.',
      'Peça ao credor o custo efetivo total (CET) da proposta nova para comparar com o que você paga hoje.',
    ],
    abertura: 'Olá, tudo bem? Estou com a {{credor}} em dia, mas os juros estão pesando no meu orçamento. Quero saber quais opções vocês têm para reduzir a taxa ou parcelar em condições melhores.',
    argumentos: [
      'Estou em dia e pretendo continuar em dia: quero uma condição que me ajude a manter isso.',
      'Pergunte se há programa de renegociação, portabilidade ou troca por parcelamento com taxa menor.',
      'Compare o custo total, e não só o valor da parcela.',
    ],
    proposta: `${parcelaAtual}Só aceite trocar se o custo total cair: parcela menor com prazo muito maior pode sair mais cara no final. Peça a proposta por escrito e compare com calma antes de responder.`,
    mensagem_whatsapp: 'Olá! Estou com a {{credor}} em dia e quero reduzir os juros. Pode me enviar as opções de renegociação ou parcelamento com o custo efetivo total por escrito? Obrigado(a).',
    evitar: [
      'Não decida na primeira ligação: peça a proposta por escrito.',
      'Não aceite seguros ou pacotes adicionais embutidos na renegociação.',
    ],
    se_recusarem: 'Pergunte se há outra modalidade mais barata e volte a comparar em alguns dias. Vale também pesquisar se outra instituição oferece taxa menor para trocar essa dívida.',
  };
}

export function templateScripts(facts: CaseFacts): ScriptsCore {
  const included = facts.debts.filter((d) => d.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  return {
    dividas: included.map((d) => templateDebtScript(d, facts.capacityCents)),
    dicas_gerais: TIPS,
  };
}

/** Troca {{credor}} pelo nome real e monta o conteúdo final com os números estruturados calculados por código. */
export function assembleScripts(core: ScriptsCore, facts: CaseFacts, names: Map<string, string>, source: 'ai' | 'template'): ScriptsContent {
  const byId = new Map(facts.debts.map((d) => [d.id, d]));
  const sub = (t: string, id: string) => t.replaceAll('{{credor}}', names.get(id) ?? 'o credor');
  const subAll = (s: DebtScript): DebtScript => ({
    ...s,
    resumo: sub(s.resumo, s.id),
    antes_de_ligar: s.antes_de_ligar.map((t) => sub(t, s.id)),
    abertura: sub(s.abertura, s.id),
    argumentos: s.argumentos.map((t) => sub(t, s.id)),
    proposta: sub(s.proposta, s.id),
    mensagem_whatsapp: sub(s.mensagem_whatsapp, s.id),
    evitar: s.evitar.map((t) => sub(t, s.id)),
    se_recusarem: sub(s.se_recusarem, s.id),
  });
  return {
    version: 1,
    source,
    general: core.dicas_gerais,
    capacityCents: facts.capacityCents,
    debts: core.dividas.map((s) => {
      const f = byId.get(s.id);
      return { ...subAll(s), creditorName: names.get(s.id) ?? 'Credor', kind: f?.kind ?? 'other', tier: f?.tier ?? 'by_interest', oferta: f?.offer ?? null };
    }),
    held: facts.heldAsideIds.map((id) => ({
      id,
      creditorName: names.get(id) ?? 'Credor',
      aviso: 'Esta dívida pode estar prescrita. Não pague nem negocie antes de conferir com um advogado ou a Defensoria Pública: reconhecer, negociar ou pagar uma parte pode reiniciar o prazo. O Kit de Cartas tem um modelo de notificação para este caso.',
    })),
  };
}

// ---------------------------------------------------------------------------
// Cartas (SEM IA: textos jurídicos ficam em modelos fixos, para revisão por advogado antes do lançamento)
// ---------------------------------------------------------------------------
const PLACEHOLDERS = 'Preencha os campos entre colchetes antes de enviar. O Fôlego não guarda seu nome, CPF nem endereço.';
const SEND_TIPS = [
  'Envie por e-mail ou pelo canal de protocolo do credor e guarde o comprovante de envio.',
  'Se o credor tiver Ouvidoria, envie uma cópia. Se não responderem, registre reclamação no Procon e no consumidor.gov.br.',
];

function header(dest: string): string {
  return `[CIDADE], [DATA]\n\nÀ ${dest}\nSetor de Atendimento / Ouvidoria\n`;
}

function signature(): string {
  return '\nAtenciosamente,\n\n[SEU NOME COMPLETO]\nCPF: [SEU CPF]\nE-mail e telefone para contato: [SEU E-MAIL] / [SEU TELEFONE]';
}

export function templateLetters(facts: CaseFacts, names: Map<string, string>, firstDefaultYear: Map<string, string | undefined>): LettersContent {
  const letters: Letter[] = [];
  const disclaimer = 'Modelo informativo. Antes de enviar, confirme com um advogado ou com a Defensoria Pública se ele se aplica ao seu caso.';

  for (const f of facts.debts) {
    const name = names.get(f.id) ?? 'o credor';
    const dest = name;

    if (f.prescription === 'possible') {
      letters.push({
        id: `${f.id}-prescricao`,
        tipo: 'prescricao',
        titulo: `Notificação sobre prazo de cobrança e negativação: ${name}`,
        destinatario: dest,
        assunto: 'Notificação: decurso do prazo de cobrança e pedido de baixa de restrição',
        corpo:
          header(dest) +
          `\nAssunto: Notificação — decurso do prazo de cobrança e pedido de baixa de restrição\n\n` +
          `Prezados,\n\nEscrevo a respeito de cobrança em meu nome atribuída à ${name}${firstDefaultYear.get(f.id) ? `, com inadimplemento apontado desde ${firstDefaultYear.get(f.id)}` : ''}, referente ao contrato/produto [NÚMERO DO CONTRATO OU PROTOCOLO, SE TIVER].\n\n` +
          `Considerando o tempo decorrido desde o vencimento apontado, entendo que já transcorreu o prazo de cinco anos para a cobrança de dívida líquida (art. 206, § 5º, I, do Código Civil) e o período máximo de manutenção de informações negativas em cadastros de proteção ao crédito (art. 43, § 1º, do Código de Defesa do Consumidor). Nos termos do art. 43, § 5º, do mesmo Código, consumada a prescrição, não podem ser fornecidas informações que dificultem novo acesso ao crédito.\n\n` +
          `Diante disso, solicito, no prazo de 10 (dez) dias: (1) a confirmação da data do vencimento da parcela mais antiga em aberto; (2) a exclusão de qualquer restrição em meu nome relativa a esse débito; e (3) o encerramento de cobranças, ligações e mensagens sobre ele.\n\n` +
          `Esta correspondência não constitui reconhecimento de dívida, confissão, promessa de pagamento ou proposta de acordo, e não interrompe nem renova qualquer prazo.\n` +
          signature(),
        anexos: ['Print ou extrato da restrição (se houver)', 'Documento com foto (cópia)'],
        como_enviar: SEND_TIPS,
        avisos: [disclaimer, PLACEHOLDERS, 'Não ligue nem responda propostas de acordo antes de conferir a prescrição: negociar ou pagar uma parte pode reiniciar o prazo.'],
      });
    }

    if (f.overdue || f.prescription === 'approaching' || f.prescription === 'possible') {
      letters.push({
        id: `${f.id}-informacoes`,
        tipo: 'informacoes',
        titulo: `Pedido de informações e memória de cálculo: ${name}`,
        destinatario: dest,
        assunto: 'Pedido de informações sobre a dívida e demonstrativo de cálculo',
        corpo:
          header(dest) +
          `\nAssunto: Pedido de informações sobre a dívida e demonstrativo de cálculo\n\n` +
          `Prezados,\n\nComo consumidor, e com base no direito à informação adequada e clara (art. 6º, III, do Código de Defesa do Consumidor) e no direito de acesso aos meus dados (art. 18, II, da Lei Geral de Proteção de Dados), solicito, por escrito e no prazo de 10 (dez) dias:\n\n` +
          `1. Cópia do contrato ou da proposta que originou o débito atribuído a mim (produto/contrato: [NÚMERO DO CONTRATO OU PROTOCOLO, SE TIVER]);\n2. A data do vencimento da parcela mais antiga em aberto e a data em que a restrição foi registrada, se houver;\n3. O demonstrativo detalhado do saldo: valor original, juros, multa, encargos, correções e pagamentos já realizados;\n4. A informação sobre se o crédito foi cedido a outra empresa e, em caso positivo, os dados do novo credor.\n\n` +
          `Esta solicitação serve apenas para eu entender o débito e não constitui reconhecimento de dívida nem proposta de acordo.\n` +
          signature(),
        anexos: ['Documento com foto (cópia)'],
        como_enviar: SEND_TIPS,
        avisos: [disclaimer, PLACEHOLDERS],
      });
    }

    const contestavel = ['credit_card', 'overdraft', 'personal_loan', 'store_credit'].includes(f.kind);
    if (contestavel && f.overdue) {
      letters.push({
        id: `${f.id}-contestacao`,
        tipo: 'contestacao',
        titulo: `Contestação de juros e encargos: ${name}`,
        destinatario: dest,
        assunto: 'Contestação de juros e encargos e pedido de recálculo',
        corpo:
          header(dest) +
          `\nAssunto: Contestação de juros e encargos e pedido de recálculo\n\n` +
          `Prezados,\n\nContesto os valores cobrados a título de juros, multa e encargos sobre o débito atribuído a mim (contrato/protocolo: [NÚMERO DO CONTRATO OU PROTOCOLO, SE TIVER]), por entender que podem estar em desacordo com o pactuado e com a proteção contra cláusulas e cobranças excessivas prevista no Código de Defesa do Consumidor (art. 6º, V, e art. 51, IV).\n\n` +
          `Solicito, no prazo de 10 (dez) dias: (1) o recálculo do saldo com a taxa contratada e a memória de cálculo completa; (2) a suspensão de novos encargos enquanto a contestação é analisada; e (3) uma proposta de regularização com o valor corrigido.\n\n` +
          `Reservo-me o direito de buscar os órgãos de defesa do consumidor. Esta correspondência não constitui reconhecimento de dívida.\n` +
          signature(),
        anexos: ['Contrato ou fatura (se tiver)', 'Documento com foto (cópia)'],
        como_enviar: SEND_TIPS,
        avisos: [disclaimer, PLACEHOLDERS],
      });
    }
  }

  return {
    version: 1,
    source: 'template',
    letters,
    general: [
      'Tire cópia de tudo o que enviar e guarde os protocolos.',
      'Prazos e direitos variam conforme o caso. Na dúvida, procure a Defensoria Pública da sua cidade (atendimento gratuito) ou um advogado.',
    ],
  };
}
