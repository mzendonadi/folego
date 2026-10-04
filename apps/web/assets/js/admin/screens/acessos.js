// Acessos de 30 dias: todo produto pago no Pix vale por um prazo (definido em "Produtos e preços") e a pessoa pode refazer com dados
// novos nesse período. Aqui o dono vê quem está dentro do prazo, quantas vezes refez, e pode prorrogar ou encerrar.
import { api } from '../api.js';
import { el, toast, int, dt, shortId, card, kpi, kpis, table, badge, tabs, pager, PRODUCT } from '../ui.js';
import { confirmDialog } from '../../confirm.js';

const FILTERS = [['ativos', 'Ativos'], ['vencendo', 'Vencem em 7 dias'], ['vencidos', 'Vencidos'], ['todos', 'Todos']];

const daysBadge = (x) => (x.expired ? badge('Encerrado', 'muted') : x.daysLeft <= 2 ? badge(`${x.daysLeft} ${x.daysLeft === 1 ? 'dia' : 'dias'}`, 'bad') : x.daysLeft <= 7 ? badge(`${x.daysLeft} dias`, 'warn') : badge(`${x.daysLeft} dias`, 'ok'));

export async function acessosScreen(ctx) {
  const st = { filtro: 'ativos', produto: '', page: 0 };
  const host = el('div', { class: 'bo-stack' });

  async function draw() {
    host.replaceChildren(el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      const r = await api.acessos({ filtro: st.filtro, produto: st.produto, pagina: st.page });
      const bar = tabs(FILTERS.map(([k, l]) => [k, l]), st.filtro, (id) => { st.filtro = id; st.page = 0; draw(); });
      const prod = el('select', { class: 'input input-sm', 'aria-label': 'Produto' }, el('option', { value: '' }, 'Todos os produtos'), ...Object.entries(PRODUCT).filter(([k]) => !k.startsWith('sub_')).map(([k, l]) => el('option', { value: k, selected: st.produto === k }, l)));
      prod.addEventListener('change', () => { st.produto = prod.value; st.page = 0; draw(); });

      const act = async (fn, ok) => {
        try {
          await fn();
          toast(ok);
          draw();
        } catch (e) {
          toast(e?.message ?? 'Não consegui agora.');
        }
      };
      const actions = (x) => {
        const plus = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, '+7 dias');
        plus.addEventListener('click', () => act(() => api.prorrogarAcesso(x.id, 7), 'Prorrogado em 7 dias.'));
        const plus30 = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, '+30 dias');
        plus30.addEventListener('click', () => act(() => api.prorrogarAcesso(x.id, 30), 'Prorrogado em 30 dias.'));
        const end = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Encerrar');
        end.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: 'Encerrar este acesso agora?', text: 'A pessoa deixa de abrir o conteúdo e de refazer. Você pode prorrogar depois, se for engano.', confirmLabel: 'Encerrar', danger: true }))) return;
          act(() => api.encerrarAcesso(x.id), 'Acesso encerrado.');
        });
        return el('span', { class: 'bo-actions' }, plus, plus30, x.expired ? null : end);
      };

      host.replaceChildren(
        el('p', { class: 'muted' }, 'Todo produto pago no Pix vale por um prazo contado do pagamento (padrão: 30 dias; edite em "Produtos e preços"). Dentro dele a pessoa refaz com dados novos quantas vezes quiser, sem pagar de novo; a data final não muda. A pessoa vê uma contagem regressiva.'),
        kpis(
          kpi('Acessos ativos', int(r.summary.active)),
          kpi('Vencem em 7 dias', int(r.summary.expiringSoon), '', r.summary.expiringSoon ? 'warn' : ''),
          kpi('Vencidos', int(r.summary.expired)),
          kpi('Vezes que refizeram', int(r.summary.redos), 'dados novos dentro do prazo'),
        ),
        bar,
        el('div', { class: 'bo-filters' }, prod),
        table(
          [
            { label: 'Produto', render: (x) => PRODUCT[x.productCode] ?? x.product },
            { label: 'Caso', cls: 'nowrap', render: (x) => el('code', {}, shortId(x.caseId)) },
            { label: 'Liberado em', cls: 'nowrap', render: (x) => dt(x.grantedAt) },
            { label: 'Termina em', cls: 'nowrap', render: (x) => dt(x.expiresAt) },
            { label: 'Prazo', cls: 'nowrap', render: (x) => el('span', {}, daysBadge(x), x.extendedDays ? el('span', { class: 'fine muted' }, ` (+${x.extendedDays} d pelo dono)`) : null) },
            { label: 'Refeito', align: 'right', cls: 'nowrap', render: (x) => (x.redoCount ? `${int(x.redoCount)}×${x.lastRedoAt ? ` · ${dt(x.lastRedoAt)}` : ''}` : '—') },
            { label: '', render: actions },
          ],
          r.items,
          { emptyText: st.filtro === 'ativos' ? 'Nenhum acesso ativo no momento.' : 'Nada nesta visão.' },
        ),
        pager(st.page, r.total, r.pageSize, (n) => { st.page = n; draw(); }),
      );
    } catch (e) {
      host.replaceChildren(el('p', { class: 'note note-amber' }, el('span', {}, e?.message ?? 'Não consegui carregar.')));
    }
  }
  draw();
  return card('Acessos e prazo de refazer', host);
}
