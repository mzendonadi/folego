// Componentes do backoffice: cartões, indicadores, tabelas, barras, abas, gaveta lateral e formatação.
// Só usa el() (nunca innerHTML), para que nenhum texto vindo do banco vire HTML.
import { el, icon, toast } from '../dom.js';
import { brl } from '../format.js';

export { el, icon, toast, brl };

// ---------- formatação ----------
export const int = (n) => Number(n ?? 0).toLocaleString('pt-BR');
export const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const day = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
export const shortId = (id) => String(id ?? '').slice(0, 8);
export const duration = (s) => {
  if (s === null || s === undefined) return '—';
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} dias`;
};

// ---------- rótulos ----------
export const EMPLOYMENT = { clt: 'CLT', public_servant: 'Servidor público', inss_retiree: 'Aposentado/pensionista INSS', self_employed: 'Autônomo', other: 'Outro' };
export const PRODUCT = { recovery_map: 'Mapa da Virada', defense_letters: 'Kit de Cartas', calendar_30d: 'Calendário 30 dias', extra_income_plan: 'Renda Extra', collection_translator: 'Tradutor de Cobrança', negotiation_scripts: 'Roteiros de negociação', sub_controle: 'Assinatura Controle', sub_ousado: 'Assinatura Ousado', sub_desbravador: 'Assinatura Desbravador' };
export const SUB_STATUS = { em_dia: ['Em dia', 'ok'], vencendo: ['Vencendo', 'warn'], cancelando: ['Não renova', 'warn'], em_debito: ['Em débito', 'bad'], sem_plano: ['Sem plano', 'muted'] };
export const PLAN = { controle: 'Controle', ousado: 'Ousado', desbravador: 'Desbravador' };
export const VIEW = { landing: 'Página inicial', intake: 'Formulário', processing: 'Cálculo', preview: 'Resultado grátis', checkout: 'Pagamento', addon: 'Compra de complemento', delivery: 'Mapa completo', tools: 'Ferramentas grátis', translator: 'Tradutor', account: 'Assinatura', partner: 'Portal do parceiro' };
export const CATEGORY = { consignado: 'Consignado', renegotiation: 'Renegociação', personal_credit: 'Crédito pessoal', empreendedorismo: 'Empreendedorismo' };
export const WEEKDAY = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ---------- blocos ----------
export const badge = (text, tone = 'muted') => el('span', { class: `bo-badge bo-${tone}` }, text);

export function card(title, ...children) {
  const opts = children.length && children.at(-1)?.__card ? children.pop() : {};
  return el(
    'section', { class: 'bo-card' },
    title || opts.actions ? el('header', { class: 'bo-card-head' }, title ? el('h2', {}, title) : null, opts.sub ? el('p', { class: 'muted' }, opts.sub) : null, opts.actions ? el('div', { class: 'bo-actions' }, ...opts.actions) : null) : null,
    ...children.filter(Boolean),
  );
}
export const cardOpts = (o) => ({ __card: true, ...o });

export function kpi(label, value, sub = null, tone = '') {
  return el('div', { class: `bo-kpi ${tone ? `bo-kpi-${tone}` : ''}` }, el('span', { class: 'bo-kpi-label' }, label), el('strong', { class: 'bo-kpi-value' }, value), sub ? el('span', { class: 'bo-kpi-sub muted' }, sub) : null);
}
export const kpis = (...items) => el('div', { class: 'bo-kpis' }, ...items);

export const grid = (cols, ...children) => el('div', { class: `bo-grid bo-grid-${cols}` }, ...children.filter(Boolean));

export function empty(text) {
  return el('p', { class: 'bo-empty muted' }, text);
}

export const loading = () => el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…');

export function errorBox(error, retry) {
  const btn = retry ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: retry }, 'Tentar de novo') : null;
  return el('div', { class: 'bo-card' }, el('h2', {}, 'Não foi possível carregar'), el('p', { class: 'muted' }, error?.status === 403 ? 'Você não tem permissão para esta área.' : (error?.message ?? 'Tente de novo.')), btn);
}

/** Barra horizontal proporcional (valor / máximo). */
export function bar(value, max, tone = 'primary') {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return el('div', { class: `bo-bar bo-bar-${tone}`, role: 'presentation' }, el('i', { style: `width:${w}%` }));
}

/**
 * Tabela. cols: [{ label, render(row), align?, cls? }]. rows: array. onRow(row) torna a linha clicável (teclado incluso).
 */
export function table(cols, rows, { emptyText = 'Nada por aqui ainda.', onRow = null } = {}) {
  if (!rows || rows.length === 0) return empty(emptyText);
  const body = rows.map((r) => {
    const tr = el('tr', onRow ? { class: 'is-click', tabindex: '0' } : {}, ...cols.map((c) => el('td', { class: `${c.align === 'right' ? 'num' : ''} ${c.cls ?? ''}`, 'data-label': c.label }, c.render(r))));
    if (onRow) {
      tr.addEventListener('click', () => onRow(r));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRow(r);
        }
      });
    }
    return tr;
  });
  return el('div', { class: 'bo-table-wrap' }, el('table', { class: 'bo-table' }, el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', { class: c.align === 'right' ? 'num' : '', scope: 'col' }, c.label)))), el('tbody', {}, ...body)));
}

export function tabs(items, current, onChange) {
  const buttons = items.map(([id, label, count]) => {
    const b = el('button', { class: 'bo-tab', type: 'button', role: 'tab', 'aria-selected': String(id === current), 'data-tab': id }, label, count !== undefined && count !== null ? el('span', { class: 'bo-tab-count' }, int(count)) : null);
    b.addEventListener('click', () => onChange(id));
    return b;
  });
  return el('div', { class: 'bo-tabs', role: 'tablist' }, ...buttons);
}

export function pager(page, total, size, onPage) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const prev = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: page <= 0 }, 'Anterior');
  const next = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: page >= pages - 1 }, 'Próxima');
  prev.addEventListener('click', () => onPage(page - 1));
  next.addEventListener('click', () => onPage(page + 1));
  return el('div', { class: 'bo-pager' }, prev, el('span', { class: 'muted' }, `Página ${page + 1} de ${pages} · ${int(total)} registros`), next);
}

export const PERIODS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '1 ano'], [3650, 'Tudo']];
export function periodSelect(current, onChange) {
  const sel = el('select', { class: 'input input-sm', 'aria-label': 'Período' }, ...PERIODS.map(([v, l]) => el('option', { value: String(v), selected: v === current }, l)));
  sel.addEventListener('change', () => onChange(Number(sel.value)));
  return sel;
}

export const field = (label, control, hint = null) => el('div', { class: 'field' }, el('label', { class: 'label' }, label), control, hint ? el('span', { class: 'fine' }, hint) : null);

/** Gaveta lateral (dialog). Devolve { body, close }. */
export function drawer(title) {
  const body = el('div', { class: 'bo-drawer-body' });
  const closeBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Fechar' }, icon('x'));
  const dialog = el('dialog', { class: 'bo-drawer', 'aria-label': title }, el('header', { class: 'bo-drawer-head' }, el('h2', {}, title), closeBtn), body);
  const close = () => {
    if (dialog.open) dialog.close();
  };
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { body, close, dialog };
}

export const dl = (pairs) => el('dl', { class: 'bo-dl' }, ...pairs.filter(Boolean).map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v ?? '—'))));

/** Gráfico de barras verticais simples (SVG), com resumo em texto para leitores de tela. */
export function columns(points, { label, format = int, height = 120 } = {}) {
  if (points.length === 0) return empty('Sem dados no período.');
  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 100 / points.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 100 ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'bo-columns');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}: ${points.map((p) => `${p.label} ${format(p.value)}`).join('; ')}`);
  points.forEach((p, i) => {
    const h = Math.max(p.value > 0 ? 1.5 : 0, (p.value / max) * (height - 4));
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(i * w + w * 0.14));
    r.setAttribute('width', String(w * 0.72));
    r.setAttribute('y', String(height - h));
    r.setAttribute('height', String(h));
    r.setAttribute('rx', '0.6');
    const t = document.createElementNS(ns, 'title');
    t.textContent = `${p.label}: ${format(p.value)}`;
    r.append(t);
    svg.append(r);
  });
  const first = points[0].label;
  const last = points.at(-1).label;
  return el('figure', { class: 'bo-figure' }, svg, el('figcaption', { class: 'bo-figcap muted' }, el('span', {}, first), el('span', {}, `pico ${format(max)}`), el('span', {}, last)));
}
