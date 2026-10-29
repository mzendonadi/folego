// Gráficos do Prumo em SVG e HTML puros (sem biblioteca, sem rede). Cada gráfico tem dois modos:
//   frio (interactive: false): só desenha e lista os valores, sem foco nem toque;
//   interativo (interactive: true): passar o mouse ou focar mostra o valor, tocar/clicar seleciona e avisa quem chamou (onSelect).
// Cores, tamanhos e textos seguem o resto do app; nada aqui busca dado: quem chama passa os números.
import { el } from './dom.js';
import { brl } from './format.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
};

/** Cores das fatias, em ordem. Contraste conferido contra o fundo claro do app; "Outros" e "Outras" ficam sempre no cinza. */
export const PALETTE = ['#0E5B49', '#B8420F', '#2F6F8F', '#B07A00', '#7A5BA6', '#3D8B72', '#8F2A17', '#586761'];
const GRAY = '#8A958F';
export const colorFor = (i, key) => (key === 'outros' || key === '__rest' ? GRAY : PALETTE[i % PALETTE.length]);

const pctText = (v, total) => `${total > 0 ? Math.round((v / total) * 100) : 0}%`;
const short = (cents) => {
  const v = Math.abs(cents) / 100;
  return `${cents < 0 ? '-' : ''}R$ ${v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString('pt-BR')}`;
};

/** Balão que acompanha o ponto tocado (um por gráfico). */
function makeTip(root) {
  const tip = el('div', { class: 'ch-tip', role: 'status', hidden: true });
  root.append(tip);
  return {
    show(text, anchor) {
      tip.textContent = text;
      tip.hidden = false;
      const r = root.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const x = a.left + a.width / 2 - r.left;
      tip.style.left = `${Math.min(Math.max(x, 70), Math.max(70, r.width - 70))}px`;
      tip.style.top = `${a.top - r.top - 8}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/** Agrupa o que passa de `max` fatias em "Outras", para a rosca continuar legível. */
function groupRest(items, max) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (list.length <= max) return list;
  const head = list.slice(0, max - 1);
  const rest = list.slice(max - 1);
  return [...head, { key: '__rest', label: 'Outras', value: rest.reduce((s, i) => s + i.value, 0), rest }];
}

/**
 * Rosca. items: [{ key, label, value }]. Mostra o total no meio e a lista com valor e porcentagem ao lado.
 * Interativo: passar o mouse/focar destaca a fatia e mostra o valor no meio; clicar seleciona (e chama onSelect(key) ou onSelect(null)).
 */
export function donut(items, opts = {}) {
  const fmt = opts.format ?? brl;
  const list = groupRest(items, opts.max ?? 8);
  const total = list.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return el('p', { class: 'muted ch-empty' }, opts.empty ?? 'Sem dados neste período.');
  const root = el('figure', { class: `ch ch-donut${opts.interactive ? ' is-live' : ''}`, 'aria-label': opts.label ?? 'Gráfico de rosca' });
  const R = 70, C = 2 * Math.PI * R;
  const cLabel = svg('text', { x: 100, y: 94, class: 'ch-c-label', 'text-anchor': 'middle' }, opts.totalLabel ?? 'Total');
  const cValue = svg('text', { x: 100, y: 116, class: 'ch-c-value', 'text-anchor': 'middle' }, fmt(total));
  const arcs = [];
  const rows = [];
  let acc = 0;
  let selected = opts.selected ?? null;

  const center = (i) => {
    if (i === null) { cLabel.textContent = opts.totalLabel ?? 'Total'; cValue.textContent = fmt(total); return; }
    const it = list[i];
    cLabel.textContent = it.label.length > 16 ? `${it.label.slice(0, 15)}…` : it.label;
    cValue.textContent = fmt(it.value);
  };
  const paint = (hover) => {
    const focus = hover ?? list.findIndex((x) => x.key === selected);
    const f = focus >= 0 ? focus : null;
    arcs.forEach((a, i) => a.classList.toggle('is-dim', f !== null && i !== f));
    rows.forEach((r, i) => { r.classList.toggle('is-dim', f !== null && i !== f); r.classList.toggle('is-on', list[i].key === selected); });
    center(f);
  };
  const pick = (i) => {
    selected = selected === list[i].key ? null : list[i].key;
    paint(null);
    rows.forEach((r, k) => r.querySelector('button')?.setAttribute('aria-pressed', String(list[k].key === selected)));
    arcs.forEach((a, k) => a.setAttribute('aria-pressed', String(list[k].key === selected)));
    opts.onSelect?.(selected === '__rest' ? null : selected);
  };

  list.forEach((it, i) => {
    const len = (it.value / total) * C;
    const dash = Math.max(len - (list.length > 1 ? 2 : 0), 0.5);
    const a = svg('circle', {
      cx: 100, cy: 100, r: R, fill: 'none', stroke: colorFor(i, it.key), 'stroke-width': 26, class: 'ch-arc',
      'stroke-dasharray': `${dash} ${C - dash}`, 'stroke-dashoffset': -acc, transform: 'rotate(-90 100 100)',
    });
    acc += len;
    if (opts.interactive) {
      a.setAttribute('tabindex', '0');
      a.setAttribute('role', 'button');
      a.setAttribute('aria-pressed', String(it.key === selected));
      a.setAttribute('aria-label', `${it.label}: ${fmt(it.value)}, ${pctText(it.value, total)}`);
      a.addEventListener('pointerenter', () => paint(i));
      a.addEventListener('pointerleave', () => paint(null));
      a.addEventListener('focus', () => paint(i));
      a.addEventListener('blur', () => paint(null));
      a.addEventListener('click', () => pick(i));
      a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } });
    }
    arcs.push(a);
  });
  const graphic = svg('svg', { viewBox: '0 0 200 200', class: 'ch-svg', role: 'img', 'aria-label': opts.label ?? 'Gráfico de rosca' }, svg('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: 'var(--line)', 'stroke-width': 26 }), ...arcs, cLabel, cValue);

  const legend = el('ul', { class: 'ch-legend' }, ...list.map((it, i) => {
    const body = [el('i', { class: 'ch-dot', style: `background:${colorFor(i, it.key)}` }), el('span', { class: 'ch-l-name' }, it.label), el('span', { class: 'ch-l-pct muted' }, pctText(it.value, total)), el('strong', { class: 'ch-l-val' }, fmt(it.value))];
    const li = el('li', {});
    if (opts.interactive) {
      const b = el('button', { class: 'ch-l-row', type: 'button', 'aria-pressed': String(it.key === selected) }, ...body);
      b.addEventListener('pointerenter', () => paint(i));
      b.addEventListener('pointerleave', () => paint(null));
      b.addEventListener('focus', () => paint(i));
      b.addEventListener('blur', () => paint(null));
      b.addEventListener('click', () => pick(i));
      li.append(b);
    } else li.append(el('div', { class: 'ch-l-row' }, ...body));
    rows.push(li);
    return li;
  }));
  root.append(el('div', { class: 'ch-donut-body' }, graphic, legend));
  paint(null);
  return root;
}

/**
 * Barras agrupadas por período. items: [{ key, label, a, b }]. `a` e `b` são as duas séries (ex.: entrou e saiu).
 * Frio: os valores ficam escritos embaixo de cada barra. Interativo: balão ao passar/focar e seleção ao clicar.
 */
export function bars(items, opts = {}) {
  const fmt = opts.format ?? brl;
  const max = Math.max(...items.flatMap((i) => [i.a ?? 0, i.b ?? 0]), 1);
  if (items.every((i) => !(i.a > 0) && !(i.b > 0))) return el('p', { class: 'muted ch-empty' }, opts.empty ?? 'Sem dados neste período.');
  const root = el('figure', { class: `ch ch-bars${opts.interactive ? ' is-live' : ''}`, 'aria-label': opts.label ?? 'Gráfico de barras' });
  const tip = opts.interactive ? makeTip(root) : null;
  let selected = opts.selected ?? null;
  const cols = items.map((it) => {
    const h = (v) => `${v > 0 ? Math.max(3, Math.round((v / max) * 100)) : 0}%`;
    const group = el('span', { class: 'ch-group' }, el('span', { class: 'ch-bar a', style: `height:${h(it.a ?? 0)}` }), opts.bLabel ? el('span', { class: 'ch-bar b', style: `height:${h(it.b ?? 0)}` }) : null);
    const label = el('span', { class: 'ch-x' }, it.label);
    const vals = !opts.interactive && items.length <= 7 ? el('span', { class: 'ch-vals' }, el('span', { class: 'ch-va' }, short(it.a ?? 0)), opts.bLabel ? el('span', { class: 'ch-vb' }, short(it.b ?? 0)) : null) : null;
    const text = `${it.label}: ${opts.aLabel} ${fmt(it.a ?? 0)}${opts.bLabel ? `, ${opts.bLabel} ${fmt(it.b ?? 0)}` : ''}`;
    if (!opts.interactive) return el('div', { class: 'ch-col' }, group, label, vals);
    const b = el('button', { class: `ch-col${it.key === selected ? ' is-on' : ''}`, type: 'button', 'aria-label': text, 'aria-pressed': String(it.key === selected) }, group, label);
    const on = () => tip.show(text, group);
    b.addEventListener('pointerenter', on);
    b.addEventListener('focus', on);
    b.addEventListener('pointerleave', () => tip.hide());
    b.addEventListener('blur', () => tip.hide());
    b.addEventListener('click', () => {
      selected = selected === it.key ? null : it.key;
      root.querySelectorAll('.ch-col').forEach((c) => c.classList.remove('is-on'));
      if (selected) b.classList.add('is-on');
      opts.onSelect?.(selected);
    });
    return b;
  });
  const keys = el('p', { class: 'ch-keys fine' }, el('span', {}, el('i', { class: 'ch-dot a' }), opts.aLabel), opts.bLabel ? el('span', {}, el('i', { class: 'ch-dot b' }), opts.bLabel) : null);
  root.append(el('div', { class: 'ch-bars-grid', style: `grid-template-columns:repeat(${items.length},minmax(0,1fr))` }, ...cols), keys);
  return root;
}

/**
 * Linha com área (ex.: gasto por dia). points: [{ x: 'AAAA-MM-DD' ou rótulo, y: número }].
 * Interativo: uma linha vertical acompanha o dedo ou o mouse e o balão mostra o dia e o valor.
 */
export function line(points, opts = {}) {
  const fmt = opts.format ?? brl;
  if (points.length < 2 || points.every((p) => !(p.y > 0))) return el('p', { class: 'muted ch-empty' }, opts.empty ?? 'Sem dados neste período.');
  const W = 640, H = 180, L = 8, Rr = 8, T = 16, B = 24;
  const max = Math.max(...points.map((p) => p.y), 1);
  const X = (i) => L + (i / (points.length - 1)) * (W - L - Rr);
  const Y = (v) => T + (1 - v / max) * (H - T - B);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${X(points.length - 1).toFixed(1)} ${H - B} L${L} ${H - B} Z`;
  const root = el('figure', { class: `ch ch-line${opts.interactive ? ' is-live' : ''}`, 'aria-label': opts.label ?? 'Gráfico de linha' });
  const peak = points.reduce((m, p, i) => (p.y > points[m].y ? i : m), 0);
  const xl = opts.xLabel ?? ((p) => p.x);
  const marker = svg('circle', { r: 5, class: 'ch-mark', cx: X(peak), cy: Y(points[peak].y) });
  const rule = svg('line', { class: 'ch-rule', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ch-svg', role: 'img', 'aria-label': opts.label ?? 'Gráfico de linha' },
    svg('line', { class: 'ch-axis', x1: L, x2: W - Rr, y1: H - B, y2: H - B }),
    svg('line', { class: 'ch-grid', x1: L, x2: W - Rr, y1: T, y2: T }),
    svg('text', { x: L, y: T - 4, class: 'ch-t' }, short(max)),
    svg('path', { d: area, class: 'ch-area' }), svg('path', { d, class: 'ch-path' }), rule, marker,
    svg('text', { x: L, y: H - 6, class: 'ch-t' }, xl(points[0])),
    svg('text', { x: W / 2, y: H - 6, class: 'ch-t', 'text-anchor': 'middle' }, xl(points[Math.floor(points.length / 2)])),
    svg('text', { x: W - Rr, y: H - 6, class: 'ch-t', 'text-anchor': 'end' }, xl(points[points.length - 1])));
  root.append(g);
  if (opts.interactive) {
    const tip = makeTip(root);
    const at = (clientX) => {
      const r = g.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const i = Math.min(points.length - 1, Math.max(0, Math.round(((px - L) / (W - L - Rr)) * (points.length - 1))));
      marker.setAttribute('cx', X(i)); marker.setAttribute('cy', Y(points[i].y));
      rule.setAttribute('x1', X(i)); rule.setAttribute('x2', X(i)); rule.setAttribute('visibility', 'visible');
      tip.show(`${xl(points[i])}: ${fmt(points[i].y)}`, marker);
      return i;
    };
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', `${opts.label ?? 'Gráfico de linha'}. Maior valor: ${xl(points[peak])}, ${fmt(points[peak].y)}. Use as setas para percorrer.`);
    let cur = peak;
    g.addEventListener('pointermove', (e) => { cur = at(e.clientX); });
    g.addEventListener('pointerdown', (e) => { cur = at(e.clientX); });
    g.addEventListener('pointerleave', () => { tip.hide(); rule.setAttribute('visibility', 'hidden'); });
    g.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      cur = Math.min(points.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      const r = g.getBoundingClientRect();
      at(r.left + (X(cur) / W) * r.width);
    });
  } else {
    root.append(el('p', { class: 'ch-keys fine' }, `Maior valor: ${xl(points[peak])}, ${fmt(points[peak].y)}.`));
  }
  return root;
}

/**
 * Barras horizontais com valor e (opcional) um marcador de limite. rows: [{ key, label, value, limit, sub, tone }].
 * Cada linha mostra o valor por escrito, então o modo frio já é completo; o interativo só acrescenta destaque e seleção.
 */
export function hbars(rows, opts = {}) {
  const fmt = opts.format ?? brl;
  const list = rows.filter((r) => r.value !== 0 || r.limit);
  if (!list.length) return el('p', { class: 'muted ch-empty' }, opts.empty ?? 'Sem dados.');
  const max = Math.max(...list.flatMap((r) => [Math.abs(r.value), r.limit ?? 0]), 1);
  const root = el('figure', { class: `ch ch-h${opts.interactive ? ' is-live' : ''}`, 'aria-label': opts.label ?? 'Gráfico de barras' });
  let selected = opts.selected ?? null;
  const items = list.map((r, i) => {
    const w = `${Math.max(2, Math.round((Math.abs(r.value) / max) * 100))}%`;
    const over = r.limit != null && r.value > r.limit;
    const neg = over || r.tone === 'neg';
    const track = el('span', { class: 'ch-track' }, el('span', { class: `ch-fill${neg ? ' neg' : ''}`, style: `width:${w};${neg ? '' : `background:${colorFor(i, r.key)}`}` }), r.limit != null ? el('span', { class: 'ch-limit', style: `left:${Math.round((r.limit / max) * 100)}%`, title: `Limite ${fmt(r.limit)}` }) : null);
    const head = el('span', { class: 'ch-h-head' }, el('span', { class: 'ch-h-name' }, r.label), el('strong', { class: neg ? 'neg' : '' }, fmt(r.value), r.limit != null ? el('span', { class: 'muted' }, ` de ${fmt(r.limit)}`) : null));
    const sub = r.sub ? el('span', { class: 'fine muted' }, r.sub) : null;
    if (!opts.interactive) return el('div', { class: 'ch-h-row' }, head, track, sub);
    const b = el('button', { class: 'ch-h-row', type: 'button', 'aria-pressed': String(r.key === selected) }, head, track, sub);
    b.addEventListener('click', () => {
      selected = selected === r.key ? null : r.key;
      root.querySelectorAll('.ch-h-row').forEach((x) => x.classList.remove('is-on'));
      if (selected) b.classList.add('is-on');
      opts.onSelect?.(selected);
    });
    return b;
  });
  root.append(...items);
  return root;
}

/** Cartão de gráfico: título, uma linha de apoio e o conteúdo. */
export function chartCard(title, sub, ...children) {
  return el('section', { class: 'card d-section ch-card' }, el('h2', {}, title), sub ? el('p', { class: 'muted' }, sub) : null, ...children.filter(Boolean));
}
