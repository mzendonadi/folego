// Telas de resultado: preview (grátis) e entrega (Mapa completo, pós-pagamento).
import { $, el, icon, prefersReducedMotion } from './dom.js';
import { brl, brlWhole, formatMonths, plural } from './format.js';
import {
  BAND, KIND_LABEL, LOCKED_LABELS, headlineCopy, firstPriorityReason, prescriptionTeaser, confidenceNote, tierReason,
} from './copy.js';
import { scriptsSection, lettersSection } from './generated.js';
import { accessSection, addonsSection, calendarSection } from './extras.js';
import { incomeSection } from './income.js';
import { strategiesSection } from './strategies.js';
import { kindText } from './copy.js';
import { leadsSection } from './leads.js';
import { referralCard } from './referral.js';
import { CATALOG, priceLabel, daysOf } from './catalog.js';
import { accessBanner } from './access-banner.js';

// ---------- componentes ----------
export function gauge(score, band, { small = false } = {}) {
  const tone = BAND[band].tone;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 70');
  svg.setAttribute('class', `gauge${small ? ' gauge-sm' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Nota ${score} de 100, faixa ${BAND[band].label.toLowerCase()}`);
  const arc = 'M10 62 A50 50 0 0 1 110 62';
  const track = document.createElementNS(ns, 'path');
  track.setAttribute('d', arc);
  track.setAttribute('pathLength', '100');
  track.setAttribute('class', 'gauge-track');
  const value = document.createElementNS(ns, 'path');
  value.setAttribute('d', arc);
  value.setAttribute('pathLength', '100');
  value.setAttribute('class', `gauge-value tone-${tone}`);
  value.setAttribute('stroke-dasharray', prefersReducedMotion() ? `${score} 100` : '0 100');
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', '60');
  text.setAttribute('y', '52');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', 'gauge-num');
  text.textContent = String(score);
  svg.append(track, value, text);
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => requestAnimationFrame(() => value.setAttribute('stroke-dasharray', `${score} 100`)));
  }
  return svg;
}

const pill = (band) => el('span', { class: `pill tone-${BAND[band].tone}` }, BAND[band].label);

function tickList(items) {
  return el('ul', { class: 'tick-list' }, ...items.map((t) => el('li', {}, icon('check'), t)));
}

// ---------- PREVIEW ----------
/** Cartão "tem mais no seu diagnóstico": só sinais e contagens do preview (nunca o conteúdo pago). */
function discoveryCard(preview) {
  const dsc = preview.discoveries ?? { moreInQueue: 0, negotiable: 0, essentialOverdue: false };
  const found = [];
  if (dsc.moreInQueue > 0) found.push(`A ordem das outras ${dsc.moreInQueue} ${plural(dsc.moreInQueue, 'dívida', 'dívidas')} da fila, com o motivo de cada uma`);
  if (dsc.negotiable > 0) found.push(`${dsc.negotiable} ${plural(dsc.negotiable, 'dívida em atraso', 'dívidas em atraso')} onde vale pedir desconto, com quanto oferecer`);
  if (dsc.essentialOverdue) found.push('Como proteger primeiro a conta essencial em atraso (moradia ou serviço)');
  if (preview.prescriptionTeaser.possibleCount > 0) found.push('O que conferir sobre a dívida que pode estar prescrita, antes de pagar qualquer coisa');
  found.push('Seu orçamento do mês e quanto dá pra separar para quitar');
  found.push('Roteiros prontos para cada conversa com o credor');
  return el(
    'section',
    { class: 'card discover', 'aria-labelledby': 'discover-title' },
    el('p', { class: 'card-eyebrow' }, 'Próximo passo'),
    el('h2', { id: 'discover-title' }, 'E tem mais no seu diagnóstico'),
    el('p', { class: 'muted' }, 'Você viu só por onde começar. O Mapa completo mostra o resto do caminho:'),
    el('ul', { class: 'discover-list' }, ...found.map((t) => el('li', {}, icon('lock', 'icon icon-lock'), t))),
    el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', 'data-buy': '' }, `Liberar meu Mapa · ${priceLabel('recovery_map')} no Pix`, icon('arrow-right')),
    el('p', { class: 'fine center' }, 'Você só paga porque já viu o que tem aqui. Não gostou? É só fechar a página.'),
  );
}


export function renderPreview(root, preview, { onBuy, onWipe }) {
  const band = preview.health.band;
  const head = headlineCopy(preview);
  const conf = confidenceNote(preview.confidence);

  const main = el('div', { class: 'preview-main' });

  main.append(
    el(
      'section',
      { class: 'card score-card', 'aria-labelledby': 'score-title' },
      el('h2', { class: 'card-eyebrow', id: 'score-title' }, 'Como está sua situação'),
      el('div', { class: 'score-body' }, gauge(preview.health.score, band), el('div', {}, pill(band), el('p', { class: 'score-text' }, BAND[band].text))),
    ),
    el(
      'section',
      { class: 'card headline-card', 'aria-labelledby': 'headline-title' },
      el('h2', { class: 'card-eyebrow', id: 'headline-title' }, 'O que dá pra fazer'),
      el('p', { class: 'headline' }, head.title),
      el('p', { class: 'muted' }, head.note),
    ),
  );

  if (preview.firstPriority) {
    const f = preview.firstPriority;
    main.append(
      el(
        'section',
        { class: 'card first-card', 'aria-labelledby': 'first-title' },
        el('h2', { class: 'card-eyebrow', id: 'first-title' }, 'Comece por aqui'),
        el('p', { class: 'first-name' }, f.creditorName),
        el('p', { class: 'muted' }, `${KIND_LABEL[f.kind] ?? f.kind} · ${brl(f.balanceCents)}`),
        el('p', {}, firstPriorityReason(f.tier)),
      ),
    );
  }

  main.append(discoveryCard(preview));

  if (preview.prescriptionTeaser.possibleCount > 0) {
    main.append(
      el(
        'section',
        { class: 'card notice notice-amber', role: 'note' },
        icon('alert'),
        el('div', {}, el('h2', { class: 'notice-title' }, 'Atenção com dívida antiga'), el('p', {}, prescriptionTeaser(preview.prescriptionTeaser.possibleCount))),
      ),
    );
  }

  if (conf) {
    main.append(el('p', { class: 'note' }, icon('info'), el('span', {}, conf)));
  }

  const lockedItems = preview.lockedSections.filter((id) => LOCKED_LABELS[id]).map((id) => LOCKED_LABELS[id]);
  main.append(
    el(
      'section',
      { class: 'card locked-card', 'aria-labelledby': 'locked-title' },
      el('h2', { id: 'locked-title' }, 'O que vem no Mapa completo'),
      el(
        'ul',
        { class: 'locked-list' },
        ...lockedItems.map(([title, desc]) =>
          el('li', {}, icon('lock', 'icon icon-lock'), el('div', {}, el('strong', {}, title), el('span', { class: 'muted' }, desc), el('span', { class: 'skeleton', 'aria-hidden': 'true' }, el('i', { class: 'bar w80' }), el('i', { class: 'bar w55' })))),
        ),
      ),
    ),
    el('p', { class: 'fine' }, 'Estimativas educativas, calculadas com o que você informou. Não substituem advogado nem consultor financeiro.'),
  );

  const buy = (label = `Liberar meu Mapa · ${priceLabel('recovery_map')} no Pix`) => el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', 'data-buy': '' }, label, icon('arrow-right'));

  const decision = el(
    'aside',
    { class: 'card decision', 'aria-labelledby': 'decision-title' },
    el('p', { class: 'card-eyebrow' }, 'Quer o Mapa completo?'),
    el('h2', { id: 'decision-title' }, 'Mapa da Virada'),
    el('p', { class: 'price price-sm' }, el('span', { class: 'price-cur' }, 'R$'), ` ${Math.floor(CATALOG.recovery_map.cents / 100)}`, el('span', { class: 'price-cents' }, `,${String(CATALOG.recovery_map.cents % 100).padStart(2, '0')}`)),
    el('p', { class: 'muted' }, 'no Pix, uma vez só. Você só paga porque viu o que está acima.'),
    tickList(['Ordem completa de pagamento', 'Orçamento do mês e linha do tempo', 'Roteiros de negociação por credor', `PDF para guardar · ${daysOf('recovery_map')} dias de acesso e direito de refazer com dados novos`]),
    buy(),
    el('p', { class: 'fine' }, 'Não gostou? Sem problema: é só fechar a página. Nada é cobrado.'),
    el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'data-wipe': '' }, icon('trash'), 'Apagar meus dados agora'),
  );

  const bar = el(
    'div',
    { class: 'buy-bar' },
    el('div', {}, el('strong', {}, brl(CATALOG.recovery_map.cents)), el('span', { class: 'muted' }, 'no Pix · uma vez só')),
    el('button', { class: 'btn btn-primary', type: 'button', 'data-buy': '' }, 'Liberar Mapa', icon('arrow-right')),
  );

  root.replaceChildren(main, decision, bar);
  root.onclick = (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b) return;
    if (b.hasAttribute('data-buy')) onBuy();
    if (b.hasAttribute('data-wipe')) onWipe();
  };
}

// ---------- ENTREGA ----------
const RATE_SOURCE = {
  declared: 'juros informados por você',
  implied: 'juros calculados a partir da sua parcela',
  default: 'juros estimados (média de mercado)',
};

function bpsToText(bps) {
  return `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% ao mês`;
}

function section(id, title, ...children) {
  return el('section', { class: 'card d-section', id, 'aria-labelledby': `${id}-t` }, el('h2', { id: `${id}-t` }, title), ...children);
}

export function renderDelivery(root, { input, diagnosis: d, items, generated, extras = {}, strategies = null, accessUntil, lettersEligible = 0, leads = null }, { onLead = async () => {}, onLeadRevoke = async () => {}, onInviteFriend = null, onWipe, onAddon = () => {}, makeLink = async () => '', sendEmail = null, onIncomeInterview = async () => {}, onIncomeTask = async () => {}, onRedo = null }) {
  const debtById = new Map(input.debts.map((x) => [x.id, x]));
  const diagById = new Map(d.debts.map((x) => [x.debtId, x]));
  const band = d.health.band;
  const totalOwed = input.debts.reduce((s, x) => s + x.balanceCents, 0);
  const has = (w) => d.warnings.some((x) => x.code === w);

  const header = el(
    'header',
    { class: 'd-head' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'Seu Mapa da Virada'), el('h1', { id: 'delivery-title', tabindex: '-1' }, 'Aqui está o seu roteiro'), el('p', { class: 'section-sub' }, 'Feito com os números que você contou. Mudou alguma coisa? Refaça com os dados novos quando quiser, dentro do prazo.')),
    el(
      'div',
      { class: 'd-actions no-print' },
      el('button', { class: 'btn btn-secondary', type: 'button', 'data-print': '' }, icon('printer'), 'Salvar em PDF'),
      el('button', { class: 'btn btn-quiet', type: 'button', 'data-wipe': '' }, icon('trash'), 'Apagar meus dados'),
    ),
  );

  const nav = el(
    'nav',
    { class: 'd-nav no-print', 'aria-label': 'Seções do Mapa' },
    ...[['resumo', 'Resumo'], ['ordem', 'Ordem'], ['orcamento', 'Orçamento'], ['linha', 'Linha do tempo'], ...(strategies ? [['estrategias', 'Estratégias']] : []), ['roteiros', 'Roteiros'], ...(items.includes('defense_letters') ? [['cartas', 'Cartas']] : []), ...(extras.calendar ? [['calendario', 'Calendário']] : []), ...(generated.income ? [['renda', 'Renda extra']] : []), ['dinheiro', 'Dinheiro esquecido']].map(([id, label]) => el('a', { href: `#${id}`, 'data-anchor': id }, label)),
  );

  // Resumo
  const stats = [
    ['Total que você deve', brl(totalOwed)],
    ['Parcelas por mês', brl(d.budget.declaredPaymentsCents)],
    [d.budget.deficit ? 'Falta por mês' : 'Sobra por mês', brl(d.budget.deficit ? d.budget.gapCents : d.budget.surplusCents)],
    ['Quitar tudo em', d.plan.months === null ? 'não quita nesse ritmo' : formatMonths(d.plan.months)],
  ];
  const resumo = section(
    'resumo', 'Resumo',
    el('div', { class: 'score-body' }, gauge(d.health.score, band), el('div', {}, pill(band), el('p', { class: 'score-text' }, BAND[band].text))),
    el('p', { class: 'headline' }, headlineCopy({ headline: d.headline, prescriptionTeaser: { possibleCount: d.heldAsideIds.length } }).title),
    el('dl', { class: 'stats' }, ...stats.map(([k, v]) => el('div', { class: 'stat' }, el('dt', {}, k), el('dd', {}, v)))),
    has('payment_below_interest') ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Em alguma dívida a parcela de hoje é menor que os juros do mês: do jeito que está, ela só cresce. Negociar a taxa, o prazo ou o desconto vem antes de qualquer outra coisa.')) : null,
    has('plan_very_long') ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Mesmo seguindo o plano, a quitação passa de 10 anos. Esse prazo é só uma conta teórica: para ficar livre de verdade é preciso renegociar ou aumentar o que sobra para as dívidas.')) : null,
    has('baseline_never_pays_off') ? el('p', { class: 'note' }, icon('info'), el('span', {}, 'Do jeito que está hoje, algumas dívidas não acabam: a parcela não cobre nem os juros. Por isso a ordem abaixo importa.')) : null,
    has('deficit') ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Suas despesas e parcelas passam da renda. Antes de acelerar dívidas, o primeiro passo é fechar essa conta: renegociar parcelas, cortar o que dá ou aumentar a renda.')) : null,
    has('rates_estimated') ? el('p', { class: 'note' }, icon('info'), el('span', {}, 'Em algumas dívidas usamos taxas médias de mercado. Se você conferir a taxa real no contrato ou na fatura, o resultado fica mais preciso.')) : null,
  );

  // Ordem de pagamento
  const orderItems = d.order.map((id, i) => {
    const debt = debtById.get(id);
    const dg = diagById.get(id);
    return el(
      'li', { class: 'order-item' },
      el('span', { class: 'rank', 'aria-hidden': 'true' }, String(i + 1)),
      el(
        'div', { class: 'order-body' },
        el('p', { class: 'order-name' }, el('strong', {}, debt.creditorName), ' ', el('span', { class: 'muted' }, `· ${kindText(debt)}`)),
        el('p', { class: 'muted' }, `${brl(debt.balanceCents)} · ${bpsToText(dg.rateBps)} (${RATE_SOURCE[dg.rateSource]})`),
        el('p', {}, tierReason(dg.tier), dg.payoffMonth !== null ? ` Quita em cerca de ${formatMonths(dg.payoffMonth)}.` : ''),
        dg.prescription.status === 'approaching' ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Perto de completar o prazo de prescrição. Confira antes de negociar.')) : null,
      ),
    );
  });
  const ordem = section(
    'ordem', 'Ordem de pagamento',
    el('p', { class: 'section-sub' }, 'Contas essenciais em atraso vêm primeiro. Depois, as dívidas com juros mais altos: é onde cada real economiza mais.'),
    d.order.length > 0 ? el('ol', { class: 'order-list' }, ...orderItems) : el('p', {}, 'Nenhuma dívida entrou na fila de pagamento.'),
    d.heldAsideIds.length > 0
      ? el(
          'div', { class: 'notice notice-amber' }, icon('alert'),
          el(
            'div', {},
            el('h3', { class: 'notice-title' }, 'Confira antes de pagar'),
            el('p', {}, 'Estas dívidas podem estar prescritas, por isso ficaram fora da conta:'),
            el('ul', {}, ...d.heldAsideIds.map((id) => el('li', {}, `${debtById.get(id).creditorName} (${brl(debtById.get(id).balanceCents)})`))),
            el('p', {}, 'Cuidado: negociar, pagar uma parte ou reconhecer a dívida pode reiniciar o prazo. Antes de qualquer contato com o credor, confirme com um advogado ou com a Defensoria Pública.'),
          ),
        )
      : null,
  );

  // Orçamento
  const b = d.budget;
  const reserve = Math.max(0, b.surplusCents - b.extraToDebtCents);
  const segs = [
    ['Despesas fixas', b.fixedExpensesCents, 'seg-a'],
    ['Parcelas das dívidas', b.declaredPaymentsCents, 'seg-b'],
    ['Extra para quitar', b.extraToDebtCents, 'seg-c'],
    ['Reserva', reserve, 'seg-d'],
  ];
  const sumSegs = segs.reduce((s, x) => s + x[1], 0) || 1;
  const orcamento = section(
    'orcamento', 'Seu orçamento do mês',
    el('p', { class: 'section-sub' }, `Renda de ${brl(b.netIncomeCents)} por mês, dividida assim:`),
    el('div', { class: 'budget-bar', role: 'img', 'aria-label': segs.map(([n, v]) => `${n}: ${brl(v)}`).join('; ') }, ...segs.filter((x) => x[1] > 0).map(([n, v, c]) => el('span', { class: c, style: `flex:${v / sumSegs}` }))),
    el('ul', { class: 'legend' }, ...segs.map(([n, v, c]) => el('li', {}, el('i', { class: `dot ${c}`, 'aria-hidden': 'true' }), el('span', {}, n), el('strong', {}, brl(v))))),
    b.deficit
      ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, `Faltam ${brl(b.gapCents)} por mês. Sem folga, não sobra nada para acelerar dívidas.`))
      : el('p', { class: 'muted' }, `Direcionamos ${brl(b.extraToDebtCents)} extra por mês para as dívidas e deixamos ${brl(reserve)} de reserva pra imprevistos.`),
  );

  // Linha do tempo
  const timelineRows = d.order.filter((id) => diagById.get(id).payoffMonth !== null);
  const maxMonths = Math.max(1, ...timelineRows.map((id) => diagById.get(id).payoffMonth));
  const linha = section(
    'linha', 'Quando cada dívida acaba',
    timelineRows.length > 0
      ? el('ul', { class: 'gantt' }, ...timelineRows.map((id) => {
          const m = diagById.get(id).payoffMonth;
          return el('li', {}, el('span', { class: 'gantt-name' }, debtById.get(id).creditorName), el('span', { class: 'gantt-track', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(4, (m / maxMonths) * 100)}%` })), el('span', { class: 'gantt-val' }, formatMonths(m)));
        }))
      : el('p', {}, 'Com o que sobra hoje, não dá pra quitar essas dívidas dentro do horizonte calculado. O primeiro passo é abrir espaço no orçamento.'),
  );

  // Roteiros e cartas (em preparação: nesta demonstração a IA ainda não escreve)
  const roteiros = scriptsSection(generated);
  const cartas = items.includes('defense_letters') ? lettersSection(generated) : null;

  // Dinheiro esquecido: o roteiro completo é um guia sob medida (pago); aqui fica só o convite e o alerta de golpe.
  const forgotten = CATALOG.guide_forgotten;
  const dinheiro = section(
    'dinheiro', 'Dinheiro esquecido',
    el('p', { class: 'section-sub' }, 'Antes de quitar dívida, vale conferir se existe dinheiro seu parado em bancos, FGTS, PIS/Pasep ou imposto. O guia monta o roteiro de onde procurar para o seu caso, com o passo a passo de cada fonte oficial.'),
    forgotten?.active
      ? el('div', { class: 'd-actions no-print' }, el('a', { class: 'btn btn-primary', href: '/guia/forgotten' }, 'Ver o guia (prévia grátis)', icon('arrow-right')), el('span', { class: 'fine' }, `${priceLabel('guide_forgotten')} por Pix, só se você gostar da prévia.`))
      : null,
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Ninguém pode cobrar para “liberar” seu dinheiro. Use só sites e aplicativos oficiais (.gov.br) e desconfie de mensagens que pedem pagamento.')),
  );

  const estrategias = strategiesSection(strategies);
  const acesso = accessSection(makeLink, accessUntil, sendEmail);
  const calendario = extras.calendar ? calendarSection(extras.calendar) : null;
  const renda = generated.income ? incomeSection(generated.income, { onSubmitInterview: onIncomeInterview, onToggleTask: onIncomeTask }) : null;
  const complementos = addonsSection(items, { lettersEligible }, onAddon);
  const propostas = leadsSection(leads, { onSubmit: onLead, onRevoke: onLeadRevoke });
  const indicar = onInviteFriend ? referralCard({ onInvite: onInviteFriend }) : null;

  // replaceChildren() é API nativa: diferente do nosso el(), ela NÃO ignora null/undefined — transforma em texto "null" na tela. Por isso filtramos aqui.
  root.replaceChildren(
    ...[
      header, accessBanner({ accessUntil, what: 'Mapa', onRedo }), acesso, nav, resumo, ordem, orcamento, linha, estrategias, roteiros, cartas, calendario, renda, complementos, propostas, indicar, dinheiro,
      el('p', { class: 'fine' }, 'Estimativas educativas, calculadas com o que você informou. O Fôlego não é escritório de advocacia, banco ou consultoria de investimentos, e não negocia por você.'),
    ].filter(Boolean),
  );

  root.onclick = (e) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn) return;
    if (btn.hasAttribute('data-print')) window.print();
    if (btn.hasAttribute('data-wipe')) onWipe();
  };
}
