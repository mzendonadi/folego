// Lançamentos do mês organizados por ORIGEM: cada conta e cada cartão num bloco só dele, com o resumo à vista e o detalhe ao tocar.
// Todo lançamento (inclusive importado) pode ser corrigido: texto, valor, data e categoria.
// A mesma tela serve ao pessoal e à empresa: `opts` troca as categorias e as chamadas (a empresa tem as suas e nunca toca no pessoal).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { NEW_CAT, catLabel, catList, categoryEditor } from './account-categories.js';

const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const KIND_LABEL = { conta: 'Conta corrente', poupanca: 'Poupança', dinheiro: 'Dinheiro', caixa: 'Caixa', cartao: 'Cartão (carteira)', outra: 'Outra carteira' };

/**
 * opts (tudo opcional; sem opts é o pessoal):
 *   categories: [[valor, rótulo]]  categorias próprias (sem "Nova categoria")
 *   api: { updateEntry, setEntryCategory, deleteEntry }   chamadas da empresa
 *   refresh: () => void
 *   locked: (x) => string | null   motivo para travar data e valor de um lançamento (ex.: ligado ao pessoal)
 */
const catsOf = (ctx, opts) => (opts.categories ? opts.categories.map(([v]) => v) : catList(ctx));
const labelOf = (opts) => (c) => (opts.categories ? (opts.categories.find(([v]) => v === c)?.[1] ?? c) : catLabel(c));
const apiOf = (ctx, opts) => opts.api ?? { updateEntry: ctx.api.updateEntry, setEntryCategory: ctx.api.setEntryCategory, deleteEntry: ctx.api.deleteEntry };
const refreshOf = (ctx, opts) => opts.refresh ?? ctx.refresh;

/** Agrupa por conta/carteira, por cartão de crédito e, por fim, o que ainda está sem origem. */
export function groupEntries(entries, wallets) {
  const wallet = new Map(wallets.map((w) => [w.id, w]));
  const groups = new Map();
  const add = (key, base, x) => {
    if (!groups.has(key)) groups.set(key, { key, ...base, items: [], inCents: 0, outCents: 0, invoicePaidCents: 0 });
    const g = groups.get(key);
    g.items.push(x);
    if (x.transfer && x.transferKind !== 'investment_redeem') g.invoicePaidCents += -x.amountCents;
    else if (x.amountCents >= 0) g.inCents += x.amountCents;
    else g.outCents += -x.amountCents;
  };
  for (const x of entries) {
    if (x.cardName) add(`card:${x.cardName}`, { type: 'cartao', order: 1, title: x.cardName, sub: 'Cartão de crédito' }, x);
    else if (x.walletId && wallet.has(x.walletId)) { const w = wallet.get(x.walletId); add(`w:${w.id}`, { type: 'conta', order: 0, title: w.name, sub: KIND_LABEL[w.kind] ?? 'Carteira' }, x); }
    else add('loose', { type: 'solto', order: 2, title: 'Sem conta definida', sub: 'Lançamentos que ainda não foram ligados a uma conta' }, x);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'pt-BR'));
}

function editRow(ctx, x, done, opts) {
  const api = apiOf(ctx, opts);
  const lockedWhy = opts.locked?.(x) ?? null;
  const date = el('input', { class: 'input input-sm', type: 'date', value: x.date, 'aria-label': 'Data', ...(lockedWhy ? { disabled: true } : {}) });
  const note = el('input', { class: 'input input-sm', type: 'text', maxlength: '120', value: x.note, 'aria-label': 'Descrição' });
  const amount = moneyInput({ id: `ed-v-${x.id}`, ariaLabel: 'Valor' });
  amount.input.value = (Math.abs(x.amountCents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  if (lockedWhy) amount.input.disabled = true;
  const sign = el('select', { class: 'input input-sm', 'aria-label': 'Tipo', ...(lockedWhy ? { disabled: true } : {}) }, el('option', { value: '-1', selected: x.amountCents < 0 }, 'Saída'), el('option', { value: '1', selected: x.amountCents >= 0 }, 'Entrada'));
  const options = catsOf(ctx, opts);
  if (!options.includes(x.category)) options.push(x.category);
  const cat = el('select', { class: 'input input-sm', 'aria-label': 'Categoria' }, ...options.map((c) => el('option', { value: c, selected: c === x.category }, labelOf(opts)(c))));
  const save = el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Salvar');
  const cancel = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar');
  cancel.addEventListener('click', done);
  const form = el('form', { class: 'ledger-edit' },
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Descrição'), note),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Data'), date),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Tipo'), sign),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Valor (R$)'), amount.input),
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Categoria'), cat),
    lockedWhy ? el('p', { class: 'fine muted' }, lockedWhy) : null,
    el('div', { class: 'button-row' }, save, cancel));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = amount.cents();
    if (!cents) return toast('Digite o valor.');
    if (!date.value || !note.value.trim()) return toast('Preencha a data e a descrição.');
    const patch = {};
    if (note.value.trim() !== x.note) patch.note = note.value.trim();
    if (date.value !== x.date) patch.date = date.value;
    const signed = Number(sign.value) * cents;
    if (signed !== x.amountCents) patch.amountCents = signed;
    if (cat.value !== x.category) patch.category = cat.value;
    if (Object.keys(patch).length === 0) return done();
    save.disabled = true;
    try {
      await api.updateEntry(x.id, patch);
      toast('Lançamento corrigido.');
      refreshOf(ctx, opts)();
    } catch (err) {
      save.disabled = false;
      toast(err?.status === 422 && err.message ? err.message : 'Não consegui salvar agora.');
    }
  });
  return form;
}

function entryRow(ctx, x, opts) {
  const api = apiOf(ctx, opts);
  const li = el('li', { class: 'entry-row' });
  const show = () => {
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Remover ${x.note}` }, icon('trash'));
    del.addEventListener('click', async () => {
      try {
        await api.deleteEntry(x.id);
        toast('Lançamento removido.');
        refreshOf(ctx, opts)();
      } catch {
        toast('Não consegui remover agora.');
      }
    });
    const edit = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Editar ${x.note}` }, icon('pencil'));
    edit.addEventListener('click', () => li.replaceChildren(editRow(ctx, x, show, opts)));
    const options = catsOf(ctx, opts);
    if (!options.includes(x.category)) options.push(x.category);
    let current = x.category;
    const cat = el('select', { class: 'input input-sm', 'aria-label': `Categoria de ${x.note}` }, ...options.map((c) => el('option', { value: c, selected: c === x.category }, labelOf(opts)(c))), ...(opts.categories ? [] : [el('option', { value: NEW_CAT }, '＋ Nova categoria…')]));
    cat.addEventListener('change', () => {
      if (cat.value === NEW_CAT) {
        cat.value = current;
        const editor = categoryEditor(ctx, {
          onCreated: async (name) => {
            await api.setEntryCategory(x.id, name);
            toast(`Categoria "${name}" criada e aplicada.`);
            refreshOf(ctx, opts)();
          },
          onCancel: () => editor.replaceWith(cat),
        });
        cat.replaceWith(editor);
        return;
      }
      current = cat.value;
      api.setEntryCategory(x.id, cat.value).then(() => toast('Categoria atualizada.')).catch(() => toast('Não consegui salvar a categoria.'));
    });
    li.replaceChildren(
      el('span', { class: 'entry-date muted' }, fmtDay(x.date)),
      el('span', { class: 'entry-note' }, x.note,
        x.transfer ? el('span', { class: 'wallet-tag' }, x.transferKind === 'investment_redeem' ? ' · resgate de investimento (não é receita)' : ' · pagamento de fatura (fora dos gastos)') : null,
        x.tag ? el('span', { class: 'wallet-tag' }, ` · ${x.tag}`) : null,
        x.installmentNo ? el('span', { class: 'wallet-tag' }, ` · parcela ${x.installmentNo}/${x.installmentTotal}`) : null),
      cat,
      el('strong', { class: `entry-amount ${x.amountCents < 0 ? 'neg' : 'pos'}` }, brl(x.amountCents)),
      el('span', { class: 'ledger-actions' }, edit, del),
    );
  };
  show();
  return li;
}

/** Blocos recolhidos: o resumo de cada conta/cartão fica à vista; tocar abre os lançamentos dele. */
export function ledgerGroups(ctx, entries, wallets, opts = {}) {
  const groups = groupEntries(entries, wallets);
  return el('div', { class: 'ledger-groups' }, ...groups.map((g) => {
    const ico = g.type === 'cartao' ? 'card' : g.type === 'conta' ? 'bank' : 'wallet';
    const nCompras = g.items.filter((x) => !x.transfer).length;
    const summary = g.type === 'cartao'
      ? [el('span', { class: 'lg-fig' }, el('span', { class: 'muted fine' }, 'Compras do mês'), el('strong', { class: 'neg' }, brl(g.outCents)))]
      : [
        el('span', { class: 'lg-fig' }, el('span', { class: 'muted fine' }, 'Entrou'), el('strong', { class: 'pos' }, brl(g.inCents))),
        el('span', { class: 'lg-fig' }, el('span', { class: 'muted fine' }, 'Saiu'), el('strong', { class: 'neg' }, brl(g.outCents))),
      ];
    const head = el('button', { class: 'lg-head', type: 'button', 'aria-expanded': 'false' },
      el('span', { class: 'lg-ico' }, icon(ico)),
      el('span', { class: 'lg-title' }, el('strong', {}, g.title), el('span', { class: 'muted fine' }, g.sub), el('span', { class: 'muted fine' }, `${g.items.length} ${g.items.length === 1 ? 'lançamento' : 'lançamentos'}${g.type === 'cartao' ? `, ${nCompras} ${nCompras === 1 ? 'compra' : 'compras'}` : ''}`)),
      el('span', { class: 'lg-figs' }, ...summary),
      icon('chevron', 'icon lg-chev'));
    const note = g.invoicePaidCents > 0 ? el('p', { class: 'fine muted lg-note' }, icon('info'), ` Desta conta saíram ${brl(g.invoicePaidCents)} para pagar fatura de cartão. Isso não conta como gasto: o gasto está nas compras do cartão.`) : null;
    const body = el('div', { class: 'lg-body', hidden: true }, note, el('ul', { class: 'entries' }, ...g.items.map((x) => entryRow(ctx, x, opts))));
    head.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
    });
    return el('section', { class: `lg lg-${g.type}` }, head, body);
  }));
}
