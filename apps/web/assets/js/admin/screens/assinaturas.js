// Assinaturas: quem está pagando em dia, quem vence logo e quem está em débito, com ações manuais (cortesia, plano, cancelar).
import { api } from '../api.js';
import { el, brl, int, pct, dt, card, kpi, kpis, table, pager, badge, loading, errorBox, PLAN, SUB_STATUS } from '../ui.js';
import { subscriberDrawer } from './shared.js';

const CHIPS = [['todos', 'Todos'], ['em_dia', 'Em dia'], ['vencendo', 'Vencendo em 7 dias'], ['cancelando', 'Não vão renovar'], ['em_debito', 'Em débito']];

export async function assinaturasScreen(ctx) {
  const st = ctx.state.assinaturas ?? (ctx.state.assinaturas = { status: 'todos', q: '', page: 0 });
  const host = el('div', { class: 'bo-stack' });
  const search = el('input', { class: 'input input-sm', type: 'search', placeholder: 'Buscar por e-mail', value: st.q, 'aria-label': 'Buscar por e-mail' });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      st.q = search.value.trim();
      st.page = 0;
      draw();
    }
  });

  async function draw() {
    host.replaceChildren(loading());
    try {
      const [summary, list] = await Promise.all([api.assinaturasResumo(30), api.assinaturas({ status: st.status, q: st.q, pagina: st.page })]);
      const counts = list.counts;
      const chips = el('div', { class: 'bo-chips' }, ...CHIPS.map(([id, label]) => {
        const n = id === 'todos' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[id] ?? 0);
        const b = el('button', { class: 'bo-chip', type: 'button', 'aria-pressed': String(st.status === id) }, label, el('span', { class: 'bo-tab-count' }, int(n)));
        b.addEventListener('click', () => { st.status = id; st.page = 0; draw(); });
        return b;
      }));
      host.replaceChildren(
        kpis(
          kpi('Pagando em dia', int(summary.upToDate), brl(summary.mrrCents) + ' por mês', 'good'),
          kpi('Vencendo em 7 dias', int(summary.expiringSoon), brl(summary.mrrAtRiskCents), summary.expiringSoon ? 'warn' : ''),
          kpi('Em débito', int(summary.delinquent), summary.delinquent ? `${brl(summary.lostMrrCents)}/mês parados` : 'nenhum', summary.delinquent ? 'bad' : ''),
          kpi('Renovação', pct(summary.renewalRatePct), 'já pagaram 2+ vezes'),
        ),
        card('Assinantes', el('div', { class: 'bo-toolbar' }, chips, search), table(
          [
            { label: 'E-mail', render: (s) => s.email },
            { label: 'Plano', render: (s) => (s.plan ? PLAN[s.plan] : '—') },
            { label: 'Situação', render: (s) => badge(...(SUB_STATUS[s.status] ?? [s.status, 'muted'])) },
            { label: 'Vence', render: (s) => (s.periodEnd ? `${new Date(s.periodEnd).toLocaleDateString('pt-BR')} (${s.daysLeft >= 0 ? `em ${s.daysLeft} d` : `há ${-s.daysLeft} d`})` : '—') },
            { label: 'Pedidos', align: 'right', render: (s) => int(s.paidOrders) },
            { label: 'Total pago', align: 'right', render: (s) => brl(s.paidCents) },
            { label: 'Último acesso', render: (s) => dt(s.lastLoginAt) },
          ],
          list.items,
          { emptyText: 'Nenhuma assinatura neste filtro.', onRow: (s) => subscriberDrawer(s.id, ctx, draw) },
        ), pager(list.page, list.total, list.pageSize, (p) => { st.page = p; draw(); })),
        el('p', { class: 'fine' }, '"Em débito" = a assinatura venceu e não foi renovada (o Pix é manual, a cada 30 dias; os dados da pessoa continuam guardados). Clique numa linha para estender dias como cortesia, trocar o plano ou ver a jornada.'),
      );
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return host;
}
