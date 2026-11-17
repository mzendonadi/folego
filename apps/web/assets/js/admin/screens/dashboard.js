// Dashboard: os indicadores que respondem "quantos vieram, quantos preencheram, quantos pagaram, como, e por quê não".
import { api } from '../api.js';
import { el, brl, int, pct, duration, card, cardOpts, kpi, kpis, grid, table, bar, columns, badge, drawer, periodSelect, EMPLOYMENT, PRODUCT, PLAN, WEEKDAY, VIEW, PRUMO_TAB } from '../ui.js';

const PRUMO_CTA = { prumo_pedir_codigo: 'Pediram o código de acesso', prumo_entrou: 'Entraram com o código', prumo_plano_controle: 'Clicaram em Assinar o Controle (/prumo)', prumo_plano_ousado: 'Clicaram em Assinar o Ousado (/prumo)', prumo_plano_desbravador: 'Clicaram em Assinar o Desbravador (/prumo)' };
const prumoCtaName = (id) => PRUMO_CTA[id] ?? (id.startsWith('prumo_tour_') ? `Exploraram "${PRUMO_TAB[id.slice(11)] ?? id.slice(11)}" na página /prumo` : id.startsWith('prumo_assinar_') ? `Escolheram assinar o ${PLAN[id.slice(14)] ?? id.slice(14)}` : id);
const DEVICE = { mobile: 'Celular', tablet: 'Tablet', desktop: 'Computador', 'n/d': 'Não informado' };
/** De onde veio cada Mapa liberado (o pagamento do pedido): o Mapa passou a ser grátis, mas os pagos de antes continuam contando. */
const MAP_SRC = { free: 'Grátis (qualquer pessoa)', plan: 'Incluso no plano Desbravador', demo: 'Conta de teste', asaas: 'Pago no Pix (antes de ser grátis)', fake: 'Pago no Pix (antes de ser grátis)' };
const DELIVERY_ST = { queued: 'Na fila', delivered: 'Entregue', contacted: 'Em contato', converted: 'Contrato fechado', failed: 'Falhou', rejected: 'Descartado', canceled: 'Cancelado' };

/** Indicadores do Prumo (página /prumo e app /conta): acessos, usuários ativos, funil até a assinatura, abas mais usadas e origem. */
function prumoSection(pm, days) {
  const k = pm.kpis;
  const since = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : null);
  const maxTab = Math.max(...pm.tabs.map((t) => t.sessions), 1);
  const overview = card(
    'Prumo: acessos e usuários ativos',
    kpis(
      kpi('Visitas em /prumo', int(k.landingVisitors), `${int(k.landingViews)} aberturas`),
      kpi('Abriram o app (/conta)', int(k.appSessions), `${int(k.appViews)} telas abertas`),
      kpi('Usuários ativos no período', int(k.activeUsers), `${int(k.activeApp)} no app · ${int(k.activeWhatsapp)} no WhatsApp`, 'good'),
      kpi('Ativos hoje', int(k.dau), 'no app ou no WhatsApp'),
      kpi('Ativos em 7 dias', int(k.wau)),
      kpi('Ativos em 30 dias', int(k.mau), k.totalSubscribers ? `${pct((k.mau / k.totalSubscribers) * 100)} dos ${int(k.totalSubscribers)} assinantes` : ''),
      kpi('Voltaram em 2+ dias', int(k.returningUsers), `${pct(k.returningPct)} dos ativos`),
      kpi('Entradas (logins) e contas novas', `${int(k.logins)} · ${int(k.newAccounts)}`, 'pessoas distintas no período'),
    ),
    el('p', { class: 'fine' }, `Período: últimos ${days === 3650 ? 'todos os' : days} ${days === 3650 ? 'registros' : 'dias'}. "Ativos" vem do registro de uso no servidor${since(pm.activityTrackingSince) ? ` (desde ${since(pm.activityTrackingSince)})` : ' (começa a contar a partir de agora)'}; telas, cliques e origem vêm do rastreamento anônimo do site${since(pm.appTrackingSince) ? ` (app desde ${since(pm.appTrackingSince)})` : ''}.`),
  );
  const funnel = card(
    'Funil do Prumo: da página à assinatura',
    el('ol', { class: 'bo-funnel' }, ...pm.funnel.map((s, i) => el('li', {}, el('div', { class: 'bo-funnel-row' }, el('span', {}, s.label), el('strong', {}, int(s.count)), el('span', { class: 'muted' }, i === 0 ? '' : `${pct(s.pctOfPrev)} do passo anterior`)), bar(s.count, pm.funnel[0].count || 1, i === pm.funnel.length - 1 ? 'good' : 'primary')))),
    el('p', { class: 'fine' }, 'Os três primeiros passos são do rastreamento anônimo (pessoas por navegador). Conta, cobrança e assinatura vêm dos registros reais; quem já tinha conta e só voltou não entra em "criaram a conta".'),
    cardOpts({ sub: 'Cada pessoa conta uma vez por etapa.' }),
  );
  const dayLabel = (x) => new Date(`${x.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const byDay = grid(
    2,
    card('Usuários ativos por dia', columns(pm.byDay.map((x) => ({ label: dayLabel(x), value: x.users })), { label: 'Usuários ativos por dia' })),
    card('Acessos por dia (pessoas por navegador)', columns(pm.byDay.map((x) => ({ label: dayLabel(x), value: x.landing + x.app })), { label: 'Acessos ao Prumo por dia' }), el('p', { class: 'fine' }, 'Soma das visitas à página /prumo e das aberturas do app.')),
  );
  const tabs = card(
    'Abas mais usadas no app',
    table(
      [{ label: 'Aba', render: (t) => PRUMO_TAB[t.tab] ?? t.tab }, { label: 'Pessoas', align: 'right', render: (t) => int(t.sessions) }, { label: 'Assinantes', align: 'right', render: (t) => int(t.users) }, { label: 'Aberturas', align: 'right', render: (t) => int(t.events) }, { label: '', render: (t) => bar(t.sessions, maxTab) }],
      pm.tabs,
      { emptyText: 'Ainda sem aberturas de abas registradas (o rastreamento do app começa a contar a partir da publicação).' },
    ),
  );
  const clicks = card(
    'Cliques e passos no Prumo',
    table([{ label: 'Ação', render: (c) => prumoCtaName(c.id) }, { label: 'Pessoas', align: 'right', render: (c) => int(c.sessions) }, { label: 'Cliques', align: 'right', render: (c) => int(c.clicks) }], pm.ctas, { emptyText: 'Sem cliques registrados ainda.' }),
  );
  const people = grid(
    2,
    card('Usuários ativos por plano', table([{ label: 'Plano', render: (p) => PLAN[p.plan] ?? (p.plan === 'sem_plano' ? 'Sem plano ativo' : p.plan) }, { label: 'Pessoas', align: 'right', render: (p) => int(p.users) }], pm.byPlan, { emptyText: 'Sem usuários ativos registrados ainda.' })),
    card('Aparelhos de quem acessa o Prumo', table([{ label: 'Aparelho', render: (x) => DEVICE[x.device] ?? x.device }, { label: 'Pessoas', align: 'right', render: (x) => int(x.sessions) }], pm.devices, { emptyText: 'Sem dados.' })),
  );
  const sources = card(
    'De onde vêm as visitas do Prumo',
    table([{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Pessoas', align: 'right', render: (s) => int(s.sessions) }], pm.sources, { emptyText: 'Sem visitas rastreadas ainda.' }),
    el('p', { class: 'fine' }, 'Use links com UTM ao divulgar o Prumo (ex.: folego.online/prumo?utm_source=instagram&utm_medium=bio).'),
  );
  return el('div', { class: 'bo-stack' }, overview, grid(2, funnel, tabs), byDay, grid(2, clicks, sources), people);
}

export async function dashboardScreen(ctx) {
  const days = ctx.state.days;
  const [d, saude] = await Promise.all([api.dashboard(days), api.saude().catch(() => null)]);
  const steps = d.funnel.steps;
  const step = (k) => steps.find((s) => s.key === k)?.count ?? 0;
  const ab = d.funnel.abandonment;
  const pp = d.funnel.partners;
  const bn = d.funnel.banner;
  const rev = d.revenue;
  const sub = d.subscriptions;
  const overall = step('visitors') > 0 ? (step('paid') / step('visitors')) * 100 : null;
  const partnerEarnings = pp.leadRevenueCents + pp.commissionDueCents + pp.commissionReceivedCents;
  const bannerTable = () => table([{ label: 'Campanha', render: (b) => el('span', {}, b.campaign, el('span', { class: 'fine muted' }, ` · ${b.partner}`)) }, { label: 'Exibições', align: 'right', render: (b) => int(b.shown) }, { label: 'Cliques', align: 'right', render: (b) => int(b.clicks) }, { label: 'Taxa de clique', align: 'right', render: (b) => pct(b.ctrPct) }], bn.byCampaign, { emptyText: 'Nenhum banner de parceiro foi exibido no período. Cadastre em Parcerias > editar a campanha.' });
  const deliveriesTable = () => table([{ label: 'Situação', render: (x) => DELIVERY_ST[x[0]] ?? x[0] }, { label: 'Contatos', align: 'right', render: (x) => int(x[1]) }], Object.entries(pp.deliveriesByStatus), { emptyText: 'Nenhum contato entregue a parceiros no período.' });

  // ---------- detalhe de cada cartão (gaveta) ----------
  const h3 = (t) => el('h3', {}, t);
  const note = (t) => el('p', { class: 'muted' }, t);
  const tr = d.traffic;
  const p0 = d.profile;
  const funnelTable = () => table([{ label: 'Etapa', render: (s) => s.label }, { label: 'Pessoas', align: 'right', render: (s) => int(s.count) }, { label: 'Do passo anterior', align: 'right', render: (s) => pct(s.pctOfPrev) }], steps);
  const sourcesTable = () => table([{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Visitas', align: 'right', render: (s) => int(s.visitors) }, { label: 'Diagnósticos', align: 'right', render: (s) => int(s.cases) }, { label: 'Mapas', align: 'right', render: (s) => int(s.freeMaps) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Receita', align: 'right', render: (s) => brl(s.revenueCents) }], tr.sources, { emptyText: 'Sem visitas rastreadas ainda.' });
  const viewsTable = () => table([{ label: 'Tela', render: (v) => VIEW[v.view] ?? v.view }, { label: 'Pessoas', align: 'right', render: (v) => int(v.sessions) }, { label: 'Aberturas', align: 'right', render: (v) => int(v.events) }], tr.views, { emptyText: 'Sem dados.' });
  const productsTable = () => table([{ label: 'Produto', render: (x) => PRODUCT[x.code] ?? x.name }, { label: 'Vendas', align: 'right', render: (x) => int(x.units) }, { label: 'Receita', align: 'right', render: (x) => brl(x.cents) }, { label: 'Ticket', align: 'right', render: (x) => (x.units ? brl(Math.round(x.cents / x.units)) : '—') }], rev.byProduct, { emptyText: 'Nenhuma venda no período.' });
  /** Só produtos cobrados: pedidos gerados, pagos, quem gerou o Pix e não pagou, receita e conversão. O Mapa (grátis) não entra. */
  const chargedTable = () => table([{ label: 'Produto', render: (x) => PRODUCT[x.code] ?? x.name }, { label: 'Pedidos', align: 'right', render: (x) => int(x.orders) }, { label: 'Pagos', align: 'right', render: (x) => int(x.paid) }, { label: 'Não pagaram', align: 'right', render: (x) => int(x.unpaid) }, { label: 'Receita', align: 'right', render: (x) => brl(x.revenueCents) }, { label: 'Conversão', align: 'right', render: (x) => pct(x.conversionPct) }], d.funnel.products, { emptyText: 'Nenhum produto cobrado vendido no período.' });
  const methodsTable = () => table([{ label: 'Meio', render: (m) => (m.method === 'pix' ? 'Pix' : m.method === 'card' ? 'Cartão' : m.method) }, { label: 'Pagamentos', align: 'right', render: (m) => int(m.orders) }, { label: 'Valor', align: 'right', render: (m) => brl(m.cents) }], rev.byMethod, { emptyText: 'Nenhum pagamento confirmado no período.' });
  const dayChart = () => columns(rev.byDay.map((x) => ({ label: new Date(`${x.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: x.cents })), { label: 'Receita por dia', format: brl });
  const plansTable = () => table([{ label: 'Plano', render: (x) => PLAN[x.plan] ?? x.plan }, { label: 'Pagando', align: 'right', render: (x) => int(x.payingCount) }, { label: 'Em débito', align: 'right', render: (x) => int(x.delinquent) }, { label: 'Receita/mês', align: 'right', render: (x) => brl(x.mrrCents) }], sub.byPlan, { emptyText: 'Sem assinantes.' });
  const segTable = (rows, labelOf = (k) => k) => table([{ label: 'Grupo', render: (s) => labelOf(s.key) }, { label: 'Casos', align: 'right', render: (s) => int(s.cases) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Conversão', align: 'right', render: (s) => pct(s.conversionPct) }], rows, { emptyText: 'Sem dados.' });
  /** Abre a gaveta; `link` leva à tela completa (só aparece se a pessoa tem a permissão). */
  function detail(title, build, link = null) {
    const dw = drawer(title);
    const nodes = build().filter(Boolean);
    if (link && ctx.can(link.perm)) {
      const go = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, link.label);
      go.addEventListener('click', () => {
        dw.close();
        history.pushState(null, '', `/gestao/${link.route}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      nodes.push(el('div', { class: 'bo-actions' }, go));
    }
    dw.body.append(el('div', { class: 'bo-detail' }, ...nodes));
  }
  const period = `Período: últimos ${days === 3650 ? 'todos os' : days} ${days === 3650 ? 'registros' : 'dias'}.`;
  const DETAILS = {
    visitors: () => detail('Visitantes', () => [note(`${period} Quem entrou no site e o que fez.${tr.trackingSince ? ` Rastreamento desde ${new Date(tr.trackingSince).toLocaleDateString('pt-BR')}.` : ''}`), kpis(kpi('Visitantes', int(step('visitors'))), kpi('Pagaram', int(step('paid')), `${pct(overall)} dos visitantes`, 'good')), h3('Funil'), funnelTable(), h3('De onde vêm as visitas'), sourcesTable(), h3('O que as pessoas fazem no site'), viewsTable(), note(`Tempo mediano da primeira visita ao pagamento: ${duration(tr.medianSecondsToPay)}.`)], { route: 'jornada', perm: 'jornada', label: 'Abrir Jornada e funil' }),
    diagnosed: () => detail('Diagnósticos feitos', () => [note(`${period} Perfil de quem fez o diagnóstico e quanto converte.`), kpis(kpi('Diagnósticos', int(step('diagnosed')), `${pct(steps.find((s) => s.key === 'diagnosed')?.pctOfPrev)} de quem começou`), kpi('Dívida média', brl(p0.avgDebtCents)), kpi('Com dívida em atraso', int(p0.withOverdue), p0.cases ? `${pct((p0.withOverdue / p0.cases) * 100)} dos casos` : '')), h3('Por vínculo de trabalho'), segTable(p0.byEmployment, (k) => EMPLOYMENT[k] ?? k), h3('Por faixa de renda'), segTable(p0.byIncome), h3('Por estado'), segTable(p0.byUf.slice(0, 12)), h3('Por tamanho da dívida'), segTable(p0.byDebt), h3('Tipos de dívida mais comuns'), table([{ label: 'Tipo', render: (k) => k.kind }, { label: 'Casos', align: 'right', render: (k) => int(k.cases) }], p0.debtKinds, { emptyText: 'Sem dados.' })], { route: 'jornada', perm: 'jornada', label: 'Abrir Jornada e funil' }),
    paid: () => detail('Quem pagou', () => [note(`${period} Pagamentos confirmados.`), kpis(kpi('Pagaram', int(step('paid')), `${pct(overall)} dos visitantes`, 'good'), kpi('Receita', brl(rev.grossCents), `${int(rev.orders)} pedidos pagos`, 'good'), kpi('Compraram, de quem abriu o Mapa', pct(ab.payRatePct), `${int(ab.paid)} pessoas`)), h3('Por produto cobrado'), chargedTable(), h3('Como pagaram'), methodsTable(), note(`Tempo mediano da primeira visita ao pagamento: ${duration(tr.medianSecondsToPay)}.`)], { route: 'clientes', perm: 'clientes', label: 'Abrir Clientes' }),
    revenue: () => detail('Receita', () => [note(`${period} Soma dos pedidos pagos.`), kpis(kpi('Receita', brl(rev.grossCents), `${int(rev.orders)} pedidos pagos`, 'good'), kpi('Ticket médio', brl(rev.avgTicketCents))), h3('Por dia'), dayChart(), h3('Por produto'), productsTable(), h3('Por meio de pagamento'), methodsTable()], { route: 'clientes', perm: 'clientes', label: 'Abrir Clientes' }),
    ticket: () => detail('Ticket médio', () => [note(`${period} Receita dividida pelos pedidos pagos; abaixo, o ticket de cada produto.`), kpis(kpi('Ticket médio', brl(rev.avgTicketCents)), kpi('Pedidos pagos', int(rev.orders)), kpi('Receita', brl(rev.grossCents))), h3('Por produto'), productsTable()]),
    mrr: () => detail('Receita recorrente (mês)', () => [note('Soma das mensalidades de quem está pagando hoje.'), kpis(kpi('Receita recorrente (mês)', brl(sub.mrrCents), `${int(sub.payingCount)} assinantes pagando`), kpi('Vencendo em 7 dias', int(sub.expiringSoon), brl(sub.mrrAtRiskCents), sub.expiringSoon ? 'warn' : ''), kpi('Em débito', int(sub.delinquent), sub.delinquent ? `${brl(sub.lostMrrCents)}/mês parados` : 'nenhuma', sub.delinquent ? 'bad' : '')), h3('Por plano'), plansTable()], { route: 'assinaturas', perm: 'assinaturas', label: 'Abrir Assinaturas' }),
    subs: () => detail('Assinaturas', () => [note(`${period} Situação das assinaturas do Prumo.`), kpis(kpi('Em dia', int(sub.upToDate)), kpi('Vencendo em 7 dias', int(sub.expiringSoon), brl(sub.mrrAtRiskCents), sub.expiringSoon ? 'warn' : ''), kpi('Não vão renovar', int(sub.cancelling)), kpi('Em débito', int(sub.delinquent), '', sub.delinquent ? 'bad' : ''), kpi('Renovação', pct(sub.renewalRatePct), 'quem já pagou 2+ vezes'), kpi('Novos no período', int(sub.newSubscribers))), h3('Por plano'), plansTable()], { route: 'assinaturas', perm: 'assinaturas', label: 'Abrir Assinaturas' }),
    abandon: () => detail('Até o Mapa e depois dele: quem parou e quem seguiu', () => [note(`${period} O Mapa é grátis: aqui está o que a pessoa faz até ele e depois dele.`), kpis(kpi('Começaram e não finalizaram', int(ab.startedNotFinished), 'saíram do formulário', ab.startedNotFinished ? 'warn' : ''), kpi('Viram o resultado e não liberaram o Mapa', int(ab.diagnosedNoMap), null, ab.diagnosedNoMap ? 'warn' : ''), kpi('Mapas liberados', int(ab.mapReleased), `${pct(ab.mapRatePct)} dos diagnósticos`, 'good'), kpi('Abriram o Mapa e não seguiram', int(ab.mapNoFollow), `${pct(ab.mapReleased ? (ab.mapNoFollow / ab.mapReleased) * 100 : null)} dos Mapas`, ab.mapNoFollow ? 'warn' : '')), h3('Quem abriu o Mapa e seguiu'), kpis(kpi('Preencheram o formulário do parceiro', int(ab.mapPartner), pct(ab.partnerRatePct)), kpi('Viram outros produtos', int(ab.viewedOtherProducts), 'cartas, calendário, guias…'), kpi('Clicaram no banner do parceiro', int(ab.mapBanner)), kpi('Seguiram (qualquer caminho)', int(ab.mapFollowed), pct(ab.followRatePct), 'good')), h3('Mapas liberados por origem'), table([{ label: 'Origem', render: (m) => MAP_SRC[m.provider] ?? m.provider }, { label: 'Mapas', align: 'right', render: (m) => int(m.maps) }], d.funnel.mapsBySource, { emptyText: 'Nenhum Mapa liberado no período.' }), h3('Perfil de quem faz o diagnóstico'), segTable(p0.byIncome), note('As hipóteses para melhorar estão em Marketing → Insights.')], { route: 'marketing', perm: 'marketing', label: 'Abrir Marketing' }),
    partners: () => detail('Parceiros: o que o Fôlego ganha', () => [note(`${period} A pessoa só entra aqui se autorizou, em separado e de forma opcional.`), kpis(kpi('Preencheram o formulário do parceiro', int(pp.consentsGranted), `${int(pp.consentsRevoked)} revogaram`), kpi('Autorizações ativas hoje', int(pp.consentsActive)), kpi('Contatos entregues', int(pp.deliveries)), kpi('Contratos fechados', int(pp.deals), brl(pp.volumeCents))), kpis(kpi('Receita por contato entregue', brl(pp.leadRevenueCents)), kpi('Comissão a receber', brl(pp.commissionDueCents), null, pp.commissionDueCents ? 'warn' : ''), kpi('Comissão recebida', brl(pp.commissionReceivedCents), null, 'good'), kpi('Total do período', brl(partnerEarnings), null, 'good')), h3('Contatos por situação'), deliveriesTable(), h3('Banner do parceiro no Mapa'), kpis(kpi('Exibições', int(bn.shown)), kpi('Cliques', int(bn.clicks)), kpi('Taxa de clique', pct(bn.ctrPct))), bannerTable()], { route: 'parcerias', perm: 'parcerias', label: 'Abrir Parcerias' }),
    profile: () => detail('Perfil dos clientes', () => [note(`${period} Quem são as pessoas que fazem o diagnóstico.`), kpis(kpi('Diagnósticos', int(p0.cases)), kpi('Dívida total informada', brl(p0.totalDebtCents)), kpi('Dívida média', brl(p0.avgDebtCents)), kpi('Com dívida em atraso', int(p0.withOverdue), p0.cases ? `${pct((p0.withOverdue / p0.cases) * 100)} dos casos` : '')), h3('Por vínculo de trabalho'), segTable(p0.byEmployment, (k) => EMPLOYMENT[k] ?? k), h3('Por faixa de renda'), segTable(p0.byIncome), h3('Por faixa etária'), segTable(p0.byAge), h3('Por estado'), segTable(p0.byUf.slice(0, 12)), h3('Por tamanho da dívida'), segTable(p0.byDebt)]),
    ai: () => detail('Uso de IA', () => [note(`${period} Quantos textos a IA escreveu e quanto ela consumiu.`), kpis(kpi('Escritas pela IA', int(d.ai.ai)), kpi('Pelo modelo fixo', int(d.ai.template)), kpi('Tokens de entrada', int(d.ai.inputTokens)), kpi('Tokens de saída', int(d.ai.outputTokens))), note('Compare os tokens com o custo da sua conta Anthropic para saber quanto a IA custa por entrega.')]),
  };
  const open = (key) => () => DETAILS[key]();

  const head = el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, `Período: últimos ${days === 3650 ? 'todos os' : days} ${days === 3650 ? 'registros' : 'dias'}. Atualizado às ${new Date(d.generatedAt).toLocaleTimeString('pt-BR')}.`), periodSelect(days, (v) => ctx.setDays(v)));

  // O Mapa é grátis: os números principais são o caminho até ele e o que a pessoa faz depois. "Pagaram" e "Receita" só contam o que é cobrado.
  const top = kpis(
    kpi('Visitantes', int(step('visitors')), d.traffic.trackingSince ? `desde ${new Date(d.traffic.trackingSince).toLocaleDateString('pt-BR')}` : 'rastreamento novo', '', open('visitors')),
    kpi('Diagnósticos feitos', int(step('diagnosed')), `${pct(steps.find((s) => s.key === 'diagnosed')?.pctOfPrev)} de quem começou`, '', open('diagnosed')),
    kpi('Mapas liberados (grátis)', int(step('mapped')), `${pct(ab.mapRatePct)} dos diagnósticos`, 'good', open('abandon')),
    kpi('Preencheram e não finalizaram', int(ab.startedNotFinished), 'começaram o formulário e saíram', ab.startedNotFinished ? 'warn' : '', open('abandon')),
    kpi('Viram o resultado e não liberaram o Mapa', int(ab.diagnosedNoMap), null, ab.diagnosedNoMap ? 'warn' : '', open('abandon')),
    kpi('Viram o Mapa e não seguiram', int(ab.mapNoFollow), `${pct(ab.mapReleased ? (ab.mapNoFollow / ab.mapReleased) * 100 : null)} dos Mapas`, ab.mapNoFollow ? 'warn' : '', open('abandon')),
    kpi('Viram o Mapa e preencheram o formulário do parceiro', int(ab.mapPartner), `${pct(ab.partnerRatePct)} dos Mapas`, 'good', open('partners')),
    kpi('Viram outros produtos', int(ab.viewedOtherProducts), 'cartas, calendário, guias…', '', open('abandon')),
    kpi('Pagaram (produtos cobrados)', int(step('paid')), `${pct(ab.payRatePct)} de quem abriu o Mapa`, 'good', open('paid')),
    kpi('Receita (só o que é cobrado)', brl(rev.grossCents), `${int(rev.orders)} pedidos pagos`, 'good', open('revenue')),
    kpi('Ganho com parceiros', brl(partnerEarnings), `${int(pp.deliveries)} contatos entregues · ${int(pp.deals)} contratos`, 'good', open('partners')),
    kpi('Receita recorrente (mês)', brl(sub.mrrCents), `${int(sub.payingCount)} assinantes pagando`, '', open('mrr')),
    kpi('Assinaturas em débito', int(sub.delinquent), sub.delinquent ? `${brl(sub.lostMrrCents)}/mês parados` : 'nenhuma', sub.delinquent ? 'bad' : '', open('subs')),
  );

  const funnel = card(
    'Funil: da visita ao Mapa e além',
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
    el('p', { class: 'fine' }, 'Visitantes e "começaram" vêm do rastreamento do site (anônimo). Do diagnóstico em diante, os números vêm dos registros reais. "Seguiram" = preencheram o formulário do parceiro, viram outro produto ou clicaram no banner; "compraram" só conta produto cobrado.'),
    cardOpts({ sub: 'Cada pessoa conta uma vez por etapa.' }),
  );

  const aband = card(
    'Onde as pessoas param',
    kpis(kpi('Começaram e não finalizaram', int(ab.startedNotFinished), null, '', open('abandon')), kpi('Viram o resultado e não liberaram o Mapa', int(ab.diagnosedNoMap), null, '', open('abandon')), kpi('Abriram o Mapa e não seguiram', int(ab.mapNoFollow), `${pct(ab.mapReleased ? (ab.mapNoFollow / ab.mapReleased) * 100 : null)} dos Mapas`, '', open('abandon')), kpi('Seguiram depois do Mapa', int(ab.mapFollowed), pct(ab.followRatePct), 'good', open('abandon'))),
    el('p', { class: 'muted' }, 'Veja o perfil de quem faz o diagnóstico em "Perfil dos clientes" e as hipóteses em Marketing → Insights.'),
    rev.unpaidOrders && Object.keys(rev.unpaidOrders).length ? el('p', { class: 'fine' }, `Pedidos de produtos cobrados não pagos no período: ${Object.entries(rev.unpaidOrders).map(([k, v]) => `${v} ${k}`).join(', ')}.`) : null,
  );
  const partnersCard = card(
    'Parceiros e banner no Mapa',
    kpis(kpi('Preencheram o formulário do parceiro', int(pp.consentsGranted), `${int(pp.consentsRevoked)} revogaram`, '', open('partners')), kpi('Contatos entregues', int(pp.deliveries), null, '', open('partners')), kpi('Contratos fechados', int(pp.deals), brl(pp.volumeCents), 'good', open('partners')), kpi('Comissão a receber', brl(pp.commissionDueCents), `${brl(pp.commissionReceivedCents)} já recebida`, pp.commissionDueCents ? 'warn' : '', open('partners')), kpi('Banner: exibições', int(bn.shown), `${int(bn.clicks)} cliques`, '', open('partners')), kpi('Banner: taxa de clique', pct(bn.ctrPct), null, '', open('partners'))),
    bannerTable(),
    el('p', { class: 'fine' }, 'O contato só chega ao parceiro com a autorização da pessoa (formulário opcional, em separado). O banner é publicidade marcada como tal.'),
  );

  const byDay = card('Receita por dia', columns(rev.byDay.map((x) => ({ label: new Date(`${x.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: x.cents })), { label: 'Receita por dia', format: brl }));

  const maxProd = Math.max(...d.funnel.products.map((p) => p.revenueCents), 1);
  const products = card(
    'Pagaram: por produto cobrado',
    table(
      [
        { label: 'Produto', render: (p) => PRODUCT[p.code] ?? p.name },
        { label: 'Pedidos', align: 'right', render: (p) => int(p.orders) },
        { label: 'Pagos', align: 'right', render: (p) => int(p.paid) },
        { label: 'Não pagaram', align: 'right', render: (p) => int(p.unpaid) },
        { label: 'Receita', align: 'right', render: (p) => brl(p.revenueCents) },
        { label: '', render: (p) => bar(p.revenueCents, maxProd) },
      ],
      d.funnel.products,
      { emptyText: 'Nenhum produto cobrado vendido no período.' },
    ),
    el('p', { class: 'fine' }, 'O Mapa da Virada é grátis e não aparece aqui. "Não pagaram" são pedidos de Pix gerados e não pagos.'),
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
    kpis(kpi('Em dia', int(sub.upToDate), null, '', open('subs')), kpi('Vencendo em 7 dias', int(sub.expiringSoon), brl(sub.mrrAtRiskCents), sub.expiringSoon ? 'warn' : '', open('subs')), kpi('Não vão renovar', int(sub.cancelling), null, '', open('subs')), kpi('Em débito', int(sub.delinquent), '', sub.delinquent ? 'bad' : '', open('subs')), kpi('Renovação', pct(sub.renewalRatePct), 'quem já pagou 2+ vezes', '', open('subs')), kpi('Novos no período', int(sub.newSubscribers), null, '', open('subs'))),
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
    card('Perfil dos clientes', kpis(kpi('Diagnósticos', int(p.cases), null, '', open('profile')), kpi('Dívida total informada', brl(p.totalDebtCents), null, '', open('profile')), kpi('Dívida média', brl(p.avgDebtCents), null, '', open('profile')), kpi('Com dívida em atraso', int(p.withOverdue), p.cases ? `${pct((p.withOverdue / p.cases) * 100)} dos casos` : '', '', open('profile')))),
    grid(2, seg('Por vínculo de trabalho', p.byEmployment, (k) => EMPLOYMENT[k] ?? k), seg('Por faixa de renda', p.byIncome), seg('Por estado', p.byUf.slice(0, 12)), seg('Por faixa etária', p.byAge), seg('Por tamanho da dívida', p.byDebt), card('Tipos de dívida mais comuns', table([{ label: 'Tipo', render: (k) => k.kind }, { label: 'Casos', align: 'right', render: (k) => int(k.cases) }], p.debtKinds, { emptyText: 'Sem dados.' }))),
  );

  const t = d.traffic;
  const traffic = grid(
    2,
    card(
      'De onde vêm as visitas',
      table(
        [{ label: 'Origem', render: (s) => (s.medium ? `${s.source} / ${s.medium}` : s.source) }, { label: 'Visitas', align: 'right', render: (s) => int(s.visitors) }, { label: 'Diagnósticos', align: 'right', render: (s) => int(s.cases) }, { label: 'Mapas', align: 'right', render: (s) => int(s.freeMaps) }, { label: 'Pagaram', align: 'right', render: (s) => int(s.paid) }, { label: 'Receita', align: 'right', render: (s) => brl(s.revenueCents) }],
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

  const ai = card('Uso de IA', kpis(kpi('Escritas pela IA', int(d.ai.ai), null, '', open('ai')), kpi('Pelo modelo fixo', int(d.ai.template), null, '', open('ai')), kpi('Tokens de entrada', int(d.ai.inputTokens), null, '', open('ai')), kpi('Tokens de saída', int(d.ai.outputTokens), null, '', open('ai'))), el('p', { class: 'fine' }, 'Compare os tokens com o custo da sua conta Anthropic para saber quanto a IA custa por entrega.'));

  return el('div', { class: 'bo-stack' }, head, top, grid(2, funnel, aband), partnersCard, byDay, grid(2, products, methods), subs, profile, traffic, d.prumo ? prumoSection(d.prumo, days) : null, timing, ai, saudeCard(saude));
}

const SAUDE = { banco: 'Banco de dados', worker: 'Worker (entregas em segundo plano)', fila: 'Fila de entregas', webhooks: 'Eventos de pagamento', ebook: 'Envio do e-book', backup: 'Backup', disco: 'Disco do servidor', custos: 'Custos e limites (IA e e-mail)' };

/** Semáforo do sistema: o mesmo que o monitor externo confere a cada 10 minutos (e avisa por e-mail se algo falhar). */
function saudeCard(s) {
  if (!s) return null;
  return card(
    s.ok ? 'Sistema saudável' : 'Atenção: algo precisa de cuidado',
    el('ul', { class: 'bo-saude' }, ...Object.entries(s.checks).map(([k, c]) => el('li', {}, badge(c.ok ? 'ok' : 'atenção', c.ok ? 'ok' : 'bad'), ' ', el('strong', {}, SAUDE[k] ?? k), el('span', { class: 'muted' }, ' — ' + c.detail)))),
    cardOpts({ sub: 'Monitor externo roda a cada 10 minutos.' }),
  );
}
