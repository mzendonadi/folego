// Landing do Prumo (/prumo): vitrine do app com os MESMOS componentes de gráfico do produto, alimentados por dados fictícios.
// Nada aqui lê conta, lançamento ou dado de ninguém: os números abaixo são inventados e a tela diz isso.
import { el, icon } from './dom.js';
import { brl } from './format.js';
import { donut, bars, line, hbars } from './charts.js';
import { bindStaticPrices } from './prices.js';

const R = (n) => Math.round(n * 100); // reais -> centavos

// ----------------------------------------------------------------------- dados fictícios
const CATS = [
  { key: 'moradia', label: 'Moradia', value: R(3200) }, { key: 'mercado', label: 'Mercado', value: R(1450) },
  { key: 'transporte', label: 'Transporte', value: R(820) }, { key: 'lazer', label: 'Lazer', value: R(640) },
  { key: 'saude', label: 'Saúde', value: R(410) }, { key: 'educacao', label: 'Educação', value: R(380) }, { key: 'outros', label: 'Outros', value: R(520) },
];
const MONTHS = [['mai/26', 5200, 4400], ['jun/26', 7900, 8300], ['jul/26', 5200, 5900], ['ago/26', 6100, 5400], ['set/26', 5200, 5600], ['out/26', 5200, 4870]];
const monthItems = () => MONTHS.map(([label, a, b]) => ({ key: label, label, a: R(a), b: R(b) }));
const dailyPoints = () => Array.from({ length: 31 }, (_, i) => {
  const d = String(i + 1).padStart(2, '0');
  const base = [0, 8, 15, 22, 29].includes(i) ? 0 : 60;
  const bump = i === 4 ? 3200 : i === 9 ? 640 : i === 17 ? 380 : i === 24 ? 520 : 0; // aluguel, mercado grande, farmácia, lazer
  return { x: `2026-10-${d}`, y: R(base + ((i * 37) % 90) + bump) };
});
const SAMPLE = [
  ['mercado', 'Mercado do bairro', 482.3, '03/10'], ['moradia', 'Aluguel', 3200, '05/10'], ['lazer', 'Cinema e jantar', 187.5, '11/10'], ['mercado', 'Feira e açougue', 144.9, '12/10'],
  ['transporte', 'Combustível', 260, '14/10'], ['saude', 'Farmácia', 138.4, '18/10'], ['educacao', 'Curso de inglês', 380, '20/10'], ['mercado', 'Mercado do bairro', 301, '24/10'],
];

const pane = (title, points, plan, demo) => el('div', { class: 'pm-pane' },
  el('div', { class: 'pm-pane-copy' }, el('p', { class: 'pm-plan' }, plan), el('h3', {}, title), el('ul', { class: 'tick-list left' }, ...points.map((p) => el('li', {}, icon('check'), el('span', {}, p))))),
  el('div', { class: 'example-card pm-demo' }, el('p', { class: 'example-tag' }, 'Exemplo ilustrativo, dados fictícios'), demo));

const kpi = (label, value, tone) => el('div', { class: 'stat' }, el('dt', {}, label), el('dd', { class: tone }, value));

// ----------------------------------------------------------------------- demonstrações
function overviewDemo() {
  return el('div', { class: 'pm-stack' },
    el('dl', { class: 'stats pm-kpis' }, kpi('Entrou', brl(R(5200)), 'pos'), kpi('Saiu', brl(R(4870))), kpi('Sobrou', brl(R(330)), 'pos')),
    el('h4', {}, 'Gastos por categoria'), donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria (exemplo)', max: 6 }),
    el('h4', {}, 'Entrou e saiu, mês a mês'), bars(monthItems(), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: true, label: 'Entrou e saiu por mês (exemplo)' }));
}

function cardsDemo() {
  const cards = [
    { key: 'azul', label: 'Cartão Azul', value: R(4320), limit: R(12000), sub: '36% do limite em uso' },
    { key: 'verde', label: 'Cartão Verde', value: R(9100), limit: R(10000), sub: '91% do limite em uso: perto do teto' },
  ];
  const parcels = ['nov', 'dez', 'jan', 'fev', 'mar', 'abr'].map((m, i) => ({ key: m, label: m, a: R([620, 620, 480, 480, 310, 310][i]) }));
  return el('div', { class: 'pm-stack' },
    el('h4', {}, 'Limite usado por cartão'), hbars(cards, { interactive: true, label: 'Limite usado por cartão (exemplo)' }),
    el('h4', {}, 'Parcelas que ainda vão chegar'), bars(parcels, { aLabel: 'Parcelas', interactive: true, label: 'Parcelas dos próximos meses (exemplo)' }),
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'A fatura do Cartão Verde vence em 3 dias: R$ 2.310,00. Pagar em dia evita o rotativo.')));
}

function reportsDemo() {
  const state = { cat: null };
  const out = el('div', { class: 'pm-stack' });
  const list = el('ol', { class: 'rel-top' });
  const head = el('p', { class: 'fine muted' });
  const draw = () => {
    const rows = SAMPLE.filter((r) => !state.cat || r[0] === state.cat);
    const total = rows.reduce((s, r) => s + r[2], 0);
    head.textContent = state.cat ? `Filtrado por ${CATS.find((c) => c.key === state.cat)?.label}: ${rows.length} lançamentos, ${brl(R(total))}.` : 'Toque numa categoria da rosca para filtrar o relatório.';
    list.replaceChildren(...rows.map((r) => el('li', {}, el('span', { class: 'rel-top-note' }, el('strong', {}, r[1]), el('span', { class: 'fine muted' }, `${r[3]} · ${CATS.find((c) => c.key === r[0])?.label}`)), el('strong', { class: 'neg' }, brl(R(r[2]))))));
  };
  out.append(
    el('div', { class: 'seg rel-seg', role: 'presentation' }, ...['Este mês', '3 meses', '12 meses', 'Este ano'].map((l, i) => el('span', { class: 'seg-btn', 'aria-current': i === 0 ? 'true' : undefined }, l))),
    el('dl', { class: 'stats pm-kpis' }, kpi('Gastou', brl(R(4870))), kpi('Entrou', brl(R(5200)), 'pos'), kpi('Lançamentos', '48')),
    donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria (exemplo)', max: 6, onSelect: (k) => { state.cat = k; draw(); } }),
    head, list,
    el('div', { class: 'pm-fake-actions' }, el('span', { class: 'btn btn-secondary btn-sm', 'aria-hidden': 'true' }, 'Baixar planilha (CSV)'), el('span', { class: 'btn btn-secondary btn-sm', 'aria-hidden': 'true' }, 'Imprimir ou salvar em PDF')));
  draw();
  return out;
}

function investmentsDemo() {
  const items = [{ key: 'cdb', label: 'CDB liquidez diária', value: R(12400) }, { key: 'tes', label: 'Tesouro Selic', value: R(6800) }, { key: 'lci', label: 'LCI 90 dias', value: R(4300) }];
  return el('div', { class: 'pm-stack' },
    el('div', { class: 'inv-hero' }, el('div', {}, el('span', { class: 'muted' }, 'Total investido'), el('strong', { class: 'inv-total' }, brl(R(23500))), el('p', { class: 'inv-yield' }, 'Rendimento atual ', el('strong', { class: 'pos' }, `+${brl(R(318.4))} (1,37%)`)))),
    donut(items, { interactive: true, totalLabel: 'Investido', label: 'Composição da carteira (exemplo)' }),
    el('h4', {}, 'Rendimento por aplicação'), hbars([{ key: 'cdb', label: 'CDB liquidez diária', value: R(171.2) }, { key: 'tes', label: 'Tesouro Selic', value: R(94.7) }, { key: 'lci', label: 'LCI 90 dias', value: R(52.5) }], { interactive: true, label: 'Rendimento por aplicação (exemplo)' }));
}

function strategiesDemo() {
  const plays = [
    ['alta', 'Resgatar R$ 1.800 para zerar o negativo da conta', 'O limite da conta custa cerca de 8% ao mês; o que está aplicado rende cerca de 1% ao mês. Resgatar e cobrir o negativo economiza uns R$ 126 por mês.', 'até R$ 126 por mês'],
    ['alta', 'Fatura em aberto do Cartão Verde: R$ 2.310', 'Fatura vencida cai no rotativo, com custo de cerca de 14% ao mês. Antes de parcelar no banco, compare com outras linhas de crédito.', 'até R$ 323 por mês'],
    ['media', 'LCI 90 dias: em 12 dias o IR cai para 20%', 'Hoje o IR sobre o rendimento é 22,5%. Se não precisar do dinheiro agora, esperar reduz o imposto.', null],
  ];
  return el('ul', { class: 'plays pm-plays' }, ...plays.map(([prio, title, text, save]) => el('li', { class: `play ${prio === 'alta' ? 'play-warn' : 'play-info'}` },
    el('div', { class: 'play-top' }, el('span', { class: `pill ${prio === 'alta' ? 'tone-critical' : 'tone-attention'}` }, prio === 'alta' ? 'Prioridade alta' : 'Prioridade média'), save ? el('span', { class: 'fine pos' }, save) : null),
    el('strong', {}, title), el('p', {}, text))));
}

function whatsappDemo() {
  const msg = (me, t) => el('div', { class: `pm-msg ${me ? 'me' : 'bot'}` }, el('p', {}, t));
  return el('div', { class: 'pm-chat', role: 'img', 'aria-label': 'Conversa de exemplo com o assistente no WhatsApp' },
    msg(true, 'mercado 45'), msg(false, 'Lancei R$ 45,00 em Mercado, hoje. Quer mudar a categoria?'),
    msg(true, '[foto do cupom do posto]'), msg(false, 'Li R$ 182,40 em Combustível, ontem. Lancei no Cartão Azul.'),
    msg(true, '[áudio] gastei 38 reais na farmácia'), msg(false, 'Lancei R$ 38,00 em Saúde. Seu gasto de Saúde no mês: R$ 410,00.'));
}

const TABS = [
  { id: 'geral', label: 'Visão geral', plan: 'Gráficos do mês a partir do Controle', title: 'Para onde foi o dinheiro, de relance', points: ['Gastos por categoria e entrou/saiu mês a mês, com os valores escritos.', 'No Desbravador os gráficos são interativos: toque e veja o valor de cada fatia e de cada mês.', 'Saldo da conta que já conta o negativo de antes, não só entrou menos saiu.'], demo: overviewDemo },
  { id: 'cartoes', label: 'Cartões', plan: 'A partir do Ousado', title: 'Cartão sem susto', points: ['Limite, fatura, vencimento e parcelas sem gasto em dobro com o extrato.', 'Pagou parte da fatura e parcelou o resto? O Prumo liga o pagamento e mostra os juros.', 'Fatura em PDF lida e conferida no Desbravador, também pelo WhatsApp.'], demo: cardsDemo },
  { id: 'relatorios', label: 'Relatórios', plan: 'Ousado, com filtros no Desbravador', title: 'Relatório do período, em um toque', points: ['Mês, 3 meses, 12 meses ou ano, com comparação com o período anterior.', 'Planilha (CSV) e PDF para guardar ou levar a quem divide as contas.', 'No Desbravador, filtre por categoria, conta, cartão, tipo e texto.'], demo: reportsDemo },
  { id: 'investimentos', label: 'Investimentos', plan: 'Desbravador', title: 'O que você já construiu', points: ['Lance suas aplicações e veja total investido e rendimento atual.', 'Imposto de renda estimado se resgatar hoje e quando ele cai de faixa.', 'Aplicações em processamento ficam à parte até serem creditadas.'], demo: investmentsDemo },
  { id: 'estrategias', label: 'Estratégias', plan: 'Desbravador', title: 'Onde mover, resgatar ou quitar primeiro', points: ['Jogadas calculadas com contas, cartões, dívidas e aplicações juntos.', 'Análise completa de um estrategista financeiro por IA, com plano de ação.', 'Educação financeira com os seus números, sem recomendação de produto.'], demo: strategiesDemo },
  { id: 'whatsapp', label: 'WhatsApp', plan: 'Em todos os planos', title: 'Lançar sem abrir o app', points: ['Mande texto, áudio ou a foto do cupom e o gasto entra no lugar certo.', 'Você confere e corrige quando quiser, no app.', 'Avisos no celular para fatura, boleto e conta no negativo, só entre 8h e 22h.'], demo: whatsappDemo },
];

function tour(root) {
  const list = el('div', { class: 'pm-tabs', role: 'tablist', 'aria-label': 'Telas do Prumo' });
  const body = el('div', { class: 'pm-tabpanel', role: 'tabpanel', tabindex: '-1' });
  const btns = TABS.map((t) => {
    const b = el('button', { class: 'pm-tab', type: 'button', role: 'tab', id: `pm-tab-${t.id}`, 'aria-controls': 'pm-panel', 'aria-selected': 'false' }, t.label);
    b.addEventListener('click', () => show(t.id));
    return b;
  });
  btns.forEach((b) => list.append(b));
  body.id = 'pm-panel';
  list.addEventListener('keydown', (e) => {
    const i = btns.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: btns.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const k = (next + btns.length) % btns.length;
    show(TABS[k].id);
    btns[k].focus();
  });
  function show(id) {
    const t = TABS.find((x) => x.id === id) ?? TABS[0];
    btns.forEach((b) => { const on = b.id === `pm-tab-${t.id}`; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    body.setAttribute('aria-labelledby', `pm-tab-${t.id}`);
    body.replaceChildren(pane(t.title, t.points, t.plan, t.demo()));
  }
  root.replaceChildren(list, body);
  show('geral');
}

function plans(root) {
  const grid = document.querySelector('#prumo .plan-grid');
  if (!grid) return;
  // os mesmos cartões da home (copiados dali, para nunca divergirem), agora com o botão de assinar
  const copy = grid.cloneNode(true);
  const names = ['Controle', 'Ousado', 'Desbravador'];
  copy.querySelectorAll('article.plan-card').forEach((a, i) => {
    a.append(el('a', { class: `btn btn-block ${a.classList.contains('plan-featured') ? 'btn-primary' : 'btn-secondary'}`, href: '/conta' }, `Assinar o ${names[i] ?? 'plano'}`));
  });
  root.replaceChildren(copy);
  bindStaticPrices(root);
}

let built = false;
/** Monta a vitrine uma vez; chamado toda vez que a tela /prumo abre (a primeira monta, as seguintes só reaproveitam). */
export function renderPrumoLanding() {
  if (built) return;
  built = true;
  const hero = document.getElementById('pm-hero-demo');
  if (hero) {
    hero.replaceChildren(
      el('div', { class: 'pm-hero-top' }, el('strong', {}, 'Outubro'), el('span', { class: 'pill tone-ok' }, 'Sobrou R$ 330,00')),
      donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria (exemplo)', max: 5 }),
      line(dailyPoints(), { interactive: true, xLabel: (p) => `${p.x.slice(8, 10)}/${p.x.slice(5, 7)}`, label: 'Gasto por dia (exemplo)' }));
  }
  const t = document.getElementById('pm-tour-root');
  if (t) tour(t);
  const p = document.getElementById('pm-plans');
  if (p) plans(p);
}
