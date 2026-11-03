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
import { accountFields, overdraftBlock, viewDividas } from './account-extras-views.js';
import { ledgerGroups } from './account-ledger.js';
import { invoiceImportPanel } from './account-invoice.js';
import { cardPaymentHint, detectDocumentKind, parseExtract, parsePdfExtract } from '../vendor/engine.js';

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
  let debts = null;
  let debtExtra = 0;

  async function show() {
    root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Carregando a empresa…')));
    try {
      [data, { entries }, debts] = await Promise.all([ctx.api.getBusiness(ctx.month), ctx.api.getBizEntries(ctx.month), ctx.api.getBizDebts(debtExtra)]);
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
  function walletForm(inline = false) {
    const name = el('input', { class: 'input', id: 'bw-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Conta Inter PJ' });
    const kind = select('bw-tipo', WALLET_KINDS, 'conta');
    const opening = moneyInput({ id: 'bw-saldo', ariaLabel: 'Saldo de hoje', placeholder: '0,00' });
    const openingField = field('Saldo de hoje (R$)', opening.input, 'Opcional. A partir daqui o Prumo soma os lançamentos da empresa.');
    const acc = accountFields({ prefix: 'bw' }); // conta bancária: saldo (pode ser negativo), cheque especial (LIS), taxa e dias sem juros
    const accBox = el('div', { class: 'field field-wide' }, acc.node);
    const sync = () => { const bank = kind.value === 'conta'; accBox.hidden = !bank; openingField.hidden = bank; };
    kind.addEventListener('change', sync);
    sync();
    const b = buttons('Adicionar conta');
    const f = el('form', { class: 'entry-form form-std' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'bw-nome' }, 'Nome da conta'), name),
      field('Tipo', kind), openingField, accBox, b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return toast('Dê um nome à conta.');
      if (kind.value === 'conta') {
        const v = acc.read();
        if (!v.rateOk) return toast('Informe a taxa do cheque especial em % ao mês, por exemplo 8.');
        return run(b.ok, () => ctx.api.createBizWallet({ name: name.value.trim(), kind: 'conta', openingBalanceCents: v.openingBalanceCents, overdraftLimitCents: v.overdraftLimitCents, overdraftRateBps: v.overdraftRateBps, ...(v.overdraftFreeDays ? { overdraftFreeDays: v.overdraftFreeDays } : {}) }), 'Conta da empresa adicionada.');
      }
      run(b.ok, () => ctx.api.createBizWallet({ name: name.value.trim(), kind: kind.value, openingBalanceCents: opening.cents() ?? 0 }), 'Conta da empresa adicionada.');
    });
    if (inline) return f;
    shell('Nova conta da empresa', f,'Fica só na empresa: não entra nos seus números pessoais.');
  }

  function cardForm(existing = null, inline = false) {
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
    if (inline) return f;
    shell(existing ? 'Editar cartão da empresa' : 'Novo cartão da empresa', f,'As compras no cartão da empresa usam o limite dele e não saem da conta na hora.');
  }

  /** Ajusta o nome, o saldo de partida e o cheque especial (LIS) da conta: negativo na conta é cheque especial em uso, igual ao pessoal. */
  function walletEditForm(w) {
    const name = el('input', { class: 'input', id: 'bwe-nome', type: 'text', maxlength: '40', value: w.name });
    const isAccount = w.kind === 'conta';
    const acc = accountFields({ prefix: `bwe-${w.id.slice(0, 8)}`, openingBalanceCents: w.openingBalanceCents, overdraftLimitCents: w.overdraftLimitCents, overdraftRateBps: w.overdraftRateBps, overdraftFreeDays: w.overdraftFreeDays });
    const b = buttons('Salvar');
    const f = el('form', { class: 'entry-form form-std' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'bwe-nome' }, 'Nome da conta'), name), isAccount ? acc.node : null, b.row);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (name.value.trim().length < 2) return toast('Dê um nome à conta.');
      const v = acc.read();
      if (isAccount && !v.rateOk) return toast('Informe a taxa do cheque especial em % ao mês, por exemplo 8.');
      const body = { name: name.value.trim(), ...(isAccount ? { openingBalanceCents: v.openingBalanceCents, overdraftLimitCents: v.overdraftLimitCents, overdraftRateBps: v.overdraftRateBps, overdraftFreeDays: v.overdraftFreeDays } : {}) };
      run(b.ok, () => ctx.api.updateBizWallet(w.id, body), 'Conta atualizada.');
    });
    shell(`Editar ${w.name}`, f, 'Quando o saldo da conta fica negativo, o Prumo mostra o cheque especial em uso, o custo dos juros e inclui o valor nas dívidas da empresa.');
  }

  // ---- importar extrato (CSV, OFX, PDF): mesmos leitores do pessoal, a gravação é só da empresa
  function importBox() {
    if (data.wallets.length === 0) return null;
    const wallet = select('bi-conta', data.wallets.map((w) => [w.id, w.name]), data.wallets[0].id);
    const input = el('input', { type: 'file', accept: '.csv,.ofx,.txt,.pdf', hidden: true, 'aria-label': 'Arquivo do extrato da empresa' });
    const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('list'), 'Importar extrato (CSV, OFX ou PDF)');
    btn.addEventListener('click', () => input.click());
    const preview = el('div', { class: 'import-preview', hidden: true });
    const reset = () => { preview.hidden = true; preview.replaceChildren(); input.value = ''; };

    async function doImport(parsed, skipped, anchor) {
      try {
        let added = 0, duplicates = 0, transfers = 0;
        for (let i = 0; i < parsed.length; i += 400) {
          const r = await ctx.api.importBizEntries({ walletId: wallet.value || null, entries: parsed.slice(i, i + 400).map((x) => ({ date: x.date, amountCents: x.amountCents, note: x.note.slice(0, 120), ...(x.transfer ? { transfer: true } : {}) })) });
          added += r.added; duplicates += r.duplicates ?? 0; transfers += r.transfers ?? 0;
        }
        if (anchor && wallet.value) {
          try { await ctx.api.anchorBizWallet(wallet.value, { asOf: anchor.on, balanceCents: anchor.cents }); } catch { toast('Importei, mas não consegui acertar o saldo da conta.'); }
        }
        const months = new Map();
        for (const x of parsed) months.set(x.date.slice(0, 7), (months.get(x.date.slice(0, 7)) ?? 0) + 1);
        const top = [...months.entries()].sort((p, q) => q[1] - p[1])[0]?.[0];
        if (added > 0 && top) ctx.month = top;
        toast(`${added} lançamentos importados na empresa${transfers ? `, ${transfers} pagamento(s) de fatura fora das despesas` : ''}${duplicates ? `, ${duplicates} repetidos ignorados` : ''}${skipped ? `, ${skipped} linhas não reconhecidas` : ''}.`);
        reset();
        show();
      } catch (e) {
        toast(why(e, 'Não consegui importar agora.'));
      }
    }

    function showPreview(parsed, skipped, check) {
      const chosen = new Set(parsed.map((_, i) => i));
      const ok = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, `Importar ${parsed.length} lançamentos`);
      const sync = () => { ok.textContent = `Importar ${chosen.size} lançamentos`; ok.disabled = chosen.size === 0; };
      const rows = parsed.map((x, i) => {
        const cb = el('input', { type: 'checkbox', checked: true, 'aria-label': `Importar: ${x.note}` });
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(i); else chosen.delete(i); sync(); });
        const hint = x.amountCents < 0 ? cardPaymentHint(x.note) : null;
        let tag = null;
        if (hint) {
          if (hint === 'forte') x.transfer = true;
          const tick = el('input', { type: 'checkbox', ...(hint === 'forte' ? { checked: true } : {}), 'aria-label': `${x.note} é pagamento de fatura de cartão` });
          tick.addEventListener('change', () => { x.transfer = tick.checked; });
          tag = el('label', { class: 'fine muted pay-tag' }, tick, hint === 'forte' ? ' pagamento de fatura (não conta como despesa)' : ' é pagamento de fatura? (não conta como despesa)');
        }
        return el('li', { class: 'entry-row' }, cb, el('span', { class: 'entry-date muted' }, dayShort(x.date)), el('span', { class: 'entry-note' }, x.note, tag), el('strong', { class: `entry-amount ${x.amountCents < 0 ? 'neg' : 'pos'}` }, brl(x.amountCents)));
      });
      const verdict = check
        ? el('p', { class: check.ok ? 'note' : 'error' }, icon(check.ok ? 'check' : 'alert'), el('span', {}, check.ok
          ? `Conferido com o extrato: a soma dos lançamentos fecha com ${check.source === 'saldo' ? 'o saldo anterior e o saldo final' : 'os totais de créditos e débitos'} (${brl(check.parsedCents)}).`
          : `Atenção: a soma dos lançamentos lidos (${brl(check.parsedCents)}) não bate com o que o extrato informa (${brl(check.expectedCents)}). Confira antes de importar.`))
        : el('p', { class: 'fine' }, 'O PDF não traz saldos nem totais para conferir a soma. Confira as linhas antes de importar.');
      const eb = check?.ok ? check.endBalance : null;
      const anchorBox = eb ? el('input', { type: 'checkbox', checked: true }) : null;
      const no = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar');
      no.addEventListener('click', reset);
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        await doImport(parsed.filter((_, i) => chosen.has(i)), skipped, eb && anchorBox.checked ? { cents: eb.cents, on: eb.on } : null);
      });
      preview.replaceChildren(
        el('p', { class: 'fine' }, `Li ${parsed.length} lançamentos${skipped ? ` (${skipped} linhas não reconhecidas)` : ''}. Vão para a conta da empresa escolhida acima. Desmarque o que não quiser.`), verdict,
        eb ? el('label', { class: 'fine pay-tag' }, anchorBox, ` Acertar o saldo da conta para o saldo do extrato (${brl(eb.cents)} em ${dayShort(eb.on)})`) : null,
        el('ul', { class: 'entry-list', style: 'max-height: 360px; overflow: auto' }, ...rows), el('div', { class: 'button-row' }, ok, no));
      preview.hidden = false;
    }

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
          toast('Lendo o PDF no seu aparelho…');
          const { extractPdfText } = await import('../vendor/pdfread.js');
          const { text } = await extractPdfText(await file.arrayBuffer(), 36);
          if (detectDocumentKind(text) === 'fatura') { input.value = ''; return toast('Isso é uma fatura de cartão. Importe pelo botão "Importar fatura" do cartão da empresa, mais abaixo.'); }
          const r = parsePdfExtract(text);
          if (r.entries.length === 0) { input.value = ''; return toast('Não achei lançamentos nesse PDF. Se ele for uma foto ou estiver escaneado, baixe o extrato em CSV ou OFX no app do banco.'); }
          return showPreview(r.entries, r.skipped, r.check);
        }
        const r = parseExtract(await file.text(), file.name);
        if (r.entries.length === 0) { input.value = ''; return toast('Não consegui ler nenhum lançamento desse arquivo.'); }
        await doImport(r.entries, r.skipped, null);
      } catch {
        input.value = '';
        toast('Não consegui ler esse arquivo.');
      }
    });
    return el('div', { class: 'import-box no-print' }, data.wallets.length > 1 ? field('Importar para a conta', wallet) : null, input, btn,
      el('span', { class: 'fine' }, 'Aceita CSV, OFX e PDF. O PDF é lido no seu aparelho: o arquivo não é enviado. Repetidos são ignorados e pró-labore, lucros, aporte e retirada são reconhecidos.'), preview);
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

  // ---- Carteira: o mesmo padrão do pessoal ("Saldo por carteira", ajuste de saldo e cheque especial dentro da linha da conta)
  function walletsCard() {
    const full = data.wallets.length >= data.plan.limits.wallets;
    const add = el('details', { class: 'cc-add', ...(data.wallets.length === 0 ? { open: true } : {}) }, el('summary', { class: 'btn btn-primary' }, icon('plus'), 'Adicionar conta'), walletForm(true));
    const adjust = (w) => {
      const f = accountFields({ prefix: `aj-${w.id.slice(0, 8)}`, openingBalanceCents: w.openingBalanceCents, overdraftLimitCents: w.overdraftLimitCents, overdraftRateBps: w.overdraftRateBps, overdraftFreeDays: w.overdraftFreeDays });
      const save = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar');
      save.addEventListener('click', () => {
        const v = f.read();
        if (!v.rateOk) return toast('A taxa deve ser um número entre 0 e 100.');
        run(save, () => ctx.api.updateBizWallet(w.id, { openingBalanceCents: v.openingBalanceCents, overdraftLimitCents: v.overdraftLimitCents, overdraftRateBps: v.overdraftRateBps, overdraftFreeDays: v.overdraftFreeDays }), 'Conta atualizada.');
      });
      return el('details', { class: 'lis-edit' }, el('summary', {}, 'Ajustar saldo e cheque especial (LIS)'), f.node, save);
    };
    const rows = data.wallets.map((w) => el('li', { class: 'wallet-row' },
      el('div', {}, el('strong', {}, w.name), el('p', { class: 'muted fine' }, WALLET_KINDS.find(([k]) => k === w.kind)?.[1] ?? 'Conta'), w.kind === 'conta' ? overdraftBlock(w) : null, w.kind === 'conta' ? adjust(w) : null),
      el('strong', { class: `entry-amount ${w.balanceCents < 0 ? 'neg' : 'pos'}` }, brl(w.balanceCents)),
      delButton(`Apagar a conta ${w.name}`, () => ctx.api.deleteBizWallet(w.id), 'Os lançamentos dela não somem: ficam sem conta.')));
    return card(
      el('div', { class: 'cc-top' }, el('div', {}, el('h2', {}, 'Carteira da empresa'), el('p', { class: 'muted' }, 'Onde o dinheiro da empresa está. Em conta corrente você registra o limite do cheque especial (LIS) para ver quanto está usando e quanto isso custa. O saldo é o de partida mais os lançamentos ligados à conta.')),
        el('div', { class: 'cc-top-actions' }, full ? el('p', { class: 'fine' }, data.plan.multi ? 'Você chegou ao limite de contas.' : 'No Ousado cabe uma conta da empresa. No Desbravador você cadastra quantas precisar.') : add)),
      rows.length ? el('ul', { class: 'entries' }, ...rows) : el('p', { class: 'muted' }, 'Nenhuma conta ainda. Cadastre a conta da empresa para acompanhar o saldo.'));
  }

  // ---- Cartões: painéis iguais aos do pessoal (fatura, limite, ações)
  const METER = { none: '', ok: '', attention: 'lis-high', high: 'lis-over' };
  function actionBar(defs) {
    const area = el('div', { class: 'cc-area' });
    let open = null;
    const buttons = defs.map((d) => {
      const b = el('button', { class: 'btn btn-secondary btn-sm cc-actbtn', type: 'button', 'aria-expanded': 'false' }, d.label);
      b.addEventListener('click', () => {
        open = open === d.id ? null : d.id;
        buttons.forEach((x, i) => { const on = defs[i].id === open; x.setAttribute('aria-expanded', String(on)); x.classList.toggle('is-on', on); });
        area.replaceChildren(...(open ? [d.build()] : []));
      });
      return b;
    });
    return [el('div', { class: 'cc-acts', role: 'group', 'aria-label': 'Ações do cartão' }, ...buttons), area];
  }
  function purchasePanel(c) {
    const k = c.id.slice(0, 8);
    const note = el('input', { class: 'input', id: `pc-${k}-desc`, type: 'text', maxlength: '120', placeholder: 'Ex.: anúncios, software, combustível' });
    const amount = moneyInput({ id: `pc-${k}-valor`, ariaLabel: 'Valor da compra' });
    const date = el('input', { class: 'input', id: `pc-${k}-data`, type: 'date', value: todayISO(), max: todayISO() });
    const cat = select(`pc-${k}-cat`, [['', 'Automática (pelo nome)'], ...Object.entries(data.labels.categories)], '');
    const go = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Lançar compra');
    const f = el('form', { class: 'entry-form cc-form form-std' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: note.id }, 'O que foi'), note), field('Valor (R$)', amount.input), field('Data da compra', date), field('Categoria', cat), go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cents = amount.cents();
      if (!cents) return toast('Informe o valor da compra.');
      run(go, () => ctx.api.createBizEntry({ date: date.value, amountCents: -cents, note: note.value.trim(), cardId: c.id, ...(cat.value ? { category: cat.value } : {}) }), 'Compra lançada no cartão.');
    });
    return f;
  }
  function paymentPanel(c) {
    const k = c.id.slice(0, 8);
    const amount = moneyInput({ id: `pg-${k}-valor`, ariaLabel: 'Valor pago', value: c.usedCents > 0 ? c.usedCents : null });
    const date = el('input', { class: 'input', id: `pg-${k}-data`, type: 'date', value: todayISO(), max: todayISO() });
    const wallet = select(`pg-${k}-conta`, data.wallets.map((w) => [w.id, w.name]), data.wallets[0]?.id ?? '');
    const go = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Registrar pagamento');
    const f = el('form', { class: 'entry-form cc-form form-std' }, field('Valor pago (R$)', amount.input, 'A fatura paga não conta como despesa de novo: o gasto está nas compras do cartão.'), field('Data', date), field('Saiu da conta', wallet), go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cents = amount.cents();
      if (!cents) return toast('Informe o valor pago.');
      if (!wallet.value) return toast('Cadastre antes uma conta da empresa.');
      run(go, () => ctx.api.createBizEntry({ date: date.value, amountCents: -cents, note: 'Pagamento da fatura', walletId: wallet.value, cardId: c.id, cardPayment: true }), 'Pagamento da fatura registrado.');
    });
    return f;
  }
  function cardTile(c) {
    const pct = c.limitCents > 0 ? Math.round((c.usedCents / c.limitCents) * 100) : null;
    const level = pct === null ? 'none' : pct >= 90 ? 'high' : pct >= 70 ? 'attention' : 'ok';
    const stat = (label, value, sub) => el('div', { class: 'cc-stat' }, el('span', { class: 'cc-stat-label' }, label), el('strong', {}, value), el('span', { class: 'fine muted' }, sub));
    const meter = pct === null ? el('p', { class: 'fine muted' }, 'Informe o limite para acompanhar quanto você já usou.') : el('div', { class: 'lis-block' },
      el('div', { class: `lis-meter ${METER[level]}`, role: 'img', 'aria-label': `${pct}% do limite em uso` }, el('span', { style: `width:${Math.min(100, pct)}%` })),
      el('p', { class: 'fine' }, `${pct}% do limite em uso: ${brl(c.usedCents)} de ${brl(c.limitCents)}.`));
    const invCtx = { ...ctx, cards: { cards: data.cards }, refresh: show, api: { ...ctx.api, importCardInvoice: ctx.api.importBizInvoice, createCard: ctx.api.createBizCard } };
    const acts = actionBar([
      { id: 'compra', label: 'Nova compra', build: () => purchasePanel(c) },
      { id: 'pagar', label: 'Pagar fatura', build: () => paymentPanel(c) },
      { id: 'pdf', label: 'Importar fatura (PDF)', build: () => invoiceImportPanel(invCtx, c) },
      { id: 'editar', label: 'Editar cartão', build: () => cardForm(c, true) },
    ]);
    return el('article', { class: `card cc-tile cc-${level}` },
      el('header', { class: 'cc-head' }, el('span', { class: 'cc-ico', 'aria-hidden': 'true' }, icon('card')),
        el('div', { class: 'cc-title' }, el('h3', {}, c.name), el('p', { class: 'muted fine' }, `${BRANDS.find(([k]) => k === c.brand)?.[1] ?? ''}${c.last4 ? ` · final ${c.last4}` : ''} · fecha dia ${c.closingDay}, vence dia ${c.dueDay}`)),
        delButton(`Apagar o cartão ${c.name}`, () => ctx.api.deleteBizCard(c.id), 'As compras dele ficam na empresa, sem cartão definido.')),
      el('div', { class: 'cc-stats' }, stat('A pagar', brl(c.usedCents), `vence dia ${c.dueDay}`), stat('Disponível', c.limitCents > 0 ? brl(c.availableCents) : '—', c.limitCents > 0 ? `de ${brl(c.limitCents)}` : 'sem limite informado'), stat('Fecha', `dia ${c.closingDay}`, 'fechamento da fatura')),
      meter, ...acts);
  }
  function cardsCard() {
    const full = data.cards.length >= data.plan.limits.cards;
    const add = el('details', { class: 'cc-add', ...(data.cards.length === 0 ? { open: true } : {}) }, el('summary', { class: 'btn btn-primary' }, icon('plus'), 'Adicionar cartão'), cardForm(null, true));
    const totalLimit = data.cards.reduce((s, c) => s + c.limitCents, 0);
    const totalUsed = data.cards.reduce((s, c) => s + c.usedCents, 0);
    const pct = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : null;
    const invCtx = { ...ctx, cards: { cards: data.cards }, refresh: show, api: { ...ctx.api, importCardInvoice: ctx.api.importBizInvoice, createCard: ctx.api.createBizCard } };
    const quick = data.cards.length > 0 ? el('details', { class: 'cc-add' }, el('summary', { class: 'btn btn-secondary' }, icon('list'), 'Importar fatura (PDF)'), invoiceImportPanel(invCtx, null)) : null;
    const top = card(
      el('div', { class: 'cc-top' }, el('div', {}, el('h2', {}, 'Cartões da empresa'), el('p', { class: 'muted' }, data.cards.length ? `${data.cards.length} de ${data.plan.limits.cards} cartões${totalLimit ? ` · limite total ${brl(totalLimit)}` : ''}.` : 'Cadastre o cartão da empresa para acompanhar limite, fatura e vencimento. Compra no cartão conta como despesa do mês; pagar a fatura não conta de novo.')),
        el('div', { class: 'cc-top-actions' }, full ? el('p', { class: 'fine' }, data.plan.multi ? 'Você chegou ao limite de cartões.' : 'No Ousado cabe um cartão da empresa. No Desbravador você cadastra quantos tiver.') : add, quick)),
      pct !== null ? el('div', { class: 'lis-block' }, el('div', { class: `lis-meter ${pct >= 90 ? 'lis-over' : pct >= 70 ? 'lis-high' : ''}`, role: 'img', 'aria-label': `${pct}% do limite total em uso` }, el('span', { style: `width:${Math.min(100, pct)}%` })), el('p', { class: 'fine' }, `Em uso: ${brl(totalUsed)} (${pct}%). Disponível: ${brl(Math.max(0, totalLimit - totalUsed))}.`)) : null);
    return [top, ...data.cards.map(cardTile)];
  }

  // ---- Lançamentos: o mesmo padrão do pessoal (novo lançamento no topo, blocos por conta e cartão, editar e corrigir)
  const monthLabel = (m) => { const s = new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  function monthNav() {
    const prev = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': 'Mês anterior' }, icon('arrow-left'));
    const next = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': 'Próximo mês', ...(ctx.month >= todayISO().slice(0, 7) ? { disabled: true } : {}) }, icon('arrow-right'));
    prev.addEventListener('click', () => ctx.setMonth(addMonths(ctx.month, -1)));
    next.addEventListener('click', () => ctx.setMonth(addMonths(ctx.month, 1)));
    return el('div', { class: 'month-nav no-print' }, prev, el('strong', { class: 'month-label', role: 'status' }, monthLabel(ctx.month)), next);
  }
  function newEntryForm() {
    let kind = 'gasto';
    const seg = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' }, ...[['gasto', 'Gasto'], ['entrada', 'Entrada']].map(([v, l]) => {
      const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(v === 'gasto') }, l);
      b.addEventListener('click', () => { kind = v; seg.querySelectorAll('.seg-btn').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
      return b;
    }));
    const amount = moneyInput({ id: 'lc-valor', ariaLabel: 'Valor' });
    const date = el('input', { class: 'input', id: 'lc-data', type: 'date', max: todayISO(), value: ctx.month === todayISO().slice(0, 7) ? todayISO() : `${ctx.month}-01` });
    const note = el('input', { class: 'input', id: 'lc-desc', type: 'text', maxlength: '120', placeholder: 'Ex.: anúncios do mês, venda para cliente, DAS' });
    const cat = select('lc-categoria', [['', 'Automática (pelo texto)'], ...Object.entries(data.labels.categories)], '');
    const wallet = data.wallets.length ? select('lc-carteira', [['', 'Sem conta'], ...data.wallets.map((w) => [w.id, w.name])], data.wallets[0].id) : null;
    const go = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Adicionar');
    const f = el('form', { class: 'entry-form' },
      el('div', { class: 'field' }, el('span', { class: 'label' }, 'Tipo'), seg), field('Valor (R$)', amount.input), field('Data', date), field('Categoria', cat),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'lc-desc' }, 'Descrição'), note), wallet ? field('Conta da empresa', wallet) : null, go);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cents = amount.cents();
      if (!cents) return toast('Digite o valor.');
      if (!date.value) return toast('Escolha a data.');
      const body = { date: date.value, amountCents: kind === 'gasto' ? -cents : cents, note: note.value.trim() || (kind === 'gasto' ? 'Gasto' : 'Entrada'), ...(cat.value ? { category: cat.value } : {}), ...(wallet?.value ? { walletId: wallet.value } : {}) };
      ctx.month = date.value.slice(0, 7);
      run(go, () => ctx.api.createBizEntry(body), 'Lançamento adicionado.');
    });
    return f;
  }
  function entriesCard() {
    const opts = {
      categories: Object.entries(data.labels.categories), refresh: show,
      api: { updateEntry: ctx.api.updateBizEntry, setEntryCategory: (id, c) => ctx.api.updateBizEntry(id, { category: c }), deleteEntry: ctx.api.deleteBizEntry },
      locked: (x) => (x.linked ? 'Este lançamento está ligado ao pessoal (movimento com o sócio): para mudar data ou valor, apague e lance de novo.' : null),
    };
    const mapped = entries.map((x) => ({
      id: x.id, date: x.date, note: x.note || x.label, category: x.category, amountCents: x.amountCents, walletId: x.walletId, linked: x.linkedToPf,
      cardName: x.transferKind === 'card_payment' ? null : x.card, transfer: x.transferKind === 'card_payment' || x.transferKind === 'investment',
      transferKind: x.transferKind === 'investment' ? 'investment_redeem' : x.transferKind, tag: x.movement ? MOVEMENT_SHORT[x.movement] : x.linkedToPf ? 'ligado ao pessoal' : null,
    }));
    return card(el('h2', {}, 'Lançamentos da empresa'), monthNav(), newEntryForm(), importBox(),
      el('p', { class: 'fine muted' }, 'Pelo WhatsApp: comece a mensagem com "empresa:" (texto, áudio, foto do cupom ou PDF da fatura) e o lançamento cai aqui, nunca no pessoal.'),
      mapped.length ? ledgerGroups(ctx, mapped, data.wallets, opts) : el('div', { class: 'empty' }, el('strong', {}, 'Nenhum lançamento neste mês'), el('p', { class: 'muted' }, 'Adicione acima ou importe o extrato do banco.')));
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

  /** Dívidas da empresa: a mesma tela de dívidas do pessoal (plano de quitação, pagamentos, cheque especial como dívida), com os dados e as chamadas da empresa. */
  function debtsView() {
    const debtCtx = {
      ...ctx, debts, refresh: show,
      get debtExtra() { return debtExtra; },
      set debtExtra(v) { debtExtra = v; },
      api: { ...ctx.api, createDebt: ctx.api.createBizDebt, deleteDebt: ctx.api.deleteBizDebt, payDebt: (id, body) => ctx.api.payBizDebt(id, { ...body, walletId: data.wallets.length === 1 ? data.wallets[0].id : null }) },
    };
    return viewDividas(debtCtx, { scope: 'pj' });
  }

  function draw() {
    const m = data.month;
    const hero = card(
      el('h2', {}, 'Empresa (PJ)'),
      el('p', { class: 'muted' }, 'Contas, cartões e lançamentos da empresa. Tudo aqui é só da empresa: nada entra na sua Visão geral pessoal, no Orçamento ou nos Relatórios pessoais.'),
      data.hasData
        ? el('dl', { class: 'stats' }, stat('Saldo nas contas', brl(data.totals.balanceCents), tone(data.totals.balanceCents)), stat('Entrou no mês', brl(m.incomeCents), 'pos'), stat('Saiu no mês', brl(m.spendCents)), stat('Resultado do mês', brl(m.resultCents), tone(m.resultCents)),
          ...(data.debts?.count > 0 ? [stat('Dívidas da empresa', brl(data.debts.owedCents), 'neg')] : []))
        : el('p', { class: 'note' }, icon('info'), el('span', {}, 'Comece cadastrando a conta da empresa. Depois lance as vendas e as despesas, e o Prumo mostra o saldo, o resultado do mês e o cartão, separados dos seus números pessoais.')),
      data.cards.length > 0 ? el('p', { class: 'fine' }, `Cartões da empresa: ${brl(data.totals.cardUsedCents)} a pagar.`) : null);
    const upsell = !data.plan.multi ? card(el('p', { class: 'note' }, icon('info'), el('span', {}, 'No Desbravador a empresa ganha contas e cartões à vontade, investimentos da empresa, relatório da empresa e a leitura dos movimentos entre a empresa e você (pró-labore, lucros, aportes e retiradas).'))) : null;
    // Cheque especial (LIS) em uso nas contas da empresa: aviso no topo, igual ao pessoal.
    const alerts = (data.alerts ?? []).length > 0 ? card(...data.alerts.map((a) => el('p', { class: `note ${a.level === 'warn' ? 'note-amber' : ''}` }, icon(a.level === 'warn' ? 'alert' : 'info'), el('span', {}, el('strong', {}, a.title), ' ', a.detail)))) : null;
    root.replaceChildren(...[hero, alerts, walletsCard(), cardsCard(), entriesCard(), chartsCard(), debtsView(), data.plan.multi ? partnerCard() : null, upsell, ...(data.plan.multi ? investCard() : [])].flat().filter(Boolean));
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
      ...(data.debts?.count > 0 ? [stat('Dívidas da empresa', brl(data.debts.owedCents), 'neg')] : []),
      ...(data.investments && data.investments.count > 0 ? [stat('Investido pela empresa', brl(data.investments.positionCents))] : [])),
    ...(data.alerts ?? []).map((a) => el('p', { class: `note ${a.level === 'warn' ? 'note-amber' : ''}` }, icon(a.level === 'warn' ? 'alert' : 'info'), el('span', {}, a.title))),
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
