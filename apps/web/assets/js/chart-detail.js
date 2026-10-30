// Detalhamento dos totais dos gráficos (plano Desbravador): clicar num valor somado abre este quadro com o que o compõe.
// Cada linha mostra rótulo, valor e fatia do total; se quem chamou passar `drill`, a linha abre os lançamentos que a formam.
// Nada aqui busca dado por conta própria: `rows` vem pronto e `drill(row)` devolve [{ date, note, origin, cents }].
import { el, icon } from './dom.js';
import { brl } from './format.js';

const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MAX_ENTRIES = 60;

/**
 * @param {{ title: string, subtitle?: string, totalLabel?: string, total: number, rows: Array<{ key?: string, label: string, sub?: string, value: number, color?: string }>,
 *   format?: (n: number) => string, drill?: (row: object) => Promise<Array<{ date: string, note: string, origin?: string, cents: number }>>,
 *   openIn?: (row: object) => void, openInLabel?: string, notes?: string[] }} o
 */
export function openDetail(o) {
  const fmt = o.format ?? brl;
  const sum = o.rows.reduce((s, r) => s + r.value, 0);
  const shares = o.rows.every((r) => r.value >= 0) && sum > 0;
  const dialog = el('dialog', { class: 'dialog dialog-detail', 'aria-labelledby': 'cd-title' });
  const close = el('button', { class: 'btn btn-primary', type: 'button' }, 'Fechar');
  const x = el('button', { class: 'btn btn-quiet btn-sm cd-x', type: 'button', 'aria-label': 'Fechar' }, icon('x'));

  const entriesBox = (row) => {
    const box = el('div', { class: 'cd-entries', role: 'region', 'aria-label': `Lançamentos de ${row.label}` }, el('p', { class: 'muted fine', role: 'status' }, 'Buscando os lançamentos…'));
    o.drill(row).then((list) => {
      if (!list.length) { box.replaceChildren(el('p', { class: 'muted fine' }, 'Nenhum lançamento encontrado para este item.')); return; }
      const shown = list.slice(0, MAX_ENTRIES);
      box.replaceChildren(
        el('ul', { class: 'cd-ent-list' }, ...shown.map((e) => el('li', {}, el('span', { class: 'cd-ent-date' }, fmtDate(e.date)), el('span', { class: 'cd-ent-note' }, e.note || 'Sem descrição', e.origin ? el('small', { class: 'muted' }, e.origin) : null), el('span', { class: 'cd-ent-val' }, fmt(Math.abs(e.cents)))))),
        list.length > shown.length ? el('p', { class: 'fine muted' }, `Mostrando ${shown.length} de ${list.length} lançamentos. Veja todos nos Relatórios.`) : null,
        o.openIn ? (() => { const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, `${o.openInLabel ?? 'Abrir nos Relatórios'}`); b.addEventListener('click', () => { dialog.close(); o.openIn(row); }); return b; })() : null,
      );
    }).catch(() => box.replaceChildren(el('p', { class: 'muted fine' }, 'Não consegui buscar os lançamentos agora. Tente de novo.')));
    return box;
  };

  const list = el('ul', { class: 'cd-list' }, ...o.rows.map((r) => {
    const head = [
      r.color ? el('i', { class: 'ch-dot', style: `background:${r.color}` }) : null,
      el('span', { class: 'cd-name' }, r.label, r.sub ? el('small', { class: 'muted' }, r.sub) : null),
      shares ? el('span', { class: 'cd-pct muted' }, `${Math.round((r.value / sum) * 100)}%`) : null,
      el('strong', { class: `cd-val${r.value < 0 ? ' neg' : ''}` }, fmt(r.value)),
    ];
    const li = el('li', {});
    if (!o.drill) { li.append(el('div', { class: 'cd-row' }, ...head)); return li; }
    const b = el('button', { class: 'cd-row cd-row-btn', type: 'button', 'aria-expanded': 'false' }, ...head, icon('chevron', 'icon cd-chev'));
    let box = null;
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open));
      if (open) { box?.remove(); box = null; return; }
      box = entriesBox(r);
      li.append(box);
    });
    li.append(b);
    return li;
  }));

  dialog.append(el('div', { class: 'dialog-inner' },
    el('header', { class: 'dialog-head cd-head' }, el('div', {}, el('h2', { id: 'cd-title' }, o.title), o.subtitle ? el('p', { class: 'muted cd-sub' }, o.subtitle) : null), x),
    el('div', { class: 'dialog-body cd-body' },
      el('p', { class: 'cd-total' }, el('span', { class: 'cd-total-label' }, o.totalLabel ?? 'Total'), el('strong', {}, fmt(o.total))),
      ...(o.notes ?? []).map((n) => el('p', { class: 'fine muted' }, n)),
      list,
      o.drill ? el('p', { class: 'fine muted cd-hint' }, 'Toque numa linha para ver os lançamentos que formam o valor.') : null),
    el('footer', { class: 'dialog-foot' }, close)));
  const done = () => { if (dialog.open) dialog.close(); };
  close.addEventListener('click', done);
  x.addEventListener('click', done);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) done(); }); // toque fora do quadro
  dialog.addEventListener('close', () => dialog.remove()); // Esc também cai aqui; o foco volta para quem abriu
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  return dialog;
}
