// Assinatura: abas "Carteiras" e "Lembretes" (o plano é exigido no servidor; aqui só desenhamos).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');
export const WALLET_KIND_LABEL = { dinheiro: 'Dinheiro', conta: 'Conta bancária', cartao: 'Cartão', poupanca: 'Poupança', outra: 'Outra' };

export function viewCarteiras(ctx) {
  const w = ctx.wallets;
  const name = el('input', { class: 'input', id: 'cw-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Nubank, carteira, cartão do mercado' });
  const kind = el('select', { class: 'input', id: 'cw-tipo', 'aria-label': 'Tipo da carteira' }, ...Object.entries(WALLET_KIND_LABEL).map(([v, l]) => el('option', { value: v }, l)));
  const add = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Criar carteira');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'cw-nome' }, 'Nome'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'cw-tipo' }, 'Tipo'), kind),
    add,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) return toast('Dê um nome à carteira.');
    add.disabled = true;
    try {
      await ctx.api.createWallet({ name: name.value.trim(), kind: kind.value });
      toast('Carteira criada.');
      ctx.refresh();
    } catch (err) {
      add.disabled = false;
      toast(err?.status === 422 ? 'Você chegou ao limite de carteiras.' : 'Não consegui criar agora.');
    }
  });

  const row = (title, sub, cents, walletId) => {
    let del = null;
    if (walletId) {
      del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar a carteira ${title}` }, icon('trash'));
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: `Apagar "${title}"?`, text: 'Os lançamentos dela não somem: ficam sem carteira.', confirmLabel: 'Apagar' }))) return;
        try {
          await ctx.api.deleteWallet(walletId);
          toast('Carteira apagada.');
          ctx.refresh();
        } catch {
          toast('Não consegui apagar agora.');
        }
      });
    }
    return el('li', { class: 'wallet-row' }, el('div', {}, el('strong', {}, title), el('p', { class: 'muted fine' }, sub)), el('strong', { class: `entry-amount ${cents < 0 ? 'neg' : 'pos'}` }, brl(cents)), del);
  };
  const items = [
    ...w.wallets.map((x) => row(x.name, `${WALLET_KIND_LABEL[x.kind] ?? x.kind} · ${x.entries} lançamentos`, x.balanceCents, x.id)),
    w.unassigned.entries > 0 ? row('Sem carteira', `${w.unassigned.entries} lançamentos`, w.unassigned.balanceCents, null) : null,
  ].filter(Boolean);
  return el(
    'div', { class: 'acc-stack' },
    card(el('h2', {}, 'Nova carteira'), el('p', { class: 'muted' }, 'Separe onde o dinheiro está: conta, dinheiro vivo, cartão. O saldo de cada uma é a soma dos lançamentos ligados a ela.'), form),
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
