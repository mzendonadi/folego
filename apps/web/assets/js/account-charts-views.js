// Prumo > Gráficos nas telas e menu Relatórios.
//   Controle: gráficos frios (só desenham e escrevem os valores) em Visão geral e Orçamento.
//   Ousado: gráficos nas demais telas (Lançamentos, Carteiras, Cartões, Dívidas, Metas, Cobranças) e o menu Relatórios com períodos prontos.
//   Desbravador: os mesmos gráficos, interativos, e Relatórios com filtros (categoria, conta ou cartão, tipo, texto e datas).
// Nada que já existia sai das telas: os gráficos entram no fim de cada uma (e, na Visão geral, logo depois de "Para onde foi o dinheiro").
import { el, icon, toast } from './dom.js';
import { brl, todayISO } from './format.js';
import { donut, bars, line, hbars, chartCard } from './charts.js';
import { catLabel, catList } from './account-categories.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthShort = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dayShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const addMonths = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const loading = () => el('p', { class: 'muted', role: 'status' }, 'Montando os gráficos…');
const fail = () => el('p', { class: 'muted' }, 'Não consegui montar os gráficos agora. Recarregue a tela.');
const h3 = (t) => el('h3', { class: 'ch-h3' }, t);

/** Todos os dias de um período, com zero onde não houve gasto (a linha do tempo não pode pular dias). */
function dailyPoints(from, to, rows) {
  const by = new Map(rows.map((r) => [r.date, r.spendCents]));
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push({ x: d, y: by.get(d) ?? 0 });
  }
  return out;
}

/** Detalhamento por categoria (Desbravador): os lançamentos de gasto da categoria no período, via o mesmo relatório filtrado. */
function categoryDrill(ctx, from, to) {
  if (!ctx.has('reports_filters')) return {};
  return {
    drill: (row) => ctx.api.getReport(new URLSearchParams({ from, to, kind: 'gasto', category: row.key }).toString()).then((r) => r.rows ?? []),
    openIn: ctx.has('reports') ? (row) => { ctx.reportPreset = { preset: from.slice(0, 7) === to.slice(0, 7) ? 'mes' : 'custom', from, to, category: row.key, kind: 'gasto' }; ctx.goTab('relatorios'); } : undefined,
  };
}

const catItems = (list) => list.filter((c) => c.spendCents > 0).map((c) => ({ key: c.category, label: catLabel(c.category), value: c.spendCents }));

/** Visão geral: gastos por categoria, entrou e saiu nos últimos meses e (Ousado em diante) gasto por dia e por conta. */
export function overviewCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const body = el('div', { class: 'ch-stack' }, loading());
  const box = chartCard('Seus números em gráficos', live ? 'Passe o mouse ou toque para ver os valores; toque numa categoria para destacá-la.' : 'Para onde vai o dinheiro e como os meses se comparam.', body);
  ctx.api.getCharts(ctx.month, 6).then((d) => {
    const parts = [];
    const jump = el('div', { class: 'no-print', hidden: true });
    parts.push(h3('Gastos por categoria'), donut(catItems(d.byCategory), {
      interactive: live, label: 'Gastos do mês por categoria', totalLabel: 'Gastou', detailTitle: 'De onde veio o gasto do mês', ...categoryDrill(ctx, `${d.month}-01`, lastDay(d.month)),
      onSelect: live && ctx.has('reports') ? (key) => {
        jump.hidden = !key;
        jump.replaceChildren();
        if (!key) return;
        const go = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, `Ver ${catLabel(key)} nos Relatórios`);
        go.addEventListener('click', () => { ctx.reportPreset = { preset: 'mes', category: key, kind: 'gasto' }; ctx.goTab('relatorios'); });
        jump.append(go);
      } : undefined,
    }), jump);
    parts.push(h3('Entrou e saiu, mês a mês'), bars(d.series.map((s) => ({ key: s.month, label: monthShort(s.month), a: s.incomeCents, b: s.spendCents })), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: live, label: 'Entrou e saiu por mês' }));
    if (ctx.has('charts_screens')) {
      parts.push(h3('Gasto por dia'), line(dailyPoints(`${d.month}-01`, lastDay(d.month), d.daily), { interactive: live, xLabel: (p) => dayShort(p.x), label: 'Gasto por dia no mês' }));
      if (d.byOrigin.some((o) => o.spendCents > 0)) parts.push(h3('Por conta e cartão'), hbars(d.byOrigin.filter((o) => o.spendCents > 0).map((o) => ({ key: `${o.kind}:${o.name}`, label: o.name, value: o.spendCents, sub: o.kind === 'cartao' ? 'Cartão de crédito' : o.kind === 'conta' ? 'Conta ou carteira' : 'Sem conta definida' })), { interactive: live, label: 'Gasto por conta e cartão' }));
    }
    body.replaceChildren(...parts);
  }).catch(() => body.replaceChildren(fail()));
  return box;
}

/** Orçamento: gasto do mês contra o limite de cada categoria. */
export function budgetCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const rows = (ctx.data?.summary?.byCategory ?? []).filter((c) => c.cents > 0 || c.limitCents).map((c) => ({ key: c.category, label: catLabel(c.category), value: c.cents, limit: c.limitCents ?? undefined }));
  return chartCard('Gasto e limite por categoria', 'A marca vertical é o limite que você definiu; a barra fica vermelha quando passa dele.', hbars(rows, { interactive: live, label: 'Gasto contra o limite por categoria', empty: 'Nada gasto neste mês ainda.' }));
}

/** Lançamentos: o ritmo do mês, dia a dia. */
export function entriesCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const month = ctx.month;
  const by = new Map();
  const cats = new Map();
  for (const e of ctx.data?.entries ?? []) {
    if (e.amountCents >= 0 || e.transfer) continue;
    by.set(e.date, (by.get(e.date) ?? 0) - e.amountCents);
    cats.set(e.category, (cats.get(e.category) ?? 0) - e.amountCents);
  }
  const pts = dailyPoints(`${month}-01`, lastDay(month), [...by].map(([date, spendCents]) => ({ date, spendCents })));
  return chartCard('O mês em gráficos', 'Dia a dia e por categoria, com o que está lançado acima.', h3('Gasto por dia'), line(pts, { interactive: live, xLabel: (p) => dayShort(p.x), label: 'Gasto por dia' }), h3('Por categoria'), donut([...cats].map(([key, value]) => ({ key, label: catLabel(key), value })), { interactive: live, totalLabel: 'Gastou', label: 'Gastos por categoria', detailTitle: 'De onde veio o gasto do mês', ...categoryDrill(ctx, `${month}-01`, lastDay(month)) }));
}

export function walletsCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const list = (ctx.wallets?.wallets ?? []).map((w) => ({ key: w.id, label: w.name, value: w.balanceCents, tone: w.balanceCents < 0 ? 'neg' : undefined, sub: w.kind === 'conta' ? 'Conta bancária' : undefined }));
  return chartCard('Saldo por carteira', 'Quanto há em cada conta agora; em vermelho, a que está no negativo.', hbars(list, { interactive: live, label: 'Saldo por carteira', empty: 'Cadastre uma carteira para ver o gráfico.' }));
}

export function cardsCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const list = (ctx.cards?.cards ?? []).map((c) => ({ key: c.id, label: c.name, value: c.summary.usedCents, limit: c.limitCents || undefined, sub: c.summary.usedPct === null ? undefined : `${c.summary.usedPct}% do limite em uso` }));
  return chartCard('Limite usado por cartão', 'A marca vertical é o limite; a barra é o que já está comprometido, com as parcelas que ainda vão chegar.', hbars(list, { interactive: live, label: 'Limite usado por cartão' }));
}

export function debtsCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const open = (ctx.debts?.debts ?? []).filter((x) => !x.paidOff && x.balanceCents > 0);
  return chartCard('O que falta pagar', 'Saldo de cada dívida e quanto ela pesa no total.', hbars(open.map((x) => ({ key: x.id, label: x.name, value: x.balanceCents, tone: 'neg' })), { interactive: live, label: 'Saldo por dívida', empty: 'Nenhuma dívida em aberto.' }), open.length > 1 ? donut(open.map((x) => ({ key: x.id, label: x.name, value: x.balanceCents })), { interactive: live, totalLabel: 'Total', label: 'Peso de cada dívida' }) : null);
}

export function goalsCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const list = (ctx.data?.goals ?? []).filter((g) => g.targetCents > 0).map((g) => ({ key: g.id, label: g.name, value: g.savedCents, limit: g.targetCents, sub: `${Math.round((g.savedCents / g.targetCents) * 100)}% guardado` }));
  return chartCard('Metas: quanto já foi guardado', 'A marca vertical é o valor da meta.', hbars(list, { interactive: live, label: 'Progresso das metas', empty: 'Crie uma meta para ver o gráfico.' }));
}

export function recurringCharts(ctx) {
  const live = ctx.has('charts_interactive');
  const list = (ctx.recurring?.items ?? []).filter((i) => i.decision !== 'cancel').map((i) => ({ key: i.key ?? i.name, label: i.name, value: i.yearlyCents ?? (i.monthlyCents ?? 0) * 12, sub: i.cadence === 'mensal' ? 'Todo mês' : 'Todo ano' })).sort((a, b) => b.value - a.value).slice(0, 10);
  return chartCard('Cobranças: quanto pesam por ano', 'As dez maiores cobranças recorrentes, somadas em 12 meses.', hbars(list, { interactive: live, label: 'Cobranças recorrentes por ano' }));
}

/** Qual gráfico entra em cada aba (e a partir de qual plano). Devolve null onde não há gráfico. */
export function chartsForTab(id, ctx) {
  const base = ctx.has('charts');
  const screens = ctx.has('charts_screens');
  try {
    if (id === 'geral' && base) return overviewCharts(ctx);
    if (id === 'orcamento' && base) return budgetCharts(ctx);
    if (id === 'lancamentos' && screens) return entriesCharts(ctx);
    if (id === 'carteiras' && screens && ctx.wallets) return walletsCharts(ctx);
    if (id === 'cartoes' && screens && ctx.has('cards') && ctx.cards?.cards?.length) return cardsCharts(ctx);
    if (id === 'dividas' && screens && ctx.debts) return debtsCharts(ctx);
    if (id === 'metas' && screens && ctx.has('goals')) return goalsCharts(ctx);
    if (id === 'cobrancas' && screens && ctx.recurring) return recurringCharts(ctx);
  } catch { /* gráfico nunca derruba a tela */ }
  return null;
}

// ---------------------------------------------------------------- Relatórios
const PRESETS = [['mes', 'Este mês'], ['3m', '3 meses'], ['12m', '12 meses'], ['ano', 'Este ano'], ['custom', 'Datas']];
const KINDS = [['todos', 'Tudo'], ['gasto', 'Gastos'], ['entrada', 'Entradas']];

function rangeOf(state, month) {
  const end = lastDay(month);
  if (state.preset === 'mes') return { from: `${month}-01`, to: end };
  if (state.preset === '3m') return { from: `${addMonths(month, -2)}-01`, to: end };
  if (state.preset === '12m') return { from: `${addMonths(month, -11)}-01`, to: end };
  if (state.preset === 'ano') return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
  return { from: state.from || `${month}-01`, to: state.to || end };
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadCsv(r, name) {
  const head = ['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Conta ou cartão'];
  const rows = r.rows.map((x) => [x.date.split('-').reverse().join('/'), x.note, catLabel(x.category), (x.cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, useGrouping: false }), x.origin ?? '']);
  const text = `﻿${[head, ...rows].map((l) => l.map(csvCell).join(';')).join('\r\n')}`;
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function viewRelatorios(ctx) {
  const filters = ctx.has('reports_filters');
  const live = ctx.has('charts_interactive');
  const root = el('div', { class: 'acc-stack rel' });
  const state = { preset: '3m', from: '', to: '', kind: 'todos', category: '', origin: '', q: '', ...(ctx.reportPreset ?? {}) };
  ctx.reportPreset = null;
  let origins = { wallets: [], cards: [] };
  let token = 0;

  async function load() {
    const mine = ++token;
    const { from, to } = rangeOf(state, ctx.month);
    const p = new URLSearchParams({ from, to });
    if (filters) {
      if (state.kind !== 'todos') p.set('kind', state.kind);
      if (state.category) p.set('category', state.category);
      if (state.origin.startsWith('w:')) p.set('walletId', state.origin.slice(2));
      if (state.origin.startsWith('c:')) p.set('cardId', state.origin.slice(2));
      if (state.q.trim()) p.set('q', state.q.trim());
    }
    root.replaceChildren(controls(), el('section', { class: 'card d-section' }, loading()));
    try {
      const r = await ctx.api.getReport(p.toString());
      if (mine === token) draw(r);
    } catch (e) {
      if (mine !== token) return;
      root.replaceChildren(controls(), el('section', { class: 'card d-section' }, el('p', { class: 'muted' }, e?.status === 403 ? 'Este filtro é do plano Desbravador.' : e?.message && e.status === 422 ? e.message : 'Não consegui montar o relatório agora. Tente de novo.')));
    }
  }

  function controls() {
    const seg = el('div', { class: 'seg rel-seg', role: 'radiogroup', 'aria-label': 'Período' }, ...PRESETS.map(([v, l]) => {
      const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(state.preset === v) }, l);
      b.addEventListener('click', () => { state.preset = v; load(); });
      return b;
    }));
    const parts = [seg];
    if (state.preset === 'custom') {
      const r = rangeOf(state, ctx.month);
      const f = el('input', { class: 'input', type: 'date', value: r.from, 'aria-label': 'De' });
      const t = el('input', { class: 'input', type: 'date', value: r.to, 'aria-label': 'Até' });
      const go = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Aplicar datas');
      go.addEventListener('click', () => { state.from = f.value; state.to = t.value; load(); });
      parts.push(el('div', { class: 'rel-dates' }, el('label', { class: 'field' }, el('span', { class: 'label' }, 'De'), f), el('label', { class: 'field' }, el('span', { class: 'label' }, 'Até'), t), go));
    }
    if (filters) {
      const kind = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' }, ...KINDS.map(([v, l]) => {
        const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(state.kind === v) }, l);
        b.addEventListener('click', () => { state.kind = v; load(); });
        return b;
      }));
      const cat = el('select', { class: 'input', 'aria-label': 'Categoria' }, el('option', { value: '' }, 'Todas as categorias'), ...catList(ctx).map((c) => el('option', { value: c, ...(state.category === c ? { selected: true } : {}) }, catLabel(c))));
      cat.addEventListener('change', () => { state.category = cat.value; load(); });
      const org = el('select', { class: 'input', 'aria-label': 'Conta ou cartão' }, el('option', { value: '' }, 'Todas as contas e cartões'),
        ...origins.wallets.map((w) => el('option', { value: `w:${w.id}`, ...(state.origin === `w:${w.id}` ? { selected: true } : {}) }, w.name)),
        ...origins.cards.map((c) => el('option', { value: `c:${c.id}`, ...(state.origin === `c:${c.id}` ? { selected: true } : {}) }, `${c.name} (cartão)`)));
      org.addEventListener('change', () => { state.origin = org.value; load(); });
      const q = el('input', { class: 'input', type: 'search', maxlength: '60', placeholder: 'Buscar por descrição', value: state.q, 'aria-label': 'Buscar por descrição' });
      q.addEventListener('change', () => { state.q = q.value; load(); });
      const clear = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Limpar filtros');
      clear.addEventListener('click', () => { Object.assign(state, { kind: 'todos', category: '', origin: '', q: '' }); load(); });
      parts.push(el('div', { class: 'rel-filters' }, kind, el('div', { class: 'rel-selects' }, cat, org, q), clear));
    }
    return el('section', { class: 'card d-section no-print' }, el('h2', {}, 'Relatórios'), el('p', { class: 'muted' }, filters ? 'Escolha o período e filtre por categoria, conta, cartão, tipo ou texto. Tudo se atualiza junto.' : 'Escolha o período. No plano Desbravador também dá para filtrar por categoria, conta, cartão e texto.'), ...parts);
  }

  function draw(r) {
    const t = r.totals;
    const prev = r.previous.totals.spendCents;
    const delta = prev > 0 ? Math.round(((t.spendCents - prev) / prev) * 100) : null;
    const stat = (label, value, tone) => el('div', { class: 'stat' }, el('dt', {}, label), el('dd', { class: tone }, value));
    const top = r.byCategory.filter((c) => c.spendCents > 0)[0];
    const lines = [];
    if (top && t.spendCents > 0) lines.push(`A maior fatia dos gastos foi ${catLabel(top.category)}: ${brl(top.spendCents)}, ${Math.round((top.spendCents / t.spendCents) * 100)}% do total.`);
    if (delta !== null) lines.push(`${delta === 0 ? 'Gasto igual' : delta > 0 ? `Gasto ${delta}% maior` : `Gasto ${-delta}% menor`} que no período anterior de mesma duração (${brl(prev)}).`);
    const acts = el('div', { class: 'button-row no-print' });
    const csv = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('list'), 'Baixar planilha (CSV)');
    csv.addEventListener('click', () => { if (!r.rows.length) return toast('Nada para exportar neste período.'); downloadCsv(r, `prumo-relatorio-${r.from}-a-${r.to}.csv`); });
    const pr = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('printer'), 'Imprimir ou salvar em PDF');
    pr.addEventListener('click', () => window.print());
    acts.append(csv, pr);

    const sections = [
      el('section', { class: 'card d-section' },
        el('h2', {}, `De ${r.from.split('-').reverse().join('/')} a ${r.to.split('-').reverse().join('/')}`),
        r.filtered ? el('p', { class: 'note' }, icon('info'), el('span', {}, 'Relatório filtrado: os números abaixo contam só o que combina com os filtros escolhidos.')) : null,
        el('dl', { class: 'stats' }, stat('Gastou', brl(t.spendCents)), stat('Entrou', brl(t.incomeCents), 'pos'), stat('Saldo do período', brl(t.balanceCents), t.balanceCents < 0 ? 'neg' : 'pos'), stat('Lançamentos', String(t.count))),
        ...lines.map((x) => el('p', { class: 'fine' }, x)), acts),
      chartCard('Gastos por categoria', live ? 'Toque numa categoria para destacar; com filtros, ela vira o filtro do relatório.' : 'Quanto cada categoria pesou no período.', donut(r.byCategory.filter((c) => c.spendCents > 0).map((c) => ({ key: c.category, label: catLabel(c.category), value: c.spendCents })), {
        interactive: live, totalLabel: 'Gastou', label: 'Gastos por categoria', selected: state.category || null, detailTitle: 'De onde veio o gasto do período',
        drill: filters ? (row) => {
          const p = new URLSearchParams({ from: r.from, to: r.to, kind: 'gasto', category: row.key });
          if (state.origin.startsWith('w:')) p.set('walletId', state.origin.slice(2));
          if (state.origin.startsWith('c:')) p.set('cardId', state.origin.slice(2));
          if (state.q.trim()) p.set('q', state.q.trim());
          return ctx.api.getReport(p.toString()).then((x) => x.rows ?? []);
        } : undefined,
        onSelect: filters ? (key) => { state.category = key ?? ''; load(); } : undefined,
      })),
    ];
    if (r.series.length >= 2) sections.push(chartCard('Entrou e saiu, mês a mês', null, bars(r.series.map((s) => ({ key: s.month, label: monthShort(s.month), a: s.incomeCents, b: s.spendCents })), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: live, label: 'Entrou e saiu por mês' })));
    const until = r.to > todayISO() ? todayISO() : r.to;
    sections.push(chartCard('Gasto por dia', null, line(dailyPoints(r.from, until, r.daily), { interactive: live, xLabel: (p) => (r.from.slice(0, 4) === r.to.slice(0, 4) ? dayShort(p.x) : `${dayShort(p.x)}/${p.x.slice(2, 4)}`), label: 'Gasto por dia' })));
    if (r.byOrigin.some((o) => o.spendCents > 0)) sections.push(chartCard('Por conta e cartão', null, hbars(r.byOrigin.filter((o) => o.spendCents > 0).map((o) => ({ key: `${o.kind}:${o.name}`, label: o.name, value: o.spendCents, sub: o.kind === 'cartao' ? 'Cartão de crédito' : o.kind === 'conta' ? 'Conta ou carteira' : 'Sem conta definida' })), { interactive: live, label: 'Gasto por conta e cartão' })));
    if (r.top.length) sections.push(el('section', { class: 'card d-section' }, el('h2', {}, 'Maiores gastos do período'), el('ol', { class: 'rel-top' }, ...r.top.map((x) => el('li', {}, el('span', { class: 'rel-top-note' }, el('strong', {}, x.note), el('span', { class: 'fine muted' }, `${dayShort(x.date)} · ${catLabel(x.category)}`)), el('strong', { class: 'neg' }, brl(x.cents)))))));
    root.replaceChildren(controls(), ...sections);
  }

  (async () => {
    if (filters) {
      const [w, c] = await Promise.all([ctx.api.getWallets().catch(() => null), ctx.has('cards') ? ctx.api.getCards().catch(() => null) : null]);
      origins = { wallets: w?.wallets ?? [], cards: c?.cards ?? [] };
    }
    load();
  })();
  return root;
}
