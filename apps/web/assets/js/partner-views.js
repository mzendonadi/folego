// Portal do parceiro: Painel, Contatos do Fôlego, Minha base e Contratos.
import { el, icon, toast } from './dom.js';
import { brl, todayISO } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';

export const STAGE = { novo: 'Novo', em_contato: 'Em contato', proposta: 'Proposta', fechado: 'Fechado', sem_interesse: 'Sem interesse' };
const STAGE_ORDER = ['novo', 'em_contato', 'proposta', 'fechado', 'sem_interesse'];
const LEAD_STATUS = { delivered: 'Novo', contacted: 'Em contato', converted: 'Contrato fechado', rejected: 'Descartado', queued: 'Na fila', failed: 'Na fila' };
const PRODUCT = { consignado: 'Consignado', cartao_consignado: 'Cartão consignado', refinanciamento: 'Refinanciamento', portabilidade: 'Portabilidade', outro: 'Outro' };
const EVENT = { nota: 'Nota', ligacao: 'Ligação', whatsapp: 'WhatsApp', etapa: 'Etapa', contrato: 'Contrato' };

export const fmtPhone = (p) => (p && p.length === 11 ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}` : p && p.length === 10 ? `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}` : p ?? '');
const fmtCpf = (c) => (c ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : '');
const dayBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
const pctText = (bps) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const monthLabel = (ym) => new Date(`${ym}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

const pill = (text, tone = '') => el('span', { class: `pt-pill ${tone}` }, text);
const section = (title, sub, ...children) => el('section', { class: 'pt-card' }, title ? el('h2', { class: 'pt-h2' }, title) : null, sub ? el('p', { class: 'pt-sub' }, sub) : null, ...children);
const empty = (title, text) => el('div', { class: 'pt-empty' }, el('strong', {}, title), el('p', {}, text));
const head = (title, sub, ...actions) => el('header', { class: 'pt-head' }, el('div', {}, el('h1', {}, title), sub ? el('p', {}, sub) : null), actions.length ? el('div', { class: 'pt-head-actions' }, ...actions) : null);

function metric(label, value, sub, tone = '') {
  return el('div', { class: `pt-metric ${tone}` }, el('span', { class: 'pt-metric-label' }, label), el('strong', { class: 'pt-metric-value' }, value), sub ? el('span', { class: 'pt-metric-sub' }, sub) : null);
}

/** Janela sobre a página (detalhe do contato, registro de contrato). Fecha com Esc, clique fora ou no botão. */
export function modal(title, ...content) {
  const prev = document.activeElement;
  const body = el('div', { class: 'pt-modal-body' }, ...content);
  const close = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Fechar' }, icon('x'));
  const box = el('div', { class: 'pt-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('header', {}, el('h2', {}, title), close), body);
  const back = el('div', { class: 'pt-backdrop' }, box);
  const shut = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') shut(); };
  close.addEventListener('click', shut);
  back.addEventListener('mousedown', (e) => { if (e.target === back) shut(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  close.focus();
  return { body, close: shut };
}

/** Formulário de contrato fechado. `source`: 'lead' (contato do Fôlego, com comissão), 'contact' (base própria) ou 'avulso'. */
function dealForm(ctx, { source, refId, name, bps, onDone }) {
  const amount = moneyInput({ id: 'pt-d-valor', ariaLabel: 'Valor do contrato' });
  const monthly = moneyInput({ id: 'pt-d-parcela', ariaLabel: 'Valor da parcela', placeholder: 'opcional' });
  const installments = el('input', { class: 'input', id: 'pt-d-prazo', type: 'number', min: '1', max: '240', placeholder: 'ex.: 84' });
  const product = el('select', { class: 'input', id: 'pt-d-produto' }, ...Object.entries(PRODUCT).map(([v, l]) => el('option', { value: v }, l)));
  const bank = el('input', { class: 'input', id: 'pt-d-banco', type: 'text', maxlength: '80', placeholder: 'Banco que liberou' });
  const date = el('input', { class: 'input', id: 'pt-d-data', type: 'date', value: todayISO(), max: todayISO() });
  const who = source === 'avulso' ? el('input', { class: 'input', id: 'pt-d-nome', type: 'text', maxlength: '120' }) : null;
  const note = el('input', { class: 'input', id: 'pt-d-nota', type: 'text', maxlength: '500', placeholder: 'opcional' });
  const preview = el('p', { class: 'pt-commission-preview', 'aria-live': 'polite' });
  const refresh = () => {
    const cents = amount.cents() ?? 0;
    preview.textContent = source === 'lead' ? (cents ? `Comissão do Fôlego (${pctText(bps)}): ${brl(Math.round((cents * bps) / 10000))}` : `Comissão do Fôlego sobre este contrato: ${pctText(bps)}`) : 'Contrato da sua própria base: sem comissão para o Fôlego.';
  };
  amount.input.addEventListener('input', refresh);
  refresh();
  const field = (label, input, id) => el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), input);
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Registrar contrato');
  const form = el('form', { class: 'pt-form' },
    name ? el('p', { class: 'pt-form-who' }, name) : null,
    who ? field('Nome do cliente', who, 'pt-d-nome') : null,
    field('Valor do contrato (R$)', amount.input, 'pt-d-valor'),
    field('Produto', product, 'pt-d-produto'),
    field('Data da assinatura', date, 'pt-d-data'),
    field('Banco', bank, 'pt-d-banco'),
    field('Prazo (parcelas)', installments, 'pt-d-prazo'),
    field('Valor da parcela (R$)', monthly.input, 'pt-d-parcela'),
    el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'pt-d-nota' }, 'Observação'), note),
    preview,
    save,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = amount.cents();
    if (!cents) return toast('Informe o valor do contrato.');
    if (who && who.value.trim().length < 2) return toast('Informe o nome do cliente.');
    save.disabled = true;
    try {
      const body = { source, product: product.value, amountCents: cents, signedOn: date.value };
      if (refId) body.refId = refId;
      if (who) body.clientName = who.value.trim();
      if (bank.value.trim().length >= 2) body.bank = bank.value.trim();
      if (installments.value) body.installments = Number(installments.value);
      if (monthly.cents()) body.monthlyCents = monthly.cents();
      if (note.value.trim()) body.note = note.value.trim();
      const out = await ctx.call('POST', '/partner/deals', body);
      toast(source === 'lead' ? `Contrato registrado. Comissão do Fôlego: ${brl(out.commissionCents)}.` : 'Contrato registrado.');
      onDone?.(out);
    } catch (err) {
      save.disabled = false;
      toast(err.message);
    }
  });
  return form;
}

export function openDealModal(ctx, opts) {
  const m = modal('Registrar contrato fechado', dealForm(ctx, { ...opts, onDone: (out) => { m.close(); opts.onDone?.(out); } }));
}

const titleCase = (s) => String(s).toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// ---------------------------------------------------------------------------------------------------------------------
export async function viewPainel(ctx) {
  const s = await ctx.call('GET', '/partner/summary');
  const f = s.folego;
  const d = s.deals;
  const maxMonth = Math.max(1, ...s.months.map((m) => m.volumeCents));
  const stageTotal = Math.max(1, s.base.total);
  const camp = s.campaigns[0];
  const dueBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ver agora');
  dueBtn.addEventListener('click', () => ctx.go('base', { due: true }));
  return el('div', { class: 'pt-stack' },
    head(ctx.profile.tradeName ? `Olá, equipe ${titleCase(ctx.profile.tradeName).replace(/\s+(Intermediacoes|Intermediações)$/, '')}` : 'Olá', 'O resumo do que está andando, do que precisa de ação hoje e do que já virou contrato.'),
    el('div', { class: 'pt-metrics' },
      metric('Contatos do Fôlego', String(f.received), `${f.pending} aguardando seu primeiro contato`),
      metric('Contratos fechados', String(d.folego.count + d.propria.count), `${brl(d.folego.volumeCents + d.propria.volumeCents)} em contratos`),
      metric('Conversão dos contatos do Fôlego', `${f.conversionPct.toLocaleString('pt-BR')}%`, `${f.converted} de ${f.received} viraram contrato`),
      metric('Comissão do Fôlego a pagar', brl(d.folego.commissionDueCents), camp ? `${pctText(camp.commissionBps)} sobre cada contrato do Fôlego` : 'sobre os contratos do Fôlego', 'is-accent')),
    s.base.dueToday > 0 ? el('div', { class: 'pt-alert' }, icon('alert'), el('span', {}, `${s.base.dueToday} contato(s) da sua base com retorno marcado para hoje ou antes.`), dueBtn) : null,
    el('div', { class: 'pt-cols' },
      section('Sua base por etapa', `${s.base.total.toLocaleString('pt-BR')} contatos importados de planilhas`,
        s.base.total === 0 ? empty('Nenhum contato na base ainda', 'Importe sua planilha para organizar o trabalho por etapa.') : el('ul', { class: 'pt-funnel' }, ...STAGE_ORDER.map((k) => {
          const n = s.base.byStage[k] ?? 0;
          return el('li', {}, el('span', {}, STAGE[k]), el('div', { class: 'pt-bar' }, el('i', { class: `st-${k}`, style: `width:${Math.max(n ? 2 : 0, Math.round((n / stageTotal) * 100))}%` })), el('strong', {}, n.toLocaleString('pt-BR')));
        }))),
      section('Contratos por mês', 'Valor fechado nos últimos meses',
        s.months.length === 0 ? empty('Nenhum contrato ainda', 'Quando você registrar o primeiro contrato, ele aparece aqui.') : el('ol', { class: 'pt-months' }, ...s.months.map((m) => el('li', {}, el('span', { class: 'pt-month-v' }, brl(m.volumeCents).replace(',00', '')), el('span', { class: 'pt-month-bar', style: `height:${Math.max(6, Math.round((m.volumeCents / maxMonth) * 100))}%`, title: `${m.count} contrato(s)` }), el('span', { class: 'pt-month-l' }, monthLabel(m.month)))))),
    ),
    section('Comissão do Fôlego', 'O que é devido ao Fôlego sobre contratos fechados com contatos que ele enviou.',
      el('div', { class: 'pt-split' },
        metric('A pagar', brl(d.folego.commissionDueCents), `sobre ${brl(d.folego.volumeCents)} contratados`),
        metric('Já pago', brl(d.folego.commissionPaidCents), 'baixado pelo Fôlego'))),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
function eventsList(events) {
  if (!events.length) return el('p', { class: 'pt-sub' }, 'Sem anotações ainda.');
  return el('ul', { class: 'pt-events' }, ...events.map((e) => el('li', {}, el('span', { class: 'pt-event-k' }, EVENT[e.kind] ?? e.kind), el('span', {}, e.body), el('time', {}, new Date(e.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })))));
}

/** Caixa de anotação rápida: nota, ligação ou WhatsApp. */
function noteBox(ctx, path, onSaved) {
  const kind = el('select', { class: 'input', 'aria-label': 'Tipo' }, el('option', { value: 'nota' }, 'Nota'), el('option', { value: 'ligacao' }, 'Ligação'), el('option', { value: 'whatsapp' }, 'WhatsApp'));
  const body = el('input', { class: 'input', type: 'text', maxlength: '1000', placeholder: 'O que aconteceu? Ex.: pediu retorno amanhã', 'aria-label': 'Anotação' });
  const add = el('button', { class: 'btn btn-secondary btn-sm', type: 'submit' }, 'Anotar');
  const form = el('form', { class: 'pt-note-form' }, kind, body, add);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!body.value.trim()) return;
    add.disabled = true;
    try {
      await ctx.call('POST', path, { kind: kind.value, body: body.value.trim() });
      body.value = '';
      onSaved();
    } catch (err) {
      toast(err.message);
    }
    add.disabled = false;
  });
  return form;
}

export async function viewFolego(ctx) {
  const root = el('div', { class: 'pt-stack' });
  let filter = 'todos';
  let leads = [];
  const draw = () => {
    const shown = leads.filter((l) => filter === 'todos' || l.status === filter);
    const tabs = [['todos', 'Todos'], ['delivered', 'Novos'], ['contacted', 'Em contato'], ['converted', 'Contrato fechado'], ['rejected', 'Descartados']];
    const count = (k) => (k === 'todos' ? leads.length : leads.filter((l) => l.status === k).length);
    root.replaceChildren(
      head('Contatos do Fôlego', 'Pessoas que autorizaram falar com um parceiro e foram enviadas a você. A comissão do Fôlego vale sobre os contratos fechados com elas.'),
      el('div', { class: 'pt-filters', role: 'tablist' }, ...tabs.map(([k, l]) => { const b = el('button', { class: 'pt-chip', type: 'button', role: 'tab', 'aria-selected': String(filter === k) }, `${l} `, el('span', {}, String(count(k)))); b.addEventListener('click', () => { filter = k; draw(); }); return b; })),
      shown.length === 0 ? empty('Nenhum contato aqui', leads.length === 0 ? 'Quando o Fôlego enviar contatos para você, eles aparecem nesta tela.' : 'Nenhum contato nesta situação.') : el('div', { class: 'pt-list' }, ...shown.map(leadCard)),
    );
  };
  const reload = async () => {
    leads = (await ctx.call('GET', '/partner/leads')).leads;
    draw();
  };
  const setStatus = async (l, status) => {
    try {
      await ctx.call('POST', `/partner/leads/${l.id}/status`, { status });
      await reload();
    } catch (err) {
      toast(err.message);
    }
  };
  function leadCard(l) {
    const open = ['delivered', 'contacted'].includes(l.status);
    const actions = [];
    if (open) {
      if (l.status === 'delivered') { const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Marcar como contatado'); b.addEventListener('click', () => setStatus(l, 'contacted')); actions.push(b); }
      const deal = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Registrar contrato'); deal.addEventListener('click', () => openDealModal(ctx, { source: 'lead', refId: l.id, name: l.name, bps: l.commissionBps, onDone: reload })); actions.push(deal);
      const no = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Descartar'); no.addEventListener('click', () => setStatus(l, 'rejected')); actions.push(no);
    }
    const waBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'WhatsApp');
    waBtn.addEventListener('click', () => ctx.go('whatsapp', { startDelivery: l.id }));
    const hist = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Histórico e anotações');
    hist.addEventListener('click', () => {
      const m = modal(l.name ?? 'Contato', el('p', { class: 'pt-sub' }, 'Carregando…'));
      const paint = async () => {
        const det = await ctx.call('GET', `/partner/leads/${l.id}`);
        m.body.replaceChildren(
          el('p', { class: 'pt-sub' }, [l.phone && fmtPhone(l.phone), l.email].filter(Boolean).join(' · ')),
          det.deals.length ? el('div', { class: 'pt-deals-mini' }, ...det.deals.map((x) => el('p', {}, `${PRODUCT[x.product]} de ${brl(x.amountCents)} em ${dayBr(x.signedOn)}${x.status === 'cancelado' ? ' (cancelado)' : ` · comissão do Fôlego ${brl(x.commissionCents)}`}`))) : null,
          noteBox(ctx, `/partner/leads/${l.id}/events`, paint),
          eventsList(det.events),
        );
      };
      paint().catch((err) => m.body.replaceChildren(el('p', { class: 'note note-amber' }, err.message)));
    });
    return el('article', { class: `pt-lead st-${l.status}` },
      el('div', { class: 'pt-lead-main' },
        el('h3', {}, l.revoked ? 'Titular revogou a autorização' : (l.name ?? 'Aguardando entrega'), ' ', pill(LEAD_STATUS[l.status] ?? l.status, `tone-${l.status}`)),
        l.revoked ? el('p', { class: 'note note-amber' }, 'Apague os dados deste titular dos seus sistemas.') : el('p', { class: 'pt-lead-contact' },
          l.phone ? el('a', { href: `tel:+55${l.phone}` }, fmtPhone(l.phone)) : null,
          l.phone ? el('a', { href: `https://wa.me/55${l.phone}`, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp') : null,
          l.email ? el('a', { href: `mailto:${l.email}` }, l.email) : null),
        el('p', { class: 'pt-lead-meta' }, [l.uf && `UF ${l.uf}`, l.incomeBand && `renda ${l.incomeBand}`, l.debtBand && `dívidas ${l.debtBand}`, `recebido em ${new Date(l.createdAt).toLocaleDateString('pt-BR')}`].filter(Boolean).join(' · ')),
        l.dealsCount ? el('p', { class: 'pt-lead-deal' }, `${l.dealsCount} contrato(s): ${brl(l.dealsCents)} · comissão do Fôlego ${pctText(l.commissionBps)}`) : null),
      el('div', { class: 'pt-lead-actions' }, ...actions, l.revoked || !l.phone ? null : waBtn, l.revoked ? null : hist));
  }
  await reload();
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
export async function viewBase(ctx) {
  const root = el('div', { class: 'pt-stack' });
  const facets = await ctx.call('GET', '/partner/contacts/facets');
  const f = { q: '', etapa: '', orgao: '', situacao: '', margem: '', ordem: ctx.opts?.due ? 'acao' : 'recentes', vencidas: ctx.opts?.due ? '1' : '', pagina: 0 };
  const results = el('div', { class: 'pt-results', 'aria-live': 'polite' });

  const input = (attrs) => el('input', { class: 'input', ...attrs });
  const q = input({ type: 'search', placeholder: 'Buscar por nome ou CPF', 'aria-label': 'Buscar por nome ou CPF', maxlength: '60' });
  const etapa = el('select', { class: 'input', 'aria-label': 'Etapa' }, el('option', { value: '' }, 'Todas as etapas'), ...STAGE_ORDER.map((k) => el('option', { value: k }, `${STAGE[k]} (${facets.stages.find((s) => s.key === k)?.count ?? 0})`)));
  const orgao = el('select', { class: 'input', 'aria-label': 'UF do órgão' }, el('option', { value: '' }, 'Todos os estados'), ...facets.orgUfs.map((x) => el('option', { value: x.key }, `${x.key} (${x.count})`)));
  const situacao = el('select', { class: 'input', 'aria-label': 'Situação funcional' }, el('option', { value: '' }, 'Toda situação'), ...facets.statuses.map((x) => el('option', { value: x.key }, `${x.key} (${x.count})`)));
  const margem = input({ type: 'text', inputmode: 'numeric', placeholder: 'Margem mínima (R$)', 'aria-label': 'Margem livre mínima em reais', maxlength: '9' });
  const ordem = el('select', { class: 'input', 'aria-label': 'Ordenar por' }, ...[['recentes', 'Mais recentes'], ['margem', 'Maior margem'], ['nome', 'Nome (A–Z)'], ['acao', 'Próximo retorno']].map(([v, l]) => el('option', { value: v }, l)));
  ordem.value = f.ordem;
  const due = el('input', { type: 'checkbox', id: 'pt-due', checked: f.vencidas === '1' });
  let timer = 0;
  const load = async () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== '' && v !== 0) p.set(k, String(v));
    results.replaceChildren(el('p', { class: 'pt-sub', role: 'status' }, 'Buscando…'));
    try {
      paint(await ctx.call('GET', `/partner/contacts?${p}`));
    } catch (err) {
      if (!err.silent) results.replaceChildren(el('p', { class: 'note note-amber' }, err.message));
    }
  };
  const bind = (node, key, delay = 0) => node.addEventListener(delay ? 'input' : 'change', () => {
    f[key] = node.type === 'checkbox' ? (node.checked ? '1' : '') : key === 'margem' ? node.value.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '') : node.value.trim();
    f.pagina = 0;
    window.clearTimeout(timer);
    timer = window.setTimeout(load, delay);
  });
  bind(q, 'q', 350); bind(etapa, 'etapa'); bind(orgao, 'orgao'); bind(situacao, 'situacao'); bind(margem, 'margem', 350); bind(ordem, 'ordem'); bind(due, 'vencidas');

  function paint(r) {
    if (r.total === 0) {
      results.replaceChildren(empty(facets.stages.length ? 'Nada encontrado' : 'Sua base está vazia', facets.stages.length ? 'Tente tirar algum filtro.' : 'Importe sua planilha em "Importar planilha" para trabalhar seus contatos aqui.'));
      return;
    }
    const pages = Math.ceil(r.total / r.pageSize);
    const prev = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: f.pagina === 0 }, 'Anterior');
    const next = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: f.pagina + 1 >= pages }, 'Próxima');
    prev.addEventListener('click', () => { f.pagina -= 1; load(); });
    next.addEventListener('click', () => { f.pagina += 1; load(); });
    results.replaceChildren(
      el('p', { class: 'pt-count' }, `${r.total.toLocaleString('pt-BR')} contato(s)`),
      el('div', { class: 'pt-table-wrap' }, el('table', { class: 'pt-table' },
        el('thead', {}, el('tr', {}, ...['Contato', 'Etapa', 'Margem livre', 'Telefone', 'Órgão', 'Retorno'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...r.items.map((c) => {
          const row = el('tr', { tabindex: '0', class: 'pt-row' },
            el('td', {}, el('strong', {}, c.name), el('span', { class: 'pt-cell-sub' }, [c.serviceStatus, c.city && `${c.city}/${c.uf ?? ''}`].filter(Boolean).join(' · '))),
            el('td', {}, pill(STAGE[c.stage], `st-${c.stage}`)),
            el('td', { class: 'num' }, c.availableMarginCents === null ? '—' : brl(c.availableMarginCents), c.cardMarginCents ? el('span', { class: 'pt-cell-sub' }, `cartão ${brl(c.cardMarginCents)}`) : null),
            el('td', {}, c.phone ? fmtPhone(c.phone) : '—'),
            el('td', {}, c.orgUf ?? '—'),
            el('td', { class: c.nextActionOn && c.nextActionOn <= todayISO() ? 'is-due' : '' }, c.nextActionOn ? dayBr(c.nextActionOn) : '—'));
          const open = () => openContact(c.id);
          row.addEventListener('click', open);
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
          return row;
        })))),
      el('div', { class: 'pt-pager' }, prev, el('span', {}, `Página ${f.pagina + 1} de ${pages}`), next));
  }

  async function openContact(id) {
    const m = modal('Contato', el('p', { class: 'pt-sub' }, 'Carregando…'));
    const paint2 = async () => {
      const c = await ctx.call('GET', `/partner/contacts/${id}`);
      const p = c.pii;
      const stage = el('select', { class: 'input', 'aria-label': 'Etapa' }, ...STAGE_ORDER.map((k) => el('option', { value: k, selected: k === c.stage }, STAGE[k])));
      const next = el('input', { class: 'input', type: 'date', value: c.nextActionOn ?? '', 'aria-label': 'Próximo retorno' });
      const save = async () => {
        try {
          await ctx.call('PATCH', `/partner/contacts/${id}`, { stage: stage.value, nextActionOn: next.value || null });
          toast('Salvo.');
          await paint2();
          load();
        } catch (err) {
          toast(err.message);
        }
      };
      stage.addEventListener('change', save);
      next.addEventListener('change', save);
      const kv = (label, value) => (value ? el('div', {}, el('dt', {}, label), el('dd', {}, value)) : null);
      const addr = p.address ?? {};
      const deal = el('button', { class: 'btn btn-primary', type: 'button' }, 'Registrar contrato fechado');
      deal.addEventListener('click', () => openDealModal(ctx, { source: 'contact', refId: id, name: c.name, bps: 0, onDone: () => { m.close(); load(); } }));
      // WhatsApp: a permissão é uma declaração do parceiro (ele só marca "tem permissão" se de fato a tem).
      const optin = el('select', { class: 'input', 'aria-label': 'Permissão de WhatsApp' }, ...[['desconhecido', 'Permissão de WhatsApp: não informada'], ['sim', 'Tem permissão de WhatsApp'], ['nao', 'Pediu para não receber']].map(([v, l]) => el('option', { value: v, selected: v === c.waOptin }, l)));
      optin.addEventListener('change', async () => {
        try { await ctx.call('PATCH', `/partner/contacts/${id}`, { waOptin: optin.value }); toast('Permissão atualizada.'); } catch (err) { toast(err.message); }
      });
      const chatBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Conversar no WhatsApp');
      chatBtn.addEventListener('click', () => { m.close(); ctx.go('whatsapp', { startContact: id }); });
      m.body.replaceChildren(
        el('h3', { class: 'pt-contact-name' }, c.name),
        el('p', { class: 'pt-sub' }, [c.serviceStatus, c.orgUf && `órgão ${c.orgUf}`, c.age && `${c.age} anos`].filter(Boolean).join(' · ')),
        el('div', { class: 'pt-metrics tight' }, metric('Margem livre', c.availableMarginCents === null ? '—' : brl(c.availableMarginCents), 'consignado'), metric('Margem do cartão', c.cardMarginCents === null ? '—' : brl(c.cardMarginCents), 'cartão consignado')),
        el('div', { class: 'pt-form pt-inline' }, el('div', { class: 'field' }, el('label', { class: 'label' }, 'Etapa'), stage), el('div', { class: 'field' }, el('label', { class: 'label' }, 'Próximo retorno'), next)),
        el('div', { class: 'pt-phones' }, ...(p.phones ?? []).map((ph) => el('span', {}, el('a', { href: `tel:+55${ph}` }, fmtPhone(ph)), el('a', { href: `https://wa.me/55${ph}`, target: '_blank', rel: 'noopener noreferrer' }, 'WhatsApp'))), ...(p.emails ?? []).map((em) => el('a', { href: `mailto:${em}` }, em))),
        el('dl', { class: 'pt-kv' }, kv('CPF', fmtCpf(p.cpf)), kv('Nascimento', p.birthDate && dayBr(p.birthDate)), kv('Mãe', p.motherName), kv('Matrícula', p.matricula),
          kv('Endereço', [addr.street, addr.number, addr.complement, addr.district, addr.city && `${addr.city}/${addr.uf ?? ''}`, addr.cep].filter(Boolean).join(', ')),
          kv('Conta de recebimento', [p.bank?.payer, p.bank?.agency && `ag. ${p.bank.agency}`, p.bank?.account && `conta ${p.bank.account}`].filter(Boolean).join(' · '))),
        c.deals.length ? el('div', { class: 'pt-deals-mini' }, ...c.deals.map((x) => el('p', {}, `${PRODUCT[x.product]} de ${brl(x.amountCents)} em ${dayBr(x.signedOn)}${x.status === 'cancelado' ? ' (cancelado)' : ''}`))) : null,
        deal,
        el('div', { class: 'pt-form pt-inline' }, el('div', { class: 'field' }, optin), el('div', { class: 'field' }, chatBtn)),
        el('h4', { class: 'pt-h4' }, 'Anotações'),
        noteBox(ctx, `/partner/contacts/${id}/events`, paint2),
        eventsList(c.events),
      );
    };
    try { await paint2(); } catch (err) { m.body.replaceChildren(el('p', { class: 'note note-amber' }, err.message)); }
  }

  root.append(
    head('Minha base', 'Os contatos das suas planilhas. Ficam separados dos contatos do Fôlego e nunca se misturam.'),
    el('div', { class: 'pt-filterbar' }, q, etapa, orgao, situacao, margem, ordem, el('label', { class: 'pt-check', for: 'pt-due' }, due, el('span', {}, 'Retornos de hoje ou atrasados'))),
    results);
  load();
  return root;
}

// ---------------------------------------------------------------------------------------------------------------------
export async function viewContratos(ctx) {
  const root = el('div', { class: 'pt-stack' });
  const month = el('input', { class: 'input', type: 'month', 'aria-label': 'Mês', max: todayISO().slice(0, 7) });
  const origin = el('select', { class: 'input', 'aria-label': 'Origem' }, el('option', { value: '' }, 'Todas as origens'), el('option', { value: 'folego' }, 'Contatos do Fôlego'), el('option', { value: 'propria' }, 'Minha base'));
  const body = el('div', {});
  const load = async () => {
    const p = new URLSearchParams();
    if (month.value) p.set('mes', month.value);
    if (origin.value) p.set('origem', origin.value);
    const r = await ctx.call('GET', `/partner/deals?${p}`);
    const t = r.totals;
    body.replaceChildren(
      el('div', { class: 'pt-metrics' }, metric('Contratos', String(t.count), 'fechados no período'), metric('Valor contratado', brl(t.volumeCents), `${brl(t.folegoVolumeCents)} vieram do Fôlego`), metric('Comissão do Fôlego a pagar', brl(t.commissionDueCents), 'ainda não baixada', 'is-accent'), metric('Comissão já paga', brl(t.commissionPaidCents), 'baixada pelo Fôlego')),
      r.deals.length === 0 ? empty('Nenhum contrato registrado', 'Registre contratos pela ficha de cada contato, em Contatos do Fôlego ou Minha base.') : el('div', { class: 'pt-table-wrap' }, el('table', { class: 'pt-table' },
        el('thead', {}, el('tr', {}, ...['Cliente', 'Produto', 'Valor', 'Data', 'Origem', 'Comissão do Fôlego', ''].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...r.deals.map((d) => {
          const cancel = d.status === 'fechado' && d.commissionStatus !== 'recebida' ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar') : null;
          cancel?.addEventListener('click', async () => {
            if (!(await confirmDialog({ title: 'Cancelar este contrato?', text: 'Ele deixa de contar nos totais e na comissão do Fôlego.', confirmLabel: 'Cancelar contrato', danger: true }))) return;
            try { await ctx.call('PATCH', `/partner/deals/${d.id}`, { status: 'cancelado' }); load(); } catch (err) { toast(err.message); }
          });
          const com = d.status === 'cancelado' ? pill('Cancelado') : d.origin === 'propria' ? '—' : el('span', {}, `${brl(d.commissionCents)} `, pill(d.commissionStatus === 'recebida' ? 'Paga' : 'A pagar', d.commissionStatus === 'recebida' ? 'st-fechado' : 'st-proposta'), el('span', { class: 'pt-cell-sub' }, pctText(d.commissionBps)));
          return el('tr', { class: d.status === 'cancelado' ? 'is-off' : '' },
            el('td', {}, el('strong', {}, d.clientName ?? 'Titular revogou'), d.bank ? el('span', { class: 'pt-cell-sub' }, d.bank) : null),
            el('td', {}, PRODUCT[d.product], d.installments ? el('span', { class: 'pt-cell-sub' }, `${d.installments}x${d.monthlyCents ? ` de ${brl(d.monthlyCents)}` : ''}`) : null),
            el('td', { class: 'num' }, brl(d.amountCents)), el('td', {}, dayBr(d.signedOn)), el('td', {}, d.origin === 'folego' ? 'Fôlego' : 'Minha base'), el('td', {}, com), el('td', {}, cancel));
        })))));
  };
  month.addEventListener('change', load);
  origin.addEventListener('change', load);
  const avulso = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('plus'), 'Contrato avulso');
  avulso.addEventListener('click', () => openDealModal(ctx, { source: 'avulso', bps: 0, onDone: load }));
  root.append(head('Contratos', 'Tudo o que você fechou, com o valor e a comissão devida ao Fôlego sobre os contatos que ele enviou.', avulso), el('div', { class: 'pt-filterbar' }, month, origin), body);
  await load();
  return root;
}
