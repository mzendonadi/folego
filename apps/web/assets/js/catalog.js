// Catálogo mostrado ao cliente. Os PREÇOS que valem são os do servidor (app.products): ele cobra e calcula o desconto.
// Os valores abaixo são só o padrão de reserva; ao abrir o site, applyCatalog() troca pelos que o dono definiu no backoffice.
export const CATALOG = {
  recovery_map: { name: 'Mapa da Virada', cents: 2900, active: true },
  collection_translator: { name: 'Tradutor de Cobrança', cents: 1290, active: true },
  defense_letters: {
    name: 'Kit de Cartas e Defesas',
    cents: 1900,
    active: true,
    blurb: 'Cartas prontas para pedir informações, contestar juros e avisar sobre prazo de cobrança. Você preenche uma vez e baixa em PDF.',
  },
  calendar_30d: {
    name: 'Calendário do plano',
    cents: 1999,
    active: true,
    blurb: 'As ações dos 30 dias, as estratégias do seu caso e os marcos dos próximos meses (dia de pagar, dívida quitada), com lembretes. Funciona no Google Agenda, no iPhone e no Outlook.',
  },
  extra_income_plan: {
    name: 'Criador de Renda Extra',
    cents: 1599,
    active: true,
    blurb: 'Podemos traçar um plano personalizado para você empreender. Depois de comprar, você responde algumas perguntas rápidas e a IA monta a sua ideia, as plataformas certas e um plano de 4 semanas — feito para o seu perfil, não uma lista genérica.',
  },
};

/** Preço fechado do Kit Completo (Mapa + Cartas + Calendário). Só exibição: o servidor calcula o que vale. */
export const BUNDLE = { cents: 5990 };

export const ADDONS = ['defense_letters', 'calendar_30d', 'extra_income_plan'];

/** Aplica o catálogo vindo do servidor (GET /api/catalog). */
export function applyCatalog(server) {
  for (const p of server?.products ?? []) {
    const item = CATALOG[p.code];
    if (!item) continue;
    item.cents = p.priceCents;
    item.active = p.active;
    if (p.name) item.name = p.name;
  }
  if (Number.isInteger(server?.bundlePriceCents)) BUNDLE.cents = server.bundlePriceCents;
}

const whole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** "R$ 29" quando o valor é redondo; "R$ 15,99" quando não é. */
export const priceLabel = (code) => {
  const cents = code === 'bundle' ? BUNDLE.cents : CATALOG[code].cents;
  return cents % 100 === 0 ? whole.format(cents / 100) : exact.format(cents / 100);
};
