// Categorias no Prumo: as do sistema + as que a pessoa cria. Usado por Lançamentos, Cartões e onde mais houver um seletor de categoria.
import { el, icon, toast } from './dom.js';
import { CATEGORIES, CATEGORY_LABEL } from '../vendor/engine.js';

export const NEW_CAT = '__nova__';
const CAT_SUGGESTIONS = ['Cartão de crédito', 'Parcela de financiamento', 'Assinaturas e streaming', 'Pets', 'Viagem', 'Presentes', 'Impostos e taxas', 'Investimentos'];

export const catLabel = (c) => CATEGORY_LABEL[c] ?? c;
/** Categorias próprias já carregadas: no mês (ctx.data) ou, em telas que não carregam o mês, em ctx.customCategories. */
export const customOf = (ctx) => ctx.data?.customCategories ?? ctx.customCategories ?? [];
export const catList = (ctx) => [...CATEGORIES, ...customOf(ctx)];

function remember(ctx, name) {
  const holder = ctx.data ?? ctx;
  if (!(holder.customCategories ?? []).includes(name)) holder.customCategories = [...(holder.customCategories ?? []), name];
}

/** Campo para criar uma categoria na hora. Entra no lugar do seletor (mesma célula da grade), então cabe no desktop e no mobile. */
export function categoryEditor(ctx, { onCreated, onCancel }) {
  const listId = `cat-sug-${Math.random().toString(36).slice(2, 8)}`;
  const taken = new Set(catList(ctx).map((c) => catLabel(c).toLowerCase()));
  const suggestions = el('datalist', { id: listId }, ...CAT_SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase())).map((s) => el('option', { value: s })));
  const input = el('input', { class: 'input input-sm', type: 'text', maxlength: '30', placeholder: 'Nome da categoria', 'aria-label': 'Nome da nova categoria', list: listId, autocomplete: 'off' });
  const ok = el('button', { class: 'btn btn-primary btn-sm icon-btn', type: 'button', 'aria-label': 'Criar categoria' }, icon('check'));
  const no = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': 'Cancelar' }, icon('x'));
  const box = el('div', { class: 'cat-new' }, input, ok, no, suggestions);
  async function save() {
    const name = input.value.trim();
    if (name.length < 2) return toast('Digite o nome da categoria (mínimo 2 letras).');
    ok.disabled = true;
    try {
      const r = await ctx.api.createCategory(name);
      remember(ctx, r.name);
      await onCreated(r.name);
    } catch (e) {
      ok.disabled = false;
      toast(e?.message || 'Não consegui criar a categoria agora.');
    }
  }
  ok.addEventListener('click', save);
  no.addEventListener('click', onCancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') onCancel();
  });
  window.setTimeout(() => input.focus(), 0);
  return box;
}

/**
 * Seletor de categoria com "＋ Nova categoria…" (o mesmo de Lançamentos). `first` é a opção neutra (ex.: Automática).
 * Quem chama lê o valor com `sel.value`; enquanto o editor está aberto o seletor volta para a opção neutra.
 */
export function categorySelect(ctx, { id, label, first, exclude = [] }) {
  const sel = el('select', { class: 'input', id, 'aria-label': label }, el('option', { value: '' }, first), ...catList(ctx).filter((c) => !exclude.includes(c)).map((c) => el('option', { value: c }, catLabel(c))), el('option', { value: NEW_CAT }, '＋ Nova categoria…'));
  sel.addEventListener('change', () => {
    if (sel.value !== NEW_CAT) return;
    sel.value = '';
    const editor = categoryEditor(ctx, {
      onCreated: async (name) => {
        sel.insertBefore(el('option', { value: name }, name), sel.lastElementChild);
        sel.value = name;
        editor.replaceWith(sel);
        toast(`Categoria "${name}" criada.`);
      },
      onCancel: () => editor.replaceWith(sel),
    });
    sel.replaceWith(editor);
  });
  return sel;
}
