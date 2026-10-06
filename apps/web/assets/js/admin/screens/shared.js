// Peças usadas por mais de uma tela: linha do tempo da jornada e as gavetas de detalhe (caso e assinante).
import { api } from '../api.js';
import { el, icon, toast, brl, int, dt, day, shortId, drawer, dl, badge, table, field, empty, loading, errorBox, EMPLOYMENT, PRODUCT, PLAN, SUB_STATUS, CATEGORY } from '../ui.js';

const KIND_ICON = { view: 'list', click: 'arrow-right', tool: 'shield', step: 'clock', case: 'chart', order: 'wallet', payment: 'check', delivery: 'check', consent: 'shield', account: 'lock', admin: 'alert' };

export function timeline(items) {
  if (!items || items.length === 0) return empty('Sem registros de navegação para este cliente (o rastreamento só guarda o que aconteceu depois de ativado).');
  return el(
    'ol', { class: 'bo-timeline' },
    ...items.map((i) =>
      el('li', { class: `bo-tl-${i.kind}` }, el('span', { class: 'bo-tl-dot', 'aria-hidden': 'true' }, icon(KIND_ICON[i.kind] ?? 'info')), el('div', {}, el('strong', {}, i.label), i.detail ? el('span', { class: 'muted' }, ` · ${i.detail}`) : null, el('div', { class: 'fine' }, dt(i.at)))),
    ),
  );
}

const ORDER_STATUS = { paid: ['Pago', 'ok'], pending: ['Pendente', 'warn'], expired: ['Expirado', 'muted'], canceled: ['Cancelado', 'muted'], refunded: ['Reembolsado', 'bad'] };

/** Gaveta com tudo de um comprador avulso: perfil, pedidos, entregas, consentimento e jornada. */
export async function caseDrawer(id, ctx) {
  const dw = drawer(`Cliente avulso ${shortId(id)}`);
  dw.body.append(loading());
  try {
    const [c, j] = await Promise.all([api.avulso(id), api.jornadaCaso(id).catch(() => ({ timeline: [] }))]);
    const contactBox = el('div', { class: 'bo-contact' });
    if (c.hasContact && c.leadConsent?.active) {
      if (ctx.can('clientes_pii')) {
        const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('lock'), 'Ver contato (fica registrado)');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const r = await api.contato(id);
            contactBox.replaceChildren(dl([['Nome', r.name], ['Telefone', r.phone], ['E-mail', r.email ?? '—']]), el('p', { class: 'fine' }, 'Esta consulta foi registrada na auditoria.'));
          } catch (e) {
            btn.disabled = false;
            toast(e.message);
          }
        });
        contactBox.append(btn);
      } else contactBox.append(el('p', { class: 'fine' }, 'Há contato autorizado, mas você não tem a permissão para ver dados pessoais.'));
    } else if (c.hasContact) contactBox.append(el('p', { class: 'fine' }, 'Há contato guardado, mas a pessoa não autoriza (ou revogou) o contato: os dados ficam ocultos.'));
    else contactBox.append(el('p', { class: 'fine' }, 'Nenhum contato guardado (compra anônima).'));

    // replaceChildren() nativo não ignora null (viraria o texto "null"): por isso o filter.
    dw.body.replaceChildren(...[
      el('section', {}, el('h3', {}, 'Perfil'), dl([
        ['Criado em', dt(c.createdAt)], ['Tipo', c.kind === 'translator' ? 'Tradutor de Cobrança' : 'Diagnóstico de dívidas'], ['Estado', c.uf], ['Vínculo', EMPLOYMENT[c.employment] ?? c.employment],
        ['Faixa etária', c.ageBand], ['Renda líquida', c.netIncomeCents === null ? '—' : brl(c.netIncomeCents)], ['Dívida total', c.debtTotalCents === null ? '—' : `${brl(c.debtTotalCents)} em ${c.debtCount} dívidas`],
        ['Em atraso', c.hasOverdue ? 'Sim' : 'Não'], ['Tipos de dívida', c.debtKinds.join(', ') || '—'], ['Dados expiram em', day(c.purgeAfter)],
      ])),
      el('section', {}, el('h3', {}, 'Compras'), table([
        { label: 'Pedido', render: (o) => shortId(o.id) }, { label: 'Itens', render: (o) => o.items }, { label: 'Total', align: 'right', render: (o) => brl(o.totalCents) },
        { label: 'Situação', render: (o) => badge(...(ORDER_STATUS[o.status] ?? [o.status, 'muted'])) }, { label: 'Meio', render: (o) => (o.method ? `${o.method}${o.provider === 'fake' ? ' (simulado)' : ''}` : '—') }, { label: 'Data', render: (o) => dt(o.paidAt ?? o.createdAt) },
      ], c.orders, { emptyText: 'Não gerou pedido: só viu o resultado grátis.' })),
      c.deliverables.length ? el('section', {}, el('h3', {}, 'Entregas'), table([{ label: 'Produto', render: (d) => PRODUCT[d.product] ?? d.product }, { label: 'Situação', render: (d) => d.status }, { label: 'Origem', render: (d) => (d.source === 'ai' ? 'IA' : d.source === 'template' ? 'Modelo fixo' : '—') }, { label: 'Quando', render: (d) => dt(d.at) }], c.deliverables)) : null,
      c.incomeInterview ? el('section', {}, el('h3', {}, 'Entrevista de renda extra'), dl([['Horas por semana', c.incomeInterview.hoursBand], ['Modo', c.incomeInterview.mode], ['Tem veículo', c.incomeInterview.hasVehicle ? 'Sim' : 'Não'], ['Capital para começar', brl(c.incomeInterview.capitalCents)]])) : null,
      el('section', {}, el('h3', {}, 'Contato e autorização'), c.leadConsent ? dl([['Autorização', c.leadConsent.active ? badge('Ativa', 'ok') : badge('Revogada', 'muted')], ['Categorias', c.leadConsent.categories.map((k) => CATEGORY[k] ?? k).join(', ') || '—'], ['Desde', dt(c.leadConsent.at)]]) : el('p', { class: 'fine' }, 'Sem autorização de contato de parceiros.'), contactBox),
      el('section', {}, el('h3', {}, 'Jornada no site'), timeline(j.timeline)),
    ].filter(Boolean));
  } catch (e) {
    dw.body.replaceChildren(errorBox(e));
  }
}

/** Gaveta do assinante: situação, pedidos, uso, histórico e ações manuais (sempre com motivo). */
const CREDIT = { available: ['Disponível', 'warn'], applied: ['Aplicado em fatura', 'ok'], revoked: ['Revogado', 'muted'] };

/** Indicações e descontos do cliente: de onde veio, o que indicou, créditos (dados/aplicados) e se o valor no provedor confere. */
function referralSection(r) {
  if (!r) return null;
  const b = r.billing;
  const money = (c) => (c === null || c === undefined ? '—' : brl(c));
  return el(
    'section', {},
    el('h3', {}, 'Indicações e descontos'),
    dl([
      ['Código de indicação', r.code ?? 'ainda não gerado'],
      ['Chegou indicado por', r.referredBy ? `${r.referredBy}${r.creditedForReferrer ? ' (desconto já creditado a quem indicou)' : ' (aguardando a 1ª cobrança)'}` : '—'],
      ['Indicou / assinaram', `${int(r.invited)} / ${int(r.converted)}`],
      ...(b ? [
        ['Cobrança', `${b.status === 'active' ? 'Em dia' : b.status === 'past_due' ? 'Cartão recusado' : b.status === 'canceled' ? 'Cancelada' : 'Pendente'} · termos aceitos em ${dt(b.termsAcceptedAt)} (v${b.termsVersion})`],
        ['Valor contratado', money(b.listCents)],
        ['Próxima fatura deve ser', `${money(b.wantedCents)}${b.creditsAvailable ? ` (${b.creditsAvailable} mês(es) de desconto)` : ''}`],
        ['Valor no provedor (Asaas)', `${money(b.syncedCents)} ${b.inSync ? '✓ confere' : '⚠ divergente: o ajuste automático corrige em instantes'}`],
      ] : []),
    ]),
    r.credits.length
      ? table(
          [
            { label: 'Crédito', render: (c) => `${c.percent}% · ${c.source === 'manual' ? 'manual' : 'indicação'}` },
            { label: 'Situação', render: (c) => badge(...(CREDIT[c.status] ?? [c.status, 'muted'])) },
            { label: 'Origem', render: (c) => c.friend ?? c.note ?? '—' },
            { label: 'Fatura', align: 'right', render: (c) => (c.appliedAmountCents ? brl(c.appliedAmountCents) : '—') },
            { label: 'Quando', render: (c) => dt(c.appliedAt ?? c.createdAt) },
          ],
          r.credits,
        )
      : el('p', { class: 'fine' }, 'Nenhum crédito de desconto até agora.'),
  );
}

/** Dados cadastrais do assinante: CPF só com os 4 últimos dígitos; completo e celular só com permissão (e fica na auditoria). */
function personalData(s, ctx) {
  const masked = s.cpfLast4 ? `***.***.*${s.cpfLast4.slice(0, 2)}-${s.cpfLast4.slice(2)}` : '—';
  const box = el('dl', { class: 'bo-dl' });
  const fill = (v) => box.replaceChildren(...Object.entries(v).map(([k, val]) => el('div', {}, el('dt', {}, k), el('dd', {}, val || '—'))));
  fill({ Nome: s.name || '—', 'E-mail': s.email, CPF: masked, Celular: s.hasPhone ? 'informado' : '—' });
  const reveal = ctx.can('clientes_pii') && (s.cpfLast4 || s.hasPhone)
    ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const d = await api.assinanteDados(s.id);
          fill({ Nome: d.name || s.name || '—', 'E-mail': s.email, CPF: d.cpf ? d.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '—', Celular: d.phone ? d.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '—' });
          btn.remove();
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
        }
      } }, 'Mostrar CPF e celular (fica na auditoria)')
    : null;
  return el('section', {}, el('h3', {}, 'Dados cadastrais'), box, reveal);
}

export async function subscriberDrawer(id, ctx, onChange = () => {}) {
  const dw = drawer('Assinante');
  dw.body.append(loading());
  const render = async () => {
    const [s, j] = await Promise.all([api.assinante(id), api.jornadaAssinante(id).catch(() => ({ timeline: [] }))]);
    const [label, tone] = SUB_STATUS[s.status] ?? [s.status, 'muted'];
    const reason = el('input', { class: 'input', type: 'text', maxlength: '200', placeholder: 'Motivo (fica na auditoria)', 'aria-label': 'Motivo da ação' });
    const days = el('input', { class: 'input input-sm', type: 'number', min: '1', max: '365', value: '7', 'aria-label': 'Dias' });
    const plan = el('select', { class: 'input input-sm', 'aria-label': 'Plano' }, ...['controle', 'ousado', 'desbravador'].map((p) => el('option', { value: p, selected: p === s.plan }, PLAN[p])));
    const run = async (body, okMsg) => {
      if (reason.value.trim().length < 3) return toast('Escreva o motivo (mínimo 3 letras).');
      try {
        await api.assinanteAcao(id, { ...body, reason: reason.value.trim() });
        toast(okMsg);
        onChange();
        await render();
      } catch (e) {
        toast(e.message);
      }
    };
    const actions = ctx.can('assinaturas')
      ? el(
          'section', {},
          el('h3', {}, 'Ações'),
          field('Motivo', reason),
          el('div', { class: 'bo-actions' },
            el('label', { class: 'bo-inline' }, 'Dar', days, 'dias'),
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => run({ type: 'extend', days: Number(days.value) }, 'Dias adicionados.') }, 'Estender assinatura'),
          ),
          el('div', { class: 'bo-actions' },
            el('label', { class: 'bo-inline' }, 'Plano', plan),
            el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => run({ type: 'set_plan', plan: plan.value }, 'Plano atualizado.') }, 'Definir plano'),
          ),
          el('div', { class: 'bo-actions' }, s.plan ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => run({ type: 'cancel', cancel: !s.cancelAtPeriodEnd }, s.cancelAtPeriodEnd ? 'Voltou a renovar.' : 'Marcado para não renovar.') }, s.cancelAtPeriodEnd ? 'Voltar a renovar' : 'Marcar para não renovar') : null),
        )
      : null;
    dw.body.replaceChildren(...[
      el('div', { class: 'bo-head-line' }, el('h3', {}, s.name || s.email), s.awaitingPayment ? badge('Pagamento iniciado', 'warn') : badge(label, tone)),
      personalData(s, ctx),
      dl([['Plano', s.plan ? PLAN[s.plan] : '—'], ['Vence em', s.periodEnd ? day(s.periodEnd) : '—'], ['Cadastro', dt(s.createdAt)], ['Último acesso', dt(s.lastLoginAt)], ['Lançamentos', int(s.usage.entries)], ['Metas / aportes', `${int(s.usage.goals)} / ${int(s.usage.contributions)}`], ['Último lançamento', dt(s.usage.lastEntryAt)]]),
      actions,
      el('section', {}, el('h3', {}, 'Pedidos'), table([
        { label: 'Item', render: (o) => PRODUCT[o.product] ?? o.product },
        { label: 'Forma', render: (o) => (o.method === 'card' ? 'Cartão (mensal)' : o.method === 'pix' ? 'Pix' : '—') },
        { label: 'Tabela', align: 'right', render: (o) => (o.listCents ? brl(o.listCents) : '—') },
        { label: 'Cobrado', align: 'right', render: (o) => brl(o.totalCents) },
        { label: 'Desconto', render: (o) => (o.discountCents > 0 ? badge(`-${brl(o.discountCents)}${o.creditPercent ? ` · ${o.creditPercent}% indicação` : ''}`, 'ok') : '—') },
        { label: 'Situação', render: (o) => badge(...(ORDER_STATUS[o.status] ?? [o.status, 'muted'])) },
        { label: 'Data', render: (o) => dt(o.paidAt ?? o.createdAt) },
      ], s.orders, { emptyText: 'Nenhum pedido.' })),
      referralSection(s.referral),
      s.history.length ? el('section', {}, el('h3', {}, 'Histórico de ações'), table([{ label: 'Quando', render: (h) => dt(h.at) }, { label: 'Ação', render: (h) => h.action.replace('admin_subscription_', '') }, { label: 'Quem / motivo', render: (h) => (h.data?.by ? `${h.data.by}${h.data.reason ? `: ${h.data.reason}` : ''}` : h.actor) }], s.history)) : null,
      el('section', {}, el('h3', {}, 'Jornada'), timeline(j.timeline)),
    ].filter(Boolean));
  };
  try {
    await render();
  } catch (e) {
    dw.body.replaceChildren(errorBox(e));
  }
}

