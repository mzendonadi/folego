// Assinatura: abas "Carteiras" e "Lembretes" (o plano é exigido no servidor; aqui só desenhamos).
import { el, icon, toast } from './dom.js';
import { brl, percentToBps } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
export const WALLET_KIND_LABEL = { dinheiro: 'Dinheiro', conta: 'Conta bancária', cartao: 'Cartão', poupanca: 'Poupança', outra: 'Outra' };

/** "1.234,50" → 123450 (aceita vazio = 0). */
const centsOrZero = (m) => m.cents() ?? 0;
const bpsToField = (bps) => String(bps / 100).replace('.', ',');

const OVERDRAFT_TONE = { none: '', low: 'note', high: 'note note-amber', over: 'note note-amber' };

/** Faixa do cheque especial (LIS) de uma conta bancária: limite, quanto está em uso e o custo estimado. */
function overdraftBlock(x) {
  const o = x.overdraft;
  if (!o || (x.overdraftLimitCents === 0 && o.usedCents === 0)) return null;
  const pct = Math.min(100, o.usedPct);
  const meter = el('div', { class: `lis-meter lis-${o.level}`, role: 'img', 'aria-label': `${o.usedPct}% do limite do cheque especial em uso` }, el('span', { style: `width:${pct}%` }));
  const lines = [
    el('p', { class: 'fine' }, x.overdraftLimitCents > 0 ? `Limite do cheque especial (LIS): ${brl(x.overdraftLimitCents)} · taxa ${bpsToField(x.overdraftRateBps)}% ao mês` : 'Você não informou limite de cheque especial.'),
  ];
  if (o.usedCents > 0) {
    lines.push(el('p', { class: OVERDRAFT_TONE[o.level] ? `${OVERDRAFT_TONE[o.level]} lis-note` : 'fine' }, icon(o.level === 'low' ? 'info' : 'alert'), el('span', {}, `Usando ${brl(o.usedCents)} do limite (${o.usedPct}%). Se ficar assim por um mês, o banco cobra cerca de ${brl(o.monthlyCostCents)} de juros.${o.overLimitCents > 0 ? ` A conta passou ${brl(o.overLimitCents)} do limite.` : ''}`)));
  } else {
    lines.push(el('p', { class: 'fine' }, `Limite todo livre: ${brl(o.availableCents)} disponíveis. Não está pagando juros.`));
  }
  return el('div', { class: 'lis-block' }, meter, ...lines);
}

/** Formulário de cheque especial / saldo (usado ao criar e ao ajustar uma conta bancária). */
function accountFields(init = {}) {
  const opening = moneyInput({ id: init.prefix ? `${init.prefix}-saldo` : 'cw-saldo', ariaLabel: 'Saldo de partida', value: Math.abs(init.openingBalanceCents ?? 0) || null, placeholder: '0,00' });
  const negative = el('input', { type: 'checkbox', id: init.prefix ? `${init.prefix}-neg` : 'cw-neg' });
  negative.checked = (init.openingBalanceCents ?? 0) < 0;
  const limit = moneyInput({ id: init.prefix ? `${init.prefix}-lis` : 'cw-lis', ariaLabel: 'Limite do cheque especial (LIS)', value: init.overdraftLimitCents || null, placeholder: 'sem limite' });
  const rate = el('input', { class: 'input', id: init.prefix ? `${init.prefix}-taxa` : 'cw-taxa', type: 'text', inputmode: 'decimal', maxlength: '5', 'aria-label': 'Taxa do cheque especial ao mês (%)', value: bpsToField(init.overdraftRateBps ?? 800) });
  const node = el(
    'div', { class: 'lis-fields' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: opening.input.id }, 'Saldo da conta hoje'), opening.input, el('div', { class: 'check' }, negative, el('label', { for: negative.id }, 'A conta está no negativo (usando o cheque especial)'))),
    el('div', { class: 'field' }, el('label', { class: 'label', for: limit.input.id }, 'Limite do cheque especial (LIS), se tiver'), limit.input, el('p', { class: 'fine' }, 'Está no app ou no extrato do banco. Deixe em branco se não tem.')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: rate.id }, 'Taxa do cheque especial (% ao mês)'), rate, el('p', { class: 'fine' }, 'Usamos 8% ao mês se você não souber. É o teto que os bancos podem cobrar.')),
  );
  const read = () => {
    const base = centsOrZero(opening);
    const r = percentToBps(rate.value);
    return { openingBalanceCents: negative.checked ? -base : base, overdraftLimitCents: centsOrZero(limit), overdraftRateBps: r === undefined ? 800 : r, rateOk: r !== undefined };
  };
  return { node, read };
}

export function viewCarteiras(ctx) {
  const w = ctx.wallets;
  const name = el('input', { class: 'input', id: 'cw-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Nubank, carteira, cartão do mercado' });
  const nameLabel = el('label', { class: 'label', for: 'cw-nome' }, 'Nome');
  const kind = el('select', { class: 'input', id: 'cw-tipo', 'aria-label': 'Tipo da carteira' }, ...Object.entries(WALLET_KIND_LABEL).map(([v, l]) => el('option', { value: v }, l)));
  const fields = accountFields();
  const lisBox = el('div', { class: 'field field-wide' }, fields.node);
  lisBox.hidden = true;
  // "Outra": a pessoa diz qual é (vale-refeição, PicPay, cofrinho...); o nome é essa descrição.
  const kindHint = el('p', { class: 'fine', id: 'cw-dica' });
  kindHint.hidden = true;
  const onKind = () => {
    const other = kind.value === 'outra';
    nameLabel.textContent = other ? 'Qual é essa carteira?' : 'Nome';
    name.placeholder = other ? 'Ex.: vale-refeição, PicPay, cofrinho, conta de um parente' : 'Ex.: Nubank, carteira, cartão do mercado';
    kindHint.textContent = other ? 'Como é um tipo diferente dos da lista, escreva aqui o que ela é: é o nome que vai aparecer nos seus lançamentos.' : '';
    kindHint.hidden = !other;
    lisBox.hidden = kind.value !== 'conta';
  };
  kind.addEventListener('change', onKind);
  const add = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Criar carteira');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field field-wide' }, nameLabel, name, kindHint),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'cw-tipo' }, 'Tipo'), kind),
    lisBox,
    add,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) return toast(kind.value === 'outra' ? 'Escreva qual é essa carteira.' : 'Dê um nome à carteira.');
    const body = { name: name.value.trim(), kind: kind.value };
    if (kind.value === 'conta') {
      const v = fields.read();
      if (!v.rateOk) return toast('A taxa do cheque especial deve ser um número entre 0 e 100.');
      Object.assign(body, { openingBalanceCents: v.openingBalanceCents, overdraftLimitCents: v.overdraftLimitCents, overdraftRateBps: v.overdraftRateBps });
    }
    add.disabled = true;
    try {
      await ctx.api.createWallet(body);
      toast('Carteira criada.');
      ctx.refresh();
    } catch (err) {
      add.disabled = false;
      toast(err?.status === 422 ? 'Você chegou ao limite de carteiras.' : 'Não consegui criar agora.');
    }
  });

  const row = (x) => {
    const title = x.name;
    const sub = x.id ? `${WALLET_KIND_LABEL[x.kind] ?? x.kind} · ${x.entries} ${x.entries === 1 ? 'lançamento' : 'lançamentos'}` : `${x.entries} ${x.entries === 1 ? 'lançamento' : 'lançamentos'}`;
    let del = null;
    let edit = null;
    if (x.id) {
      del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar a carteira ${title}` }, icon('trash'));
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Apagar "${title}"?`, text: 'Os lançamentos dela não somem: ficam sem carteira.', confirmLabel: 'Apagar' }))) return;
        try {
          await ctx.api.deleteWallet(x.id);
          toast('Carteira apagada.');
          ctx.refresh();
        } catch {
          toast('Não consegui apagar agora.');
        }
      });
      if (x.kind === 'conta') edit = adjustForm(x);
    }
    return el(
      'li', { class: 'wallet-row' },
      el('div', {}, el('strong', {}, title), el('p', { class: 'muted fine' }, sub), x.id ? overdraftBlock(x) : null, edit),
      el('strong', { class: `entry-amount ${x.balanceCents < 0 ? 'neg' : 'pos'}` }, brl(x.balanceCents)),
      del,
    );
  };

  /** "Ajustar saldo e cheque especial" dentro da linha da conta bancária. */
  function adjustForm(x) {
    const f = accountFields({ prefix: `aj-${x.id.slice(0, 8)}`, openingBalanceCents: x.openingBalanceCents, overdraftLimitCents: x.overdraftLimitCents, overdraftRateBps: x.overdraftRateBps });
    const save = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar');
    save.addEventListener('click', async () => {
      const v = fields2(f);
      if (!v.rateOk) return toast('A taxa deve ser um número entre 0 e 100.');
      save.disabled = true;
      try {
        await ctx.api.updateWallet(x.id, { openingBalanceCents: v.openingBalanceCents, overdraftLimitCents: v.overdraftLimitCents, overdraftRateBps: v.overdraftRateBps });
        toast('Conta atualizada.');
        ctx.refresh();
      } catch {
        save.disabled = false;
        toast('Não consegui salvar agora.');
      }
    });
    return el('details', { class: 'lis-edit' }, el('summary', {}, 'Ajustar saldo e cheque especial (LIS)'), f.node, save);
  }
  const fields2 = (f) => f.read();

  const items = [
    ...w.wallets.map((x) => row(x)),
    w.unassigned.entries > 0 ? row({ id: null, name: 'Sem carteira', entries: w.unassigned.entries, balanceCents: w.unassigned.balanceCents }) : null,
  ].filter(Boolean);
  return el(
    'div', { class: 'acc-stack' },
    card(el('h2', {}, 'Nova carteira'), el('p', { class: 'muted' }, 'Separe onde o dinheiro está: conta, dinheiro vivo, cartão. Em conta bancária você também registra o limite do cheque especial (LIS) para acompanhar quanto está usando e quanto isso custa. O saldo é o saldo de partida mais os lançamentos ligados à carteira.'), form),
    card(el('h2', {}, 'Saldo por carteira'), items.length ? el('ul', { class: 'entries' }, ...items) : el('p', { class: 'muted' }, 'Nenhuma carteira ainda. Crie a primeira acima e escolha-a ao lançar um gasto.')),
  );
}

export function viewLembretes(ctx) {
  const list = ctx.reminders;
  const title = el('input', { class: 'input', id: 'lm-titulo', type: 'text', maxlength: '80', placeholder: 'Ex.: conta de luz, parcela do carro' });
  const due = el('input', { class: 'input', id: 'lm-data', type: 'date', value: new Date().toISOString().slice(0, 10) });
  const amount = moneyInput({ id: 'lm-valor', ariaLabel: 'Valor (opcional)' });
  const repeat = el('input', { type: 'checkbox', id: 'lm-mensal' });
  const days = el('select', { class: 'input', id: 'lm-dias', 'aria-label': 'Avisar por e-mail' }, ...[[0, 'No dia'], [1, '1 dia antes'], [3, '3 dias antes'], [7, '7 dias antes']].map(([v, l]) => el('option', { value: String(v), selected: v === 1 }, l)));
  const add = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Criar lembrete');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'lm-titulo' }, 'O que vence'), title),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lm-data' }, 'Vence em'), due),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lm-valor' }, 'Valor (opcional)'), amount.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lm-dias' }, 'Aviso por e-mail'), days),
    el('label', { class: 'check', for: 'lm-mensal' }, repeat, ' Repete todo mês'),
    add,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (title.value.trim().length < 2) return toast('Diga o que vence.');
    if (!due.value) return toast('Escolha a data.');
    add.disabled = true;
    try {
      await ctx.api.createReminder({ title: title.value.trim(), dueOn: due.value, amountCents: amount.cents() || null, repeatMonthly: repeat.checked, emailDaysBefore: Number(days.value) });
      toast('Lembrete criado.');
      ctx.refresh();
    } catch {
      add.disabled = false;
      toast('Não consegui criar agora.');
    }
  });

  const rows = list.map((r) => {
    const check = el('input', { type: 'checkbox', checked: r.done, 'aria-label': `Marcar "${r.title}" como pago` });
    check.addEventListener('change', async () => {
      try {
        await ctx.api.updateReminder(r.id, { done: check.checked });
        ctx.refresh();
      } catch {
        check.checked = !check.checked;
        toast('Não consegui salvar agora.');
      }
    });
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar o lembrete ${r.title}` }, icon('trash'));
    del.addEventListener('click', async () => {
      try {
        await ctx.api.deleteReminder(r.id);
        ctx.refresh();
      } catch {
        toast('Não consegui apagar agora.');
      }
    });
    const when = r.done ? 'Pago' : r.overdue ? `Venceu há ${-r.daysLeft} dia(s)` : r.daysLeft === 0 ? 'Vence hoje' : r.daysLeft === 1 ? 'Vence amanhã' : `Vence em ${r.daysLeft} dias`;
    return el(
      'li', { class: `wallet-row${r.done ? ' is-done' : ''}` },
      el('label', { class: 'check' }, check, el('span', {}, el('strong', {}, r.title), el('span', { class: `muted fine${r.overdue ? ' neg' : ''}` }, ` ${fmtDate(r.dueOn)} · ${when}${r.repeatMonthly ? ' · todo mês' : ''}`))),
      r.amountCents ? el('strong', {}, brl(r.amountCents)) : el('span', {}),
      del,
    );
  });
  return el(
    'div', { class: 'acc-stack' },
    card(el('h2', {}, 'Novo lembrete'), el('p', { class: 'muted' }, 'Anote contas e prazos. Mandamos um e-mail na antecedência que você escolher. Ao marcar uma conta mensal como paga, a do mês seguinte já aparece.'), form),
    card(el('h2', {}, 'Seus lembretes'), rows.length ? el('ul', { class: 'entries' }, ...rows) : el('p', { class: 'muted' }, 'Nenhum lembrete ainda.')),
  );
}

const KIND_NOTE = { avalanche: 'Avalanche: ataca primeiro a dívida com juros mais altos. É a que menos custa.', snowball: 'Bola de neve: ataca primeiro a menor dívida. Custa um pouco mais, mas dá vitórias rápidas.' };
const monthsText = (m) => (m >= 600 ? 'nunca, neste ritmo' : m === 0 ? 'já está tudo pago' : m < 12 ? `${m} meses` : `${Math.floor(m / 12)} ${Math.floor(m / 12) === 1 ? 'ano' : 'anos'}${m % 12 ? ` e ${m % 12} meses` : ''}`);

export function viewDividas(ctx) {
  const d = ctx.debts;
  const name = el('input', { class: 'input', id: 'dv-nome', type: 'text', maxlength: '60', placeholder: 'Ex.: cartão do banco, financiamento' });
  const balance = moneyInput({ id: 'dv-saldo', ariaLabel: 'Quanto falta pagar' });
  const rate = el('input', { class: 'input', id: 'dv-juros', type: 'number', min: '0', max: '100', step: '0.01', placeholder: 'Ex.: 12' });
  const minPay = moneyInput({ id: 'dv-min', ariaLabel: 'Parcela mínima por mês' });
  const add = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Adicionar dívida');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'dv-nome' }, 'Qual dívida'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'dv-saldo' }, 'Quanto falta (R$)'), balance.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'dv-juros' }, 'Juros ao mês (%)'), rate),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'dv-min' }, 'Parcela mínima (R$)'), minPay.input),
    add,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = balance.cents();
    if (!name.value.trim()) return toast('Diga qual é a dívida.');
    if (!cents) return toast('Informe quanto falta pagar.');
    add.disabled = true;
    try {
      await ctx.api.createDebt({ name: name.value.trim(), balanceCents: cents, monthlyRateBps: Math.round((Number(rate.value) || 0) * 100), minPaymentCents: minPay.cents() || 0 });
      toast('Dívida adicionada.');
      ctx.refresh();
    } catch {
      add.disabled = false;
      toast('Não consegui adicionar agora.');
    }
  });

  const rows = d.debts.map((x) => {
    const amount = moneyInput({ id: `pg-${x.id}`, ariaLabel: `Valor pago em ${x.name}`, small: true });
    const payBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Registrar pagamento');
    payBtn.addEventListener('click', async () => {
      const cents = amount.cents();
      if (!cents) return toast('Informe quanto você pagou.');
      payBtn.disabled = true;
      try {
        const r = await ctx.api.payDebt(x.id, { amountCents: cents, addToLedger: true });
        toast(r.paidOff ? `${x.name} quitada! 🎉` : 'Pagamento registrado.');
        ctx.refresh();
      } catch {
        payBtn.disabled = false;
        toast('Não consegui registrar agora.');
      }
    });
    // Cheque especial (LIS): vem da carteira (conta bancária); não se paga nem se remove aqui.
    if (x.virtual) {
      const share = el('li', { class: 'debt-row' },
        el('div', { class: 'debt-top' }, el('strong', {}, x.name), d.plan?.focusId === x.id ? el('span', { class: 'pill tone-ok' }, 'Foco agora') : null, el('span', { class: 'pill tone-attention' }, 'Cheque especial (LIS)')),
        el('p', { class: 'muted fine' }, `Usando ${brl(x.balanceCents)} · juros ${(x.monthlyRateBps / 100).toLocaleString('pt-BR')}% ao mês (cerca de ${brl(Math.round((x.balanceCents * x.monthlyRateBps) / 10_000))} por mês).`),
        el('p', { class: 'fine' }, 'Este valor vem da sua conta bancária na aba Carteiras. Para pagar, lance uma entrada nessa conta: o saldo volta ao positivo e a dívida some daqui.'),
        el('div', { class: 'button-row no-print' }, (() => { const go = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ir para Carteiras'); go.addEventListener('click', () => ctx.goTab('carteiras')); return go; })()),
      );
      return share;
    }
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Remover ${x.name}` }, icon('trash'));
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Remover "${x.name}"?`, text: 'O histórico de pagamentos dela também sai.', confirmLabel: 'Remover' }))) return;
      try {
        await ctx.api.deleteDebt(x.id);
        ctx.refresh();
      } catch {
        toast('Não consegui remover agora.');
      }
    });
    const pct = x.initialCents ? Math.round(((x.initialCents - x.balanceCents) / x.initialCents) * 100) : 0;
    const focus = d.plan?.focusId === x.id;
    return el(
      'li', { class: `debt-row${x.paidOff ? ' is-done' : ''}` },
      el('div', { class: 'debt-top' }, el('strong', {}, x.name), focus ? el('span', { class: 'pill tone-ok' }, 'Foco agora') : null, x.paidOff ? el('span', { class: 'pill tone-ok' }, 'Quitada') : null, del),
      el('p', { class: 'muted fine' }, x.paidOff ? 'Parabéns!' : `Falta ${brl(x.balanceCents)}${x.monthlyRateBps ? ` · juros ${(x.monthlyRateBps / 100).toLocaleString('pt-BR')}% ao mês` : ''}${x.minPaymentCents ? ` · mínima ${brl(x.minPaymentCents)}` : ''}`),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': `Progresso de ${x.name}` }, el('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` })),
      x.paidOff ? null : el('div', { class: 'button-row no-print' }, amount.input, payBtn),
    );
  });

  let planBox = null;
  if (d.plan) {
    const p = d.plan;
    const best = p[p.recommended];
    const extra = moneyInput({ id: 'dv-extra', ariaLabel: 'Quanto a mais por mês', value: p.extraCents || null, placeholder: '0,00' });
    const sim = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Simular');
    sim.addEventListener('click', () => {
      ctx.debtExtra = extra.cents() || 0;
      ctx.refresh();
    });
    const focus = d.debts.find((x) => x.id === p.focusId);
    planBox = card(
      el('h2', {}, 'Seu plano de quitação'),
      best.neverPaysOff
        ? el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Com as parcelas atuais os juros comem o pagamento e a dívida não acaba. Veja o quanto a mais por mês muda isso abaixo, ou negocie a taxa.'))
        : el('p', {}, el('strong', {}, `Quitando tudo em ${monthsText(best.months)}`), `, pagando ${brl(best.totalInterestCents)} de juros no total.`),
      focus ? el('p', {}, 'Coloque todo dinheiro extra em ', el('strong', {}, focus.name), ' e pague só a mínima nas outras. ', el('span', { class: 'muted' }, KIND_NOTE[p.recommended])) : null,
      p.savingsCents > 0 ? el('p', { class: 'muted' }, `Em relação à bola de neve, a avalanche economiza ${brl(p.savingsCents)} em juros.`) : null,
      el('div', { class: 'button-row no-print' }, el('div', { class: 'field' }, el('label', { class: 'label', for: 'dv-extra' }, 'E se eu pagar a mais por mês (R$)?'), extra.input), sim),
      best.order.length ? el('ol', { class: 'payoff-order' }, ...best.order.map((o) => el('li', {}, `${o.name} quitada no mês ${o.paidOffInMonth}`))) : null,
    );
  }

  const t = d.totals;
  return el(
    'div', { class: 'acc-stack' },
    t.initialCents ? card(el('h2', {}, 'Para sair do vermelho'), el('p', {}, el('strong', {}, brl(t.owedCents)), ' ainda a pagar. Você já pagou ', el('strong', {}, brl(t.paidCents)), ` (${t.progressPct}%).`)) : null,
    planBox,
    card(el('h2', {}, 'Nova dívida'), el('p', { class: 'muted' }, 'Cadastre o que você deve. O saldo cai a cada pagamento registrado, e o pagamento entra nos seus lançamentos como gasto em "Dívidas".'), form),
    card(el('h2', {}, 'Suas dívidas'), rows.length ? el('ul', { class: 'entries' }, ...rows) : el('p', { class: 'muted' }, 'Nenhuma dívida cadastrada ainda.')),
  );
}

export function viewFamilia(ctx, locked) {
  const h = ctx.household;
  const stack = (...c) => el('div', { class: 'acc-stack' }, ...c.filter(Boolean));
  if (h.role === 'member') {
    const leave = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Sair da conta compartilhada');
    leave.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Sair da conta compartilhada?', text: 'Você volta para a sua própria conta (sem os dados de ' + h.ownerEmail + ').', confirmLabel: 'Sair' }))) return;
      try {
        await ctx.api.leaveHousehold();
        toast('Você saiu da conta compartilhada.');
        ctx.reloadAccount();
      } catch {
        toast('Não consegui agora.');
      }
    });
    return stack(card(el('h2', {}, 'Conta compartilhada'), el('p', {}, 'Você usa a conta de ', el('strong', {}, h.ownerEmail), '. Lançamentos, dívidas, metas e lembretes são os mesmos dela. Só o titular paga, cancela e convida.'), el('div', { class: 'button-row' }, leave)));
  }
  const accept = h.invite
    ? (() => {
      const b = el('button', { class: 'btn btn-primary', type: 'button' }, 'Aceitar convite');
      b.addEventListener('click', async () => {
        try {
          await ctx.api.acceptHousehold();
          ctx.reloadAccount();
        } catch (e) {
          toast(e?.message || 'Não consegui aceitar agora.');
        }
      });
      return card(el('h2', {}, 'Você recebeu um convite'), el('p', {}, el('strong', {}, h.invite.ownerEmail), ' convidou você para a conta dela(e). Ao aceitar, você passa a usar os dados da conta de lá e deixa de usar a sua.'), el('div', { class: 'button-row' }, b));
    })()
    : null;
  if (!h.canInvite) {
    return stack(accept, locked ? locked() : stack(card(el('h2', {}, 'Conta compartilhada'), el('p', { class: 'muted' }, 'Disponível nos planos Ousado e Desbravador.'))));
  }
  let body;
  if (h.member) {
    const rm = el('button', { class: 'btn btn-secondary', type: 'button' }, h.member.status === 'pending' ? 'Cancelar convite' : 'Remover da conta');
    rm.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: h.member.status === 'pending' ? 'Cancelar o convite?' : 'Remover ' + h.member.email + '?', text: 'A pessoa deixa de ver os dados da conta. Nada é apagado.', confirmLabel: 'Confirmar' }))) return;
      try {
        await ctx.api.removeHouseholdMember();
        ctx.refresh();
      } catch {
        toast('Não consegui agora.');
      }
    });
    body = card(el('h2', {}, 'Quem divide a conta com você'), el('p', {}, el('strong', {}, h.member.email), h.member.status === 'pending' ? ' · convite enviado, aguardando aceite.' : ' · ativa(o).'), el('div', { class: 'button-row' }, rm));
  } else {
    const email = el('input', { class: 'input', id: 'hh-email', type: 'email', autocomplete: 'off', placeholder: 'email@dapessoa.com', required: true });
    const send = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Enviar convite');
    const form = el('form', { class: 'entry-form' }, el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'hh-email' }, 'E-mail de quem vai dividir a conta'), email), send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      send.disabled = true;
      try {
        await ctx.api.inviteHousehold(email.value.trim());
        toast('Convite enviado.');
        ctx.refresh();
      } catch (err) {
        send.disabled = false;
        toast(err?.message || 'Não consegui enviar agora.');
      }
    });
    body = card(el('h2', {}, 'Convidar pessoa para a conta'), el('p', { class: 'muted' }, 'Ideal para casal ou família que divide as contas de casa. A pessoa entra com o e-mail dela e passa a ver e editar a mesma conta: lançamentos, dívidas, metas e lembretes. Só você paga, cancela e convida. Uma pessoa por conta.'), form);
  }
  return stack(accept, body);
}
