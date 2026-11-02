// Prumo > Empresa (PJ). Contas, cartões, lançamentos e movimentos com o sócio da empresa, SEMPRE separados dos números pessoais:
// nada daqui entra na Visão geral pessoal, no Orçamento ou nos Relatórios pessoais (e o contrário também vale).
//   Ousado: uma conta e um cartão da empresa, lançamentos e a visão da empresa.
//   Desbravador: contas e cartões à vontade, investimentos da empresa, relatório da empresa e os movimentos com o sócio
//   (pró-labore, lucros, aporte, retirada), com o Prumo lendo os lançamentos pessoais e sugerindo o que é da empresa.
import { el, icon, toast } from './dom.js';
import { brl, todayISO } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';
import { donut, bars, hbars, chartCard } from './charts.js';
import { viewInvestimentos } from './account-invest-views.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthShort = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dayShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const addMonths = (m, n) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const lastDay = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('p', { class: 'fine' }, hint) : null);
const select = (id, options, value) => el('select', { class: 'input', id }, ...options.map(([v, l]) => el('option', { value: String(v), ...(String(v) === String(value ?? '') ? { selected: true } : {}) }, l)));
const stat = (label, value, tone = '') => el('div', { class: 'stat' }, el('dt', {}, label), el('dd', { class: tone }, value));
const tone = (cents) => (cents < 0 ? 'neg' : 'pos');
const why = (err, fallback) => (err?.message && [403, 409, 422].includes(err.status) ? err.message : fallback);

const WALLET_KINDS = [['conta', 'Conta corrente'], ['caixa', 'Caixa'], ['poupanca', 'Poupança'], ['outra', 'Outra']];
const BRANDS = [['visa', 'Visa'], ['mastercard', 'Mastercard'], ['elo', 'Elo'], ['amex', 'American Express'], ['hipercard', 'Hipercard'], ['outra', 'Outra']];
const MOVEMENT_SHORT = { pro_labore: 'Pró-labore', lucros: 'Lucros', aporte: 'Aporte do sócio', retirada: 'Retirada' };
const MOVEMENT_HINT = {
  pro_labore: 'A empresa paga o sócio. Na empresa é despesa; do lado pessoal entra como renda.',
  lucros: 'A empresa distribui lucro ao sócio. Na empresa não é despesa; do lado pessoal entra como renda.',
  aporte: 'O sócio coloca dinheiro na empresa. Na empresa não é receita; do lado pessoal sai da conta e não conta como gasto.',
  retirada: 'O sócio tira dinheiro da empresa. Na empresa não é despesa; do lado pessoal entra e não conta como renda.',
};

// ---------------------------------------------------------------- Aba Empresa
export function viewEmpresa(ctx) {
  const root = el('div', { class: 'acc-stack biz' });
  let data = null;
  let entries = [];

  async function show() {
    root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Carregando a empresa…')));
    try {
      [data, { entries }] = await Promise.all([ctx.api.getBusiness(ctx.month), ctx.api.getBizEntries(ctx.month)]);
    } catch {
      return root.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.')));
    }
    draw();
  }

  const shell = (title, form, hint) => root.replaceChildren(card(el('h2', {}, title), hint ? el('p', { class: 'muted' }, hint) : null, form));
  const buttons = (okLabel) => {
    const ok = el('button', { class: 'btn btn-primary', type: 'submit' }, okLabel);
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    cancel.addEventListener('click', show);
    return { ok, cancel, row: el('div', { class: 'button-row' }, ok, cancel) };
  };
  const run = async (btn, job, done) => {
    btn.disabled = true;
    try { await job(); toast(done); show(); } catch (err) { btn.disabled = false; toast(why(err, 'Não consegui salvar agora.')); }
  };

  // ---- formulários
  function walletForm() {
    const name = el('input', { class: 'input', id: 'bw-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Conta Inter PJ' });
    const kind = select('bw-tipo', WALLET_KINDS, 'conta');
    const opening = moneyInput({ id: 'bw-saldo', ariaLabel: 'Saldo de hoje', placeholder: '0,00' });
    const b = buttons('Adicionar conta');
    const f = el('form', { class: 'entry-form form-std' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'bw-nome' }, 'Nome da conta'), name),
      field('Tipo', kind), field('Saldo de hoje (R$)', opening.input, 'Opcional. A partir daqui o Prumo soma os lançamentos da empresa.'), b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return toast('Dê um nome à conta.');
      run(b.ok, () => ctx.api.createBizWallet({ name: name.value.trim(), kind: kind.value, openingBalanceCents: opening.cents() ?? 0 }), 'Conta da empresa adicionada.');
    });
    shell('Nova conta da empresa', f, 'Fica só na empresa: não entra nos seus números pessoais.');
  }

  function cardForm(existing = null) {
    const name = el('input', { class: 'input', id: 'bc-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Cartão Empresarial', value: existing?.name ?? '' });
    const brand = select('bc-bandeira', BRANDS, existing?.brand ?? 'outra');
    const last4 = el('input', { class: 'input', id: 'bc-final', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '1234', value: existing?.last4 ?? '' });
    const limit = moneyInput({ id: 'bc-limite', ariaLabel: 'Limite', value: existing?.limitCents ?? null, placeholder: '0,00' });
    const closing = el('input', { class: 'input', id: 'bc-fecha', type: 'number', min: '1', max: '31', value: String(existing?.closingDay ?? 5) });
    const due = el('input', { class: 'input', id: 'bc-vence', type: 'number', min: '1', max: '31', value: String(existing?.dueDay ?? 12) });
    const b = buttons(existing ? 'Salvar' : 'Adicionar cartão');
    const f = el('form', { class: 'entry-form form-std' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'bc-nome' }, 'Nome do cartão'), name),
      field('Bandeira', brand), field('Final (4 dígitos)', last4), field('Limite (R$)', limit.input), field('Dia do fechamento', closing), field('Dia do vencimento', due), b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return toast('Dê um nome ao cartão.');
      if (last4.value && !/^\d{4}$/.test(last4.value)) return toast('O final do cartão tem 4 números.');
      const body = { name: name.value.trim(), brand: brand.value, last4: last4.value || null, limitCents: limit.cents() ?? 0, closingDay: Number(closing.value), dueDay: Number(due.value) };
      run(b.ok, () => (existing ? ctx.api.updateBizCard(existing.id, body) : ctx.api.createBizCard(body)), existing ? 'Cartão atualizado.' : 'Cartão da empresa adicionado.');
    });
    shell(existing ? 'Editar cartão da empresa' : 'Novo cartão da empresa', f, 'As compras no cartão da empresa usam o limite dele e não saem da conta na hora.');
  }

  function entryForm() {
    const kind = select('be-tipo', [['saida', 'Saída (despesa)'], ['entrada', 'Entrada (receita)'], ['cartao', 'Compra no cartão da empresa'], ['fatura', 'Pagamento de fatura do cartão']], 'saida');
    const value = moneyInput({ id: 'be-valor', ariaLabel: 'Valor' });
    const day = el('input', { class: 'input', id: 'be-data', type: 'date', max: todayISO(), value: todayISO() });
    const note = el('input', { class: 'input', id: 'be-nota', type: 'text', maxlength: '120', placeholder: 'Ex.: Anúncios do mês, venda para cliente, DAS' });
    const category = select('be-cat', [['', 'Automática (o Prumo reconhece pelo texto)'], ...Object.entries(data.labels.categories)], '');
    const wallet = select('be-conta', [['', 'Sem conta definida'], ...data.wallets.map((w) => [w.id, w.name])], data.wallets[0]?.id ?? '');
    const cardSel = select('be-cartao', data.cards.map((c) => [c.id, c.name]), data.cards[0]?.id ?? '');
    const walletField = field('Conta da empresa', wallet);
    const cardField = field('Cartão da empresa', cardSel);
    const sync = () => { walletField.hidden = kind.value === 'cartao'; cardField.hidden = kind.value !== 'cartao' && kind.value !== 'fatura'; };
    kind.addEventListener('change', sync);
    sync();
    const b = buttons('Lançar');
    const f = el('form', { class: 'entry-form form-std' }, field('Tipo', kind), field('Valor (R$)', value.input), field('Dia', day),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'be-nota' }, 'Descrição'), note), walletField, cardField, field('Categoria', category), b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cents = value.cents();
      if (!cents) return toast('Informe o valor.');
      if (!day.value) return toast('Informe o dia.');
      const k = kind.value;
      if ((k === 'cartao' || k === 'fatura') && data.cards.length === 0) return toast('Cadastre antes um cartão da empresa.');
      if (k === 'fatura' && !wallet.value) return toast('Escolha a conta de onde saiu o pagamento.');
      const body = {
        date: day.value, amountCents: k === 'entrada' ? cents : -cents, note: note.value.trim(),
        ...(category.value && k !== 'fatura' ? { category: category.value } : {}),
        ...(k === 'cartao' ? { cardId: cardSel.value } : k === 'fatura' ? { walletId: wallet.value, cardId: cardSel.value, cardPayment: true } : wallet.value ? { walletId: wallet.value } : {}),
      };
      run(b.ok, () => ctx.api.createBizEntry(body), 'Lançado na empresa.');
    });
    shell('Novo lançamento da empresa', f, 'O Prumo reconhece sozinho pelo texto: imposto, anúncio, software, pró-labore, lucros, aporte e retirada.');
  }

  async function movementForm() {
    let pf = [];
    try { pf = (await ctx.api.getWallets()).wallets ?? []; } catch { /* sem contas pessoais: lança só na empresa */ }
    if (data.wallets.length === 0) return toast('Cadastre antes uma conta da empresa.');
    const kind = select('bm-tipo', Object.entries(data.labels.movements), 'pro_labore');
    const value = moneyInput({ id: 'bm-valor', ariaLabel: 'Valor' });
    const day = el('input', { class: 'input', id: 'bm-data', type: 'date', max: todayISO(), value: todayISO() });
    const biz = select('bm-empresa', data.wallets.map((w) => [w.id, w.name]), data.wallets[0].id);
    const pfSel = select('bm-pessoal', [['', 'Sem conta pessoal definida'], ...pf.map((w) => [w.id, w.name])], pf.find((w) => w.kind === 'conta')?.id ?? '');
    const mirror = el('input', { type: 'checkbox', id: 'bm-espelho', checked: true });
    const hint = el('p', { class: 'fine' });
    const sync = () => { hint.textContent = MOVEMENT_HINT[kind.value]; };
    kind.addEventListener('change', sync);
    sync();
    const b = buttons('Lançar movimento');
    const f = el('form', { class: 'entry-form form-std' }, field('Movimento', kind), field('Valor (R$)', value.input), field('Dia', day), field('Conta da empresa', biz), field('Conta pessoal', pfSel),
      el('div', { class: 'field field-wide' }, el('label', { class: 'check', for: 'bm-espelho' }, mirror, el('span', {}, 'Lançar também do lado pessoal, com a regra certa')), hint), b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cents = value.cents();
      if (!cents) return toast('Informe o valor.');
      run(b.ok, () => ctx.api.createBizMovement({ movement: kind.value, date: day.value, amountCents: cents, walletId: biz.value, ...(pfSel.value ? { pfWalletId: pfSel.value } : {}), mirrorPf: mirror.checked }), 'Movimento lançado nos dois lados.');
    });
    shell('Movimento entre a empresa e você', f, 'Pró-labore, lucros, aporte e retirada: o Prumo lança cada lado com a regra certa e nunca soma a empresa com o seu pessoal.');
  }

  // ---- blocos da tela
  const delButton = (label, job, text) => {
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': label }, icon('trash'));
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `${label}?`, text, confirmLabel: 'Apagar', danger: true }))) return;
      try { await job(); toast('Apagado.'); show(); } catch (e) { toast(why(e, 'Não consegui apagar agora.')); }
    });
    return del;
  };

  function walletsCard() {
    const full = data.wallets.length >= data.plan.limits.wallets;
    const add = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', ...(full ? { disabled: true } : {}) }, icon('plus'), 'Adicionar conta');
    add.addEventListener('click', walletForm);
    const rows = data.wallets.map((w) => el('li', { class: 'biz-row' },
      el('div', {}, el('strong', {}, w.name), el('p', { class: 'muted fine' }, WALLET_KINDS.find(([k]) => k === w.kind)?.[1] ?? 'Conta')),
      el('strong', { class: tone(w.balanceCents) }, brl(w.balanceCents)),
      delButton(`Apagar a conta ${w.name}`, () => ctx.api.deleteBizWallet(w.id), 'Os lançamentos dela ficam na empresa, sem conta definida.')));
    return card(el('div', { class: 'biz-head' }, el('h2', {}, 'Contas da empresa'), add),
      rows.length ? el('ul', { class: 'biz-list' }, ...rows) : el('p', { class: 'muted' }, 'Nenhuma conta ainda. Cadastre a conta da empresa para acompanhar o saldo.'),
      full && !data.plan.multi ? el('p', { class: 'fine muted' }, 'No Ousado cabe uma conta da empresa. No Desbravador você cadastra quantas precisar.') : null);
  }

  function cardsCard() {
    const full = data.cards.length >= data.plan.limits.cards;
    const add = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', ...(full ? { disabled: true } : {}) }, icon('plus'), 'Adicionar cartão');
    add.addEventListener('click', () => cardForm());
    const rows = data.cards.map((c) => {
      const pct = c.limitCents > 0 ? Math.min(100, Math.round((c.usedCents / c.limitCents) * 100)) : 0;
      const edit = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Editar ${c.name}` }, icon('pencil'));
      edit.addEventListener('click', () => cardForm(c));
      return el('li', { class: 'biz-row biz-row-card' },
        el('div', {}, el('strong', {}, `${c.name}${c.last4 ? ` ••${c.last4}` : ''}`), el('p', { class: 'muted fine' }, `Fecha dia ${c.closingDay} · vence dia ${c.dueDay}`),
          c.limitCents > 0 ? el('div', { class: `progress${pct >= 90 ? ' is-over' : ''}`, role: 'img', 'aria-label': `${pct}% do limite usado` }, el('i', { style: `width:${pct}%` })) : null,
          el('p', { class: 'fine' }, c.limitCents > 0 ? `Usado ${brl(c.usedCents)} de ${brl(c.limitCents)} · disponível ${brl(c.availableCents)}` : `Usado ${brl(c.usedCents)}`)),
        el('span', { class: 'ledger-actions' }, edit, delButton(`Apagar o cartão ${c.name}`, () => ctx.api.deleteBizCard(c.id), 'As compras dele ficam na empresa, sem cartão definido.')));
    });
    return card(el('div', { class: 'biz-head' }, el('h2', {}, 'Cartões da empresa'), add),
      rows.length ? el('ul', { class: 'biz-list' }, ...rows) : el('p', { class: 'muted' }, 'Nenhum cartão ainda. Cadastre o cartão da empresa para ver limite e fatura.'),
      full && !data.plan.multi ? el('p', { class: 'fine muted' }, 'No Ousado cabe um cartão da empresa. No Desbravador você cadastra quantos tiver.') : null);
  }

  function entriesCard() {
    const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Novo lançamento');
    add.addEventListener('click', entryForm);
    const rows = entries.map((x) => {
      const tag = x.movement ? MOVEMENT_SHORT[x.movement] : x.transferKind === 'card_payment' ? 'Fatura paga' : x.transferKind === 'investment' ? 'Resgate' : null;
      return el('li', { class: 'biz-row' },
        el('div', {}, el('strong', {}, x.note || x.label), el('p', { class: 'muted fine' }, `${dayShort(x.date)} · ${x.label} · ${x.card ?? x.wallet ?? 'sem conta'}${tag ? ` · ${tag}` : ''}${x.linkedToPf ? ' · ligado ao pessoal' : ''}`)),
        el('strong', { class: x.amountCents < 0 ? 'neg' : 'pos' }, brl(x.amountCents)),
        delButton('Apagar o lançamento', () => ctx.api.deleteBizEntry(x.id), x.linkedToPf ? 'Se o lançamento pessoal foi criado junto com este, ele também será apagado.' : 'Some da empresa.'));
    });
    return card(el('div', { class: 'biz-head' }, el('h2', {}, 'Lançamentos da empresa'), add),
      rows.length ? el('ul', { class: 'biz-list' }, ...rows) : el('p', { class: 'muted' }, 'Nada lançado neste mês. Use "Novo lançamento" para registrar uma venda, uma despesa ou o pagamento da fatura.'));
  }

  function chartsCard() {
    const live = ctx.has('charts_interactive');
    const items = data.month.byCategory.filter((c) => c.spendCents > 0).map((c) => ({ key: c.category, label: c.label, value: c.spendCents }));
    if (items.length === 0 && data.series.every((s) => s.incomeCents === 0 && s.spendCents === 0)) return null;
    return chartCard('A empresa em gráficos', 'Só da empresa. Aporte do sócio não conta como receita e lucros e retiradas não contam como despesa.',
      items.length ? el('h3', { class: 'ch-h3' }, 'Saídas por categoria') : null, items.length ? donut(items, { interactive: live, totalLabel: 'Saiu', label: 'Saídas da empresa por categoria' }) : null,
      el('h3', { class: 'ch-h3' }, 'Entrou e saiu, mês a mês'), bars(data.series.map((s) => ({ key: s.month, label: monthShort(s.month), a: s.incomeCents, b: s.spendCents })), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: live, label: 'Entrou e saiu da empresa por mês' }));
  }

  function partnerCard() {
    const p = data.partner;
    const move = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Lançar movimento');
    move.addEventListener('click', movementForm);
    const sugg = el('div', { class: 'biz-sugg' });
    loadSuggestions(sugg);
    return card(el('div', { class: 'biz-head' }, el('h2', {}, 'Entre a empresa e você'), move),
      el('p', { class: 'muted' }, 'Pró-labore, lucros, aportes e retiradas do mês, lidos nos dois lados. O pessoal e a empresa seguem separados, e cada movimento entra com a regra certa.'),
      el('dl', { class: 'stats' }, stat('Pró-labore', brl(p.proLaboreCents)), stat('Lucros distribuídos', brl(p.lucrosCents)), stat('Retiradas', brl(p.retiradaCents)), stat('Aportes seus na empresa', brl(p.aporteCents))),
      el('p', { class: 'fine' }, p.paidToPartnerCents || p.putByPartnerCents
        ? `Neste mês a empresa pagou ${brl(p.paidToPartnerCents)} a você e você colocou ${brl(p.putByPartnerCents)} nela: saldo de ${brl(p.netToPartnerCents)} para o seu lado.`
        : 'Sem movimentos entre você e a empresa neste mês.'),
      sugg);
  }

  async function loadSuggestions(box) {
    let list = [];
    try { list = (await ctx.api.getBizSuggestions()).suggestions ?? []; } catch { return; }
    if (list.length === 0 || data.wallets.length === 0) return;
    const company = select('bs-conta', data.wallets.map((w) => [w.id, w.name]), data.wallets[0].id);
    box.append(el('h3', { class: 'ch-h3' }, 'O Prumo achou nos seus lançamentos pessoais'),
      el('p', { class: 'fine muted' }, 'Estes lançamentos pessoais parecem ser da sua empresa. Ligue ao movimento certo para o pessoal e a empresa baterem entre si.'),
      data.wallets.length > 1 ? field('Conta da empresa para ligar', company) : null,
      el('ul', { class: 'biz-list' }, ...list.map((s) => {
        const mv = select(`bs-${s.id}`, Object.entries(data.labels.movements), s.guess ?? (s.amountCents > 0 ? 'pro_labore' : 'aporte'));
        const link = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ligar');
        link.addEventListener('click', async () => {
          link.disabled = true;
          try { await ctx.api.linkBizMovement({ pfEntryId: s.id, movement: mv.value, walletId: company.value }); toast('Ligado à empresa.'); show(); } catch (e) { link.disabled = false; toast(why(e, 'Não consegui ligar agora.')); }
        });
        return el('li', { class: 'biz-row biz-row-sugg' }, el('div', {}, el('strong', {}, s.note), el('p', { class: 'muted fine' }, `${dayShort(s.date)} · ${brl(s.amountCents)} · ${s.reason}`)), mv, link);
      })));
  }

  function investCard() {
    const reports = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('chart'), 'Relatório da empresa');
    reports.addEventListener('click', () => { ctx.reportScope = 'pj'; ctx.goTab('relatorios'); });
    return [card(el('div', { class: 'biz-head' }, el('h2', {}, 'Investimentos da empresa'), ctx.has('reports') ? reports : null),
      el('p', { class: 'muted' }, 'Aplicações da empresa, separadas das suas: total, rendimento e imposto estimado de cada uma.')), viewInvestimentos(ctx, { scope: 'pj' })];
  }

  function draw() {
    const m = data.month;
    const hero = card(
      el('h2', {}, 'Empresa (PJ)'),
      el('p', { class: 'muted' }, 'Contas, cartões e lançamentos da empresa. Tudo aqui é só da empresa: nada entra na sua Visão geral pessoal, no Orçamento ou nos Relatórios pessoais.'),
      data.hasData
        ? el('dl', { class: 'stats' }, stat('Saldo nas contas', brl(data.totals.balanceCents), tone(data.totals.balanceCents)), stat('Entrou no mês', brl(m.incomeCents), 'pos'), stat('Saiu no mês', brl(m.spendCents)), stat('Resultado do mês', brl(m.resultCents), tone(m.resultCents)))
        : el('p', { class: 'note' }, icon('info'), el('span', {}, 'Comece cadastrando a conta da empresa. Depois lance as vendas e as despesas, e o Prumo mostra o saldo, o resultado do mês e o cartão, separados dos seus números pessoais.')),
      data.cards.length > 0 ? el('p', { class: 'fine' }, `Cartões da empresa: ${brl(data.totals.cardUsedCents)} a pagar.`) : null);
    const upsell = !data.plan.multi ? card(el('p', { class: 'note' }, icon('info'), el('span', {}, 'No Desbravador a empresa ganha contas e cartões à vontade, investimentos da empresa, relatório da empresa e a leitura dos movimentos entre a empresa e você (pró-labore, lucros, aportes e retiradas).'))) : null;
    root.replaceChildren(...[hero, walletsCard(), cardsCard(), entriesCard(), chartsCard(), data.plan.multi ? partnerCard() : null, upsell, ...(data.plan.multi ? investCard() : [])].flat().filter(Boolean));
  }

  show();
  return root;
}

// ---------------------------------------------------------------- Cartão da empresa na Visão geral
/** Bloco da empresa na Visão geral: sempre à parte, com os números só da empresa. */
export function businessHomeCard(ctx, data) {
  if (!data?.hasData) return null;
  const m = data.month;
  const open = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Abrir a empresa', icon('arrow-right'));
  open.addEventListener('click', () => ctx.goTab('empresa'));
  const p = data.partner;
  const partner = p && (p.paidToPartnerCents || p.putByPartnerCents)
    ? el('p', { class: 'fine' }, `Entre a empresa e você neste mês: pró-labore ${brl(p.proLaboreCents)} · lucros ${brl(p.lucrosCents)} · retiradas ${brl(p.retiradaCents)} · aportes seus ${brl(p.aporteCents)}.`)
    : null;
  return el('section', { class: 'card d-section biz-home', 'aria-labelledby': 'bh-title' },
    el('div', { class: 'biz-head' }, el('h2', { id: 'bh-title' }, 'Sua empresa'), el('span', { class: 'pill tone-ok' }, 'separado do pessoal')),
    el('p', { class: 'muted' }, 'Só da empresa. Estes valores não entram nos números pessoais da Visão geral.'),
    el('dl', { class: 'stats' },
      stat('Saldo nas contas', brl(data.totals.balanceCents), tone(data.totals.balanceCents)),
      stat('Entrou no mês', brl(m.incomeCents), 'pos'),
      stat('Saiu no mês', brl(m.spendCents)),
      stat('Resultado do mês', brl(m.resultCents), tone(m.resultCents)),
      ...(data.cards.length > 0 ? [stat('Cartões a pagar', brl(data.totals.cardUsedCents))] : []),
      ...(data.investments && data.investments.count > 0 ? [stat('Investido pela empresa', brl(data.investments.positionCents))] : [])),
    partner, el('div', { class: 'no-print' }, open));
}

// ---------------------------------------------------------------- Relatório da empresa (Desbravador)
const PRESETS = [['mes', 'Este mês'], ['3m', '3 meses'], ['12m', '12 meses'], ['ano', 'Este ano']];
function rangeOf(preset, month) {
  const end = lastDay(month);
  if (preset === 'mes') return { from: `${month}-01`, to: end };
  if (preset === '3m') return { from: `${addMonths(month, -2)}-01`, to: end };
  if (preset === '12m') return { from: `${addMonths(month, -11)}-01`, to: end };
  return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
}

export function viewRelatorioEmpresa(ctx) {
  const root = el('div', { class: 'acc-stack rel' });
  let preset = '3m';
  let token = 0;
  const live = ctx.has('charts_interactive');

  async function load() {
    const mine = ++token;
    const { from, to } = rangeOf(preset, ctx.month);
    root.replaceChildren(controls(), card(el('p', { class: 'muted', role: 'status' }, 'Montando o relatório da empresa…')));
    try {
      const r = await ctx.api.getBizReport(from, to);
      if (mine === token) draw(r);
    } catch (e) {
      if (mine === token) root.replaceChildren(controls(), card(el('p', { class: 'muted' }, why(e, 'Não consegui montar o relatório agora. Tente de novo.'))));
    }
  }

  function controls() {
    const seg = el('div', { class: 'seg rel-seg', role: 'radiogroup', 'aria-label': 'Período' }, ...PRESETS.map(([v, l]) => {
      const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(preset === v) }, l);
      b.addEventListener('click', () => { preset = v; load(); });
      return b;
    }));
    return card(el('h2', {}, 'Relatório da empresa'), el('p', { class: 'muted' }, 'Só os números da empresa, sem misturar com os pessoais. Aporte do sócio não é receita; lucros e retiradas não são despesa.'), seg);
  }

  function draw(r) {
    const t = r.totals;
    const prev = r.previous.totals.spendCents;
    const delta = prev > 0 ? Math.round(((t.spendCents - prev) / prev) * 100) : null;
    const p = r.partner;
    const sections = [
      card(el('h2', {}, `De ${r.from.split('-').reverse().join('/')} a ${r.to.split('-').reverse().join('/')}`),
        el('dl', { class: 'stats' }, stat('Entrou', brl(t.incomeCents), 'pos'), stat('Saiu', brl(t.spendCents)), stat('Resultado', brl(t.resultCents), tone(t.resultCents)), stat('Lançamentos', String(t.count))),
        delta !== null ? el('p', { class: 'fine' }, `${delta === 0 ? 'Saídas iguais' : delta > 0 ? `Saídas ${delta}% maiores` : `Saídas ${-delta}% menores`} que no período anterior de mesma duração (${brl(prev)}).`) : null),
    ];
    const items = r.byCategory.filter((c) => c.spendCents > 0).map((c) => ({ key: c.category, label: c.label, value: c.spendCents }));
    if (items.length) sections.push(chartCard('Saídas por categoria', null, donut(items, { interactive: live, totalLabel: 'Saiu', label: 'Saídas da empresa por categoria' })));
    if (r.series.length >= 2) sections.push(chartCard('Entrou e saiu, mês a mês', null, bars(r.series.map((s) => ({ key: s.month, label: monthShort(s.month), a: s.incomeCents, b: s.spendCents })), { aLabel: 'Entrou', bLabel: 'Saiu', interactive: live, label: 'Entrou e saiu da empresa por mês' })));
    const origin = r.byOrigin.filter((o) => o.spendCents > 0);
    if (origin.length) sections.push(chartCard('Por conta e cartão da empresa', null, hbars(origin.map((o) => ({ key: `${o.kind}:${o.name}`, label: o.name, value: o.spendCents, sub: o.kind === 'cartao' ? 'Cartão da empresa' : o.kind === 'conta' ? 'Conta da empresa' : 'Sem conta definida' })), { interactive: live, label: 'Saídas por conta e cartão da empresa' })));
    sections.push(card(el('h2', {}, 'Entre a empresa e você'),
      el('dl', { class: 'stats' }, stat('Pró-labore', brl(p.proLaboreCents)), stat('Lucros distribuídos', brl(p.lucrosCents)), stat('Retiradas', brl(p.retiradaCents)), stat('Aportes seus', brl(p.aporteCents))),
      el('p', { class: 'fine' }, `A empresa pagou ${brl(p.paidToPartnerCents)} a você e você colocou ${brl(p.putByPartnerCents)} nela no período.`)));
    if (r.top.length) sections.push(card(el('h2', {}, 'Maiores saídas da empresa'), el('ol', { class: 'rel-top' }, ...r.top.map((x) => el('li', {}, el('span', { class: 'rel-top-note' }, el('strong', {}, x.note || x.label), el('span', { class: 'fine muted' }, `${dayShort(x.date)} · ${x.label}`)), el('strong', { class: 'neg' }, brl(x.cents)))))));
    root.replaceChildren(controls(), ...sections);
  }

  load();
  return root;
}

/** Relatórios com a escolha "Pessoal | Empresa" (a empresa é do Desbravador); o pessoal é o de sempre. */
export function viewRelatoriosAbas(ctx, viewPessoal) {
  if (!ctx.has('business_pro')) return viewPessoal(ctx);
  const root = el('div', { class: 'acc-stack' });
  let tab = ctx.reportScope === 'pj' ? 'pj' : 'pf';
  ctx.reportScope = null;
  const content = el('div', { class: 'acc-stack' });
  const seg = el('div', { class: 'seg rel-scope no-print', role: 'radiogroup', 'aria-label': 'Relatório de' });
  const paint = () => {
    seg.replaceChildren(...[['pf', 'Pessoal'], ['pj', 'Empresa']].map(([v, l]) => {
      const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(tab === v) }, l);
      b.addEventListener('click', () => { tab = v; paint(); });
      return b;
    }));
    content.replaceChildren(tab === 'pj' ? viewRelatorioEmpresa(ctx) : viewPessoal(ctx));
  };
  paint();
  root.append(seg, content);
  return root;
}
