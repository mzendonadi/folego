// Fale conosco: janela de mensagem direta (abre ao clicar em "Suporte" ou em suporte@folego.online, em qualquer tela).
// Sem JavaScript, os links continuam abrindo o programa de e-mail (mailto). A mensagem vira e-mail para o suporte; nada é guardado.
import { el, icon, toast } from './dom.js';
import * as api from './api.js';

let open = null;

export function openContact() {
  if (open) return open.showModal?.();
  const field = (label, input, cls = '') => el('div', { class: `field ${cls}` }, el('label', { class: 'label', for: input.id }, label), input);
  const name = el('input', { class: 'input', id: 'ct-nome', type: 'text', autocomplete: 'name', maxlength: '100', required: true, placeholder: 'Nome' });
  const email = el('input', { class: 'input', id: 'ct-email', type: 'email', autocomplete: 'email', maxlength: '200', required: true, placeholder: 'E-mail' });
  const phone = el('input', { class: 'input', id: 'ct-tel', type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: '30', placeholder: 'Telefone (opcional)' });
  const message = el('textarea', { class: 'input', id: 'ct-msg', rows: '6', maxlength: '2000', required: true, placeholder: 'Comentário' });
  // Isca para robôs: fora da tela e fora da navegação por teclado.
  const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'ct-trap' });
  const send = el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Enviar');
  const close = el('button', { class: 'btn btn-quiet btn-sm ct-close', type: 'button', 'aria-label': 'Fechar' }, icon('x'));
  const form = el(
    'form', { class: 'ct-form', novalidate: true },
    field('Nome', name), field('E-mail', email), field('Telefone', phone, 'ct-wide'), field('Comentário', message, 'ct-wide'), trap,
    el('div', { class: 'ct-actions ct-wide' }, send),
  );
  const body = el('div', { class: 'ct-body' }, el('h2', { id: 'ct-title' }, 'Fale com a gente'), el('p', { class: 'ct-lead' }, 'Será um prazer ajudá-lo.'), form);
  const dlg = el('dialog', { class: 'ct-dialog', 'aria-labelledby': 'ct-title' }, close, body);
  document.body.append(dlg);
  open = dlg;
  const shut = () => dlg.close();
  close.addEventListener('click', shut);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) shut(); }); // clique no fundo escuro fecha
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (name.value.trim().length < 2) return toast('Informe o seu nome.');
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return toast('Confira o e-mail para podermos responder.');
    if (message.value.trim().length < 5) return toast('Escreva a sua mensagem.');
    send.disabled = true;
    send.textContent = 'Enviando…';
    try {
      await api.sendContact({ name: name.value.trim(), email: email.value.trim(), ...(phone.value.trim() ? { phone: phone.value.trim() } : {}), message: message.value.trim(), website: trap.value });
      const ok = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, 'Fechar');
      ok.addEventListener('click', shut);
      body.replaceChildren(el('h2', { id: 'ct-title' }, 'Mensagem enviada'), el('p', { class: 'ct-lead' }, 'Obrigado! Respondemos no e-mail que você informou.'), ok);
    } catch (error) {
      send.disabled = false;
      send.textContent = 'Enviar';
      toast(error?.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : (error?.message || 'Não consegui enviar agora. Escreva para suporte@folego.online.'));
    }
  });
  dlg.addEventListener('close', () => { dlg.remove(); open = null; });
  dlg.showModal();
  name.focus();
}
