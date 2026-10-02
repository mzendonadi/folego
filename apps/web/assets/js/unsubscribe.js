// Cancelar o recebimento de e-mails de campanha (link assinado que vai em todo e-mail). Não pede login nem senha.
import { el, icon } from './dom.js';
import * as api from './api.js';

export async function renderUnsubscribe(root, token) {
  root.replaceChildren(el('section', { class: 'card d-section' }, el('p', { class: 'muted', role: 'status' }, 'Cancelando…')));
  try {
    await api.unsubscribeEmails(token);
    root.replaceChildren(el('section', { class: 'card d-section' }, el('h2', {}, 'Pronto, você não receberá mais esses e-mails'), el('p', { class: 'note' }, icon('check'), el('span', {}, 'Cancelamos o recebimento de mensagens de novidades e relacionamento do Fôlego.')), el('p', { class: 'muted' }, 'Você continua recebendo só o que a sua conta precisa, como o código de login e o aviso de vencimento do plano.')));
  } catch {
    root.replaceChildren(el('section', { class: 'card d-section' }, el('h2', {}, 'Não conseguimos cancelar'), el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'O link está incompleto ou foi alterado. Abra o link direto do e-mail de novo.'))));
  }
}
