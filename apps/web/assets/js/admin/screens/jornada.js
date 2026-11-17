// Jornada: por onde as pessoas passam no site, onde saem, de onde vêm — e a linha do tempo de um cliente específico.
import { api } from '../api.js';
import { el, toast, int, pct, brl, duration, card, kpi, kpis, grid, table, bar, periodSelect, loading, errorBox, VIEW, PRUMO_TAB, PRODUCT } from '../ui.js';
import { timeline } from './shared.js';

const STEP_ORDER = ['vinculo', 'renda', 'perfil', 'gastos', 'dividas', 'revisao'];
const STEP_LABEL = { vinculo: '1. Como o dinheiro chega (vínculo)', renda: '2. Renda mensal', perfil: '3. Perfil (idade e estado)', gastos: '4. Despesas fixas', dividas: '5. Dívidas', revisao: '6. Revisão e termos' };

const MAP_SRC = { free: 'Grátis (qualquer pessoa)', plan: 'Incluso no plano Desbravador', demo: 'Conta de teste', asaas: 'Pago no Pix (antes de ser grátis)', fake: 'Pago no Pix (antes de ser grátis)' };
const CTA = { start: 'Começar o diagnóstico', buy_map: 'Liberar o Mapa', banner_clique: 'Banner do parceiro (clique)', prumo_pedir_codigo: 'Prumo: pediu o código de acesso', prumo_entrou: 'Prumo: entrou com o código', prumo_plano_controle: 'Prumo: Assinar o Controle (/prumo)', prumo_plano_ousado: 'Prumo: Assinar o Ousado (/prumo)', prumo_plano_desbravador: 'Prumo: Assinar o Desbravador (/prumo)' };
const ctaName = (id) => CTA[id] ?? (id.startsWith('prumo_tour_') ? `Prumo: explorou "${PRUMO_TAB[id.slice(11)] ?? id.slice(11)}" (/prumo)` : id.startsWith('prumo_assinar_') ? `Prumo: escolheu assinar ${id.slice(14)}` : id);

export async function jornadaScreen(ctx) {
  const days = ctx.state.days;
  const r = await api.jornadaResumo(days);
  const steps = r.funnel.steps;
  const ab = r.funnel.abandonment;
  const t = r.traffic;
  // O código do cliente consultado fica guardado enquanto a sessão estiver ativa (a jornada abre de novo ao voltar a esta tela).
  const st = ctx.state.jornada ?? (ctx.state.jornada = { code: '' });

  const lookupOut = el('div', {});
  const input = el('input', { class: 'input', type: 'text', placeholder: 'Cole o código do caso (ou do assinante)', 'aria-label': 'Código do cliente', maxlength: '36', value: st.code });
  const btn = el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Ver jornada');
  const form = el('form', { class: 'bo-toolbar' }, input, btn);
  async function lookup(id) {
    lookupOut.replaceChildren(loading());
    try {
      const j = await api.jornadaCaso(id).catch(() => api.jornadaAssinante(id));
      lookupOut.replaceChildren(timeline(j.timeline));
    } catch (err) {
      lookupOut.replaceChildren(errorBox(err));
    }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = input.value.trim();
    if (id.length < 8) return toast('Informe o código completo.');
    st.code = id;
    await lookup(id);
  });
  if (st.code.length >= 8) queueMicrotask(() => lookup(st.code));

  const maxStep = Math.max(...t.intakeSteps.map((s) => s.sessions), 1);
  return el(
    'div', { class: 'bo-stack' },
    el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'A navegação é registrada de forma anônima (sem IP, sem nome, sem e-mail). Valores de casos e pedidos vêm dos registros reais.'), periodSelect(days, (v) => ctx.setDays(v))),
    kpis(kpi('Visitantes', int(steps[0].count)), kpi('Mapas liberados (grátis)', int(ab.mapReleased), `${pct(ab.mapRatePct)} dos diagnósticos`, 'good'), kpi('Seguiram depois do Mapa', int(ab.mapFollowed), pct(ab.followRatePct) + ' dos Mapas', 'good'), kpi('Compraram um produto cobrado', int(steps.at(-1).count), pct(steps.at(-1).pctOfFirst) + ' dos visitantes'), kpi('Tempo mediano até a 1ª compra', duration(t.medianSecondsToPay), 'da 1ª visita ao pagamento'), kpi('Rastreamento desde', t.trackingSince ? new Date(t.trackingSince).toLocaleDateString('pt-BR') : '—')),
    card('Funil completo', el('ol', { class: 'bo-funnel' }, ...steps.map((s, i) => el('li', {}, el('div', { class: 'bo-funnel-row' }, el('span', {}, s.label), el('strong', {}, int(s.count)), el('span', { class: 'muted' }, i === 0 ? '' : `${pct(s.pctOfPrev)} do passo anterior · ${pct(s.pctOfFirst)} do total`)), bar(s.count, steps[0].count || 1, i === steps.length - 1 ? 'good' : 'primary')))),
      el('p', { class: 'fine' }, 'O Mapa é grátis: "Seguiram" = preencheram o formulário do parceiro, viram outro produto ou clicaram no banner. "Compraram" só conta produto cobrado.')),
    grid(2,
      card('Onde as pessoas param', el('ul', { class: 'bo-list' },
        ...[['Começaram o diagnóstico e não finalizaram', ab.startedNotFinished], ['Viram o resultado e não liberaram o Mapa', ab.diagnosedNoMap], ['Abriram o Mapa e não seguiram', ab.mapNoFollow]].map(([label, n]) => el('li', {}, el('span', {}, label), bar(n, Math.max(steps[0].count, 1), 'primary'), el('strong', {}, int(n)))))),
      card('Quem abriu o Mapa e seguiu', el('ul', { class: 'bo-list' },
        ...[['Preencheram o formulário do parceiro', ab.mapPartner], ['Viram outros produtos', ab.mapOther], ['Clicaram no banner do parceiro', ab.mapBanner], ['Compraram um produto cobrado', ab.paid]].map(([label, n]) => el('li', {}, el('span', {}, label), bar(n, Math.max(ab.mapReleased, 1), 'good'), el('strong', {}, int(n)))))),
      card('Pagaram: por produto cobrado', table([{ label: 'Produto', render: (p) => PRODUCT[p.code] ?? p.name }, { label: 'Pedidos', align: 'right', render: (p) => int(p.orders) }, { label: 'Pagos', align: 'right', render: (p) => int(p.paid) }, { label: 'Não pagaram', align: 'right', render: (p) => int(p.unpaid) }, { label: 'Receita', align: 'right', render: (p) => brl(p.revenueCents) }], r.funnel.products, { emptyText: 'Nenhum produto cobrado vendido no período.' })),
      card('Mapas liberados por origem', table([{ label: 'Origem', render: (m) => MAP_SRC[m.provider] ?? m.provider }, { label: 'Mapas', align: 'right', render: (m) => int(m.maps) }], r.funnel.mapsBySource, { emptyText: 'Nenhum Mapa liberado no período.' })),
    ),
    grid(2,
      card('Onde as pessoas desistem do formulário', table([{ label: 'Etapa', render: (s) => STEP_LABEL[s.step] ?? s.step }, { label: 'Pessoas que chegaram', align: 'right', render: (s) => int(s.sessions) }, { label: '', render: (s) => bar(s.sessions, maxStep) }], [...t.intakeSteps].sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step)), { emptyText: 'Ainda sem dados de etapas.' })),
      card('Cliques nos botões principais', table([{ label: 'Botão', render: (c) => ctaName(c.id) }, { label: 'Cliques', align: 'right', render: (c) => int(c.clicks) }], t.ctas, { emptyText: 'Sem cliques registrados.' })),
      card('Telas abertas', table([{ label: 'Tela', render: (v) => VIEW[v.view] ?? v.view }, { label: 'Pessoas', align: 'right', render: (v) => int(v.sessions) }], t.views, { emptyText: 'Sem dados.' })),
      card('Ferramentas grátis usadas', table([{ label: 'Ferramenta', render: (x) => x.tool }, { label: 'Pessoas', align: 'right', render: (x) => int(x.sessions) }], t.tools, { emptyText: 'Sem uso registrado.' })),
      card('Origem do tráfego', table([{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Visitas', align: 'right', render: (s) => int(s.visitors) }, { label: 'Mapas', align: 'right', render: (s) => int(s.freeMaps) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Mapa por visita', align: 'right', render: (s) => pct(s.mapPct) }], t.sources, { emptyText: 'Sem dados.' })),
      card('Aparelhos', table([{ label: 'Aparelho', render: (d) => ({ mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet' }[d.device] ?? d.device) }, { label: 'Pessoas', align: 'right', render: (d) => int(d.sessions) }], t.devices, { emptyText: 'Sem dados.' })),
    ),
    card('Jornada de um cliente', el('p', { class: 'muted' }, 'Digite o código de um cliente (aparece nas listas de Clientes e Assinaturas) ou abra a linha dele para ver a jornada na gaveta.'), form, lookupOut),
  );
}

