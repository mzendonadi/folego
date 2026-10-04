// Prumo: "Cobranças" (detector de assinaturas e cobranças recorrentes) e "E se...?" (simulador de cenários do orçamento).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { simulateScenario, SCENARIO_PRESETS, DEFAULT_CHANGE } from '../vendor/engine.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const dateBr = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
const setMoney = (m, cents) => {
  m.input.value = cents ? (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
  m.input.dispatchEvent(new Event('input', { bubbles: true }));
};

// ---------------------------------------------------------------- Cobranças
export function viewCobrancas(ctx) {
  const r = ctx.recurring;
  if (!r.hasData) {
    return card(el('h2', {}, 'Cobranças recorrentes'), el('p', { class: 'muted' }, 'Lance ou importe o extrato dos últimos meses (aba Lançamentos). Quando houver pelo menos duas ou três cobranças do mesmo lugar, mostramos aqui o que se repete, o que subiu de preço e o que foi cobrado em duplicidade.'));
  }
  const alerts = [];
  const up = r.alerts.priceIncreases;
  const dup = r.alerts.duplicates;
  if (up) alerts.push(up === 1 ? '1 cobrança aumentou de preço' : `${up} cobranças aumentaram de preço`);
  if (dup) alerts.push(dup === 1 ? '1 possível cobrança em duplicidade' : `${dup} possíveis cobranças em duplicidade`);
  const summary = el(
    'div', { class: 'ref-stats' },
    el('div', {}, el('strong', {}, String(r.items.length)), el('span', { class: 'fine muted' }, 'cobranças que se repetem')),
    el('div', {}, el('strong', {}, brl(r.monthlyTotalCents)), el('span', { class: 'fine muted' }, 'por mês')),
    el('div', {}, el('strong', {}, brl(r.yearlyTotalCents)), el('span', { class: 'fine muted' }, 'por ano')),
    el('div', {}, el('strong', {}, brl(r.savings.yearlyCents)), el('span', { class: 'fine muted' }, `economia por ano (${r.savings.count} a cancelar)`)),
  );
  const setDecision = async (item, status) => {
    try {
      await ctx.api.setRecurringDecision(item.key, status);
      toast(status === 'cancel' ? 'Marcada para cancelar. Cancele no app ou site de quem cobra.' : status === 'keep' ? 'Combinado: vai ficar.' : 'Marcação removida.');
      ctx.refresh();
    } catch {
      toast('Não consegui salvar agora.');
    }
  };
  const rows = r.items.map((i) => {
    const sel = el('select', { class: 'input input-sm', 'aria-label': `O que fazer com ${i.name}` }, el('option', { value: '' }, 'Decidir…'), el('option', { value: 'keep', selected: i.decision === 'keep' }, 'Mantenho'), el('option', { value: 'cancel', selected: i.decision === 'cancel' }, 'Vou cancelar'));
    sel.addEventListener('change', () => setDecision(i, sel.value || null));
    const flags = [
      i.priceChange ? el('span', { class: 'pill tone-attention' }, `Subiu ${i.priceChange.pct}%: de ${brl(i.priceChange.fromCents)} para ${brl(i.priceChange.toCents)}`) : null,
      i.duplicate ? el('span', { class: 'pill tone-attention' }, `Cobrada 2x em ${dateBr(i.duplicate.date)}: confira`) : null,
    ].filter(Boolean);
    return el(
      'li', { class: `rec-row${i.decision === 'cancel' ? ' is-cancel' : ''}` },
      el('div', { class: 'rec-main' }, el('strong', {}, i.name), el('p', { class: 'fine muted' }, `${i.cadence === 'mensal' ? 'Todo mês' : 'Todo ano'} · última em ${dateBr(i.lastDate)} · próxima por volta de ${dateBr(i.nextExpected)} · ${i.occurrences} cobranças`), flags.length ? el('div', { class: 'rec-flags' }, ...flags) : null),
      el('div', { class: 'rec-money' }, el('strong', {}, brl(i.lastCents)), el('span', { class: 'fine muted' }, i.cadence === 'mensal' ? `${brl(i.yearlyCents)} por ano` : `${brl(i.monthlyCents)} por mês`)),
      sel,
    );
  });
  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Cobranças recorrentes'),
      el('p', { class: 'section-sub' }, 'Achamos nos seus lançamentos o que se repete todo mês ou todo ano. Marque o que vai manter e o que vai cancelar: a economia anual é somada para você.'),
      alerts.length ? el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, `Atenção: ${alerts.join(' e ')}.`)) : null,
      summary,
    ),
    card(el('h2', {}, 'Suas cobranças'), rows.length ? el('ul', { class: 'entries' }, ...rows) : el('p', { class: 'muted' }, 'Não achamos cobranças que se repetem nos seus lançamentos. Importe mais meses de extrato para o detector ter o que comparar.'), el('p', { class: 'fine muted' }, 'A detecção é feita pelo nome do lançamento e pelo intervalo entre as cobranças. Se algo estiver errado, é só ignorar. Cobrança que você não reconhece? Contate o banco ou a empresa e peça a contestação.')),
  );
}

// ---------------------------------------------------------------- E se...?
function chart(result) {
  const NS = 'http://www.w3.org/2000/svg';
  const w = 560;
  const h = 200;
  const pad = 8;
  const pts = result.timeline;
  const vals = pts.flatMap((p) => [p.before, p.after, 0]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const path = (key) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'scn-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Saldo acumulado ao longo dos meses: situação atual e com a mudança');
  const line = (d, color, width2, dash) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', String(width2));
    if (dash) p.setAttribute('stroke-dasharray', dash);
    svg.append(p);
  };
  const zero = document.createElementNS(NS, 'line');
  zero.setAttribute('x1', String(pad));
  zero.setAttribute('x2', String(w - pad));
  zero.setAttribute('y1', String(y(0)));
  zero.setAttribute('y2', String(y(0)));
  zero.setAttribute('stroke', 'currentColor');
  zero.setAttribute('stroke-opacity', '0.25');
  svg.append(zero);
  line(path('before'), '#8a948f', 2, '5 4');
  line(path('after'), 'var(--primary, #0b4a3a)', 3, null);
  return svg;
}

export function viewCenarios(ctx) {
  const base = ctx.scenarioBase.base;
  const hasBase = base.incomeCents > 0 || base.essentialCents > 0;
  const f = {
    income: moneyInput({ id: 'sc-renda', ariaLabel: 'Nova renda mensal', placeholder: 'sem mudança' }),
    ess: moneyInput({ id: 'sc-ess', ariaLabel: 'Variação dos gastos essenciais', placeholder: '0,00' }),
    flex: moneyInput({ id: 'sc-flex', ariaLabel: 'Variação dos gastos variáveis', placeholder: '0,00' }),
    debt: moneyInput({ id: 'sc-div', ariaLabel: 'Extra por mês para dívidas', placeholder: '0,00' }),
    once: moneyInput({ id: 'sc-uma', ariaLabel: 'Custo único no primeiro mês', placeholder: '0,00' }),
  };
  const sign = (id, label) => el('select', { class: 'input input-sm', id, 'aria-label': label }, el('option', { value: '1' }, 'Aumenta'), el('option', { value: '-1' }, 'Reduz'));
  const essSign = sign('sc-ess-s', 'Gastos essenciais aumentam ou reduzem');
  const flexSign = sign('sc-flex-s', 'Gastos variáveis aumentam ou reduzem');
  const gap = el('input', { class: 'input input-sm', id: 'sc-gap', type: 'number', min: '0', max: '24', value: '0', 'aria-label': 'Meses sem renda na transição' });
  const horizon = el('select', { class: 'input input-sm', id: 'sc-hor', 'aria-label': 'Horizonte da projeção' }, ...[12, 24, 36, 60].map((m) => el('option', { value: String(m), selected: m === 24 }, `${m} meses`)));
  const out = el('div', { class: 'scn-out', 'aria-live': 'polite' });

  const read = () => ({
    ...DEFAULT_CHANGE,
    newIncomeCents: f.income.cents() || null,
    essentialDeltaCents: (f.ess.cents() || 0) * Number(essSign.value),
    flexibleDeltaCents: (f.flex.cents() || 0) * Number(flexSign.value),
    extraDebtCents: f.debt.cents() || 0,
    oneTimeCostCents: f.once.cents() || 0,
    gapMonths: Number(gap.value) || 0,
    months: Number(horizon.value),
  });
  const render = () => {
    const r = simulateScenario(base, read());
    const tone = r.verdict === 'melhora' ? 'tone-ok' : r.verdict === 'piora' ? 'tone-attention' : '';
    const verdict = { melhora: 'Esse cenário melhora o seu mês', piora: 'Esse cenário piora o seu mês', igual: 'Esse cenário não muda o seu mês' }[r.verdict];
    const money = (c) => (c < 0 ? `-${brl(-c)}` : brl(c));
    out.replaceChildren(
      el('p', { class: `scn-verdict ${tone}` }, el('strong', {}, verdict), r.deltaMonthlyCents !== 0 ? ` · ${r.deltaMonthlyCents > 0 ? '+' : ''}${money(r.deltaMonthlyCents)} por mês (${money(r.deltaYearlyCents)} no primeiro ano)` : ''),
      el('div', { class: 'ref-stats' },
        el('div', {}, el('strong', {}, money(r.beforeMonthlyCents)), el('span', { class: 'fine muted' }, 'sobra por mês hoje')),
        el('div', {}, el('strong', {}, money(r.afterMonthlyCents)), el('span', { class: 'fine muted' }, 'sobra por mês no cenário')),
        el('div', {}, el('strong', {}, money(r.lowestAfterCents)), el('span', { class: 'fine muted' }, 'saldo mais baixo na transição')),
        el('div', {}, el('strong', {}, r.breakEvenMonth ? `mês ${r.breakEvenMonth}` : '—'), el('span', { class: 'fine muted' }, 'quando passa o cenário atual')),
      ),
      chart(r),
      el('p', { class: 'fine muted scn-legend' }, el('span', { class: 'scn-key scn-key-now' }), ' situação atual   ', el('span', { class: 'scn-key scn-key-new' }), ' com a mudança  ·  saldo acumulado (reserva + sobras)'),
      ...r.warnings.map((w) => el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, w))),
    );
  };
  const apply = (c) => {
    setMoney(f.income, c.newIncomeCents ?? 0);
    essSign.value = c.essentialDeltaCents < 0 ? '-1' : '1';
    setMoney(f.ess, c.essentialDeltaCents);
    flexSign.value = c.flexibleDeltaCents < 0 ? '-1' : '1';
    setMoney(f.flex, c.flexibleDeltaCents);
    setMoney(f.debt, c.extraDebtCents);
    setMoney(f.once, c.oneTimeCostCents);
    gap.value = String(c.gapMonths);
    render();
  };
  const presets = el('div', { class: 'button-row no-print' }, ...SCENARIO_PRESETS.map((p) => {
    const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: p.hint }, p.title);
    b.addEventListener('click', () => apply(p.build(base)));
    return b;
  }));
  const form = el(
    'form', { class: 'entry-form scn-form' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-renda' }, 'Nova renda mensal (R$)'), f.income.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-ess-s' }, 'Gastos essenciais'), el('div', { class: 'scn-pair' }, essSign, f.ess.input)),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-flex-s' }, 'Gastos variáveis'), el('div', { class: 'scn-pair' }, flexSign, f.flex.input)),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-div' }, 'Extra por mês nas dívidas (R$)'), f.debt.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-uma' }, 'Custo único no 1º mês (R$)'), f.once.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-gap' }, 'Meses sem renda na transição'), gap),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sc-hor' }, 'Projetar por'), horizon),
  );
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (e) => e.preventDefault());
  render();
  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'E se...?'),
      el('p', { class: 'section-sub' }, 'Teste uma mudança na sua vida antes de fazer: o app parte da média dos seus últimos meses e mostra o efeito no mês e no saldo.'),
      hasBase ? null : el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Ainda não há lançamentos suficientes: lance ou importe seus últimos meses para o simulador partir da sua realidade.')),
      el('dl', { class: 'scn-base' },
        ...[['Renda', base.incomeCents], ['Essencial', base.essentialCents], ['Variável', base.flexibleCents], ['Parcelas de dívida', base.debtPaymentsCents], ['Reserva guardada', base.reserveCents]].map(([k, v]) => el('div', { class: 'scn-tile' }, el('dt', {}, k), el('dd', {}, brl(v))))),
      el('p', { class: 'fine muted' }, 'Ponto de partida: média mensal dos seus lançamentos recentes, parcelas mínimas cadastradas em Dívidas e o que você guardou em metas e carteiras de poupança.'),
    ),
    card(el('h2', {}, 'Comece por um modelo'), presets, form),
    card(el('h2', {}, 'O resultado'), out, el('p', { class: 'fine muted' }, 'Simulação educativa com os seus números e as suas hipóteses. Não é previsão nem recomendação financeira.')),
  );
}
