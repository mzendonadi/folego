// Dashboard: os indicadores que respondem "quantos vieram, quantos preencheram, quantos pagaram, como, e por quê não".
import { api } from '../api.js';
import { el, brl, int, pct, duration, card, cardOpts, kpi, kpis, grid, table, bar, columns, badge, periodSelect, EMPLOYMENT, PRODUCT, PLAN, WEEKDAY, VIEW } from '../ui.js';

export async function dashboardScreen(ctx) {
  const days = ctx.state.days;
  const [d, saude] = await Promise.all([api.dashboard(days), api.saude().catch(() => null)]);
  const steps = d.funnel.steps;
  const step = (k) => steps.find((s) => s.key === k)?.count ?? 0;
  const ab = d.funnel.abandonment;
  const rev = d.revenue;
  const sub = d.subscriptions;
  const overall = step('visitors') > 0 ? (step('paid') / step('visitors')) * 100 : null;

  const head = el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, `Período: últimos ${days === 3650 ? 'todos os' : days} ${days === 3650 ? 'registros' : 'dias'}. Atualizado às ${new Date(d.generatedAt).toLocaleTimeString('pt-BR')}.`), periodSelect(days, (v) => ctx.setDays(v)));

  const top = kpis(
    kpi('Visitantes', int(step('visitors')), d.traffic.trackingSince ? `desde ${new Date(d.traffic.trackingSince).toLocaleDateString('pt-BR')}` : 'rastreamento novo'),
    kpi('Diagnósticos feitos', int(step('diagnosed')), `${pct(steps.find((s) => s.key === 'diagnosed')?.pctOfPrev)} de quem começou`),
    kpi('Pagaram', int(step('paid')), `${pct(overall)} dos visitantes`, 'good'),
    kpi('Receita', brl(rev.grossCents), `${int(rev.orders)} pedidos pagos`, 'good'),
    kpi('Ticket médio', brl(rev.avgTicketCents)),
    kpi('Receita recorrente (mês)', brl(sub.mrrCents), `${int(sub.payingCount)} assinantes pagando`),
    kpi('Assinaturas em débito', int(sub.delinquent), sub.delinquent ? `${brl(sub.lostMrrCents)}/mês parados` : 'nenhuma', sub.delinquent ? 'bad' : ''),
    kpi('Preencheram e não pagaram', int(ab.filledNotPaid), `${int(ab.abandonedCheckout)} abriram o Pix`, ab.filledNotPaid ? 'warn' : ''),
  );

  const funnel = card(
    'Funil: da visita ao pagamento',
    el(
      'ol', { class: 'bo-funnel' },
      ...steps.map((s, i) =>
        el(
          'li', {},
          el('div', { class: 'bo-funnel-row' }, el('span', {}, s.label), el('strong', {}, int(s.count)), el('span', { class: 'muted' }, i === 0 ? '' : `${pct(s.pctOfPrev)} do passo anterior`)),
          bar(s.count, steps[0].count || 1, i === steps.length - 1 ? 'good' : 'primary'),
        ),
      ),
    ),
    el('p', { class: 'fine' }, 'Visitantes e "começaram" vêm do rastreamento do site (anônimo). Do diagnóstico em diante, os números vêm dos registros reais de casos e pedidos.'),
    cardOpts({ sub: 'Cada pessoa conta uma vez por etapa.' }),
  );

  const aband = card(
    'Preencheram e não quiseram pagar',
    kpis(kpi('Não pagaram', int(ab.filledNotPaid)), kpi('Só viram o resultado', int(ab.neverOpenedCheckout), 'nem abriram o pagamento'), kpi('Abriram o Pix e desistiram', int(ab.abandonedCheckout)), kpi('Conversão do diagnóstico', pct(ab.conversionPct), `${int(ab.paid)} pagaram`)),
    el('p', { class: 'muted' }, 'Veja o perfil de quem não paga em "Perfil dos clientes" e as hipóteses em Marketing → Insights.'),
    rev.unpaidOrders && Object.keys(rev.unpaidOrders).length ? el('p', { class: 'fine' }, `Pedidos não pagos no período: ${Object.entries(rev.unpaidOrders).map(([k, v]) => `${v} ${k}`).join(', ')}.`) : null,
  );

  const byDay = card('Receita por dia', columns(rev.byDay.map((x) => ({ label: new Date(`${x.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: x.cents })), { label: 'Receita por dia', format: brl }));

  const maxProd = Math.max(...rev.byProduct.map((p) => p.cents), 1);
  const products = card(
    'Produtos comprados',
    table(
      [
        { label: 'Produto', render: (p) => el('span', {}, PRODUCT[p.code] ?? p.name, ' ', p.kind === 'subscription' ? badge('assinatura', 'muted') : null) },
        { label: 'Vendas', align: 'right', render: (p) => int(p.units) },
        { label: 'Receita', align: 'right', render: (p) => brl(p.cents) },
        { label: '', render: (p) => bar(p.cents, maxProd) },
      ],
      rev.byProduct,
      { emptyText: 'Nenhuma venda no período.' },
    ),
  );

  const methods = card(
    'Meios de pagamento',
    table(
      [
        { label: 'Meio', render: (m) => (m.method === 'pix' ? 'Pix' : m.method) },
        { label: 'Provedor', render: (m) => (m.provider === 'fake' ? 'Simulado (pré-lançamento)' : m.provider) },
        { label: 'Pagamentos', align: 'right', render: (m) => int(m.orders) },
        { label: 'Valor', align: 'right', render: (m) => brl(m.cents) },
      ],
      rev.byMethod,
      { emptyText: 'Nenhum pagamento confirmado no período.' },
    ),
    el('p', { class: 'fine' }, 'Hoje só existe Pix. Quando outros meios entrarem, aparecem aqui sem mudar nada.'),
  );

  const subs = card(
    'Assinaturas',
    kpis(kpi('Em dia', int(sub.upToDate)), kpi('Vencendo em 7 dias', int(sub.expiringSoon), brl(sub.mrrAtRiskCents), sub.expiringSoon ? 'warn' : ''), kpi('Não vão renovar', int(sub.cancelling)), kpi('Em débito', int(sub.delinquent), '', sub.delinquent ? 'bad' : ''), kpi('Renovação', pct(sub.renewalRatePct), 'quem já pagou 2+ vezes'), kpi('Novos no período', int(sub.newSubscribers))),
    table(
      [{ label: 'Plano', render: (p) => PLAN[p.plan] ?? p.plan }, { label: 'Pagando', align: 'right', render: (p) => int(p.payingCount) }, { label: 'Em débito', align: 'right', render: (p) => int(p.delinquent) }, { label: 'Receita/mês', align: 'right', render: (p) => brl(p.mrrCents) }],
      sub.byPlan,
    ),
  );

  const seg = (title, list, labelOf = (k) => k) =>
    card(
      title,
      table(
        [{ label: 'Grupo', render: (s) => labelOf(s.key) }, { label: 'Casos', align: 'right', render: (s) => int(s.cases) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Conversão', align: 'right', render: (s) => pct(s.conversionPct) }],
        list,
        { emptyText: 'Sem dados.' },
      ),
    );
  const p = d.profile;
  const profile = el(
    'div', { class: 'bo-stack' },
    card('Perfil dos clientes', kpis(kpi('Diagnósticos', int(p.cases)), kpi('Dívida total informada', brl(p.totalDebtCents)), kpi('Dívida média', brl(p.avgDebtCents)), kpi('Com dívida em atraso', int(p.withOverdue), p.cases ? `${pct((p.withOverdue / p.cases) * 100)} dos casos` : ''))),
    grid(2, seg('Por vínculo de trabalho', p.byEmployment, (k) => EMPLOYMENT[k] ?? k), seg('Por faixa de renda', p.byIncome), seg('Por estado', p.byUf.slice(0, 12)), seg('Por faixa etária', p.byAge), seg('Por tamanho da dívida', p.byDebt), card('Tipos de dívida mais comuns', table([{ label: 'Tipo', render: (k) => k.kind }, { label: 'Casos', align: 'right', render: (k) => int(k.cases) }], p.debtKinds, { emptyText: 'Sem dados.' }))),
  );

  const t = d.traffic;
  const traffic = grid(
    2,
    card(
      'De onde vêm as visitas',
      table(
        [{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Visitas', align: 'right', render: (s) => int(s.visitors) }, { label: 'Diagnósticos', align: 'right', render: (s) => int(s.cases) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Receita', align: 'right', render: (s) => brl(s.revenueCents) }],
        t.sources,
        { emptyText: 'Sem visitas rastreadas ainda.' },
      ),
      el('p', { class: 'fine' }, 'Use links com UTM ao divulgar (ex.: ?utm_source=instagram&utm_medium=bio) para separar os canais.'),
    ),
    card(
      'O que as pessoas fazem no site',
      table([{ label: 'Tela', render: (v) => VIEW[v.view] ?? v.view }, { label: 'Pessoas', align: 'right', render: (v) => int(v.sessions) }, { label: 'Aberturas', align: 'right', render: (v) => int(v.events) }], t.views, { emptyText: 'Sem dados.' }),
      t.tools.length ? table([{ label: 'Ferramenta grátis', render: (x) => x.tool }, { label: 'Pessoas', align: 'right', render: (x) => int(x.sessions) }], t.tools) : null,
      el('p', { class: 'fine' }, `Tempo mediano da primeira visita ao pagamento: ${duration(t.medianSecondsToPay)}.`),
    ),
  );

  const timing = grid(
    2,
    card('Horário dos pagamentos', columns(rev.hours.map((h) => ({ label: `${h.hour}h`, value: h.orders })), { label: 'Pagamentos por hora' })),
    card('Dia da semana', el('ul', { class: 'bo-list' }, ...rev.weekdays.map((w) => el('li', {}, el('span', {}, WEEKDAY[w.weekday]), bar(w.orders, Math.max(...rev.weekdays.map((x) => x.orders), 1)), el('strong', {}, int(w.orders)))))),
  );

  const ai = card('Uso de IA', kpis(kpi('Escritas pela IA', int(d.ai.ai)), kpi('Pelo modelo fixo', int(d.ai.template)), kpi('Tokens de entrada', int(d.ai.inputTokens)), kpi('Tokens de saída', int(d.ai.outputTokens))), el('p', { class: 'fine' }, 'Compare os tokens com o custo da sua conta Anthropic para saber quanto a IA custa por entrega.'));

  return el('div', { class: 'bo-stack' }, head, saudeCard(saude), top, grid(2, funnel, aband), byDay, grid(2, products, methods), subs, profile, traffic, timing, ai);
}

const SAUDE = { banco: 'Banco de dados', worker: 'Worker (entregas em segundo plano)', fila: 'Fila de entregas', webhooks: 'Eventos de pagamento', ebook: 'Envio do e-book', backup: 'Backup', disco: 'Disco do servidor' };

/** Semáforo do sistema: o mesmo que o monitor externo confere a cada 10 minutos (e avisa por e-mail se algo falhar). */
function saudeCard(s) {
  if (!s) return null;
  return card(
    s.ok ? 'Sistema saudável' : 'Atenção: algo precisa de cuidado',
    el('ul', { class: 'bo-saude' }, ...Object.entries(s.checks).map(([k, c]) => el('li', {}, badge(c.ok ? 'ok' : 'atenção', c.ok ? 'ok' : 'bad'), ' ', el('strong', {}, SAUDE[k] ?? k), el('span', { class: 'muted' }, ' — ' + c.detail)))),
    cardOpts({ sub: 'Monitor externo roda a cada 10 minutos.' }),
  );
}
