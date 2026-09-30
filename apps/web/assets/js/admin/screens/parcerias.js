// Parcerias: o tamanho do público e do "pool" com consentimento — números para conversar com SEBRAE, escolas técnicas,
// faculdades e instituições financeiras. Não lista pessoas; o contato só aparece por consulta auditada.
import { api } from '../api.js';
import { el, brl, int, dt, shortId, card, kpi, kpis, grid, table, badge, periodSelect, EMPLOYMENT, CATEGORY } from '../ui.js';
import { caseDrawer } from './shared.js';

export async function parceriasScreen(ctx) {
  const days = ctx.state.days;
  const [p, c] = await Promise.all([api.parcerias(days), api.contatos({}).catch(() => ({ items: [] }))]);
  const pot = p.potential;
  const pctOf = (n) => (pot.cases ? `${Math.round((n / pot.cases) * 100)}% dos diagnósticos` : '');

  return el(
    'div', { class: 'bo-stack' },
    el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Público potencial vem dos diagnósticos (perfil, sem identificar ninguém). Só vira lead quem autorizou contato — separado por categoria.'), periodSelect(days, (v) => ctx.setDays(v))),
    card('Público potencial no período (ainda sem autorização)', kpis(
      kpi('Diagnósticos', int(pot.cases)),
      kpi('Com dívida em atraso', int(pot.renegotiation), pctOf(pot.renegotiation) + ' · renegociação'),
      kpi('Perfil de consignado', int(pot.consignadoProfile), pctOf(pot.consignadoProfile) + ' · CLT/servidor/INSS com dívida cara'),
      kpi('Autônomos e outros vínculos', int(pot.entrepreneurship), pctOf(pot.entrepreneurship) + ' · empreendedorismo'),
      kpi('Renda até R$ 3.000 e em atraso', int(pot.lowIncomeOverdue), 'público de educação financeira/capacitação'),
    ), el('p', { class: 'fine' }, 'São estimativas por regra de perfil, não uma oferta nem uma lista de contatos. O que pode ser compartilhado com parceiros é só o que a pessoa autorizou.')),
    card('Quem autorizou contato de parceiros', kpis(
      kpi('Pessoas com autorização ativa', int(p.consentedCases), '', p.consentedCases ? 'good' : ''),
      kpi('Entrevistas de renda extra', int(p.incomeInterviews.total), `${int(p.incomeInterviews.committed)} com 10h+ por semana`),
      kpi('Parceiros cadastrados', int(p.partners)),
    ), grid(3,
      table([{ label: 'Categoria', render: (x) => CATEGORY[x.category] ?? x.category }, { label: 'Pessoas', align: 'right', render: (x) => int(x.count) }], p.consentedByCategory, { emptyText: 'Ninguém autorizou ainda.' }),
      table([{ label: 'Estado', render: (x) => x.key }, { label: 'Pessoas', align: 'right', render: (x) => int(x.count) }], p.consentedByUf, { emptyText: 'Sem dados.' }),
      table([{ label: 'Vínculo', render: (x) => EMPLOYMENT[x.key] ?? x.key }, { label: 'Pessoas', align: 'right', render: (x) => int(x.count) }], p.consentedByEmployment, { emptyText: 'Sem dados.' }),
    )),
    p.deliveries.length ? card('Entregas a parceiros', table([{ label: 'Situação', render: (d) => d.status }, { label: 'Leads', align: 'right', render: (d) => int(d.count) }, { label: 'Valor', align: 'right', render: (d) => brl(d.cents) }], p.deliveries)) : null,
    card('Contatos autorizados', el('p', { class: 'muted' }, 'A lista mostra só o perfil. Abra uma linha e use "Ver contato": a consulta exige permissão própria e fica registrada na auditoria.'), table(
      [
        { label: 'Caso', render: (x) => el('code', {}, shortId(x.caseId)) }, { label: 'Autorizou em', render: (x) => dt(x.consentedAt) }, { label: 'Categorias', render: (x) => x.categories.map((k) => CATEGORY[k] ?? k).join(', ') },
        { label: 'Estado', render: (x) => x.uf ?? '—' }, { label: 'Vínculo', render: (x) => EMPLOYMENT[x.employment] ?? '—' }, { label: 'Dívida', align: 'right', render: (x) => (x.debtTotalCents === null ? '—' : brl(x.debtTotalCents)) },
        { label: 'Entrevista', render: (x) => (x.hasInterview ? badge('renda extra', 'muted') : '—') },
      ],
      c.items,
      { emptyText: 'Nenhum contato autorizado ainda.', onRow: (x) => caseDrawer(x.caseId, ctx) },
    )),
  );
}

