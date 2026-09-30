// Confirmação no padrão visual do site (no lugar do window.confirm do navegador, que ignora o tema e a fonte).
import { el, icon } from './dom.js';

/** @returns {Promise<boolean>} true se a pessoa confirmou. */
export function confirmDialog({ title, text, confirmLabel = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    const ok = el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button' }, danger ? icon('trash') : null, confirmLabel);
    const dialog = el(
      'dialog',
      { class: 'dialog dialog-sm', 'aria-labelledby': 'confirm-title' },
      el(
        'div', { class: 'dialog-inner' },
        el('header', { class: 'dialog-head' }, el('h2', { id: 'confirm-title' }, title)),
        el('div', { class: 'dialog-body prose' }, el('p', {}, text)),
        el('footer', { class: 'dialog-foot' }, cancel, ok),
      ),
    );
    let answer = false;
    const done = () => {
      if (dialog.open) dialog.close();
    };
    cancel.addEventListener('click', done);
    ok.addEventListener('click', () => {
      answer = true;
      done();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer); // também cobre a tecla Esc
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
