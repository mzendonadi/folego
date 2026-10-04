// Clientes: compradores avulsos (anônimos, identificados pelo caso) e assinantes (têm e-mail). A lista nunca traz dado pessoal;
// o detalhe mostra o que a pessoa comprou e fez no site.
import { api } from '../api.js';
import { el, brl, int, dt, shortId, card, table, tabs, pager, badge, loading, errorBox, EMPLOYMENT, PRODUCT, PLAN, SUB_STATUS } from '../ui.js';
import { caseDrawer, subscriberDrawer } from './shared.js';

const FILTERS = [['todos', 'Todos'], ['pagaram', 'Pagaram'], ['nao_pagaram', 'Não pagaram'], ['abandonaram_checkout', 'Abriram o Pix e não pagaram']];

export async function clientesScreen(ctx) {
  const st = ctx.state.clientes ?? (ctx.state.clientes = { tab: 'avulsos', filtro: 'todos', q: '', page: 0 });
  const host = el('div', { class: 'bo-stack' });

  const search = el('input', { class: 'input input-sm', type: 'search', placeholder: st.tab === 'assinantes' ? 'Buscar por e-mail' : 'Buscar por código do cliente', value: st.q, 'aria-label': 'Buscar' });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      st.q = search.value.trim();
      st.page = 0;
      draw();
    }
  });

  async function draw() {
    const results = el('div', {}, loading());
    host.replaceChildren(
      el('div', { class: 'bo-toolbar' }, tabs([['avulsos', 'Compradores avulsos'], ['tradutor', 'Tradutor de Cobrança'], ['assinantes', 'Assinantes']], st.tab, (t) => {
        st.tab = t;
        st.page = 0;
        st.q = '';
        draw();
      }), search),
      results,
    );
    try {
      if (st.tab === 'assinantes') {
        const r = await api.assinaturas({ q: st.q, pagina: st.page });
        results.replaceChildren(
          card(`Assinantes (${int(r.total)})`, table(
            [
              { label: 'E-mail', render: (s) => s.email },
              { label: 'Plano', render: (s) => (s.plan ? PLAN[s.plan] : '—') },
              { label: 'Situação', render: (s) => badge(...(SUB_STATUS[s.status] ?? [s.status, 'muted'])) },
              { label: 'Vence', render: (s) => (s.daysLeft === null ? '—' : s.daysLeft >= 0 ? `em ${s.daysLeft} dias` : `há ${-s.daysLeft} dias`) },
              { label: 'Total pago', align: 'right', render: (s) => brl(s.paidCents) },
              { label: 'Cadastro', render: (s) => dt(s.createdAt) },
            ],
            r.items,
            { emptyText: 'Nenhum assinante encontrado.', onRow: (s) => subscriberDrawer(s.id, ctx, draw) },
          ), pager(r.page, r.total, r.pageSize, (p) => { st.page = p; draw(); })),
        );
        return;
      }
      const isTr = st.tab === 'tradutor';
      const chips = !isTr ? el('div', { class: 'bo-chips' }, ...FILTERS.map(([id, label]) => {
        const b = el('button', { class: 'bo-chip', type: 'button', 'aria-pressed': String(st.filtro === id) }, label);
        b.addEventListener('click', () => { st.filtro = id; st.page = 0; draw(); });
        return b;
      })) : null;
      const r = await api.avulsos({ filtro: st.filtro, q: st.q, tipo: isTr ? 'translator' : 'map', pagina: st.page });
      results.replaceChildren(
        card(isTr ? `Tradutor de Cobrança (${int(r.total)})` : `Compradores avulsos (${int(r.total)})`, chips, table(
          [
            { label: 'Código', render: (c) => el('code', {}, shortId(c.id)) },
            { label: 'Criado', render: (c) => dt(c.createdAt) },
            { label: 'Estado', render: (c) => c.uf ?? '—' },
            { label: 'Vínculo', render: (c) => (EMPLOYMENT[c.employment] ?? '—') + (c.employmentNote ? ` (${c.employmentNote})` : '') },
            { label: 'Dívida', align: 'right', render: (c) => (c.debtTotalCents === null ? '—' : brl(c.debtTotalCents)) },
            { label: 'Atraso', render: (c) => (c.hasOverdue ? badge('sim', 'warn') : '—') },
            { label: 'Comprou', render: (c) => (c.products.length ? c.products.map((p) => PRODUCT[p] ?? p).join(', ') : badge('nada', 'muted')) },
            { label: 'Pago', align: 'right', render: (c) => (c.paidCents ? brl(c.paidCents) : '—') },
            { label: 'Contato', render: (c) => (c.leadConsent ? badge('autorizou', 'ok') : '—') },
          ],
          r.items,
          { emptyText: 'Nenhum registro com este filtro.', onRow: (c) => caseDrawer(c.id, ctx) },
        ), pager(r.page, r.total, r.pageSize, (p) => { st.page = p; draw(); })),
      );
    } catch (e) {
      results.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return el('div', {}, el('p', { class: 'muted bo-lead' }, 'Compradores avulsos não têm cadastro: são identificados só pelo código do caso, sem nome nem e-mail. Clique numa linha para ver o perfil, as compras e a jornada.'), host);
}

