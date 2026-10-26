// Planejar férias: de um formulário simples saem as noites, a divisão sugerida do orçamento, quanto guardar por mês até a viagem
// e um checklist completo que muda com o tipo de viagem (carro, avião, ônibus, motorhome, navio), a família, os bichos de estimação e o destino.
// Cálculo puro, sem rede e sem IA. Nunca inventa preço: só divide o orçamento que a pessoa informa.

export type TripKind = 'carro' | 'aviao' | 'onibus' | 'motorhome' | 'navio';
export type Lodging = 'hotel' | 'casa' | 'camping' | 'familia';

export const TRIP_KINDS: { id: TripKind; label: string }[] = [
  { id: 'carro', label: 'De carro' },
  { id: 'aviao', label: 'De avião' },
  { id: 'onibus', label: 'De ônibus' },
  { id: 'motorhome', label: 'De motorhome ou trailer' },
  { id: 'navio', label: 'De navio ou cruzeiro' },
];
export const LODGINGS: { id: Lodging; label: string }[] = [
  { id: 'hotel', label: 'Hotel ou pousada' },
  { id: 'casa', label: 'Casa ou apartamento por temporada' },
  { id: 'camping', label: 'Camping ou parque de motorhome' },
  { id: 'familia', label: 'Casa de parentes ou amigos' },
];

export interface TripInput {
  name: string;
  destination: string;
  /** Cidade de saída (ajuda o roteiro por IA). */
  origin: string;
  startDate: string;
  endDate: string;
  kind: TripKind;
  adults: number;
  children: number;
  seniors: boolean;
  pets: boolean;
  lodging: Lodging;
  international: boolean;
  /** Orçamento total da viagem; sem ele só mostramos a divisão em porcentagem. */
  budgetCents: number | null;
  notes: string;
}

export interface TripBudgetLine { id: string; label: string; pct: number; cents: number | null; hint: string }
export interface TripChecklistItem { id: string; group: string; text: string }
export interface TripPlan {
  days: number;
  nights: number;
  people: number;
  perDayCents: number | null;
  perPersonCents: number | null;
  budget: TripBudgetLine[];
  saving: { monthsLeft: number; perMonthCents: number } | null;
  checklist: TripChecklistItem[];
  tips: string[];
  daysUntil: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86_400_000);
const validIso = (s: unknown): s is string => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const MAX_TRIP_DAYS = 60;

/** Confere o formulário; devolve a lista de problemas em palavras simples (vazia = ok). */
export function validateTrip(i: TripInput, today: string): string[] {
  const issues: string[] = [];
  if (!i.name.trim()) issues.push('Dê um nome para a viagem.');
  if (!i.destination.trim()) issues.push('Diga para onde vocês vão.');
  if (!validIso(i.startDate) || !validIso(i.endDate)) issues.push('Informe as datas de ida e de volta.');
  else {
    if (i.endDate < i.startDate) issues.push('A volta não pode ser antes da ida.');
    else if (daysBetween(i.startDate, i.endDate) + 1 > MAX_TRIP_DAYS) issues.push(`O planejador vai até ${MAX_TRIP_DAYS} dias de viagem.`);
    if (i.endDate < today) issues.push('A viagem já terminou. Escolha datas futuras.');
  }
  if (!Number.isInteger(i.adults) || i.adults < 1 || i.adults > 12) issues.push('Informe de 1 a 12 adultos.');
  if (!Number.isInteger(i.children) || i.children < 0 || i.children > 12) issues.push('Informe de 0 a 12 crianças.');
  if (!TRIP_KINDS.some((k) => k.id === i.kind)) issues.push('Escolha o tipo de viagem.');
  if (!LODGINGS.some((l) => l.id === i.lodging)) issues.push('Escolha onde vão ficar.');
  if (i.kind === 'motorhome' && i.lodging === 'hotel') issues.push('Motorhome costuma dormir em camping ou parque de apoio; troque o tipo de hospedagem ou use "casa de parentes".');
  if (i.budgetCents !== null && (!Number.isInteger(i.budgetCents) || i.budgetCents < 0 || i.budgetCents > 100_000_000)) issues.push('O orçamento está fora do limite.');
  return issues;
}

// ---------------------------------------------------------------------------
// Orçamento: divisão sugerida (estimativa de partida; cada viagem é diferente)
// ---------------------------------------------------------------------------
type Share = { id: string; label: string; pct: number; hint: string };

function baseShares(kind: TripKind, international: boolean): Share[] {
  const intl: Share[] = international ? [{ id: 'docs', label: 'Seguro viagem, documentos e vistos', pct: 4, hint: 'Passaporte, visto quando exigido, seguro viagem e taxas.' }] : [];
  switch (kind) {
    case 'aviao':
      return [
        { id: 'transporte', label: 'Passagens e transporte no destino', pct: international ? 32 : 36, hint: 'Passagens, bagagem despachada, traslados e transporte local.' },
        { id: 'hospedagem', label: 'Hospedagem', pct: 28, hint: 'Diárias e taxas de limpeza ou turismo.' },
        { id: 'alimentacao', label: 'Alimentação', pct: 18, hint: 'Refeições e lanches fora do que o hotel inclui.' },
        { id: 'passeios', label: 'Passeios e ingressos', pct: 10, hint: 'Atrações, ingressos e guias.' },
        ...intl,
        { id: 'imprevistos', label: 'Imprevistos e compras', pct: 8, hint: 'Reserva para o que não estava no plano.' },
      ];
    case 'onibus':
      return [
        { id: 'transporte', label: 'Passagens e transporte no destino', pct: 20, hint: 'Passagens de ida e volta e deslocamentos locais.' },
        { id: 'hospedagem', label: 'Hospedagem', pct: 32, hint: 'Diárias.' },
        { id: 'alimentacao', label: 'Alimentação', pct: 25, hint: 'Refeições e lanches.' },
        { id: 'passeios', label: 'Passeios e ingressos', pct: 13, hint: 'Atrações e ingressos.' },
        ...intl,
        { id: 'imprevistos', label: 'Imprevistos e compras', pct: 10, hint: 'Reserva para o que não estava no plano.' },
      ];
    case 'motorhome':
      return [
        { id: 'transporte', label: 'Combustível, pedágios e manutenção na estrada', pct: 30, hint: 'Motorhome consome mais: calcule trecho a trecho.' },
        { id: 'hospedagem', label: 'Campings e pontos de apoio', pct: 15, hint: 'Diárias de camping, energia, água e estacionamento.' },
        { id: 'alimentacao', label: 'Alimentação e abastecimento', pct: 28, hint: 'Mercado, gás e refeições fora.' },
        { id: 'passeios', label: 'Passeios e ingressos', pct: 12, hint: 'Atrações e ingressos.' },
        ...intl,
        { id: 'imprevistos', label: 'Imprevistos e reparos', pct: 15, hint: 'Pneus, mecânica e o que quebrar no caminho.' },
      ];
    case 'navio':
      return [
        { id: 'transporte', label: 'Cabine, taxas e embarque', pct: 58, hint: 'Cruzeiro ou balsa: cabine, taxas portuárias e gorjetas.' },
        { id: 'alimentacao', label: 'Alimentação e bebidas fora do pacote', pct: 8, hint: 'Restaurantes especiais e bebidas.' },
        { id: 'passeios', label: 'Excursões em terra', pct: 17, hint: 'Passeios nos portos.' },
        { id: 'hospedagem', label: 'Hotel antes ou depois do embarque', pct: 8, hint: 'Noites extras perto do porto.' },
        ...intl,
        { id: 'imprevistos', label: 'Imprevistos e compras', pct: 9, hint: 'Reserva para o que não estava no plano.' },
      ];
    default:
      return [
        { id: 'transporte', label: 'Combustível e pedágios', pct: 25, hint: 'Some o trecho de ida e de volta; confira pedágios e estacionamentos.' },
        { id: 'hospedagem', label: 'Hospedagem', pct: 30, hint: 'Diárias.' },
        { id: 'alimentacao', label: 'Alimentação', pct: 25, hint: 'Refeições na estrada e no destino.' },
        { id: 'passeios', label: 'Passeios e ingressos', pct: 10, hint: 'Atrações e ingressos.' },
        ...intl,
        { id: 'imprevistos', label: 'Imprevistos e manutenção', pct: 10, hint: 'Reserva para o que não estava no plano.' },
      ];
  }
}

const LODGING_FACTOR: Record<Lodging, number> = { hotel: 1, casa: 1, camping: 0.5, familia: 0.15 };

/** Divide o orçamento: ajusta a hospedagem ao lugar onde vão ficar e fecha em 100% e no total exato. */
export function splitBudget(kind: TripKind, lodging: Lodging, international: boolean, budgetCents: number | null): TripBudgetLine[] {
  const raw = baseShares(kind, international).map((s) => ({ ...s, w: s.id === 'hospedagem' ? s.pct * LODGING_FACTOR[lodging] : s.pct }));
  const sum = raw.reduce((t, s) => t + s.w, 0);
  const pcts = raw.map((s) => Math.round((s.w / sum) * 100));
  const diff = 100 - pcts.reduce((t, p) => t + p, 0);
  if (diff !== 0) {
    const biggest = pcts.indexOf(Math.max(...pcts));
    pcts[biggest] = pcts[biggest]! + diff;
  }
  const lines = raw.map((s, i) => ({ id: s.id, label: s.label, pct: pcts[i]!, cents: null as number | null, hint: s.id === 'hospedagem' && lodging === 'familia' ? 'Na casa de parentes sobra para presente, mercado e passeios.' : s.hint }));
  if (budgetCents !== null) {
    let left = budgetCents;
    lines.forEach((l, i) => {
      const v = i === lines.length - 1 ? left : Math.floor((budgetCents * l.pct) / 100);
      l.cents = v;
      left -= v;
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
export function buildChecklist(i: TripInput): TripChecklistItem[] {
  const out: TripChecklistItem[] = [];
  const add = (group: string, id: string, text: string) => out.push({ id, group, text });
  const days = daysBetween(i.startDate, i.endDate) + 1;

  add('Documentos', 'doc-id', i.adults + i.children > 1 ? 'Documento com foto de cada adulto (RG ou CNH dentro da validade)' : 'Documento com foto (RG ou CNH dentro da validade)');
  add('Documentos', 'doc-copias', 'Cópia digital dos documentos no celular e na nuvem, e uma cópia em papel separada dos originais');
  if (i.children > 0) {
    add('Documentos', 'doc-criancas', 'Certidão de nascimento ou RG de cada criança');
    add('Documentos', 'doc-autorizacao', 'Se a criança vai sem um dos pais ou com outra pessoa, confira se precisa de autorização de viagem (cartório ou modelo oficial do CNJ)');
  }
  if (i.international) {
    add('Documentos', 'doc-passaporte', 'Passaporte válido por pelo menos 6 meses depois da volta');
    add('Documentos', 'doc-visto', 'Confira no consulado ou no site oficial do país se precisa de visto ou autorização eletrônica');
    add('Documentos', 'doc-seguro', 'Seguro viagem contratado, com a apólice e o telefone de emergência salvos');
    add('Documentos', 'doc-vacinas', 'Vacinas e certificado internacional de vacinação, quando o destino exigir');
    add('Dinheiro', 'din-cambio', 'Moeda do destino ou cartão internacional; avise o banco da viagem');
    add('Dinheiro', 'din-iof', 'Compare o custo (câmbio + IOF) entre dinheiro, cartão e conta global antes de decidir');
    add('Mala', 'mala-adaptador', 'Adaptador de tomada do país de destino');
    add('Mala', 'mala-chip', 'Plano de celular no exterior (roaming, chip local ou eSIM)');
  }
  if (i.pets) {
    add('Bichos de estimação', 'pet-vacinas', 'Carteira de vacinação do bicho em dia e atestado de saúde, se o transporte ou o destino pedirem');
    add('Bichos de estimação', 'pet-regras', 'Confirme que a hospedagem e o transporte aceitam bichos e quais são as regras');
    add('Bichos de estimação', 'pet-caixa', 'Caixa de transporte adequada ao tamanho, ou cinto e guia para carro');
    add('Bichos de estimação', 'pet-itens', 'Ração, água, potes, medicamentos, coleira com identificação e saquinhos');
  }

  add('Reservas', 'res-hospedagem', i.lodging === 'familia' ? 'Combine datas, chegada e despesas com quem vai receber vocês' : 'Hospedagem confirmada, com voucher e política de cancelamento salvos');
  add('Reservas', 'res-transporte', i.kind === 'carro' || i.kind === 'motorhome' ? 'Rota definida com paradas de descanso a cada 2 horas, mais um plano B' : 'Passagens ou reserva de transporte conferidas (nome, data e horário)');
  add('Reservas', 'res-passeios', 'Ingressos e passeios que precisam de reserva antecipada');

  switch (i.kind) {
    case 'carro':
      add('Veículo', 'car-revisao', 'Revisão feita: óleo, freios, pneus (inclusive o estepe), bateria, luzes e palhetas');
      add('Veículo', 'car-docs', 'CNH válida e documento do veículo em dia (licenciamento e seguro)');
      add('Veículo', 'car-kit', 'Macaco, chave de roda, triângulo e extintor no lugar');
      add('Veículo', 'car-assist', 'Telefone da assistência 24 horas do seguro ou do cartão');
      add('Veículo', 'car-rota', 'Mapa ou rota baixados para usar sem internet, e pedágios previstos (tag ou dinheiro)');
      if (i.children > 0) add('Veículo', 'car-cadeirinha', 'Cadeirinha, assento ou bebê conforto de acordo com a idade e o peso de cada criança');
      break;
    case 'aviao':
      add('Transporte', 'av-checkin', 'Check-in online feito e cartões de embarque salvos no celular');
      add('Transporte', 'av-bagagem', 'Regras de bagagem de mão e despachada conferidas, com as malas pesadas em casa');
      add('Transporte', 'av-horario', i.international ? 'Chegue ao aeroporto cerca de 3 horas antes do voo internacional' : 'Chegue ao aeroporto cerca de 2 horas antes do voo');
      add('Transporte', 'av-traslado', 'Como ir e voltar do aeroporto combinado (traslado, aplicativo ou carro de alguém)');
      break;
    case 'onibus':
      add('Transporte', 'on-bilhete', 'Passagens conferidas (nome, data, poltrona) e horário do embarque, com folga de 40 minutos');
      add('Transporte', 'on-bagagem', 'Bagagem identificada com nome e telefone; objetos de valor na mochila de mão');
      add('Transporte', 'on-conforto', 'Travesseiro de pescoço, agasalho, água e lanche para o trajeto');
      break;
    case 'motorhome':
      add('Veículo', 'mh-revisao', 'Revisão mecânica completa: freios, pneus, suspensão, óleo, correias e arrefecimento');
      add('Veículo', 'mh-cnh', 'Confira se a categoria da CNH vale para o peso do veículo e se o documento e o seguro estão em dia');
      add('Veículo', 'mh-gas', 'Instalação de gás, botijão, fogão e detector de vazamento conferidos');
      add('Veículo', 'mh-eletrica', 'Bateria, gerador ou inversor, cabo e adaptador de energia para os pontos de apoio');
      add('Veículo', 'mh-agua', 'Tanque de água cheio, mangueira, filtro e esvaziamento do banheiro e da água cinza');
      add('Veículo', 'mh-ferramentas', 'Calços, macaco, triângulo, extintor, ferramentas e kit de reparo de pneu');
      add('Veículo', 'mh-pontos', 'Pontos de apoio e campings de cada pernoite reservados ou pesquisados, com plano B');
      add('Veículo', 'mh-altura', 'Altura e peso do veículo conferidos para túneis, pontes e balsas do caminho');
      break;
    case 'navio':
      add('Transporte', 'na-embarque', 'Hora e porto de embarque, regras de bagagem e documento exigido pela companhia');
      add('Transporte', 'na-enjoo', 'Remédio para enjoo e protetor solar');
      add('Transporte', 'na-gorjetas', 'Taxas, gorjetas e pacotes de bebida: confira o que já está pago');
      add('Transporte', 'na-hotel', 'Chegada um dia antes do embarque, se o porto for longe');
      break;
  }

  add('Saúde', 'sau-farmacia', 'Farmácia de viagem: analgésico, antitérmico, antialérgico, antidiarreico, curativos, repelente e protetor solar');
  add('Saúde', 'sau-continuo', 'Remédios de uso contínuo para todos os dias, mais uma sobra, com as receitas');
  add('Saúde', 'sau-plano', 'Cartão do plano de saúde e contatos de emergência salvos');
  if (i.children > 0) add('Saúde', 'sau-criancas', 'Remédios infantis (febre, alergia), termômetro e o que a criança usa todo dia');
  if (i.seniors) add('Saúde', 'sau-idosos', 'Receitas e remédios de quem tem mais idade, pausas no trajeto e acessibilidade do lugar conferida');

  add('Mala', 'mala-roupas', `Roupas para ${Math.min(days, 7)} dias (lave no meio da viagem se passar disso), com uma muda extra na bagagem de mão`);
  add('Mala', 'mala-calcados', 'Calçado confortável para caminhar e um para o clima do destino');
  add('Mala', 'mala-higiene', 'Itens de higiene e toalha, se a hospedagem não fornecer');
  add('Mala', 'mala-eletronicos', 'Carregadores, fones, bateria portátil e cabos');
  add('Mala', 'mala-clima', 'Previsão do tempo conferida dois dias antes: casaco, capa de chuva ou roupa de praia');
  if (i.children > 0) add('Mala', 'mala-criancas', 'Brinquedos e entretenimento para o trajeto, fraldas ou lenços, lanchinhos e uma muda extra de roupa');

  add('Dinheiro', 'din-orcamento', 'Orçamento da viagem separado do orçamento do mês (veja a divisão sugerida acima)');
  add('Dinheiro', 'din-cartao', 'Limite do cartão suficiente para a viagem (veja em Cartões) e uma segunda forma de pagamento');
  add('Dinheiro', 'din-reserva', 'Reserva para imprevistos separada, sem mexer na reserva de emergência');

  add('Casa antes de sair', 'casa-contas', 'Contas que vencem no período pagas ou agendadas (use os Lembretes do Prumo)');
  add('Casa antes de sair', 'casa-avisar', 'Avisar um vizinho ou parente de confiança e deixar um contato');
  add('Casa antes de sair', 'casa-desligar', 'Gás e registro de água fechados, aparelhos desligados da tomada e janelas trancadas');
  add('Casa antes de sair', 'casa-lixo', 'Lixo para fora e comida perecível tratada');
  if (days > 4) add('Casa antes de sair', 'casa-plantas', 'Plantas e correspondência: alguém para cuidar ou recolher');
  if (!i.pets) add('Casa antes de sair', 'casa-cuidador', 'Se ficar algum bicho em casa, combine quem cuida e deixe tudo anotado');

  return out;
}

// ---------------------------------------------------------------------------
// Plano completo
// ---------------------------------------------------------------------------
export class TripInputError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'TripInputError';
    this.issues = issues;
  }
}

export function buildTripPlan(i: TripInput, today: string): TripPlan {
  const issues = validateTrip(i, today);
  if (issues.length) throw new TripInputError(issues);
  const days = daysBetween(i.startDate, i.endDate) + 1;
  const nights = Math.max(0, days - 1);
  const people = i.adults + i.children;
  const daysUntil = Math.max(0, daysBetween(today, i.startDate));
  const budget = splitBudget(i.kind, i.lodging, i.international, i.budgetCents);
  const monthsLeft = Math.max(1, Math.ceil(daysUntil / 30));
  const tips: string[] = [];
  if (daysUntil <= 14) tips.push('A viagem está perto: comece pelos documentos e pelas reservas, que são o que mais trava na última hora.');
  else if (daysUntil > 60) tips.push('Ainda dá tempo: separe um valor fixo por mês e compare preços de hospedagem e transporte com calma.');
  if (i.international) tips.push('Viagem ao exterior: o valor em reais muda com o câmbio. Deixe uma folga de 10% a 15% no orçamento para o dólar ou o euro subirem e para o IOF.');
  if (i.kind === 'carro' || i.kind === 'motorhome') tips.push('Na estrada, faça paradas a cada 2 horas e evite dirigir à noite em trechos que você não conhece.');
  if (i.kind === 'aviao') tips.push('Bagagem despachada costuma ser cobrada à parte em tarifas baratas: confira antes de fechar a passagem.');
  if (i.children > 0) tips.push('Com crianças, planeje no máximo 1 ou 2 programas por dia e deixe horários livres para descanso.');
  if (i.pets) tips.push('Com bichos de estimação, confirme as regras da hospedagem e do transporte por escrito antes de pagar.');
  if (i.lodging === 'familia') tips.push('Na casa de parentes, combine as despesas da casa: mercado, gás e passeios em grupo.');
  if (days >= 10) tips.push('Viagem longa: reveja o orçamento a cada 3 ou 4 dias para não chegar ao fim do dinheiro antes do fim da viagem.');
  return {
    days, nights, people,
    perDayCents: i.budgetCents !== null ? Math.round(i.budgetCents / days) : null,
    perPersonCents: i.budgetCents !== null ? Math.round(i.budgetCents / people) : null,
    budget,
    saving: i.budgetCents !== null && daysUntil > 0 ? { monthsLeft, perMonthCents: Math.ceil(i.budgetCents / monthsLeft) } : null,
    checklist: buildChecklist(i),
    tips: tips.slice(0, 6),
    daysUntil,
  };
}
