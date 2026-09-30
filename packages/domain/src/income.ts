// Criador de Renda Extra 2.0: depois da compra, uma entrevista curta personaliza um plano de verdade
// (ideia certa pro perfil, 4 semanas com tarefas DIFERENTES por tipo de ideia, plataformas de verdade e uma
// faixa de ganho estimada). Tom: empreender, não só vender — nunca promessa de resultado.
// Este módulo é a fonte ÚNICA de números e fatos: a IA (quando ligada) só escreve texto sobre eles, nunca
// calcula nem inventa valor — mesma disciplina das cartas e dos roteiros de negociação.
import type { Diagnosis, EmploymentType, Profile } from './types.ts';
import { formatBrl } from './calendar.ts';

export type IncomeCategory = 'venda_usados' | 'revenda' | 'servico' | 'entrega' | 'producao' | 'negocio_proprio';
export type HoursBand = 'ate_5h' | '5_10h' | '10_20h' | 'mais_20h';
export type IncomeMode = 'presencial' | 'online' | 'tanto_faz';

export const HOURS_BAND_LABEL: Record<HoursBand, string> = {
  ate_5h: 'até 5 horas por semana',
  '5_10h': '5 a 10 horas por semana',
  '10_20h': '10 a 20 horas por semana',
  mais_20h: 'mais de 20 horas por semana',
};
const HOURS_BAND_MID: Record<HoursBand, number> = { ate_5h: 3, '5_10h': 7, '10_20h': 15, mais_20h: 25 };

export interface IncomeInterview {
  /** O que a pessoa escreveu sobre o que sabe fazer. Texto livre: nunca vira instrução para a IA, só dado. */
  skills: string;
  hoursBand: HoursBand;
  capitalCents: number;
  hasVehicle: boolean;
  mode: IncomeMode;
  /** O que já tentou antes (opcional). */
  priorAttempts: string;
}

export interface IncomeIdea {
  id: string;
  title: string;
  category: IncomeCategory;
  why: string;
  effort: 'baixo' | 'medio';
  startCost: 'zero' | 'baixo';
  firstMoney: 'dias' | 'semanas';
}

interface CatalogIdea extends IncomeIdea {
  fits: EmploymentType[] | 'all';
  /** Se a ideia não combina com esse modo de trabalho, ela é descartada (ex.: entrega não é 100% online). */
  excludesMode?: IncomeMode[];
  needsVehicle?: boolean;
}

const CATALOG: CatalogIdea[] = [
  {
    id: 'vender-parado', category: 'venda_usados', fits: 'all', title: 'Vender o que está parado em casa',
    why: 'Roupas, eletrônicos e móveis sem uso viram dinheiro sem precisar investir nada.',
    effort: 'baixo', startCost: 'zero', firstMoney: 'dias',
  },
  {
    id: 'revenda', category: 'revenda', fits: ['clt', 'public_servant', 'other', 'self_employed'], title: 'Revender produtos que você já conhece',
    why: 'Comprar pouco e revender para quem você conhece dá retorno em poucas semanas e permite parar quando quiser.',
    effort: 'medio', startCost: 'baixo', firstMoney: 'semanas',
  },
  {
    id: 'servico-habilidade', category: 'servico', fits: ['clt', 'public_servant', 'other', 'self_employed'], title: 'Vender uma habilidade sua em horários livres',
    why: 'Reparos, aulas particulares, design, redação, planilhas ou idiomas têm procura constante e se encaixam no seu horário.',
    effort: 'medio', startCost: 'zero', firstMoney: 'semanas',
  },
  {
    id: 'entregas-fim-de-semana', category: 'entrega', fits: ['clt', 'public_servant', 'other'], title: 'Entregas ou serviços por app aos fins de semana',
    why: 'Horários flexíveis e pagamento semanal, útil para cobrir um buraco no orçamento por alguns meses.',
    effort: 'medio', startCost: 'baixo', firstMoney: 'dias',
    excludesMode: ['online'],
  },
  {
    id: 'ajustar-preco', category: 'negocio_proprio', fits: ['self_employed'], title: 'Rever preços e cobrar no ato',
    why: 'Para quem trabalha por conta, reajustar o preço e cobrar adiantado costuma render mais do que arrumar clientes novos.',
    effort: 'baixo', startCost: 'zero', firstMoney: 'dias',
  },
  {
    id: 'cobrar-clientes', category: 'negocio_proprio', fits: ['self_employed'], title: 'Cobrar quem já está devendo para você',
    why: 'Dinheiro que já é seu e está parado com clientes é a renda extra mais rápida.',
    effort: 'baixo', startCost: 'zero', firstMoney: 'dias',
  },
  {
    id: 'pacotes-recorrentes', category: 'negocio_proprio', fits: ['self_employed'], title: 'Oferecer pacotes mensais aos clientes fixos',
    why: 'Um valor combinado por mês traz previsão de caixa e ajuda a pagar as parcelas em dia.',
    effort: 'medio', startCost: 'zero', firstMoney: 'semanas',
  },
  {
    id: 'artesanato-doces', category: 'producao', fits: ['inss_retiree', 'other', 'clt', 'public_servant'], title: 'Produzir e vender comida, doces ou artesanato sob encomenda',
    why: 'Encomendas evitam desperdício e o cliente paga antes de você gastar com os ingredientes.',
    effort: 'medio', startCost: 'baixo', firstMoney: 'semanas',
    excludesMode: ['online'],
  },
  {
    id: 'aulas-reforco', category: 'servico', fits: ['inss_retiree', 'public_servant', 'clt', 'other'], title: 'Aulas de reforço, idiomas ou experiência profissional',
    why: 'Quem tem experiência de vida ou de profissão tem o que ensinar, de casa ou online.',
    effort: 'medio', startCost: 'zero', firstMoney: 'semanas',
  },
  {
    id: 'cuidados-casa', category: 'servico', fits: ['inss_retiree', 'other'], title: 'Serviços de casa e vizinhança, com pouco esforço físico',
    why: 'Organização, acompanhar crianças em atividades, costura ou pequenos consertos são procurados na vizinhança.',
    effort: 'baixo', startCost: 'zero', firstMoney: 'dias',
    excludesMode: ['online'],
  },
];

export interface RateInfo {
  kind: 'hora' | 'margem' | 'variavel';
  lowCents: number;
  highCents: number;
  note: string;
}

/** Faixas amplas e conservadoras, sempre como estimativa — nunca promessa. Fonte: conhecimento geral do mercado informal brasileiro. */
const RATE_REFERENCE: Record<IncomeCategory, RateInfo> = {
  venda_usados: { kind: 'margem', lowCents: 4000, highCents: 7000, note: 'Itens usados em bom estado costumam sair entre 40% e 70% do valor de um novo parecido, dependendo da conservação.' },
  revenda: { kind: 'margem', lowCents: 3000, highCents: 6000, note: 'A margem comum fica entre 30% e 60% sobre o preço de compra, variando por produto e concorrência.' },
  servico: { kind: 'hora', lowCents: 2500, highCents: 8000, note: 'O valor da hora varia muito pelo tipo de serviço e pela região — pesquise o que outras pessoas cobram perto de você antes de fechar o seu preço.' },
  entrega: { kind: 'hora', lowCents: 1500, highCents: 3500, note: 'É o valor antes de descontar combustível e manutenção — guarde os recibos para saber o que sobra de verdade.' },
  producao: { kind: 'margem', lowCents: 5000, highCents: 10000, note: 'Cobrar de 2 a 3 vezes o custo do material costuma cobrir o seu tempo e o gás/luz gastos.' },
  negocio_proprio: { kind: 'variavel', lowCents: 0, highCents: 0, note: 'Aqui o ganho vem de cobrar melhor o que você já faz, não de um valor novo — por isso não tem uma faixa única.' },
};

const PLATFORMS: Record<IncomeCategory, string[]> = {
  venda_usados: ['OLX', 'Enjoei', 'Facebook Marketplace', 'grupos de bairro ou de condomínio'],
  revenda: ['Instagram', 'WhatsApp Business', 'Mercado Livre', 'feiras e bazares locais'],
  servico: ['WhatsApp Business', 'Instagram', 'GetNinjas', 'grupos de bairro no Facebook'],
  entrega: ['iFood', 'Rappi', '99Entregas', 'Uber'],
  producao: ['Instagram', 'WhatsApp Business', 'grupos de encomenda do bairro'],
  negocio_proprio: [],
};

const WEEK_TEMPLATES: Record<IncomeCategory, { title: string; tasks: string[] }[]> = {
  venda_usados: [
    { title: 'Separar e fotografar', tasks: ['Separe o que não usa há mais de 6 meses.', 'Limpe e tire fotos com boa luz, de vários ângulos.', 'Pesquise 2 ou 3 anúncios parecidos para definir o preço de cada item.'] },
    { title: 'Publicar em vários lugares', tasks: ['Anuncie nas plataformas indicadas, com descrição honesta sobre o estado.', 'Responda rápido a quem chamar.', 'Marque 3 pessoas conhecidas que podem se interessar.'] },
    { title: 'Negociar e entregar', tasks: ['Aceite contraproposta razoável em vez de deixar parado.', 'Combine retirada em local público, de dia.', 'Feche o que travou com um desconto pequeno.'] },
    { title: 'Fechar e decidir', tasks: ['Some tudo o que entrou.', 'Separe o valor combinado para a meta do mês.', 'Veja se sobrou mais coisa pra vender ou se é hora de trocar de ideia.'] },
  ],
  revenda: [
    { title: 'Escolher o nicho e o fornecedor', tasks: ['Escolha uma categoria que você já entende.', 'Pesquise 2 ou 3 fornecedores e compare preço.', 'Compre um lote pequeno, dentro do que você tem disponível.'] },
    { title: 'Primeiras vendas', tasks: ['Ofereça primeiro para quem já te conhece, não para estranhos.', 'Fotografe bem cada produto.', 'Anote o que perguntaram antes de comprar.'] },
    { title: 'Repetir o que vendeu', tasks: ['Compre mais do que vendeu rápido; pare o que não saiu.', 'Peça indicação a quem já comprou.', 'Ajuste o preço se estiver muito parado.'] },
    { title: 'Decidir o ritmo', tasks: ['Compare o lucro com a meta do mês.', 'Decida se continua com o mesmo produto ou troca.', 'Separe o valor combinado para a meta.'] },
  ],
  servico: [
    { title: 'Definir a oferta', tasks: ['Escreva em uma frase o que você resolve e para quem.', 'Defina seu preço usando a faixa de referência.', 'Prepare uma mensagem curta para oferecer o serviço.'] },
    { title: 'Primeiros atendimentos', tasks: ['Ofereça a pelo menos 10 conhecidos.', 'Peça para indicarem quem mais pode precisar.', 'Faça os primeiros atendimentos e peça um depoimento curto.'] },
    { title: 'Cobrar o preço cheio', tasks: ['Depois de 2 ou 3 atendimentos, cobre o preço definido, sem desconto de estreia.', 'Use os depoimentos para oferecer a mais gente.', 'Anote quanto tempo cada atendimento realmente toma.'] },
    { title: 'Organizar a agenda', tasks: ['Veja quantas horas por semana cabem sem atrapalhar o resto.', 'Decida se isso vira algo fixo.', 'Separe o valor combinado para a meta.'] },
  ],
  entrega: [
    { title: 'Cadastro e primeiros turnos', tasks: ['Complete o cadastro nas plataformas indicadas.', 'Reserve turnos de acordo com as horas que você tem disponíveis.', 'Faça os primeiros turnos e anote o que ganhou em cada um.'] },
    { title: 'Testar os horários', tasks: ['Anote em quais dias e horários rendeu mais.', 'Ajuste a região ou os turnos pro que funcionou melhor.', 'Guarde os recibos de combustível ou manutenção.'] },
    { title: 'Ver o ganho líquido', tasks: ['Calcule o que sobra depois do combustível e da manutenção.', 'Compare esse valor com a faixa de referência.', 'Decida se compensa manter o ritmo.'] },
    { title: 'Decidir o ritmo', tasks: ['Compare o líquido do mês com a meta.', 'Decida se mantém, aumenta ou reduz os turnos.', 'Separe o valor combinado para a meta.'] },
  ],
  producao: [
    { title: 'Cardápio ou catálogo enxuto', tasks: ['Escolha 3 itens para oferecer, não mais que isso no início.', 'Calcule o custo de material de cada um.', 'Defina o preço usando a faixa de referência.'] },
    { title: 'Primeiras encomendas', tasks: ['Ofereça a vizinhos e colegas, com pedido antecipado.', 'Peça pagamento, ao menos parcial, antes de comprar o material.', 'Anote o que mais pediram.'] },
    { title: 'Ajustar a produção', tasks: ['Teste aumentar a quantidade do item que mais vendeu.', 'Corte o item que ninguém pediu.', 'Revise o preço se o material subiu.'] },
    { title: 'Decidir a rotina', tasks: ['Veja quanto tempo cada encomenda toma de verdade.', 'Decida a frequência que dá para manter sem esgotar.', 'Separe o valor combinado para a meta.'] },
  ],
  negocio_proprio: [
    { title: 'Levantamento', tasks: ['Liste seus preços atuais e o que está parado a receber.', 'Compare seus preços com o que o mercado cobra hoje.', 'Separe os 3 clientes mais importantes.'] },
    { title: 'Cobrar e reajustar', tasks: ['Mande uma mensagem cordial cobrando os valores parados, com data e forma de pagamento.', 'Reajuste o preço para clientes novos.', 'Anote quem respondeu e quem não respondeu.'] },
    { title: 'Propor recorrência', tasks: ['Ofereça um pacote mensal aos 3 melhores clientes.', 'Peça pagamento adiantado em troca de um desconto pequeno.', 'Feche pelo menos uma recorrência nova.'] },
    { title: 'Medir o resultado', tasks: ['Compare o que entrou de novo com a meta do mês.', 'Decida se mantém o reajuste.', 'Separe o valor combinado para a meta.'] },
  ],
};

const CAUTIONS = [
  'Nunca pague para começar a trabalhar, e desconfie de "renda fácil", "retorno garantido" ou pirâmides.',
  'Renda extra tem impostos e limites: se vender ou prestar serviço com frequência, procure um contador para entender o MEI e o Imposto de Renda — formalizar abre portas (crédito, nota fiscal, fornecedor melhor), não é burocracia à toa.',
  'Não se endivide para começar. Use o que você já tem ou peça pagamento antecipado antes de comprar material.',
  'Proteja o que já paga as contas: seu emprego, sua saúde e seu descanso vêm antes.',
];

export interface IncomePlanWeek {
  week: number;
  title: string;
  tasks: string[];
}

export interface IncomePlanContent {
  version: 1;
  source: 'ai' | 'template';
  /** Só quando source = 'ai': uma nota de abertura e um incentivo final, escritos pela IA. */
  openingNote: string | null;
  encouragement: string | null;
  target: { cents: number; basis: 'deficit' | 'surplus'; text: string };
  idea: { title: string; category: IncomeCategory; why: string; platforms: string[]; rateNote: string; projected: { lowCents: number; highCents: number } | null };
  weeks: IncomePlanWeek[];
  cautions: string[];
}

export interface IncomeFacts {
  target: { cents: number; basis: 'deficit' | 'surplus'; text: string };
  interview: IncomeInterview;
  /** Ideias candidatas, já filtradas pelo vínculo e pelo modo de trabalho — a melhor vem primeiro. */
  candidates: IncomeIdea[];
  rateByCategory: Record<IncomeCategory, RateInfo>;
  platformsByCategory: Record<IncomeCategory, string[]>;
  /** Projeção mensal (código, nunca a IA) pra categorias por hora, usando o meio da faixa de horas informada. */
  projectedByCategory: Partial<Record<IncomeCategory, { lowCents: number; highCents: number }>>;
  /** Todo valor em reais que um texto gerado pode citar. */
  allowedAmountsCents: number[];
  /** Toda plataforma que um texto gerado pode citar pelo nome. */
  allowedPlatforms: string[];
}

function computeTarget(diagnosis: Diagnosis, profile: Profile): IncomeFacts['target'] {
  const b = diagnosis.budget;
  const basis: 'deficit' | 'surplus' = b.deficit ? 'deficit' : 'surplus';
  const cents = b.deficit ? b.gapCents : Math.max(5_000, Math.round((profile.netIncomeCents * 0.1) / 1000) * 1000);
  const text = b.deficit
    ? `Hoje faltam ${formatBrl(b.gapCents)} por mês para fechar a conta. Essa é a sua meta mínima de renda extra.`
    : `Sua conta fecha, então a meta é acelerar: ${formatBrl(cents)} por mês a mais (cerca de 10% da renda) encurtam o tempo para quitar as dívidas.`;
  return { cents, basis, text };
}

export function buildIncomeFacts(diagnosis: Diagnosis, profile: Profile, interview: IncomeInterview): IncomeFacts {
  const target = computeTarget(diagnosis, profile);
  const candidates = CATALOG.filter((i) => (i.fits === 'all' || i.fits.includes(profile.employmentType)) && !(i.excludesMode ?? []).includes(interview.mode))
    .map(({ fits: _fits, excludesMode: _e, needsVehicle: _n, ...idea }) => idea);

  const hours = HOURS_BAND_MID[interview.hoursBand];
  const projectedByCategory: IncomeFacts['projectedByCategory'] = {};
  const allowedAmounts = new Set<number>([target.cents, interview.capitalCents]);
  for (const cat of new Set(candidates.map((c) => c.category))) {
    const rate = RATE_REFERENCE[cat];
    allowedAmounts.add(rate.lowCents);
    allowedAmounts.add(rate.highCents);
    if (rate.kind === 'hora') {
      const lowCents = rate.lowCents * hours * 4;
      const highCents = rate.highCents * hours * 4;
      projectedByCategory[cat] = { lowCents, highCents };
      allowedAmounts.add(lowCents);
      allowedAmounts.add(highCents);
    }
  }

  return {
    target,
    interview,
    candidates,
    rateByCategory: RATE_REFERENCE,
    platformsByCategory: PLATFORMS,
    projectedByCategory,
    allowedAmountsCents: [...allowedAmounts],
    allowedPlatforms: [...new Set(candidates.flatMap((c) => PLATFORMS[c.category]))],
  };
}

export function rateText(cat: IncomeCategory, facts: IncomeFacts): string {
  const rate = facts.rateByCategory[cat];
  const projected = facts.projectedByCategory[cat];
  if (rate.kind === 'variavel') return rate.note;
  const range = `${formatBrl(rate.lowCents)} a ${formatBrl(rate.highCents)}`;
  const per = rate.kind === 'hora' ? 'por hora' : 'de margem por venda';
  const proj = projected ? ` Com ${HOURS_BAND_LABEL[facts.interview.hoursBand]}, isso é uma estimativa de ${formatBrl(projected.lowCents)} a ${formatBrl(projected.highCents)} por mês.` : '';
  return `Estimativa: ${range} ${per}. ${rate.note}${proj}`;
}

/** Plano 100% determinístico (nunca IA): usado quando a IA está desligada, falhou ou foi reprovada. */
export function buildIncomePlanTemplate(facts: IncomeFacts): IncomePlanContent {
  const idea = facts.candidates[0];
  if (!idea) throw new Error('nenhuma ideia combina com o perfil informado');
  const cat = idea.category;
  return {
    version: 1,
    source: 'template',
    openingNote: null,
    encouragement: null,
    target: facts.target,
    idea: {
      title: idea.title,
      category: cat,
      why: idea.why,
      platforms: facts.platformsByCategory[cat],
      rateNote: rateText(cat, facts),
      projected: facts.projectedByCategory[cat] ?? null,
    },
    weeks: WEEK_TEMPLATES[cat].map((w, i) => ({ week: i + 1, ...w })),
    cautions: CAUTIONS,
  };
}

export { CATALOG as INCOME_CATALOG, RATE_REFERENCE, PLATFORMS as INCOME_PLATFORMS, WEEK_TEMPLATES as INCOME_WEEK_TEMPLATES, CAUTIONS as INCOME_CAUTIONS };
