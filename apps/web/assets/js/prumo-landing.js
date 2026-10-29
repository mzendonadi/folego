// Landing do Prumo (/prumo): vitrine do app com os MESMOS componentes de gráfico do produto, alimentados por dados fictícios.
// Nada aqui lê conta, lançamento ou dado de ninguém: os números abaixo são inventados, mas fecham entre si
// (as categorias somam o gasto do mês, o gasto e a entrada geram a sobra, as contas de cenário saem dessa sobra).
import { el, icon } from './dom.js';
import { brl } from './format.js';
import { donut, bars, line, hbars } from './charts.js';
import { bindStaticPrices } from './prices.js';

const R = (n) => Math.round(n * 100); // reais -> centavos

// ----------------------------------------------------------------------- dados fictícios
const INCOME = 8200;
const CATS = [
  { key: 'moradia', label: 'Moradia', value: R(3200) }, { key: 'mercado', label: 'Mercado', value: R(1450) },
  { key: 'transporte', label: 'Transporte', value: R(820) }, { key: 'lazer', label: 'Lazer', value: R(640) },
  { key: 'saude', label: 'Saúde', value: R(410) }, { key: 'educacao', label: 'Educação', value: R(380) }, { key: 'outros', label: 'Outros', value: R(520) },
];
const SPENT = CATS.reduce((s, c) => s + c.value, 0) / 100; // 7.420
const LEFT = INCOME - SPENT; // 780
const MONTHS = [['mai/26', 8200, 7150], ['jun/26', 9100, 9400], ['jul/26', 8200, 7800], ['ago/26', 8200, 7350], ['set/26', 8200, 7690], ['out/26', INCOME, SPENT]];
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

const pane = (title, points, plan, demo, phone) => el('div', { class: `pm-pane${phone ? ' pm-pane-phone' : ''}` },
  el('div', { class: 'pm-pane-copy' }, el('p', { class: 'pm-plan' }, plan), el('h3', {}, title), el('ul', { class: 'tick-list left' }, ...points.map((p) => el('li', {}, icon('check'), el('span', {}, p))))),
  phone ? el('div', { class: 'pm-phone-wrap' }, demo) : el('div', { class: 'example-card pm-demo' }, demo));

const kpi = (label, value, tone) => el('div', { class: 'stat' }, el('dt', {}, label), el('dd', { class: tone }, value));

// ----------------------------------------------------------------------- demonstrações
function overviewDemo() {
  return el('div', { class: 'pm-stack' },
    el('dl', { class: 'stats pm-kpis' }, kpi('Entrou', brl(R(INCOME)), 'pos'), kpi('Saiu', brl(R(SPENT))), kpi('Sobrou', brl(R(LEFT)), 'pos')),
    el('h4', {}, 'Gastos por categoria'), donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria', max: 6 }),
    el('h4', {}, 'Entrou e saiu, mês a mês'), bars(monthItems(), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: true, label: 'Entrou e saiu por mês' }));
}

function cardsDemo() {
  const cards = [
    { key: 'santander', label: 'Cartão Santander', value: R(4320), limit: R(12000), sub: '36% do limite em uso' },
    { key: 'bradesco', label: 'Cartão Bradesco', value: R(9100), limit: R(10000), sub: '91% do limite em uso: perto do teto' },
  ];
  const parcels = ['nov', 'dez', 'jan', 'fev', 'mar', 'abr'].map((m, i) => ({ key: m, label: m, a: R([620, 620, 480, 480, 310, 310][i]) }));
  return el('div', { class: 'pm-stack' },
    el('h4', {}, 'Limite usado por cartão'), hbars(cards, { interactive: true, label: 'Limite usado por cartão' }),
    el('h4', {}, 'Parcelas que ainda vão chegar'), bars(parcels, { aLabel: 'Parcelas', interactive: true, label: 'Parcelas dos próximos meses' }),
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'A fatura do Cartão Bradesco vence em 3 dias: R$ 2.310,00. Pagar em dia evita o rotativo.')));
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
    el('div', { class: 'seg pm-seg', role: 'presentation' }, ...['Este mês', '3 meses', '12 meses', 'Este ano'].map((l, i) => el('span', { class: 'seg-btn', 'aria-current': i === 0 ? 'true' : undefined }, l))),
    el('dl', { class: 'stats pm-kpis' }, kpi('Gastou', brl(R(SPENT))), kpi('Entrou', brl(R(INCOME)), 'pos'), kpi('Lançamentos', '48')),
    donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria', max: 6, onSelect: (k) => { state.cat = k; draw(); } }),
    head, list,
    el('div', { class: 'pm-fake-actions' }, el('span', { class: 'btn btn-secondary btn-sm', 'aria-hidden': 'true' }, 'Baixar planilha (CSV)'), el('span', { class: 'btn btn-secondary btn-sm', 'aria-hidden': 'true' }, 'Imprimir ou salvar em PDF')));
  draw();
  return out;
}

function investmentsDemo() {
  const items = [{ key: 'cdb', label: 'CDB liquidez diária', value: R(12400) }, { key: 'tes', label: 'Tesouro Selic', value: R(6800) }, { key: 'lci', label: 'LCI 90 dias', value: R(4300) }];
  return el('div', { class: 'pm-stack' },
    el('div', { class: 'inv-hero' }, el('div', {}, el('span', { class: 'muted' }, 'Total investido'), el('strong', { class: 'inv-total' }, brl(R(23500))), el('p', { class: 'inv-yield' }, 'Rendimento atual ', el('strong', { class: 'pos' }, `+${brl(R(318.4))} (1,37%)`)))),
    donut(items, { interactive: true, totalLabel: 'Investido', label: 'Composição da carteira' }),
    el('h4', {}, 'Rendimento por aplicação'), hbars([{ key: 'cdb', label: 'CDB liquidez diária', value: R(171.2) }, { key: 'tes', label: 'Tesouro Selic', value: R(94.7) }, { key: 'lci', label: 'LCI 90 dias', value: R(52.5) }], { interactive: true, label: 'Rendimento por aplicação' }));
}

function strategiesDemo() {
  const plays = [
    ['alta', 'Resgatar R$ 1.800 para zerar o negativo da conta', 'O limite da conta custa cerca de 8% ao mês; o que está aplicado rende cerca de 1% ao mês. Resgatar e cobrir o negativo economiza uns R$ 126 por mês.', 'até R$ 126 por mês'],
    ['alta', 'Fatura em aberto do Cartão Bradesco: R$ 2.310', 'Fatura vencida cai no rotativo, com custo de cerca de 14% ao mês. Antes de parcelar no banco, compare com outras linhas de crédito.', 'até R$ 323 por mês'],
    ['media', 'LCI 90 dias: em 12 dias o IR cai para 20%', 'Hoje o IR sobre o rendimento é 22,5%. Se não precisar do dinheiro agora, esperar reduz o imposto.', null],
  ];
  return el('ul', { class: 'plays pm-plays' }, ...plays.map(([prio, title, text, save]) => el('li', { class: `play ${prio === 'alta' ? 'play-warn' : 'play-info'}` },
    el('div', { class: 'play-top' }, el('span', { class: `pill ${prio === 'alta' ? 'tone-critical' : 'tone-attention'}` }, prio === 'alta' ? 'Prioridade alta' : 'Prioridade média'), save ? el('span', { class: 'fine pos' }, save) : null),
    el('strong', {}, title), el('p', {}, text))));
}

function vacationDemo() {
  const parts = [{ key: 'hosp', label: 'Hospedagem', value: R(2400) }, { key: 'comida', label: 'Alimentação', value: R(1500) }, { key: 'transp', label: 'Transporte', value: R(900) }, { key: 'passeios', label: 'Passeios', value: R(720) }, { key: 'reserva', label: 'Reserva para imprevistos', value: R(480) }];
  const todo = [['Reservar a hospedagem', true], ['Revisar o carro: pneus, óleo e freios', true], ['Separar documentos, remédios e carregadores', false], ['Deixar a casa em ordem e avisar um vizinho', false]];
  return el('div', { class: 'pm-stack' },
    el('div', { class: 'pm-trip' }, el('strong', {}, 'Férias de janeiro'), el('span', { class: 'fine muted' }, 'Florianópolis · 10 a 17/01 · de carro · 2 adultos e 1 criança')),
    el('dl', { class: 'stats pm-kpis' }, kpi('Orçamento', brl(R(6000))), kpi('Guardar por mês', brl(R(1500)), 'pos'), kpi('Faltam', '4 meses')),
    el('h4', {}, 'Para onde vai o dinheiro da viagem'), donut(parts, { interactive: true, totalLabel: 'Orçamento', label: 'Divisão do orçamento da viagem', max: 5 }),
    el('h4', {}, 'Checklist da viagem'),
    el('ul', { class: 'pm-todo' }, ...todo.map(([t, done]) => el('li', { class: done ? 'is-done' : '' }, el('span', { class: 'pm-todo-box', 'aria-hidden': 'true' }, done ? icon('check') : null), el('span', {}, t)))),
    el('div', { class: 'pm-itin' }, el('span', { class: 'pill tone-ok' }, 'Roteiro por IA, no Desbravador'),
      el('strong', {}, 'Dia 1: chegada e praia perto da hospedagem'), el('p', {}, 'Saída cedo para chegar antes das 15h, parada para almoço no meio do caminho e fim de tarde sem pressa na praia mais calma da região.')));
}

const WHAT_IF = [
  { id: 'extra', label: 'Começar uma renda extra', hint: 'Mais R$ 500,00 por mês, sem mexer no resto.', delta: 500 },
  { id: 'corte', label: 'Cortar gastos variáveis', hint: 'Os gastos variáveis (R$ 1.800,00) caem 20%.', delta: 360 },
];
function whatIfDemo() {
  const out = el('div', { class: 'pm-stack', 'aria-live': 'polite' });
  const presets = el('div', { class: 'pm-presets', role: 'group', 'aria-label': 'Situações prontas' });
  let current = WHAT_IF[0];
  const draw = () => {
    const after = LEFT + current.delta;
    const items = [3, 6, 12, 24].map((m) => ({ key: `m${m}`, label: `${m} meses`, a: R(LEFT * m), b: R(after * m) }));
    out.replaceChildren(
      el('p', { class: 'scn-verdict tone-ok' }, el('strong', {}, 'Esse cenário melhora o seu mês'), ` · +${brl(R(current.delta))} por mês (${brl(R(current.delta * 12))} no primeiro ano)`),
      el('p', { class: 'fine muted' }, current.hint),
      el('dl', { class: 'stats pm-kpis' }, kpi('Sobra hoje', brl(R(LEFT))), kpi('Sobra no cenário', brl(R(after)), 'pos'), kpi('Em 12 meses', brl(R(after * 12)), 'pos')),
      el('h4', {}, 'Quanto você junta, hoje e com a mudança'), bars(items, { aLabel: 'Hoje', bLabel: 'Com a mudança', interactive: true, label: 'Saldo acumulado, hoje e no cenário' }),
      el('p', { class: 'fine muted' }, 'No app são seis situações prontas (mudar de emprego, reduzir a jornada, mudar de casa e outras) e campos para montar a sua.'));
  };
  WHAT_IF.forEach((p) => {
    const b = el('button', { class: 'pm-preset', type: 'button', 'aria-pressed': String(p === current) }, p.label);
    b.addEventListener('click', () => {
      current = p;
      presets.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    });
    presets.append(b);
  });
  const wrap = el('div', { class: 'pm-stack' }, presets, out);
  draw();
  return wrap;
}

function plannerDemo() {
  return el('div', { class: 'pm-stack' },
    el('div', { class: 'pm-ask' }, el('span', { class: 'fine muted' }, 'Sua pergunta'), el('p', {}, 'Como fecho este mês sem atrasar nada? Qual dívida eu ataco primeiro?')),
    el('div', { class: 'pm-answer' },
      el('p', {}, `Neste mês entram ${brl(R(INCOME))} e saem ${brl(R(SPENT))}, então sobram ${brl(R(LEFT))}. A dívida mais cara é a fatura do Cartão Bradesco (R$ 2.310,00, vence em 3 dias): no rotativo ela custaria cerca de 14% ao mês.`),
      el('ul', { class: 'tick-list left' },
        el('li', {}, icon('check'), 'Pague a fatura do Cartão Bradesco até o vencimento.'),
        el('li', {}, icon('check'), `Separe os ${brl(R(LEFT))} que sobram em vez de gastar em lazer.`),
        el('li', {}, icon('check'), 'Revise o mercado: é 20% dos seus gastos do mês.')),
      el('p', { class: 'fine muted' }, 'Resposta escrita por IA com base nos seus dados. É orientação de organização, não consultoria financeira licenciada.')));
}

function coachDemo() {
  const tips = [
    ['Moradia é 43% dos seus gastos', 'R$ 3.200,00 de R$ 7.420,00 no mês. É o maior peso e o que menos se mexe: o resto precisa caber no que sobra.'],
    ['Mercado: R$ 1.450,00, 20% do mês', 'Fixar um teto de R$ 1.300,00 para o mercado deixa R$ 150,00 por mês a mais na sua mão.'],
    ['Três assinaturas somam R$ 87,70 por mês', 'São R$ 1.052,40 por ano. Veja se você usou as três nas últimas semanas; as que não, vale cancelar.'],
  ];
  return el('div', { class: 'pm-stack' }, el('div', { class: 'insight-list' }, ...tips.map(([t, d]) => el('article', { class: 'insight' }, el('h3', {}, t), el('p', {}, d)))));
}

function whatsappDemo() {
  const time = (t, me) => el('span', { class: 'pm-wa-time' }, t, me ? el('span', { class: 'pm-wa-ticks', 'aria-hidden': 'true' }, '✓✓') : null);
  const text = (me, t, at) => el('div', { class: `pm-wa-msg ${me ? 'out' : 'in'}` }, el('p', {}, t), time(at, me));
  const photo = el('div', { class: 'pm-wa-msg out pm-wa-photo' },
    el('div', { class: 'pm-wa-receipt', 'aria-hidden': 'true' }, ...[70, 48, 82, 40, 64, 55, 36].map((w) => el('i', { style: `width:${w}%` }))),
    el('p', {}, 'cupom do posto'), time('14:05', true));
  const audio = el('div', { class: 'pm-wa-msg out pm-wa-audio' },
    el('span', { class: 'pm-wa-play', 'aria-hidden': 'true' }),
    el('span', { class: 'pm-wa-wave', 'aria-hidden': 'true' }, ...Array.from({ length: 22 }, (_, i) => el('i', { style: `height:${6 + ((i * 7) % 15)}px` }))),
    el('span', { class: 'pm-wa-dur' }, '0:04'), time('14:09', true));
  return el('div', { class: 'pm-phone', role: 'img', 'aria-label': 'Conversa com o assistente do Fôlego no WhatsApp: o gasto vira lançamento por texto, foto do cupom ou áudio' },
    el('div', { class: 'pm-ph-status', 'aria-hidden': 'true' }, el('span', {}, '14:09'), el('span', { class: 'pm-ph-icons' }, el('i', {}), el('i', {}), el('i', {}))),
    el('div', { class: 'pm-wa-head', 'aria-hidden': 'true' },
      el('span', { class: 'pm-wa-back' }), el('span', { class: 'pm-wa-avatar' }, 'f'),
      el('span', { class: 'pm-wa-who' }, el('strong', {}, 'Fôlego'), el('small', {}, 'assistente de finanças'))),
    el('div', { class: 'pm-wa-body' },
      el('p', { class: 'pm-wa-day' }, 'HOJE'),
      text(true, 'mercado 45', '14:02'),
      text(false, 'Lancei R$ 45,00 em Mercado, hoje. Quer mudar a categoria?', '14:02'),
      photo,
      text(false, 'Li R$ 182,40 em Combustível, ontem. Lancei no Cartão Santander.', '14:05'),
      audio,
      text(false, 'Lancei R$ 38,00 em Saúde. Seu gasto de Saúde no mês: R$ 410,00.', '14:09')),
    el('div', { class: 'pm-wa-input', 'aria-hidden': 'true' }, el('span', {}, 'Mensagem'), el('span', { class: 'pm-wa-mic' })));
}

const TABS = [
  { id: 'geral', label: 'Visão geral', plan: 'Gráficos do mês a partir do Controle', title: 'Para onde foi o dinheiro, de relance', points: ['Gastos por categoria e entrou/saiu mês a mês, com os valores escritos.', 'No Desbravador os gráficos são interativos: toque e veja o valor de cada fatia e de cada mês.', 'Saldo da conta que já conta o negativo de antes, não só entrou menos saiu.'], demo: overviewDemo },
  { id: 'cartoes', label: 'Cartões', plan: 'A partir do Ousado', title: 'Cartão sem susto', points: ['Limite, fatura, vencimento e parcelas sem gasto em dobro com o extrato.', 'Pagou parte da fatura e parcelou o resto? O Prumo liga o pagamento e mostra os juros.', 'Fatura em PDF lida e conferida no Desbravador, também pelo WhatsApp.'], demo: cardsDemo },
  { id: 'relatorios', label: 'Relatórios', plan: 'Ousado, com filtros no Desbravador', title: 'Relatório do período, em um toque', points: ['Mês, 3 meses, 12 meses ou ano, com comparação com o período anterior.', 'Planilha (CSV) e PDF para guardar ou levar a quem divide as contas.', 'No Desbravador, filtre por categoria, conta, cartão, tipo e texto.'], demo: reportsDemo },
  { id: 'investimentos', label: 'Investimentos', plan: 'Desbravador', title: 'O que você já construiu', points: ['Lance suas aplicações e veja total investido e rendimento atual.', 'Imposto de renda estimado se resgatar hoje e quando ele cai de faixa.', 'Aplicações em processamento ficam à parte até serem creditadas.'], demo: investmentsDemo },
  { id: 'estrategias', label: 'Estratégias', plan: 'Desbravador', title: 'Onde mover, resgatar ou quitar primeiro', points: ['Jogadas calculadas com contas, cartões, dívidas e aplicações juntos.', 'Análise completa de um estrategista financeiro por IA, com plano de ação.', 'Educação financeira com os seus números, sem recomendação de produto.'], demo: strategiesDemo },
  { id: 'ferias', label: 'Férias', plan: 'Ousado, com roteiro por IA no Desbravador', title: 'Viaje sem estourar o orçamento', points: ['Conte destino, datas e quem vai: o Prumo divide o orçamento e diz quanto guardar por mês.', 'Checklist completo para o tipo de viagem: carro, avião, ônibus, motorhome ou navio.', 'No Desbravador, a IA monta o roteiro dia a dia para a viagem que você escolheu.'], demo: vacationDemo },
  { id: 'cenarios', label: 'E se...?', plan: 'Ousado', title: 'Teste a decisão antes de tomá-la', points: ['Mudar de emprego, reduzir a jornada, cortar gastos ou começar uma renda extra: veja o efeito no seu mês.', 'Compara a sua situação de hoje com a do cenário, mês a mês, até 5 anos.', 'Avisa quando o cenário deixa o saldo negativo na transição.'], demo: whatIfDemo },
  { id: 'planejador', label: 'Planejador', plan: 'Desbravador', title: 'Pergunte com as suas palavras', points: ['"Como fecho o mês?", "Qual dívida pago primeiro?": a resposta usa os seus números reais.', 'Os valores vêm da sua conta, nunca são inventados pela IA.', 'Termina com os próximos passos, em lista curta.'], demo: plannerDemo },
  { id: 'treinador', label: 'Treinador', plan: 'Completo no Ousado e no Desbravador', title: 'Dicas com número, nunca genéricas', points: ['Olha os seus lançamentos e aponta onde dá para melhorar.', 'Cada dica diz quanto você economiza se fizer a mudança.', 'No Controle você vê as três dicas principais.'], demo: coachDemo },
  { id: 'whatsapp', label: 'WhatsApp', plan: 'Em todos os planos', title: 'Lançar sem abrir o app', phone: true, points: ['Mande texto, áudio ou a foto do cupom e o gasto entra no lugar certo.', 'Você confere e corrige quando quiser, no app.', 'Avisos no celular para fatura, boleto e conta no negativo, só entre 8h e 22h.'], demo: whatsappDemo },
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
    btns.forEach((b) => {
      const on = b.id === `pm-tab-${t.id}`;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) b.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    });
    body.setAttribute('aria-labelledby', `pm-tab-${t.id}`);
    body.replaceChildren(pane(t.title, t.points, t.plan, t.demo(), t.phone));
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
      el('div', { class: 'pm-hero-top' }, el('strong', {}, 'Outubro'), el('span', { class: 'pill tone-ok' }, `Sobrou ${brl(R(LEFT))}`)),
      donut(CATS, { interactive: true, totalLabel: 'Gastou', label: 'Gastos por categoria', max: 5 }),
      line(dailyPoints(), { interactive: true, xLabel: (p) => `${p.x.slice(8, 10)}/${p.x.slice(5, 7)}`, label: 'Gasto por dia' }));
  }
  const t = document.getElementById('pm-tour-root');
  if (t) tour(t);
  const p = document.getElementById('pm-plans');
  if (p) plans(p);
}
