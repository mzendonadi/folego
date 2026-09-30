// Tradutor de cobrança (produto collection_translator): lê o texto de uma cobrança e explica em português simples.
// 100% determinístico (sem IA): procura sinais no texto, nunca inventa valores nem afirma que uma cobrança é legítima.
// O texto colado NÃO é guardado: o servidor guarda só o resultado da análise.

export type CollectionKind =
  | 'cobranca_credor'
  | 'cobranca_terceirizada'
  | 'oferta_limpa_nome'
  | 'aviso_negativacao'
  | 'ameaca_judicial'
  | 'suspeita_golpe'
  | 'desconhecido';

export type TranslatorRisk = 'high' | 'attention' | 'low';

export interface TranslatorFlag {
  id: string;
  title: string;
  why: string;
}

export interface TranslatorAnalysis {
  kind: CollectionKind;
  risk: TranslatorRisk;
  title: string;
  meaning: string;
  flags: TranslatorFlag[];
  facts: { amountsCents: number[]; dates: string[]; deadlines: string[]; hasLink: boolean; asksPix: boolean; mentionsInterest: boolean };
  doNow: string[];
  dontDo: string[];
  reply: string;
  rights: string[];
}

/** Único formato que sai antes do pagamento. */
export interface TranslatorPreview {
  kind: CollectionKind;
  title: string;
  risk: TranslatorRisk;
  flagCount: number;
  amountsFound: number;
  teaser: string;
  lockedSections: string[];
}

export const MAX_TRANSLATOR_CHARS = 4000;

const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

interface Rule {
  id: string;
  test: RegExp;
  title: string;
  why: string;
  weight: number;
}

const FLAG_RULES: Rule[] = [
  { id: 'advance_fee', test: /(taxa|custo|tarifa)[^.]{0,40}(para|pra)[^.]{0,30}(liberar|limpar|remover|excluir|baixar)|pague[^.]{0,30}(antes|adiantado)|deposito (previo|antecipado)/, title: 'Pede pagamento adiantado', why: 'Empresa séria não cobra taxa antes para “limpar o nome” ou liberar acordo. É o golpe mais comum do nicho.', weight: 3 },
  { id: 'guarantee', test: /(garant(ia|imos|ido)|100%)[^.]{0,40}(nome limpo|limpar|score|aprova)|limpar? (seu )?nome (em|ate) \d+|aumente seu score/, title: 'Promete resultado garantido', why: 'Ninguém pode garantir limpar o nome ou subir o score em prazo curto. A negativação sai quando a dívida é paga ou some por prazo legal.', weight: 3 },
  { id: 'secret_codes', test: /(senha|codigo (de )?(verificacao|sms|seguranca)|token|acesso remoto|anydesk|teamviewer)/, title: 'Pede senha, código ou acesso remoto', why: 'Nenhum credor pede senha, código de SMS ou acesso ao seu celular para negociar uma dívida.', weight: 3 },
  { id: 'third_party_pix', test: /(pix|transferencia|deposito)[^.]{0,50}(pessoa fisica|conta de terceiro|cpf)|chave pix[^.]{0,30}(cpf|celular|email|aleatoria)/, title: 'Pix para chave pessoal ou de terceiros', why: 'Pagamento de dívida deve ir para o CNPJ do credor ou da assessoria autorizada, nunca para o CPF de uma pessoa.', weight: 3 },
  { id: 'pressure', test: /(ultimo aviso|ultima chance|somente hoje|so hoje|ate hoje|nas proximas \d+ ?h|em (ate )?\d+ ?horas|imediatamente|urgente)/, title: 'Pressa e ameaça de prazo curto', why: 'Pressão para pagar “agora” serve para você não conferir. Uma cobrança verdadeira continua válida depois de você conferir os dados.', weight: 2 },
  { id: 'threat_arrest', test: /(prisao|preso|mandado de prisao|penhora imediata|bloqueio (da|de) conta|oficial de justica (na|em) sua)/, title: 'Ameaça de prisão ou bloqueio', why: 'Dívida comum não gera prisão. Bloqueio e penhora só existem depois de um processo judicial, com aviso oficial.', weight: 3 },
  { id: 'short_link', test: /(bit\.ly|tinyurl|cutt\.ly|t\.co\/|wa\.me|goo\.gl|is\.gd|rebrand\.ly)/, title: 'Link encurtado', why: 'Links encurtados escondem o destino real. Acesse o site do credor digitando o endereço, não pelo link.', weight: 2 },
  { id: 'no_creditor', test: /^(?![\s\S]*(\bltda\b|\bs\/?a\b|cnpj|banco|financeira|cartao|fatura|contrato))/, title: 'Não diz quem é o credor', why: 'Sem nome da empresa, CNPJ ou contrato, não dá para saber de onde vem a dívida. Você pode exigir esses dados.', weight: 2 },
  { id: 'unknown_channel', test: /(whatsapp|zap|sms|telegram)/, title: 'Contato por mensagem', why: 'Cobrança por mensagem é comum, mas confirme sempre o remetente pelos canais oficiais que você já conhece.', weight: 1 },
];

const KIND_RULES: { kind: CollectionKind; test: RegExp; weight: number }[] = [
  { kind: 'oferta_limpa_nome', test: /(limpa nome|limpar (o |seu )?nome|feirao|desconto de ate \d+|quite (sua )?divida com|nome sujo|score)/, weight: 3 },
  { kind: 'aviso_negativacao', test: /(negativ(acao|ado|ar)|spc|serasa|scpc|cadastro de inadimplentes|protesto|cartorio)/, weight: 3 },
  { kind: 'ameaca_judicial', test: /(acao judicial|processo|execucao|citacao|vara|tribunal|advogado|oficial de justica|medidas judiciais)/, weight: 3 },
  { kind: 'cobranca_terceirizada', test: /(assessoria|recuperacao de credito|cessao de credito|cedido|adquiriu (o )?credito|em nome do credor|representando)/, weight: 3 },
  { kind: 'cobranca_credor', test: /(fatura|parcela|contrato|em atraso|vencimento|vencida|boleto|saldo devedor|cartao)/, weight: 2 },
];

const MEANING: Record<CollectionKind, { title: string; meaning: string }> = {
  cobranca_credor: {
    title: 'Cobrança direta do credor',
    meaning: 'Parece uma cobrança comum de uma empresa à qual você deve (fatura, parcela ou contrato em atraso). O texto tenta fazer você pagar ou procurar a empresa para negociar.',
  },
  cobranca_terceirizada: {
    title: 'Cobrança de assessoria ou de empresa que comprou a dívida',
    meaning: 'A dívida pode ter sido repassada a uma assessoria de cobrança ou vendida a outra empresa. Isso é permitido, mas você tem direito de saber quem é o credor atual e de onde vem o valor.',
  },
  oferta_limpa_nome: {
    title: 'Oferta de “limpar o nome”',
    meaning: 'Isto é uma oferta comercial de negociação, não uma cobrança formal. Pode ser legítima (feirões oficiais existem), mas é o formato mais usado por golpistas. Confirme tudo pelos canais oficiais antes de pagar.',
  },
  aviso_negativacao: {
    title: 'Aviso de negativação ou protesto',
    meaning: 'O texto fala em incluir ou manter seu nome em cadastro de inadimplentes ou em protesto. Você tem direito de ser avisado por escrito antes da inclusão e de saber a data e a origem da dívida.',
  },
  ameaca_judicial: {
    title: 'Ameaça de processo ou ação judicial',
    meaning: 'O texto fala em processo, execução ou advogado. Isso pode ser só pressão de cobrança. Processo de verdade chega por citação oficial, não por mensagem solta.',
  },
  suspeita_golpe: {
    title: 'Muitos sinais de golpe',
    meaning: 'O texto reúne vários sinais que aparecem em golpes de cobrança. Não pague nem clique em nada antes de confirmar por um canal oficial.',
  },
  desconhecido: {
    title: 'Não deu para identificar o tipo',
    meaning: 'O texto não deixa claro quem cobra nem por quê. Antes de qualquer resposta, peça os dados do credor e do contrato.',
  },
};

function parseAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/gi)) {
    const raw = m[1]!.replace(/\./g, '').replace(',', '.');
    const value = Math.round(Number(raw) * 100);
    if (Number.isFinite(value) && value > 0 && value < 1_000_000_000) out.push(value);
  }
  return [...new Set(out)].slice(0, 8);
}

function parseDates(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g)) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 1990 && y <= 2100) out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return [...new Set(out)].slice(0, 6);
}

function parseDeadlines(folded: string): string[] {
  const out: string[] = [];
  for (const m of folded.matchAll(/(em|ate|dentro de|nas proximas)\s+(\d{1,3})\s*(horas|h|dias|dia)\b/g)) out.push(`${m[2]} ${m[3] === 'dia' || m[3] === 'dias' ? 'dias' : 'horas'}`);
  if (/\b(hoje|amanha)\b/.test(folded)) out.push(/\bhoje\b/.test(folded) ? 'hoje' : 'amanhã');
  return [...new Set(out)].slice(0, 4);
}

const REPLY = (kind: CollectionKind) =>
  [
    'Olá. Recebi uma mensagem de cobrança em meu nome e, antes de qualquer pagamento ou acordo, preciso conferir os dados. Por favor, enviem por escrito:',
    '1. Razão social e CNPJ da empresa que está cobrando;',
    '2. Nome do credor original e número do contrato ou da fatura;',
    '3. Data do vencimento da parcela mais antiga em aberto;',
    '4. Demonstrativo do valor: principal, juros, multa e encargos;',
    kind === 'cobranca_terceirizada' ? '5. Documento que comprove a cessão ou a autorização para cobrar em nome do credor.' : '5. Canais oficiais para eu confirmar esta cobrança.',
    'Esta mensagem não é reconhecimento de dívida nem proposta de acordo. Aguardo retorno por escrito.',
  ].join('\n');

const RIGHTS = [
  'Você tem direito à informação clara sobre a dívida: valor, origem, juros e credor (Código de Defesa do Consumidor, art. 6º, III).',
  'A cobrança não pode expor você ao ridículo nem ameaçar (CDC, art. 42).',
  'Você deve ser avisado por escrito antes de ser negativado (CDC, art. 43, § 2º), e a negativação não passa de 5 anos (art. 43, § 1º).',
  'Se em dúvida, procure o Procon, o consumidor.gov.br ou a Defensoria Pública (atendimento gratuito).',
];

export function analyzeCollectionText(rawText: string): TranslatorAnalysis {
  const text = rawText.slice(0, MAX_TRANSLATOR_CHARS);
  const folded = fold(text);

  const flags = FLAG_RULES.filter((r) => r.test.test(folded)).map(({ id, title, why }) => ({ id, title, why }));
  const flagScore = FLAG_RULES.filter((r) => r.test.test(folded)).reduce((s, r) => s + r.weight, 0);
  const strong = FLAG_RULES.some((r) => r.weight === 3 && r.test.test(folded));

  const kindScores = new Map<CollectionKind, number>();
  for (const r of KIND_RULES) if (r.test.test(folded)) kindScores.set(r.kind, (kindScores.get(r.kind) ?? 0) + r.weight);
  let kind: CollectionKind = [...kindScores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'desconhecido';
  if (strong && flagScore >= 6) kind = 'suspeita_golpe';

  const risk: TranslatorRisk = strong || flagScore >= 6 ? 'high' : flagScore >= 3 || kind === 'oferta_limpa_nome' ? 'attention' : 'low';

  const facts = {
    amountsCents: parseAmounts(text),
    dates: parseDates(text),
    deadlines: parseDeadlines(folded),
    hasLink: /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|online|xyz|top|site)\b)/.test(folded),
    asksPix: /\bpix\b/.test(folded),
    mentionsInterest: /(juros|multa|encargos|correcao)/.test(folded),
  };

  const doNow = [
    'Não pague nem responda “sim” ou “aceito” enquanto não confirmar quem está cobrando.',
    'Procure a empresa pelo site, aplicativo ou telefone que já constam no seu contrato ou fatura, nunca pelo link ou número da mensagem.',
    'Mande a mensagem de resposta abaixo e peça tudo por escrito.',
    'Guarde prints, e-mails e protocolos. Anote data e hora de cada contato.',
  ];
  if (kind === 'aviso_negativacao') doNow.push('Consulte seu CPF nos canais oficiais (Serasa, SPC e Registrato do Banco Central) para ver se a restrição existe de fato.');
  if (kind === 'ameaca_judicial') doNow.push('Se receber uma citação oficial, procure a Defensoria Pública ou um advogado no prazo indicado no documento.');
  if (risk === 'high') doNow.unshift('Trate como golpe até provar o contrário. Se já pagou ou passou dados, ligue agora para o seu banco.');

  const dontDo = [
    'Não passe senha, código recebido por SMS ou acesso remoto ao celular.',
    'Não faça Pix para chave de pessoa física ou de empresa diferente da que você confirmou.',
    'Não reconheça a dívida por escrito nem pague “uma parte para mostrar boa vontade” antes de conferir: isso pode reiniciar prazos.',
    'Não clique em links da mensagem.',
  ];

  const info = MEANING[kind];
  return { kind, risk, title: info.title, meaning: info.meaning, flags, facts, doNow, dontDo, reply: REPLY(kind), rights: RIGHTS };
}

export function buildTranslatorPreview(a: TranslatorAnalysis): TranslatorPreview {
  const teaser =
    a.risk === 'high'
      ? 'Encontramos sinais fortes de golpe. Veja o que fazer agora e o que nunca fazer.'
      : a.risk === 'attention'
        ? 'Tem pontos que merecem cuidado antes de qualquer resposta. Veja o passo a passo e uma mensagem pronta.'
        : 'Não vimos sinais fortes de golpe, mas isso não garante que a cobrança esteja correta. Veja como conferir.';
  return {
    kind: a.kind,
    title: a.title,
    risk: a.risk,
    flagCount: a.flags.length,
    amountsFound: a.facts.amountsCents.length,
    teaser,
    lockedSections: ['meaning', 'flags', 'numbers', 'do_now', 'dont_do', 'reply', 'rights'],
  };
}
