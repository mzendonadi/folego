// Visão geral mais visual: ritmo do mês (esta linha contra a do mês passado), mapa de calor dos gastos por dia e o maior gasto.
// Tudo vem do campo `pace` que o servidor calcula; aqui só se desenha, em SVG e HTML, com texto equivalente para leitor de tela.
import { el } from './dom.js';
import { brl } from './format.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function paceChart(p) {
  const W = 320;
  const H = 120;
  const pad = { l: 6, r: 6, t: 8, b: 18 };
  const n = p.daysInMonth;
  const prev = p.previousCumulative;
  const top = Math.max(p.cumulative[p.cumulative.length - 1] ?? 0, prev[prev.length - 1] ?? 0, p.projectionCents ?? 0, 1);
  const x = (day) => pad.l + ((day - 1) / Math.max(n - 1, 1)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const line = (vals) => vals.map((v, i) => `${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pace-chart', role: 'img', 'aria-label': `Gasto acumulado no mês: ${brl(p.spentSoFarCents)} até o dia ${p.daysCounted}${p.previousSameDayCents ? `, contra ${brl(p.previousSameDayCents)} no mês anterior` : ''}.` });
  root.append(svg('line', { x1: pad.l, y1: H - pad.b, x2: W - pad.r, y2: H - pad.b, class: 'pace-axis' }));
  if (prev.length > 1) root.append(svg('polyline', { points: line(prev), class: 'pace-prev', fill: 'none' }));
  if (p.cumulative.length > 0) {
    root.append(svg('polyline', { points: line(p.cumulative), class: 'pace-now', fill: 'none' }));
    const last = p.cumulative.length;
    root.append(svg('circle', { cx: x(last).toFixed(1), cy: y(p.cumulative[last - 1]).toFixed(1), r: 3.5, class: 'pace-dot' }));
  }
  const label = (day, anchor) => { const t = svg('text', { x: x(day).toFixed(1), y: H - 4, class: 'pace-label', 'text-anchor': anchor }); t.textContent = `dia ${day}`; return t; };
  root.append(label(1, 'start'), label(n, 'end'));
  return root;
}

function heatmap(p, month) {
  const max = Math.max(...p.spendByDay, 1);
  const level = (v) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  const first = new Date(`${month}-01T12:00:00`).getDay(); // 0 = domingo
  const cells = [];
  for (let i = 0; i < first; i += 1) cells.push(el('span', { class: 'hm-cell hm-blank', 'aria-hidden': 'true' }));
  p.spendByDay.forEach((v, i) => {
    const day = i + 1;
    const future = day > p.daysCounted;
    const text = future ? `dia ${day}` : `dia ${day}: ${v > 0 ? brl(v) : 'sem gastos'}`;
    cells.push(el('span', { class: `hm-cell hm-${future ? 'future' : level(v)}`, title: text, 'aria-label': text, role: 'img' }, String(day)));
  });
  return el('div', { class: 'heatmap', role: 'group', 'aria-label': 'Mapa de calor dos gastos por dia do mês' },
    ...['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => el('span', { class: 'hm-head', 'aria-hidden': 'true' }, d)),
    ...cells);
}

/** Cartão "Ritmo do mês". Devolve null se não há gasto nenhum para mostrar. */
export function paceCard(ctx) {
  const p = ctx.data?.pace;
  if (!p || (p.spentSoFarCents === 0 && p.previousSameDayCents === 0)) return null;
  const parts = [`Até o dia ${p.daysCounted} você gastou ${brl(p.spentSoFarCents)}.`];
  if (p.diffPct !== null) parts.push(`No mês passado, até aqui, eram ${brl(p.previousSameDayCents)} (${p.diffPct === 0 ? 'igual' : `${Math.abs(p.diffPct)}% ${p.diffPct > 0 ? 'a mais' : 'a menos'}`}).`);
  const sub = [];
  if (p.projectionCents !== null) sub.push(`No ritmo atual, o mês fecha em ${brl(p.projectionCents)}.`);
  if (p.biggest) sub.push(`Maior gasto: ${p.biggest.note}, ${brl(-p.biggest.amountCents)} (dia ${Number(p.biggest.date.slice(8, 10))}).`);
  return el('section', { class: 'card d-section pace-card' },
    el('h2', {}, 'Ritmo do mês'),
    el('p', {}, parts.join(' ')),
    paceChart(p),
    el('p', { class: 'fine pace-legend' }, el('span', { class: 'pace-key pace-key-now' }), ' este mês  ', el('span', { class: 'pace-key pace-key-prev' }), ' mês passado'),
    sub.length ? el('p', { class: 'muted' }, sub.join(' ')) : null,
    el('h3', {}, 'Dia a dia'),
    heatmap(p, ctx.month),
    el('p', { class: 'fine muted' }, 'Quanto mais escuro, mais você gastou naquele dia.'),
  );
}
