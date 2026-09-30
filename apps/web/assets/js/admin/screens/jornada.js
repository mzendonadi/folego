// Jornada: por onde as pessoas passam no site, onde saem, de onde vêm — e a linha do tempo de um cliente específico.
import { api } from '../api.js';
import { el, toast, int, pct, duration, card, kpi, kpis, grid, table, bar, periodSelect, loading, errorBox, VIEW } from '../ui.js';
import { timeline } from './shared.js';

const STEP_ORDER = ['vinculo', 'renda', 'perfil', 'gastos', 'dividas', 'revisao'];
const STEP_LABEL = { vinculo: '1. Como o dinheiro chega (vínculo)', renda: '2. Renda mensal', perfil: '3. Perfil (idade e estado)', gastos: '4. Despesas fixas', dividas: '5. Dívidas', revisao: '6. Revisão e termos' };

export async function jornadaScreen(ctx) {
  const days = ctx.state.days;
  const r = await api.jornadaResumo(days);
  const steps = r.funnel.steps;
  const t = r.traffic;

  const lookupOut = el('div', {});
  const input = el('input', { class: 'input', type: 'text', placeholder: 'Cole o código do caso (ou do assinante)', 'aria-label': 'Código do cliente', maxlength: '36' });
  const btn = el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Ver jornada');
  const form = el('form', { class: 'bo-toolbar' }, input, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = input.value.trim();
    if (id.length < 8) return toast('Informe o código completo.');
    lookupOut.replaceChildren(loading());
    try {
      const j = await api.jornadaCaso(id).catch(() => api.jornadaAssinante(id));
      lookupOut.replaceChildren(timeline(j.timeline));
    } catch (err) {
      lookupOut.replaceChildren(errorBox(err));
    }
  });

  const maxStep = Math.max(...t.intakeSteps.map((s) => s.sessions), 1);
  return el(
    'div', { class: 'bo-stack' },
    el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'A navegação é registrada de forma anônima (sem IP, sem nome, sem e-mail). Valores de casos e pedidos vêm dos registros reais.'), periodSelect(days, (v) => ctx.setDays(v))),
    kpis(kpi('Visitantes', int(steps[0].count)), kpi('Chegaram a pagar', int(steps.at(-1).count), pct(steps.at(-1).pctOfFirst) + ' dos visitantes', 'good'), kpi('Tempo mediano até pagar', duration(t.medianSecondsToPay), 'da 1ª visita ao Pix pago'), kpi('Rastreamento desde', t.trackingSince ? new Date(t.trackingSince).toLocaleDateString('pt-BR') : '—')),
    card('Funil completo', el('ol', { class: 'bo-funnel' }, ...steps.map((s, i) => el('li', {}, el('div', { class: 'bo-funnel-row' }, el('span', {}, s.label), el('strong', {}, int(s.count)), el('span', { class: 'muted' }, i === 0 ? '' : `${pct(s.pctOfPrev)} do passo anterior · ${pct(s.pctOfFirst)} do total`)), bar(s.count, steps[0].count || 1, i === steps.length - 1 ? 'good' : 'primary'))))),
    grid(2,
      card('Onde as pessoas desistem do formulário', table([{ label: 'Etapa', render: (s) => STEP_LABEL[s.step] ?? s.step }, { label: 'Pessoas que chegaram', align: 'right', render: (s) => int(s.sessions) }, { label: '', render: (s) => bar(s.sessions, maxStep) }], [...t.intakeSteps].sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step)), { emptyText: 'Ainda sem dados de etapas.' })),
      card('Cliques nos botões principais', table([{ label: 'Botão', render: (c) => c.id }, { label: 'Cliques', align: 'right', render: (c) => int(c.clicks) }], t.ctas, { emptyText: 'Sem cliques registrados.' })),
      card('Telas abertas', table([{ label: 'Tela', render: (v) => VIEW[v.view] ?? v.view }, { label: 'Pessoas', align: 'right', render: (v) => int(v.sessions) }], t.views, { emptyText: 'Sem dados.' })),
      card('Ferramentas grátis usadas', table([{ label: 'Ferramenta', render: (x) => x.tool }, { label: 'Pessoas', align: 'right', render: (x) => int(x.sessions) }], t.tools, { emptyText: 'Sem uso registrado.' })),
      card('Origem do tráfego', table([{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Visitas', align: 'right', render: (s) => int(s.visitors) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Conversão', align: 'right', render: (s) => pct(s.conversionPct) }], t.sources, { emptyText: 'Sem dados.' })),
      card('Aparelhos', table([{ label: 'Aparelho', render: (d) => ({ mobile: 'Celular', desktop: 'Computador', tablet: 'Tablet' }[d.device] ?? d.device) }, { label: 'Pessoas', align: 'right', render: (d) => int(d.sessions) }], t.devices, { emptyText: 'Sem dados.' })),
    ),
    card('Jornada de um cliente', el('p', { class: 'muted' }, 'Digite o código de um cliente (aparece nas listas de Clientes e Assinaturas) ou abra a linha dele para ver a jornada na gaveta.'), form, lookupOut),
  );
}

