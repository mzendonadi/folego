import { PLANS } from '../vendor/engine.js';

// Catálogo mostrado ao cliente. Os PREÇOS que valem são os do servidor (app.products): ele cobra e calcula o desconto.
// Os valores abaixo são só o padrão de reserva; ao abrir o site, applyCatalog() troca pelos que o dono definiu no backoffice.
export const CATALOG = {
  recovery_map: { name: 'Mapa da Virada', cents: 2999, active: true },
  collection_translator: { name: 'Tradutor de Cobrança', cents: 699, active: true },
  defense_letters: {
    name: 'Kit de Cartas e Defesas',
    cents: 1999,
    active: true,
    blurb: 'Cartas prontas para pedir informações, contestar juros e avisar sobre prazo de cobrança. Você preenche uma vez e baixa em PDF.',
  },
  calendar_30d: {
    name: 'Calendário do plano',
    cents: 2499,
    active: true,
    blurb: 'As ações dos 30 dias, as estratégias do seu caso e os marcos dos próximos meses (dia de pagar, dívida quitada), com lembretes. Funciona no Google Agenda, no iPhone e no Outlook.',
  },
  // Guias sob medida: nascem desligados; o preço e a liberação vêm do backoffice.
  guide_financing: { name: 'Comparador honesto de financiamento', cents: 1999, active: false },
  guide_housebills: { name: 'Renegociador de contas de casa', cents: 1599, active: false },
  guide_forgotten: { name: 'Guia do dinheiro esquecido', cents: 999, active: false },
  guide_resume: { name: 'Currículo por vaga', cents: 1999, active: false },
  sub_controle: { name: 'Controle', cents: 2999, active: true },
  sub_ousado: { name: 'Ousado', cents: 4999, active: true },
  sub_desbravador: { name: 'Desbravador', cents: 7999, active: true },
  extra_income_plan: {
    name: 'Criador de Renda Extra',
    cents: 1999,
    active: true,
    blurb: 'Podemos traçar um plano personalizado para você empreender. Depois de comprar, você responde algumas perguntas rápidas e a IA monta a sua ideia, as plataformas certas e um plano de 4 semanas — feito para o seu perfil, não uma lista genérica.',
  },
};

/** Dias de acesso depois de pagar (o dono define em "Produtos e preços"; 30 é o padrão). */
export const daysOf = (code) => CATALOG[code]?.days ?? 30;

/** Preço fechado do Kit Completo (Mapa + Cartas + Calendário). Só exibição: o servidor calcula o que vale. */
export const BUNDLE = { cents: 5999 };

/** Mapa da Virada para quem assina o Ousado (Pix): valor e dias de acesso. Só exibição na landing: o servidor calcula o que vale. */
export const SUB_MAP = { cents: 1299, days: 90 };

export const ADDONS = ['defense_letters', 'calendar_30d', 'extra_income_plan'];

/** Aplica o catálogo vindo do servidor (GET /api/catalog). */
export function applyCatalog(server) {
  for (const p of server?.products ?? []) {
    const item = CATALOG[p.code];
    if (!item) continue;
    // Os planos do Prumo também seguem o que o dono define no backoffice (landing, escolha de plano e cabeçalho da conta).
    const plan = PLANS.find((x) => x.productCode === p.code);
    if (plan) plan.priceCents = p.priceCents;
    item.cents = p.priceCents;
    item.active = p.active;
    if (Number.isInteger(p.accessDays)) item.days = p.accessDays;
    if (p.name) item.name = p.name;
  }
  if (Number.isInteger(server?.bundlePriceCents)) BUNDLE.cents = server.bundlePriceCents;
  if (Number.isInteger(server?.subscriberMapPriceCents)) SUB_MAP.cents = server.subscriberMapPriceCents;
  if (Number.isInteger(server?.subscriberMapDays)) SUB_MAP.days = server.subscriberMapDays;
}

const whole = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** "R$ 29" quando o valor é redondo; "R$ 15,99" quando não é. */
export const priceLabel = (code) => {
  const cents = code === 'bundle' ? BUNDLE.cents : CATALOG[code].cents;
  return cents % 100 === 0 ? whole.format(cents / 100) : exact.format(cents / 100);
};
