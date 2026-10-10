// Parceiros: cadastro, edição, suspensão, exclusão e campanhas (para onde o envio manual de contatos vai).
// A senha do portal e o segredo do webhook só aparecem uma vez, logo depois de criar ou trocar.
import { api } from '../api.js';
import { el, icon, toast, brl, dt, day, field, badge, drawer, EMPLOYMENT, CATEGORY } from '../ui.js';
import { UFS } from '../../copy.js';
import { moneyInput } from '../../money.js';
import { percentToBps } from '../../format.js';
import { confirmDialog } from '../../confirm.js';

const PARTNER_CATEGORY = { consignado: 'Consignado', bank: 'Banco', fintech: 'Fintech', renegotiation: 'Renegociação' };
const PARTNER_STATUS = { active: ['Ativo', 'ok'], suspended: ['Suspenso', 'bad'], pending: ['Pendente', 'warn'] };
const CAMPAIGN_STATUS = { active: ['Ativa', 'ok'], paused: ['Pausada', 'warn'], ended: ['Encerrada', 'muted'] };
const CAMPAIGN_CATEGORY = { consignado: 'Consignado', renegotiation: 'Renegociação' };

const select = (options, value, label) => el('select', { class: 'input', 'aria-label': label }, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
const text = (label, attrs = {}) => el('input', { class: 'input', type: 'text', 'aria-label': label, ...attrs });
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const formatCnpj = (v) => digits(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, '$1.$2.$3/$4-$5').replace(/[-/.]+$/, '');

function chips(options, selected, name) {
  const boxes = options.map(([v, l]) => {
    const id = `${name}-${v}`;
    const input = el('input', { type: 'checkbox', id, value: v });
    input.checked = selected.includes(v);
    return { v, input, node: el('div', { class: 'check' }, input, el('label', { for: id }, l)) };
  });
  return { node: el('div', { class: 'bo-chips' }, ...boxes.map((b) => b.node)), value: () => boxes.filter((b) => b.input.checked).map((b) => b.v) };
}

/** Campos da campanha, usados ao criar o parceiro (1ª campanha), ao incluir uma campanha e ao editar. */
function campaignForm(c = {}, prefix = 'cp') {
  const name = text('Nome da campanha', { maxlength: '100', value: c.name ?? '', placeholder: 'Ex.: Consignado SP — CLT' });
  const cat = select(Object.entries(CAMPAIGN_CATEGORY), c.consentCategory ?? 'consignado', 'Categoria de autorização');
  const price = moneyInput({ id: `${prefix}-preco`, ariaLabel: 'Valor por contato', value: c.pricePerLeadCents ?? 0 });
  const commission = text('Comissão do Fôlego sobre o contrato fechado (%)', { inputmode: 'decimal', maxlength: '6', placeholder: '0', value: c.commissionBps ? String(c.commissionBps / 100).replace('.', ',') : '' });
  const cap = text('Limite por dia', { inputmode: 'numeric', maxlength: '5', value: String(c.dailyCap ?? 50) });
  const budget = moneyInput({ id: `${prefix}-orc`, ariaLabel: 'Orçamento mensal', value: c.monthlyBudgetCents ?? null, placeholder: 'sem limite' });
  const minI = moneyInput({ id: `${prefix}-min`, ariaLabel: 'Renda mínima', value: c.minIncomeCents ?? null, placeholder: 'sem mínimo' });
  const maxI = moneyInput({ id: `${prefix}-max`, ariaLabel: 'Renda máxima', value: c.maxIncomeCents ?? null, placeholder: 'sem máximo' });
  const url = text('Endereço do webhook (https)', { type: 'url', maxlength: '500', value: c.webhookUrl ?? '', placeholder: 'https://parceiro.com.br/webhooks/folego' });
  const emp = chips(Object.entries(EMPLOYMENT), c.employmentTypes ?? [], `${prefix}-emp`);
  const ufs = chips(UFS.map((u) => [u, u]), c.ufs ?? [], `${prefix}-uf`);
  const node = el(
    'div', { class: 'bo-form-grid' },
    field('Nome da campanha', name),
    field('Categoria de autorização', cat, 'Só entram pessoas que autorizaram esta categoria.'),
    field('Valor por contato (R$)', price.input, 'Cobrado do parceiro por contato entregue.'),
    field('Comissão do Fôlego (% por contrato)', commission, 'Sobre o valor de cada contrato fechado com um contato nosso. Soma-se ao valor por contato. Ex.: 10 = 10%.'),
    field('Limite por dia', cap),
    field('Orçamento mensal (R$)', budget.input, 'Opcional.'),
    field('Renda líquida mínima (R$)', minI.input, 'Opcional.'),
    field('Renda líquida máxima (R$)', maxI.input, 'Opcional.'),
    el('div', { class: 'wide' }, field('Endereço do webhook (opcional)', url, 'Para onde o contato é entregue, em https e público. Vazio = o contato aparece só no portal do parceiro.')),
    el('div', { class: 'wide' }, field('Vínculos aceitos', emp.node, 'Nada marcado = todos.')),
    el('div', { class: 'wide' }, field('Estados atendidos', ufs.node, 'Nada marcado = todos.')),
  );
  const read = () => {
    const out = {
      name: name.value.trim(),
      consentCategory: cat.value,
      pricePerLeadCents: price.cents() ?? 0,
      commissionBps: percentToBps(commission.value || '0') ?? 0,
      dailyCap: Number(cap.value) || 50,
      employmentTypes: emp.value(),
      ufs: ufs.value(),
    };
    if (url.value.trim()) out.webhookUrl = url.value.trim();
    if (budget.cents()) out.monthlyBudgetCents = budget.cents();
    if (minI.cents()) out.minIncomeCents = minI.cents();
    if (maxI.cents()) out.maxIncomeCents = maxI.cents();
    return out;
  };
  return { node, read, nullable: { monthlyBudgetCents: () => budget.cents(), minIncomeCents: () => minI.cents(), maxIncomeCents: () => maxI.cents() } };
}

function copyBtn(value) {
  const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Copiar');
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast('Copiado.');
    } catch {
      toast('Não consegui copiar. Selecione o texto e copie.');
    }
  });
  return b;
}

/** Mostra segredos uma única vez. */
function secretsDrawer(title, rows) {
  const d = drawer(title);
  d.body.append(
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Guarde agora e envie ao parceiro por um canal seguro. Por segurança, isto não aparece de novo (dá para gerar outro depois).')),
    ...rows.map(([label, value]) => el('section', {}, el('h3', {}, label), el('div', { class: 'bo-secret' }, value), el('div', { class: 'bo-actions' }, copyBtn(value)))),
  );
}

export function partnersManager(ctx, { onChange }) {
  const host = el('div', { class: 'bo-stack' });

  function newPartnerDrawer() {
    const d = drawer('Novo parceiro');
    const legalName = text('Razão social', { maxlength: '200' });
    const cnpj = text('CNPJ', { inputmode: 'numeric', maxlength: '18', placeholder: '00.000.000/0000-00' });
    cnpj.addEventListener('input', () => { cnpj.value = formatCnpj(cnpj.value); });
    const category = select(Object.entries(PARTNER_CATEGORY), 'consignado', 'Tipo de parceiro');
    const email = text('E-mail do portal do parceiro', { type: 'email', maxlength: '200' });
    const tradeName = text('Nome fantasia', { maxlength: '120' });
    const phone = text('Telefone', { maxlength: '60' });
    const camp = campaignForm({}, 'np');
    const save = el('button', { class: 'btn btn-primary', type: 'button' }, 'Cadastrar parceiro');
    save.addEventListener('click', async () => {
      const body = { legalName: legalName.value.trim(), cnpj: digits(cnpj.value), category: category.value, email: email.value.trim(), campaign: camp.read() };
      if (tradeName.value.trim().length >= 2) body.tradeName = tradeName.value.trim();
      if (phone.value.trim()) body.phone = phone.value.trim();
      if (body.legalName.length < 3) return toast('Informe a razão social.');
      if (body.cnpj.length !== 14) return toast('O CNPJ precisa ter 14 números.');
      if (!/^\S+@\S+\.\S+$/.test(body.email)) return toast('Informe um e-mail válido para o portal do parceiro.');
      if (body.campaign.name.length < 2) return toast('Dê um nome para a campanha.');
      save.disabled = true;
      try {
        const out = await api.criarParceiro(body);
        d.close();
        secretsDrawer('Parceiro cadastrado', [['Senha do portal do parceiro', out.password], ...(body.campaign.webhookUrl ? [['Segredo do webhook (assinatura HMAC)', out.webhookSecret]] : [])]);
        onChange();
      } catch (e) {
        save.disabled = false;
        toast(e?.message ?? 'Não consegui cadastrar.');
      }
    });
    d.body.append(
      el('section', {}, el('h3', {}, 'Empresa'), el('div', { class: 'bo-form-grid' }, field('Razão social', legalName), field('CNPJ', cnpj), field('Tipo', category), field('Nome fantasia', tradeName, 'Aparece no portal: "Nome fantasia & Fôlego".'), field('Telefone', phone), field('E-mail do portal', email, 'O parceiro entra com este e-mail para ver os contatos recebidos.'))),
      el('section', {}, el('h3', {}, 'Primeira campanha'), camp.node),
      el('div', { class: 'bo-actions' }, save),
    );
  }

  function editPartnerDrawer(p) {
    const d = drawer(`Editar ${p.legalName}`);
    const legalName = text('Razão social', { maxlength: '200', value: p.legalName });
    const tradeName = text('Nome fantasia', { maxlength: '120', value: p.tradeName ?? '' });
    const phone = text('Telefone', { maxlength: '60', value: p.phone ?? '' });
    const category = select(Object.entries(PARTNER_CATEGORY), p.category, 'Tipo de parceiro');
    const save = el('button', { class: 'btn btn-primary', type: 'button' }, 'Salvar');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await api.editarParceiro(p.id, { legalName: legalName.value.trim(), category: category.value, tradeName: tradeName.value.trim().length >= 2 ? tradeName.value.trim() : null, phone: phone.value.trim() || null });
        d.close();
        toast('Parceiro atualizado.');
        onChange();
      } catch (e) {
        save.disabled = false;
        toast(e?.message ?? 'Não consegui salvar.');
      }
    });
    const reset = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Gerar nova senha do portal');
    reset.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Gerar nova senha?', text: 'A senha atual deixa de funcionar. A nova aparece uma vez só.', confirmLabel: 'Gerar' }))) return;
      try {
        const out = await api.senhaParceiro(p.id);
        d.close();
        secretsDrawer('Nova senha do portal', [[`Senha de ${p.portalEmail ?? 'o parceiro'}`, out.password]]);
      } catch (e) {
        toast(e?.message ?? 'Não consegui agora.');
      }
    });
    d.body.append(
      el('div', { class: 'bo-form-grid' }, field('Razão social', legalName), field('Nome fantasia', tradeName, 'Aparece no portal do parceiro.'), field('Telefone', phone), field('Tipo', category), field('CNPJ', el('p', { class: 'muted bo-static' }, formatCnpj(p.cnpj))), field('E-mail do portal', el('p', { class: 'muted bo-static' }, p.portalEmail ?? '—'))),
      el('div', { class: 'bo-actions' }, save, reset),
    );
  }

  function campaignDrawer(p, c) {
    const d = drawer(c ? `Editar campanha: ${c.name}` : `Nova campanha de ${p.legalName}`);
    const form = campaignForm(c ?? {}, c ? `ec${c.id.slice(0, 6)}` : 'nc');
    const status = c ? select(Object.entries(CAMPAIGN_STATUS).map(([k, [l]]) => [k, l]), c.status, 'Situação da campanha') : null;
    const save = el('button', { class: 'btn btn-primary', type: 'button' }, c ? 'Salvar campanha' : 'Criar campanha');
    save.addEventListener('click', async () => {
      const body = form.read();
      if (body.name.length < 2) return toast('Dê um nome para a campanha.');
      save.disabled = true;
      try {
        if (c) {
          // Em edição, um campo opcional esvaziado precisa ser enviado como "sem limite": o servidor só mexe no que vem no corpo.
          const out = await api.editarCampanha(c.id, { ...body, webhookUrl: body.webhookUrl ?? null, status: status.value, monthlyBudgetCents: form.nullable.monthlyBudgetCents() || null, minIncomeCents: form.nullable.minIncomeCents() || null, maxIncomeCents: form.nullable.maxIncomeCents() || null });
          d.close();
          if (out?.webhookSecret) secretsDrawer('Webhook ligado', [['Segredo do webhook (assinatura HMAC)', out.webhookSecret]]);
          else toast('Campanha atualizada.');
        } else {
          const out = await api.criarCampanha(p.id, body);
          d.close();
          if (out.webhookSecret) secretsDrawer('Campanha criada', [['Segredo do webhook (assinatura HMAC)', out.webhookSecret]]);
          else toast('Campanha criada. Os contatos aparecem só no portal do parceiro.');
        }
        onChange();
      } catch (e) {
        save.disabled = false;
        toast(e?.message ?? 'Não consegui salvar.');
      }
    });
    d.body.append(status ? field('Situação', status, 'Pausada ou encerrada deixa de aparecer como destino do envio.') : null, form.node, el('div', { class: 'bo-actions' }, save));
  }

  /** Contratos que o parceiro fechou com contatos nossos, a comissão de cada um e a baixa quando ele paga. */
  async function dealsDrawer(p) {
    const d = drawer(`Contratos de ${p.tradeName ?? p.legalName}`);
    d.body.append(el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      const r = await api.contratosParceiro(p.id);
      const PRODUCT_LABEL = { consignado: 'Consignado', cartao_consignado: 'Cartão consignado', refinanciamento: 'Refinanciamento', portabilidade: 'Portabilidade', outro: 'Outro' };
      const rows = r.deals.map((x) => {
        const paid = x.commissionStatus === 'recebida';
        const btn = el('button', { class: `btn btn-sm ${paid ? 'btn-quiet' : 'btn-primary'}`, type: 'button' }, paid ? 'Desfazer baixa' : 'Dar baixa');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await api.baixarComissao(x.id, paid ? { status: 'a_receber' } : { status: 'recebida' });
            toast(paid ? 'Baixa desfeita.' : 'Comissão baixada como recebida.');
            d.close();
            dealsDrawer(p);
            onChange();
          } catch (e) {
            btn.disabled = false;
            toast(e?.message ?? 'Não consegui agora.');
          }
        });
        const state = x.status === 'cancelado' ? badge('Cancelado', 'muted') : x.commissionCents === 0 ? badge('Sem comissão', 'muted') : paid ? badge(`Recebida em ${day(x.receivedOn)}`, 'ok') : badge('A receber', 'warn');
        return el(
          'article', { class: 'bo-camp' },
          el('div', {}, el('strong', {}, x.clientName ?? 'Titular revogou a autorização', ' ', state), el('span', { class: 'fine muted' }, `${PRODUCT_LABEL[x.product] ?? x.product} · ${brl(x.amountCents)} em ${day(x.signedOn)} · ${(x.commissionBps / 100).toLocaleString('pt-BR')}% = ${brl(x.commissionCents)}${x.campaign ? ` · ${x.campaign}` : ''}`)),
          el('div', { class: 'bo-actions' }, x.status === 'fechado' && x.commissionCents > 0 ? btn : null),
        );
      });
      d.body.replaceChildren(
        el('p', { class: 'note' }, icon('info'), el('span', {}, `Comissão a receber: ${brl(p.deals.commissionDueCents)} · já recebida: ${brl(p.deals.commissionPaidCents)}. Só entram contratos fechados com contatos que o Fôlego enviou.`)),
        ...(rows.length ? rows : [el('p', { class: 'muted' }, 'Nenhum contrato registrado por este parceiro ainda.')]),
      );
    } catch (e) {
      d.body.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e?.message ?? 'Não consegui carregar.')));
    }
  }

  async function act(fn, ok) {
    try {
      await fn();
      toast(ok);
      onChange();
    } catch (e) {
      toast(e?.message ?? 'Não consegui agora.');
    }
  }

  function partnerCard(p) {
    const [sl, st] = PARTNER_STATUS[p.status] ?? [p.status, 'muted'];
    const edit = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Editar');
    edit.addEventListener('click', () => editPartnerDrawer(p));
    const contracts = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Contratos e comissão');
    contracts.addEventListener('click', () => dealsDrawer(p));
    const addCamp = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('plus'), 'Campanha');
    addCamp.addEventListener('click', () => campaignDrawer(p, null));
    const toggle = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, p.status === 'active' ? 'Suspender' : 'Reativar');
    toggle.addEventListener('click', async () => {
      if (p.status === 'active' && !(await confirmDialog({ title: `Suspender ${p.legalName}?`, text: 'Ele deixa de aparecer como destino do envio e perde o acesso ao portal. O histórico fica guardado.', confirmLabel: 'Suspender' }))) return;
      act(() => api.editarParceiro(p.id, { status: p.status === 'active' ? 'suspended' : 'active' }), p.status === 'active' ? 'Parceiro suspenso.' : 'Parceiro reativado.');
    });
    const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('trash'), 'Excluir');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Excluir ${p.legalName}?`, text: p.sent > 0 ? 'Este parceiro já recebeu contatos, então não pode ser excluído: suspenda para manter o histórico.' : 'Isso apaga o parceiro, o acesso ao portal e as campanhas. Não dá para desfazer.', confirmLabel: 'Excluir', danger: true }))) return;
      act(() => api.excluirParceiro(p.id), 'Parceiro excluído.');
    });
    const camps = p.campaigns.map((c) => {
      const [cl, ct] = CAMPAIGN_STATUS[c.status] ?? [c.status, 'muted'];
      const e = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Editar');
      e.addEventListener('click', () => campaignDrawer(p, c));
      const s = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Novo segredo');
      s.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Gerar novo segredo do webhook?', text: 'O parceiro precisa atualizar o segredo do lado dele, senão a assinatura dos envios deixa de bater.', confirmLabel: 'Gerar' }))) return;
        try {
          const out = await api.segredoCampanha(c.id);
          secretsDrawer('Novo segredo do webhook', [[c.name, out.webhookSecret]]);
        } catch (err) {
          toast(err?.message ?? 'Não consegui agora.');
        }
      });
      const x = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Excluir campanha ${c.name}` }, icon('trash'));
      x.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Excluir a campanha ${c.name}?`, text: c.sent > 0 ? 'Ela já enviou contatos, então não pode ser excluída: encerre a campanha para manter o histórico.' : 'Não dá para desfazer.', confirmLabel: 'Excluir', danger: true }))) return;
        act(() => api.excluirCampanha(c.id), 'Campanha excluída.');
      });
      const where = [c.ufs.length ? c.ufs.join(', ') : 'todos os estados', c.employmentTypes.length ? c.employmentTypes.map((k) => EMPLOYMENT[k] ?? k).join(', ') : 'todos os vínculos'].join(' · ');
      return el(
        'div', { class: 'bo-camp' },
        el('div', {}, el('strong', {}, c.name, ' ', badge(cl, ct)), el('span', { class: 'fine muted' }, `${CATEGORY[c.consentCategory] ?? c.consentCategory} · ${brl(c.pricePerLeadCents)} por contato + ${(c.commissionBps / 100).toLocaleString('pt-BR')}% por contrato fechado · até ${c.dailyCap}/dia · ${where}`), el('span', { class: 'fine muted' }, `${c.webhookUrl ?? 'só no portal do parceiro'} · ${c.sent} enviado(s)`)),
        el('div', { class: 'bo-actions' }, e, s, x),
      );
    });
    return el(
      'article', { class: `bo-partner${p.status === 'active' ? '' : ' is-off'}` },
      el('header', { class: 'bo-head-line' }, el('h3', {}, p.tradeName ?? p.legalName), badge(sl, st), badge(PARTNER_CATEGORY[p.category] ?? p.category, 'muted')),
      el('p', { class: 'fine muted' }, `${p.tradeName ? `${p.legalName} · ` : ''}CNPJ ${formatCnpj(p.cnpj)} · portal: ${p.portalEmail ?? '—'} · cadastrado em ${dt(p.createdAt)} · ${p.sent} contato(s) enviado(s), ${p.reached} com retorno`),
      el('p', { class: 'bo-deals-line' }, el('strong', {}, `${p.deals.count} contrato(s) fechado(s)`), ` · ${brl(p.deals.volumeCents)} em contratos · comissão a receber `, el('strong', {}, brl(p.deals.commissionDueCents)), ` · já recebida ${brl(p.deals.commissionPaidCents)}`),
      el('div', { class: 'bo-partner-camps' }, ...(camps.length ? camps : [el('p', { class: 'fine muted' }, 'Sem campanha: crie uma para poder enviar contatos.')])),
      el('div', { class: 'bo-actions' }, contracts, edit, addCamp, toggle, del),
    );
  }

  async function draw() {
    host.replaceChildren(el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      const r = await api.parceiros();
      const add = el('button', { class: 'btn btn-primary', type: 'button' }, icon('plus'), 'Novo parceiro');
      add.addEventListener('click', newPartnerDrawer);
      host.replaceChildren(
        el('p', { class: 'muted' }, 'Quem recebe os contatos. Cada parceiro tem uma ou mais campanhas (categoria, estados, vínculos, valor e endereço de entrega). O envio manual usa as campanhas ativas.'),
        el('div', { class: 'bo-filters' }, add),
        ...(r.partners.length ? r.partners.map(partnerCard) : [el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Nenhum parceiro cadastrado ainda. Clique em "Novo parceiro".'))]),
      );
    } catch (e) {
      host.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e?.message ?? 'Não consegui carregar.')));
    }
  }
  return { node: host, draw };
}
