// Assinaturas: quem está pagando em dia, quem vence logo e quem está em débito, com ações manuais (cortesia, plano, cancelar).
import { api } from '../api.js';
import { el, brl, int, pct, dt, card, kpi, kpis, table, pager, badge, loading, errorBox, PLAN, SUB_STATUS } from '../ui.js';
import { subscriberDrawer } from './shared.js';
import { canceladosView } from './cancelados.js';

const CHIPS = [['todos', 'Todos'], ['em_dia', 'Em dia'], ['vencendo', 'Vencendo em 7 dias'], ['cancelando', 'Não vão renovar'], ['em_debito', 'Em débito']];

export async function assinaturasScreen(ctx) {
  const st = ctx.state.assinaturas ?? (ctx.state.assinaturas = { status: 'todos', q: '', page: 0, tab: 'ativas' });
  const root = el('div', { class: 'bo-stack' });
  const host = el('div', { class: 'bo-stack' });
  const tabs = el('div', { class: 'bo-chips', role: 'tablist', 'aria-label': 'Assinaturas' }, ...[['ativas', 'Assinaturas'], ['cancelados', 'Cancelados']].map(([id, label]) => {
    const b = el('button', { class: 'bo-chip', type: 'button', role: 'tab', 'aria-selected': String(st.tab === id) }, label);
    b.addEventListener('click', () => { st.tab = id; show(); });
    return b;
  }));
  async function show() {
    tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String((i === 0) === (st.tab === 'ativas'))));
    root.replaceChildren(tabs, st.tab === 'cancelados' ? await canceladosView(ctx) : host);
    if (st.tab !== 'cancelados') await draw();
  }
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
          kpi('Pagando em dia', int(summary.upToDate), brl(summary.mrrCents) + ' por mês (recorrência)', 'good'),
          kpi('Vencendo em 7 dias', int(summary.expiringSoon), brl(summary.mrrAtRiskCents), summary.expiringSoon ? 'warn' : ''),
          kpi('Em débito', int(summary.delinquent), summary.delinquent ? `${brl(summary.lostMrrCents)}/mês parados` : 'nenhum', summary.delinquent ? 'bad' : ''),
          kpi('Renovação', pct(summary.renewalRatePct), 'já pagaram 2+ vezes'),
        ),
        card('Assinantes', el('div', { class: 'bo-toolbar' }, chips, search), table(
          [
            { label: 'Assinante', render: (s) => (s.name ? el('span', {}, el('strong', {}, s.name), el('br'), s.email) : s.email) },
            { label: 'CPF', render: (s) => (s.cpfLast4 ? `***.***.*${s.cpfLast4.slice(0, 2)}-${s.cpfLast4.slice(2)}` : '—') },
            { label: 'Plano', render: (s) => (s.plan ? PLAN[s.plan] : '—') },
            { label: 'Situação', render: (s) => (s.awaitingPayment ? badge('Pagamento iniciado', 'warn') : badge(...(SUB_STATUS[s.status] ?? [s.status, 'muted']))) },
            { label: 'Vence', render: (s) => (s.periodEnd ? `${new Date(s.periodEnd).toLocaleDateString('pt-BR')} (${s.daysLeft >= 0 ? `em ${s.daysLeft} d` : `há ${-s.daysLeft} d`})` : '—') },
            { label: 'Pedidos', align: 'right', render: (s) => int(s.paidOrders) },
            { label: 'Total pago', align: 'right', render: (s) => brl(s.paidCents) },
            { label: 'Último acesso', render: (s) => dt(s.lastLoginAt) },
          ],
          list.items,
          { emptyText: 'Nenhuma assinatura neste filtro.', onRow: (s) => subscriberDrawer(s.id, ctx, draw) },
        ), pager(list.page, list.total, list.pageSize, (p) => { st.page = p; draw(); })),
        el('p', { class: 'fine' }, 'A cobrança é mensal e recorrente no cartão de crédito (Asaas). "Em débito" = o acesso venceu e a mensalidade não entrou (cartão recusado ou assinatura encerrada). Quem cancela por conta própria vai para a aba Cancelados e mantém o acesso até o fim do mês pago. "Pagamento iniciado" = a pessoa abriu a página do cartão, mas ainda não pagou. Clique numa linha para estender dias como cortesia, trocar o plano ou ver a jornada.'),
      );
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  await show();
  return root;
}
