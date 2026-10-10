// Prumo > Cartões de crédito. Ousado: cadastro, limite usado, fatura, vencimento, compras (com parcelas) e pagamento da fatura.
// Desbravador: também importa a fatura em PDF (lida no aparelho), compara faturas, simula o rotativo e mostra estratégias.
// O plano é exigido no servidor; aqui só desenhamos.
import { el, icon, toast } from './dom.js';
import { brl, percentToBps, todayISO } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';
import { PLANS, CATEGORIES, CATEGORY_LABEL, parseCardInvoice } from '../vendor/engine.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const dayBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (ym) => cap(new Date(`${ym}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
const monthShort = (ym) => cap(new Date(`${ym}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
const catLabel = (c) => CATEGORY_LABEL[c] ?? c;
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard', outra: 'Outra bandeira' };
const METER = { none: '', ok: '', attention: 'lis-high', high: 'lis-over', over: 'lis-over' };
const STATUS = { open: ['Aberta', 'tone-ok'], closed: ['Fechada', 'tone-attention'], overdue: ['Vencida', 'tone-critical'], paid: ['Paga', 'tone-ok'] };
const parcelOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 18, 21, 24, 36, 48, 60];
const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('p', { class: 'fine' }, hint) : null);
const select = (id, label, options, value) => el('select', { class: 'input', id, 'aria-label': label }, ...options.map(([v, l]) => el('option', { value: String(v), ...(String(v) === String(value) ? { selected: true } : {}) }, l)));
const dayOptions = Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]);

function lockedBox(ctx) {
  const target = PLANS.find((p) => p.features.includes('cards'));
  const go = el('button', { class: 'btn btn-primary', type: 'button' }, `Ver o plano ${target.name}`, icon('arrow-right'));
  go.addEventListener('click', () => ctx.goTab('plano'));
  return card(
    el('h2', {}, 'Cartões de crédito'),
    el('div', { class: 'locked-box' }, icon('lock', 'icon icon-lock'), el('div', {}, el('strong', {}, `Disponível a partir do plano ${target.name} (${brl(target.priceCents)}/mês)`), el('p', { class: 'muted' }, 'Cadastre seus cartões, acompanhe o limite usado, o fechamento e o vencimento de cada fatura e nunca mais pague juros do rotativo por esquecimento.'))),
    el('ul', { class: 'tick-list left' },
      ...['Vários cartões, cada um com limite, fechamento e vencimento', 'Compras parceladas que entram mês a mês na fatura certa', 'Alerta de fatura perto de vencer e de limite quase no fim', 'Pagar a fatura sem contar como gasto em dobro'].map((b) => el('li', {}, icon('check'), b))),
    el('div', { class: 'button-row no-print' }, go),
  );
}

// ---------------------------------------------------------------- formulário de cartão (criar e editar)
function cardForm(ctx, existing = null) {
  const p = existing ? `ec-${existing.id.slice(0, 8)}` : 'nc';
  const name = el('input', { class: 'input', id: `${p}-nome`, type: 'text', maxlength: '40', placeholder: 'Ex.: Nubank, Itaú Gold', value: existing?.name ?? '' });
  const brand = select(`${p}-bandeira`, 'Bandeira', Object.entries(BRAND), existing?.brand ?? 'outra');
  const last4 = el('input', { class: 'input', id: `${p}-final`, type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: '1234', value: existing?.last4 ?? '' });
  const limit = moneyInput({ id: `${p}-limite`, ariaLabel: 'Limite do cartão', value: existing ? existing.limitCents : null, placeholder: '0,00' });
  const closing = select(`${p}-fecha`, 'Dia do fechamento', dayOptions, existing?.closingDay ?? 5);
  const due = select(`${p}-vence`, 'Dia do vencimento', dayOptions, existing?.dueDay ?? 12);
  const rate = el('input', { class: 'input', id: `${p}-juros`, type: 'text', inputmode: 'decimal', maxlength: '5', 'aria-label': 'Juros do rotativo ao mês (%)', value: String((existing?.revolvingRateBps ?? 1400) / 100).replace('.', ',') });
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, ...(existing ? ['Salvar'] : [icon('plus'), 'Adicionar cartão']));
  const form = el(
    'form', { class: 'entry-form cc-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: name.id }, 'Nome do cartão'), name),
    field('Bandeira', brand),
    field('4 últimos dígitos (opcional)', last4),
    field('Limite (R$)', limit.input, 'Está no app do banco, na tela do cartão.'),
    field('Fecha no dia', closing, 'O dia em que a fatura fecha.'),
    field('Vence no dia', due, 'O dia em que você paga.'),
    field('Juros do rotativo (% ao mês)', rate, 'Só para simular o custo de pagar parte da fatura. Usamos 14% se você não souber.'),
    save,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (name.value.trim().length < 2) return toast('Dê um nome ao cartão.');
    const bps = percentToBps(rate.value);
    if (bps === undefined || bps > 3000) return toast('Os juros do rotativo devem ser um número entre 0 e 30.');
    const body = { name: name.value.trim(), brand: brand.value, last4: last4.value.trim() || null, limitCents: limit.cents() ?? 0, closingDay: Number(closing.value), dueDay: Number(due.value), revolvingRateBps: bps };
    if (body.last4 && !/^\d{4}$/.test(body.last4)) return toast('Informe só os 4 últimos dígitos.');
    save.disabled = true;
    try {
      if (existing) await ctx.api.updateCard(existing.id, body);
      else await ctx.api.createCard(body);
      toast(existing ? 'Cartão atualizado.' : 'Cartão adicionado.');
      ctx.refresh();
    } catch (err) {
      save.disabled = false;
      toast(err?.message && err.status === 422 ? err.message : 'Não consegui salvar agora.');
    }
  });
  return form;
}

// ---------------------------------------------------------------- ações de cada cartão
function purchasePanel(ctx, c) {
  const k = c.id.slice(0, 8);
  const note = el('input', { class: 'input', id: `pc-${k}-desc`, type: 'text', maxlength: '100', placeholder: 'Ex.: TV, mercado, passagem' });
  const amount = moneyInput({ id: `pc-${k}-valor`, ariaLabel: 'Valor total da compra' });
  const date = el('input', { class: 'input', id: `pc-${k}-data`, type: 'date', value: todayISO(), max: todayISO() });
  const parcels = select(`pc-${k}-parc`, 'Parcelas', parcelOptions.map((n) => [n, n === 1 ? 'À vista' : `${n}x`]), 1);
  const cat = select(`pc-${k}-cat`, 'Categoria', [['', 'Automática (pelo nome)'], ...CATEGORIES.filter((x) => x !== 'renda').map((x) => [x, catLabel(x)])], '');
  const preview = el('p', { class: 'fine field-wide', 'aria-live': 'polite' });
  const refreshPreview = () => {
    const n = Number(parcels.value);
    const v = amount.cents();
    preview.textContent = n > 1 && v ? `${n}x de ${brl(Math.round(v / n))}. A primeira parcela entra agora; as outras entram sozinhas, uma por mês, e já contam no limite.` : '';
  };
  parcels.addEventListener('change', refreshPreview);
  amount.input.addEventListener('input', refreshPreview);
  const add = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Lançar compra');
  const form = el('form', { class: 'entry-form cc-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: note.id }, 'O que foi'), note),
    field('Valor total (R$)', amount.input),
    field('Data da compra', date),
    field('Parcelas', parcels),
    field('Categoria', cat),
    preview,
    add);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = amount.cents();
    if (!cents) return toast('Informe o valor da compra.');
    if (!date.value) return toast('Escolha a data.');
    add.disabled = true;
    try {
      await ctx.api.addCardPurchase(c.id, { date: date.value, amountCents: cents, note: note.value.trim(), ...(cat.value ? { category: cat.value } : {}), installments: Number(parcels.value) });
      toast(Number(parcels.value) > 1 ? 'Compra parcelada lançada.' : 'Compra lançada no cartão.');
      ctx.refresh();
    } catch (err) {
      add.disabled = false;
      toast(err?.status === 422 && err.message ? err.message : 'Não consegui lançar agora.');
    }
  });
  return form;
}

function paymentPanel(ctx, c, wallets) {
  const k = c.id.slice(0, 8);
  const due = c.summary.due;
  const amount = moneyInput({ id: `pg-${k}-valor`, ariaLabel: 'Valor pago', value: due?.remainingCents || null });
  const date = el('input', { class: 'input', id: `pg-${k}-data`, type: 'date', value: todayISO(), max: todayISO() });
  const payable = (wallets ?? []).filter((w) => w.id && w.kind !== 'poupanca');
  const wallet = el('select', { class: 'input', id: `pg-${k}-conta`, 'aria-label': 'Sai de qual conta' }, el('option', { value: '' }, 'Não descontar de nenhuma conta'), ...payable.map((w) => el('option', { value: w.id }, w.name)));
  const pay = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Registrar pagamento');
  const form = el('form', { class: 'entry-form cc-form' },
    due ? el('p', { class: 'fine field-wide' }, `${due.status === 'open' ? 'Fatura aberta' : 'Fatura a pagar'}: ${brl(due.remainingCents)}${due.status === 'open' ? '' : `, vence em ${dayBr(due.dueOn)}`}. Pagou outro valor? É só trocar.`) : el('p', { class: 'fine field-wide' }, 'Nenhuma fatura em aberto agora. Se pagou adiantado, registre mesmo assim.'),
    field('Valor pago (R$)', amount.input),
    field('Data', date),
    field('Saiu de', wallet, 'Com a conta escolhida, o saldo dela cai. Pagar a fatura não conta como gasto novo.'),
    pay);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = amount.cents();
    if (!cents) return toast('Informe quanto você pagou.');
    pay.disabled = true;
    try {
      await ctx.api.addCardPayment(c.id, { amountCents: cents, paidOn: date.value || todayISO(), walletId: wallet.value || null });
      toast('Pagamento registrado.');
      ctx.refresh();
    } catch (err) {
      pay.disabled = false;
      toast(err?.status === 422 && err.message ? err.message : 'Não consegui registrar agora.');
    }
  });
  const recent = c.payments.length
    ? el('ul', { class: 'entries cc-pays' }, ...c.payments.map((p) => {
      const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar o pagamento de ${brl(p.amountCents)}` }, icon('trash'));
      del.addEventListener('click', async () => {
        try {
          await ctx.api.deleteCardPayment(c.id, p.id);
          ctx.refresh();
        } catch {
          toast('Não consegui apagar agora.');
        }
      });
      return el('li', { class: 'wallet-row' }, el('div', {}, el('strong', {}, brl(p.amountCents)), el('p', { class: 'muted fine' }, `${new Date(`${p.paidOn}T12:00:00`).toLocaleDateString('pt-BR')}${p.note ? ` · ${p.note}` : ''}`)), el('span', {}), del);
    }))
    : null;
  return el('div', { class: 'cc-panel-body' }, form, recent ? el('h4', {}, 'Pagamentos recentes') : null, recent);
}

function invoicesPanel(ctx, c) {
  const rows = c.summary.invoices.filter((i) => i.totalCents > 0 || i.status === 'open');
  if (rows.length === 0) return el('p', { class: 'muted' }, 'Ainda não há compras neste cartão.');
  return el('div', { class: 'cc-invoices' }, ...rows.map((inv) => {
    const [label, tone] = STATUS[inv.status];
    const body = el('div', { class: 'cc-invoice-body' });
    const det = el('details', { class: 'cc-invoice' },
      el('summary', {},
        el('span', { class: 'cc-inv-name' }, el('strong', {}, monthName(inv.key)), el('span', { class: 'muted fine' }, `fecha ${dayBr(inv.closingOn)} · vence ${dayBr(inv.dueOn)}`)),
        el('span', { class: 'cc-inv-total' }, el('strong', {}, brl(inv.totalCents)), el('span', { class: `pill ${tone}` }, label))),
      body);
    let loaded = false;
    det.addEventListener('toggle', async () => {
      if (!det.open || loaded) return;
      loaded = true;
      body.replaceChildren(el('p', { class: 'muted', role: 'status' }, 'Carregando…'));
      try {
        const d = await ctx.api.getCardInvoice(c.id, inv.key);
        const list = d.entries.length
          ? el('ul', { class: 'entries' }, ...d.entries.map((e) => el('li', { class: 'wallet-row' }, el('div', {}, el('strong', {}, e.note || 'Compra'), el('p', { class: 'muted fine' }, `${dayBr(e.date)} · ${catLabel(e.category)}${e.installmentNo ? ` · parcela ${e.installmentNo}/${e.installmentTotal}` : ''}`)), el('strong', { class: 'entry-amount neg' }, brl(e.amountCents)), el('span', {}))))
          : el('p', { class: 'muted' }, 'Sem compras nesta fatura.');
        const extra = [];
        if (d.byCategory?.length) {
          const delta = d.previous && d.previous.totalCents > 0 ? Math.round(((d.totalCents - d.previous.totalCents) / d.previous.totalCents) * 100) : null;
          extra.push(
            el('h4', {}, 'Onde foi o dinheiro'),
            delta !== null ? el('p', { class: 'fine' }, `${delta === 0 ? 'Igual' : delta > 0 ? `${delta}% a mais` : `${-delta}% a menos`} que a fatura anterior (${brl(d.previous.totalCents)}).`) : null,
            el('ul', { class: 'cc-cats' }, ...d.byCategory.filter((x) => x.cents > 0 || x.previousCents > 0).map((x) => el('li', {}, el('span', {}, catLabel(x.category)), el('strong', {}, brl(x.cents)), el('span', { class: `fine ${x.cents > x.previousCents ? 'neg' : 'muted'}` }, x.previousCents ? `antes ${brl(x.previousCents)}` : 'novo')))));
        }
        body.replaceChildren(list, ...extra.filter(Boolean));
      } catch {
        loaded = false;
        body.replaceChildren(el('p', { class: 'muted' }, 'Não consegui carregar agora.'));
      }
    });
    return det;
  }));
}

function installmentsBlock(ctx, c) {
  if (c.installments.length === 0) return null;
  return el('div', { class: 'cc-installments' },
    el('h4', {}, 'Parcelas que ainda vão chegar'),
    el('ul', { class: 'entries' }, ...c.installments.map((p) => {
      const stop = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar o resto');
      stop.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Cancelar as parcelas de "${p.note}"?`, text: `As ${p.postedN} já lançadas ficam. As ${p.totalN - p.postedN} que faltam (${brl(p.remainingCents)}) deixam de entrar e de contar no limite. Use isso se a compra foi cancelada ou quitada antes.`, confirmLabel: 'Cancelar o resto' }))) return;
        try {
          await ctx.api.cancelCardInstallments(c.id, p.id);
          toast('Parcelas futuras canceladas.');
          ctx.refresh();
        } catch {
          toast('Não consegui cancelar agora.');
        }
      });
      return el('li', { class: 'wallet-row' }, el('div', {}, el('strong', {}, p.note), el('p', { class: 'muted fine' }, `${p.postedN}/${p.totalN} lançadas · ${brl(p.perCents)} por mês · faltam ${brl(p.remainingCents)}`)), el('span', {}), stop);
    })));
}

// ---------------------------------------------------------------- Desbravador: fatura em PDF e rotativo
function importPanel(ctx, c) {
  const k = c.id.slice(0, 6);
  const input = el('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true, 'aria-label': 'Fatura do cartão em PDF' });
  const pick = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('list'), 'Escolher a fatura em PDF');
  pick.addEventListener('click', () => input.click());
  const box = el('div', { class: 'import-preview', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    toast('Lendo a fatura no seu aparelho…');
    let parsed;
    try {
      const { extractPdfText } = await import('../vendor/pdfread.js');
      const { text } = await extractPdfText(await file.arrayBuffer(), 24);
      parsed = parseCardInvoice(text);
    } catch {
      return toast('Não consegui ler esse PDF. Se ele for uma foto ou estiver protegido, baixe a fatura de novo no app do banco.');
    }
    if (parsed.entries.length === 0) return toast('Não achei compras nesse PDF. Confira se é a fatura do cartão (e não o comprovante de pagamento).');
    const picks = parsed.entries.map((e) => ({ e, on: true }));
    const total = el('strong', {});
    const sum = () => { total.textContent = brl(picks.filter((p) => p.on).reduce((s, p) => s + p.e.amountCents, 0)); };
    const checks = picks.map((p, i) => {
      const cb = el('input', { type: 'checkbox', checked: true, id: `imp-${k}-${i}`, 'aria-label': `Importar ${p.e.note}` });
      cb.addEventListener('change', () => { p.on = cb.checked; sum(); });
      return cb;
    });
    sum();
    const m = parsed.meta;
    const verdict = parsed.check
      ? el('p', { class: `note ${parsed.check.ok ? 'note-green' : 'note-amber'}` }, icon(parsed.check.ok ? 'check' : 'alert'), el('span', {}, parsed.check.ok ? `A soma bate com o total da fatura (${brl(parsed.check.expectedCents)}).` : `A fatura diz ${brl(parsed.check.expectedCents)} e eu li ${brl(parsed.check.parsedCents)}. A diferença pode ser juros, encargos ou saldo de fatura anterior. Confira as linhas antes de importar.`))
      : el('p', { class: 'fine' }, 'O PDF não traz um total para conferir a soma. Confira as linhas antes de importar.');
    const go = el('button', { class: 'btn btn-primary', type: 'button' }, 'Importar para este cartão');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const r = await ctx.api.importCardInvoice(c.id, {
          entries: picks.filter((p) => p.on).map((p) => ({ date: p.e.date, amountCents: p.e.amountCents, note: p.e.note, installmentNo: p.e.installmentNo, installmentTotal: p.e.installmentTotal })),
          credits: parsed.credits.map((x) => ({ date: x.date, amountCents: x.amountCents, note: x.note })),
        });
        toast(`${r.added} compras importadas${r.credits ? `, ${r.credits} crédito(s) abatido(s)` : ''}${r.duplicates ? `, ${r.duplicates} repetidas ignoradas` : ''}.`);
        ctx.refresh();
      } catch {
        go.disabled = false;
        toast('Não consegui importar agora.');
      }
    });
    box.replaceChildren(
      el('p', { class: 'fine' }, `Li ${parsed.entries.length} compras${parsed.credits.length ? ` e ${parsed.credits.length} crédito(s) ou pagamento(s)` : ''}${parsed.skipped ? ` (${parsed.skipped} linhas não reconhecidas)` : ''}${m.dueOn ? `. Vencimento: ${dayBr(m.dueOn)}` : ''}. Desmarque o que não quiser.`),
      verdict,
      el('ul', { class: 'entries import-list' }, ...picks.map((p, i) => el('li', { class: 'wallet-row' }, el('label', { class: 'check', for: checks[i].id }, checks[i], el('span', {}, el('strong', {}, p.e.note), el('span', { class: 'muted fine' }, ` ${dayBr(p.e.date)}${p.e.installmentNo ? ` · parcela ${p.e.installmentNo}/${p.e.installmentTotal}` : ''}`))), el('strong', { class: 'entry-amount neg' }, brl(p.e.amountCents)), el('span', {})))),
      parsed.credits.length ? el('p', { class: 'fine' }, `Créditos que abatem a fatura: ${parsed.credits.map((x) => `${x.note} ${brl(x.amountCents)}`).join('; ')}.`) : null,
      el('div', { class: 'button-row' }, go, el('span', { class: 'fine' }, 'Marcadas: ', total)),
    );
    box.hidden = false;
  });
  return el('div', { class: 'cc-panel-body' }, el('p', { class: 'muted' }, 'Baixe a fatura em PDF no app do banco e escolha o arquivo. Ele é lido aqui, no seu aparelho: o PDF não é enviado. As compras parceladas ("03/10") já criam as parcelas que faltam, e o que já estiver lançado é ignorado.'), pick, input, box);
}

function rotativoPanel(ctx, c) {
  const fixed = moneyInput({ id: `rv-${c.id.slice(0, 8)}`, ariaLabel: 'Quanto você consegue pagar por mês' });
  const run = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Simular');
  const out = el('div', { class: 'cc-rev', 'aria-live': 'polite' });
  const months = (m) => (m >= 600 ? 'nunca, neste ritmo' : m === 1 ? '1 mês' : `${m} meses`);
  async function go() {
    run.disabled = true;
    try {
      const r = await ctx.api.getCardRevolving(c.id, fixed.cents() ?? 0);
      if (!r.options.length) out.replaceChildren(el('p', { class: 'muted' }, 'Nenhuma fatura em aberto para simular. Quando houver, mostro aqui o custo de pagar só parte.'));
      else out.replaceChildren(
        el('p', {}, `Fatura de ${brl(r.balanceCents)} com juros de ${(r.rateBps / 100).toLocaleString('pt-BR')}% ao mês:`),
        el('table', { class: 'cc-table' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Se eu…'), el('th', { scope: 'col' }, 'Leva'), el('th', { scope: 'col' }, 'Juros'))),
          el('tbody', {}, ...r.options.map((o) => el('tr', { class: o.id === 'full' ? 'cc-best' : '' }, el('td', {}, o.label), el('td', {}, o.neverPaysOff ? 'Não quita' : months(o.months)), el('td', {}, o.totalInterestCents ? brl(o.totalInterestCents) : 'R$ 0,00'))))),
        el('p', { class: 'fine' }, 'Estimativa com juro fixo ao mês. Os encargos reais variam por banco.'));
    } catch {
      toast('Não consegui simular agora.');
    }
    run.disabled = false;
  }
  run.addEventListener('click', go);
  return el('div', { class: 'cc-panel-body' }, el('p', { class: 'muted' }, 'Quanto custa não pagar a fatura inteira? Escolha quanto cabe por mês e veja a diferença.'), el('div', { class: 'button-row' }, el('div', { class: 'field' }, el('label', { class: 'label', for: fixed.input.id }, 'Consigo pagar por mês (R$, opcional)'), fixed.input), run), out);
}

/** Botões de ação de um cartão + uma área só onde o formulário escolhido aparece (um por vez; clicar de novo fecha). Os painéis só são montados ao abrir. */
function actionBar(defs) {
  const area = el('div', { class: 'cc-area' });
  let open = null;
  const buttons = defs.map((d) => {
    const b = el('button', { class: 'btn btn-secondary btn-sm cc-actbtn', type: 'button', 'aria-expanded': 'false' }, d.label);
    b.addEventListener('click', () => {
      open = open === d.id ? null : d.id;
      buttons.forEach((x, i) => {
        const on = defs[i].id === open;
        x.setAttribute('aria-expanded', String(on));
        x.classList.toggle('is-on', on);
      });
      area.replaceChildren(...(open ? [d.build()] : []));
    });
    return b;
  });
  return [el('div', { class: 'cc-acts', role: 'group', 'aria-label': 'Ações do cartão' }, ...buttons), area];
}

// ---------------------------------------------------------------- tile de um cartão
function cardTile(ctx, c, data, wallets) {
  const s = c.summary;
  const due = s.due;
  const dueSub = !due ? 'nada a pagar' : due.status === 'overdue' ? `venceu em ${dayBr(due.dueOn)}` : due.status === 'open' ? `fecha em ${dayBr(s.current.closingOn)}` : `vence ${due.daysToDue <= 0 ? 'hoje' : due.daysToDue === 1 ? 'amanhã' : `em ${due.daysToDue} dias`} (${dayBr(due.dueOn)})`;
  const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar o cartão ${c.name}` }, icon('trash'));
  del.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: `Apagar o cartão "${c.name}"?`, text: 'Os gastos dele continuam nos seus lançamentos, só sem o cartão. As parcelas que ainda iam chegar e os pagamentos de fatura registrados aqui são apagados.', confirmLabel: 'Apagar', danger: true }))) return;
    try {
      await ctx.api.deleteCard(c.id);
      toast('Cartão apagado.');
      ctx.refresh();
    } catch {
      toast('Não consegui apagar agora.');
    }
  });
  const stat = (label, value, sub, tone) => el('div', { class: `cc-stat${tone ? ` ${tone}` : ''}` }, el('span', { class: 'cc-stat-label' }, label), el('strong', {}, value), el('span', { class: 'fine muted' }, sub));
  const meter = s.usedPct === null ? el('p', { class: 'fine muted' }, 'Informe o limite para acompanhar quanto você já usou.') : el('div', { class: 'lis-block' },
    el('div', { class: `lis-meter ${METER[s.level]}`, role: 'img', 'aria-label': `${s.usedPct}% do limite em uso` }, el('span', { style: `width:${Math.min(100, s.usedPct)}%` })),
    el('p', { class: 'fine' }, `${s.usedPct}% do limite em uso: ${brl(s.usedCents)} de ${brl(s.limitCents)}${s.futureInstallmentsCents ? `, sendo ${brl(s.futureInstallmentsCents)} de parcelas que ainda vão chegar` : ''}.`));
  const acts = actionBar([
    { id: 'compra', label: 'Nova compra', build: () => purchasePanel(ctx, c) },
    { id: 'pagar', label: 'Pagar fatura', build: () => paymentPanel(ctx, c, wallets) },
    { id: 'faturas', label: 'Faturas', build: () => invoicesPanel(ctx, c) },
    ...(data.pro ? [{ id: 'pdf', label: 'Importar fatura (PDF)', build: () => importPanel(ctx, c) }, { id: 'rotativo', label: 'E se eu pagar só parte?', build: () => rotativoPanel(ctx, c) }] : []),
    { id: 'editar', label: 'Editar cartão', build: () => cardForm(ctx, c) },
  ]);
  return el('article', { class: `card cc-tile cc-${s.level}` },
    el('header', { class: 'cc-head' },
      el('span', { class: 'cc-ico', 'aria-hidden': 'true' }, icon('card')),
      el('div', { class: 'cc-title' }, el('h3', {}, c.name), el('p', { class: 'muted fine' }, `${BRAND[c.brand] ?? ''}${c.last4 ? ` · final ${c.last4}` : ''} · fecha dia ${c.closingDay}, vence dia ${c.dueDay}`)),
      del),
    el('div', { class: 'cc-stats' },
      stat('Fatura aberta', brl(s.current.totalCents), `fecha em ${dayBr(s.current.closingOn)}`),
      stat('A pagar', due ? brl(due.remainingCents) : 'R$ 0,00', dueSub, due?.status === 'overdue' ? 'neg' : ''),
      stat('Disponível', s.usedPct === null ? '—' : brl(s.availableCents), s.usedPct === null ? 'sem limite informado' : `de ${brl(s.limitCents)}`)),
    meter,
    ...acts,
    installmentsBlock(ctx, c));
}

// ---------------------------------------------------------------- tela
const LEVEL_NOTE = { alert: 'note note-amber', warn: 'note note-amber', tip: 'note', info: 'note' };
const LEVEL_ICON = { alert: 'alert', warn: 'alert', tip: 'info', info: 'info' };

function commitmentsChart(list) {
  const max = Math.max(1, ...list.map((x) => x.cents));
  return el('ol', { class: 'cc-bars', 'aria-label': 'Parcelas que ainda vão chegar, mês a mês' },
    ...list.map((x) => el('li', {}, el('span', { class: 'cc-bar-v fine' }, x.cents ? brl(x.cents).replace(',00', '') : '—'), el('span', { class: 'cc-bar', style: `height:${Math.max(x.cents ? 8 : 2, Math.round((x.cents / max) * 100))}%`, title: `${monthName(x.month)}: ${brl(x.cents)}` }), el('span', { class: 'cc-bar-m' }, monthShort(x.month)))));
}

export function viewCartoes(ctx) {
  if (!ctx.has('cards')) return lockedBox(ctx);
  const d = ctx.cards;
  const wallets = ctx.wallets?.wallets ?? [];
  const out = [];

  const add = el('details', { class: 'cc-add', ...(d.cards.length === 0 ? { open: true } : {}) },
    el('summary', { class: 'btn btn-primary' }, icon('plus'), 'Adicionar cartão'),
    cardForm(ctx));
  const total = d.totals;
  out.push(card(
    el('div', { class: 'cc-top' },
      el('div', {}, el('h2', {}, 'Cartões de crédito'), el('p', { class: 'muted' }, d.cards.length ? `${d.cards.length} de ${d.maxCards} cartões${total.limitCents ? ` · limite total ${brl(total.limitCents)}` : ''}.` : 'Cadastre seus cartões para acompanhar limite, fatura e vencimento. Compra no cartão conta como gasto do mês; pagar a fatura não conta de novo.')),
      d.cards.length < d.maxCards ? add : el('p', { class: 'fine' }, d.pro ? 'Você chegou ao limite de cartões.' : `Seu plano comporta ${d.maxCards} cartões; o Desbravador comporta mais.`)),
    d.cards.length > 0 && total.limitCents > 0 ? el('div', { class: 'lis-block' },
      el('div', { class: `lis-meter ${total.usedPct >= 90 ? 'lis-over' : total.usedPct >= 70 ? 'lis-high' : ''}`, role: 'img', 'aria-label': `${total.usedPct}% do limite total em uso` }, el('span', { style: `width:${Math.min(100, total.usedPct)}%` })),
      el('p', { class: 'fine' }, `Em uso: ${brl(total.usedCents)} (${total.usedPct}%). Disponível: ${brl(total.availableCents)}.`)) : null,
    ...d.alerts.map((a) => el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, a.text))),
  ));

  if (d.pro && d.strategies.length > 0) {
    out.push(card(
      el('h2', {}, 'Estratégias para os seus cartões'),
      el('p', { class: 'muted' }, 'Calculadas com as suas faturas, prazos, parcelas e juros informados.'),
      ...d.strategies.map((s) => el('div', { class: LEVEL_NOTE[s.level] }, icon(LEVEL_ICON[s.level]), el('div', {}, el('strong', {}, s.title), el('p', {}, s.text))))));
  }

  for (const c of d.cards) out.push(cardTile(ctx, c, d, wallets));

  const commit = d.commitments.filter((x) => x.cents > 0);
  if (d.cards.length > 0 && commit.length > 0) {
    out.push(card(
      el('h2', {}, 'Parcelas dos próximos meses'),
      el('p', { class: 'muted' }, d.pro ? 'Quanto das compras parceladas que você já fez cai em cada mês. Some isso ao que pretende gastar antes de parcelar mais.' : 'As próximas parcelas que já estão a caminho. No Desbravador você vê os 12 meses e recebe alertas quando elas pesam demais na renda.'),
      d.pro ? commitmentsChart(d.commitments) : el('ul', { class: 'entries' }, ...commit.map((x) => el('li', { class: 'wallet-row' }, el('strong', {}, monthName(x.month)), el('span', {}), el('strong', {}, brl(x.cents))))),
    ));
  }

  if (!d.pro && d.cards.length > 0) {
    const go = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ver o plano Desbravador');
    go.addEventListener('click', () => ctx.goTab('plano'));
    out.push(card(
      el('h2', {}, 'Quer ir além?'),
      el('div', { class: 'locked-box' }, icon('lock', 'icon icon-lock'), el('div', {}, el('strong', {}, 'No Desbravador'), el('p', { class: 'muted' }, 'Importe a fatura em PDF e deixe o Prumo ler as compras e as parcelas, compare faturas por categoria, veja o custo do rotativo e receba estratégias: melhor cartão para comprar hoje, qual fatura pagar primeiro e quando as parcelas apertam o orçamento.'))),
      el('div', { class: 'button-row no-print' }, go)));
  }

  if (d.cards.length > 0) out.push(el('p', { class: 'fine muted' }, 'Dica: se você também importa o extrato do banco, a linha de "pagamento de fatura" pode aparecer como gasto em dobro. Apague essa linha ou não lance as compras do cartão aqui.'));
  return el('div', { class: 'acc-stack' }, ...out);
}
