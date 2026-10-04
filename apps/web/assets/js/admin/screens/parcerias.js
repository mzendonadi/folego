// Parcerias: público potencial, quem autorizou contato e o ENVIO aos parceiros (manual, sem repetir) com acompanhamento.
// O contato (nome e telefone) nunca aparece aqui: o envio coloca o contato na fila do parceiro e o servidor entrega por webhook.
import { api } from '../api.js';
import { el, icon, toast, brl, int, dt, shortId, card, kpi, kpis, grid, table, badge, tabs, pager, periodSelect, EMPLOYMENT, CATEGORY } from '../ui.js';
import { caseDrawer } from './shared.js';
import { confirmDialog } from '../../confirm.js';

const STATUS = {
  queued: ['Na fila', 'warn'], delivered: ['Enviado', 'ok'], failed: ['Falhou', 'bad'], contacted: ['Parceiro contatou', 'ok'], converted: ['Contratou', 'ok'], rejected: ['Recusado', 'muted'],
};
const statusBadge = (s) => badge(...(STATUS[s] ?? [s, 'muted']));

export async function parceriasScreen(ctx) {
  const days = ctx.state.days;
  const [p, targets] = await Promise.all([api.parcerias(days), api.destinosParceiros().catch(() => ({ partners: [] }))]);
  const pot = p.potential;
  const pctOf = (n) => (pot.cases ? `${Math.round((n / pot.cases) * 100)}% dos diagnósticos` : '');

  // ---- envio e acompanhamento ----
  const st = { tab: 'contatos', filtro: 'nao_enviados', categoria: '', parceiro: '', page: 0, situacao: '', selected: new Set() };
  const host = el('div', { class: 'bo-stack' });

  async function drawContacts() {
    const r = await api.contatos({ categoria: st.categoria, filtro: st.filtro, parceiro: st.parceiro, pagina: st.page });
    const partnerSel = el('select', { class: 'input input-sm', 'aria-label': 'Parceiro de destino' }, el('option', { value: '' }, 'Escolha o parceiro…'), ...targets.partners.flatMap((x) => x.campaigns.map((c) => el('option', { value: `${x.partnerId}|${c.id}` }, `${x.name} · ${c.name} (${CATEGORY[c.consentCategory] ?? c.consentCategory})`))));
    const send = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('arrow-right'), 'Enviar selecionados');
    const count = el('span', { class: 'muted' });
    const refreshCount = () => {
      count.textContent = `${int(st.selected.size)} selecionado${st.selected.size === 1 ? '' : 's'}`;
      send.disabled = st.selected.size === 0;
    };
    const filtro = el('select', { class: 'input input-sm', 'aria-label': 'Filtro de envio' }, ...[['nao_enviados', 'Ainda não enviados'], ['enviados', 'Já enviados'], ['todos', 'Todos']].map(([v, l]) => el('option', { value: v, selected: st.filtro === v }, l)));
    const cat = el('select', { class: 'input input-sm', 'aria-label': 'Categoria' }, el('option', { value: '' }, 'Todas as categorias'), ...Object.entries(CATEGORY).filter(([k]) => ['consignado', 'renegotiation'].includes(k)).map(([k, l]) => el('option', { value: k, selected: st.categoria === k }, l)));
    const par = el('select', { class: 'input input-sm', 'aria-label': 'Filtrar por parceiro' }, el('option', { value: '' }, 'Qualquer parceiro'), ...targets.partners.map((x) => el('option', { value: x.partnerId, selected: st.parceiro === x.partnerId }, x.name)));
    for (const s of [filtro, cat, par]) s.addEventListener('change', () => { st.filtro = filtro.value; st.categoria = cat.value; st.parceiro = par.value; st.page = 0; st.selected.clear(); draw(); });

    const selectUnsent = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Selecionar os não enviados desta página');
    selectUnsent.addEventListener('click', () => {
      for (const x of r.items) if (x.sent.length === 0 || !partnerSel.value || !x.sent.some((s) => s.partnerId === partnerSel.value.split('|')[0])) st.selected.add(x.caseId);
      draw();
    });

    send.addEventListener('click', async () => {
      const [partnerId, campaignId] = partnerSel.value.split('|');
      if (!partnerId) return toast('Escolha o parceiro de destino.');
      const name = targets.partners.find((x) => x.partnerId === partnerId)?.name ?? 'o parceiro';
      if (!(await confirmDialog({ title: `Enviar ${st.selected.size} contato(s) para ${name}?`, text: 'Quem já foi enviado a este parceiro é ignorado automaticamente. O envio entrega nome e telefone ao parceiro e fica registrado na auditoria.', confirmLabel: 'Enviar' }))) return;
      send.disabled = true;
      try {
        const out = await api.enviarParceiro({ partnerId, campaignId, caseIds: [...st.selected] });
        const sk = out.skipped;
        toast(`${out.queued} na fila de envio.${sk.alreadySent ? ` ${sk.alreadySent} já tinham ido a este parceiro.` : ''}${sk.noConsent ? ` ${sk.noConsent} sem autorização para esta categoria.` : ''}${sk.leadLimit ? ` ${sk.leadLimit} já estão em 3 parceiros.` : ''}`);
        st.selected.clear();
        draw();
      } catch (e) {
        send.disabled = false;
        toast(e?.message ?? 'Não consegui enviar agora.');
      }
    });
    refreshCount();

    const sentCell = (x) => (x.sent.length ? el('span', {}, ...x.sent.flatMap((s) => [badge(`${s.partner}: ${(STATUS[s.status] ?? [s.status])[0]}`, (STATUS[s.status] ?? [0, 'muted'])[1]), ' '])) : badge('não enviado', 'muted'));
    const check = (x) => {
      const cb = el('input', { type: 'checkbox', 'aria-label': `Selecionar caso ${shortId(x.caseId)}` });
      cb.checked = st.selected.has(x.caseId);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { cb.checked ? st.selected.add(x.caseId) : st.selected.delete(x.caseId); refreshCount(); });
      return cb;
    };
    return [
      el('p', { class: 'muted' }, 'A lista mostra só o perfil. O envio entrega nome e telefone ao parceiro por canal seguro e registra tudo. O mesmo contato nunca é enviado duas vezes ao mesmo parceiro.'),
      el('div', { class: 'bo-toolbar' }, filtro, cat, par),
      el('div', { class: 'bo-toolbar' }, partnerSel, send, count, selectUnsent),
      targets.partners.length === 0 ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Nenhum parceiro com campanha ativa. Cadastre o parceiro e a campanha (token de administrador) para poder enviar.')) : null,
      table(
        [
          { label: '', render: check },
          { label: 'Caso', render: (x) => el('code', {}, shortId(x.caseId)) },
          { label: 'Autorizou em', render: (x) => dt(x.consentedAt) },
          { label: 'Categorias', render: (x) => x.categories.map((k) => CATEGORY[k] ?? k).join(', ') },
          { label: 'Estado', render: (x) => x.uf ?? '—' },
          { label: 'Vínculo', render: (x) => EMPLOYMENT[x.employment] ?? '—' },
          { label: 'Dívida', align: 'right', render: (x) => (x.debtTotalCents === null ? '—' : brl(x.debtTotalCents)) },
          { label: 'Envio', render: sentCell },
        ],
        r.items,
        { emptyText: st.filtro === 'nao_enviados' ? 'Nenhum contato pendente de envio.' : 'Nenhum contato nesta visão.', onRow: (x) => caseDrawer(x.caseId, ctx) },
      ),
      pager(st.page, r.total, r.pageSize, (n) => { st.page = n; draw(); }),
    ].filter(Boolean);
  }

  async function drawDeliveries() {
    const r = await api.enviosParceiros({ parceiro: st.parceiro, situacao: st.situacao, pagina: st.page });
    const par = el('select', { class: 'input input-sm', 'aria-label': 'Parceiro' }, el('option', { value: '' }, 'Todos os parceiros'), ...targets.partners.map((x) => el('option', { value: x.partnerId, selected: st.parceiro === x.partnerId }, x.name)));
    const sit = el('select', { class: 'input input-sm', 'aria-label': 'Situação' }, el('option', { value: '' }, 'Todas as situações'), ...Object.entries(STATUS).map(([k, [l]]) => el('option', { value: k, selected: st.situacao === k }, l)));
    for (const s of [par, sit]) s.addEventListener('change', () => { st.parceiro = par.value; st.situacao = sit.value; st.page = 0; draw(); });
    const act = async (id, action) => {
      try {
        await api.acaoEnvio(id, action);
        toast(action === 'retry' ? 'Voltou para a fila.' : 'Envio cancelado: o contato está livre de novo.');
        draw();
      } catch (e) {
        toast(e?.message ?? 'Não consegui agora.');
      }
    };
    return [
      el('p', { class: 'muted' }, 'Tudo que já foi enviado, por parceiro, com a situação. "Na fila" e "Falhou" ainda não chegaram ao parceiro: dá para cancelar (o contato fica livre) ou reenviar.'),
      kpis(...r.summary.map((s) => kpi((STATUS[s.status] ?? [s.status])[0], int(s.count), brl(s.cents)))),
      el('div', { class: 'bo-toolbar' }, par, sit),
      table(
        [
          { label: 'Enviado em', render: (x) => dt(x.createdAt) },
          { label: 'Parceiro', render: (x) => `${x.partner} · ${x.campaign}` },
          { label: 'Caso', render: (x) => el('code', {}, shortId(x.caseId)) },
          { label: 'Perfil', render: (x) => `${x.uf ?? '—'} · ${EMPLOYMENT[x.employment] ?? '—'}` },
          { label: 'Situação', render: (x) => el('span', {}, statusBadge(x.status), x.status === 'failed' ? el('span', { class: 'fine muted' }, ` (${x.attempts} tentativas, código ${x.lastCode ?? 0})`) : null) },
          { label: 'Valor', align: 'right', render: (x) => brl(x.priceCents) },
          {
            label: '',
            render: (x) => {
              const out = [];
              if (x.status === 'failed') { const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Reenviar'); b.addEventListener('click', () => act(x.id, 'retry')); out.push(b); }
              if (x.status === 'queued' || x.status === 'failed') { const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar'); b.addEventListener('click', () => act(x.id, 'cancel')); out.push(b); }
              return el('span', { class: 'bo-actions' }, ...out);
            },
          },
        ],
        r.items,
        { emptyText: 'Nenhum envio ainda.' },
      ),
      pager(st.page, r.summary.reduce((s, x) => s + x.count, 0), 25, (n) => { st.page = n; draw(); }),
    ];
  }

  async function draw() {
    const tabBar = tabs([['contatos', 'Contatos autorizados'], ['envios', 'Envios aos parceiros']], st.tab, (id) => { st.tab = id; st.page = 0; draw(); });
    host.replaceChildren(tabBar, el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      const body = st.tab === 'contatos' ? await drawContacts() : await drawDeliveries();
      host.replaceChildren(tabBar, ...body);
    } catch (e) {
      host.replaceChildren(tabBar, el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e?.message ?? 'Não consegui carregar.')));
    }
  }
  draw();

  return el(
    'div', { class: 'bo-stack' },
    el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Público potencial vem dos diagnósticos (perfil, sem identificar ninguém). Só vira lead quem autorizou contato, separado por categoria.'), periodSelect(days, (v) => ctx.setDays(v))),
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
    card('Contatos e envios', host),
  );
}
